import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getAIConfig } from '../config/vertexConfig.js';
import { getDb } from '../db/schema.js';
import { researchSegment } from './researcher.js';
import { scoreCandidate } from './scorer.js';
import { generateBrief } from './briefWriter.js';
import { TokenTracker } from './tokenTracker.js';
import { ActivityLogger } from './activityLogger.js';
import type { ResearchCandidate } from './researcher.js';
import type { ScoringResult } from './scorer.js';
import type { BriefResult } from './briefWriter.js';
import type {
  ICPConfigParsed,
  Exclusion,
  RecommendationLedger,
  LeadFeedback,
} from '../types/index.js';
import type { FeedbackPattern, ExtendedICPConfig } from '../types/index.js';
import { getSetting, getDefaultPipelineConfig, getDefaultPromptConfig } from '../routes/icp.js';
import { loadExtendedIcpConfig } from './config/icpConfigLoader.js';
import { enrichCandidates } from './enrichment/service.js';
import { eventBus } from '../events/eventBus.js';

type Segment = 'ENT' | 'MM' | 'SMB';
const SEGMENTS: Segment[] = ['ENT', 'MM', 'SMB'];

export async function runPipeline(triggeredBy: string): Promise<string> {
  const db = getDb();
  const runId = uuidv4();

  // Create pipeline run record
  db.prepare(
    `INSERT INTO pipeline_runs (id, triggered_by, status, started_at, created_at)
     VALUES (?, ?, 'running', datetime('now'), datetime('now'))`
  ).run(runId, triggeredBy);

  const logger = new ActivityLogger(runId);

  try {
    // Load pipeline config
    const pipelineConfig = getSetting('pipeline', getDefaultPipelineConfig());
    const promptConfig = getSetting('prompts', getDefaultPromptConfig());
    const TOP_N_PER_SEGMENT = pipelineConfig.leads_per_segment || 5;
    const modelToUse = pipelineConfig.model || getAIConfig().defaultModel;
    const tracker = new TokenTracker(modelToUse);

    // Progress tracking helpers
    let stepNumber = 0;
    // Estimate: 3 research + 3 enrich + ~15 score + ~15 brief = ~36 steps
    let totalSteps = SEGMENTS.length + SEGMENTS.length + (TOP_N_PER_SEGMENT * SEGMENTS.length * 2);

    const emitProgress = (phase: string, currentCompany?: string) => {
      stepNumber++;
      const progressData = {
        current_step: phase,
        current_company: currentCompany,
        step_number: stepNumber,
        total_steps: totalSteps,
        phase,
        tokens: tracker.getSummary(),
      };
      db.prepare('UPDATE pipeline_runs SET progress_json = ? WHERE id = ?')
        .run(JSON.stringify(progressData), runId);
      eventBus.emit('pipeline.progress', { run_id: runId, ...progressData });
    };

    // Emit token updates on each API call
    tracker.onUsage((summary) => {
      logger.setTokens({ input_tokens: summary.input_tokens, output_tokens: summary.output_tokens, estimated_cost: summary.estimated_cost });
      const progressData = {
        current_step: 'processing',
        step_number: stepNumber,
        total_steps: totalSteps,
        phase: 'processing',
        tokens: tracker.getSummary(),
      };
      eventBus.emit('pipeline.progress', { run_id: runId, ...progressData });
    });

    // Load ICP config (extended with all settings)
    const icpConfig = loadExtendedIcpConfig(promptConfig);

    // Load exclusions
    const exclusions = loadExclusions();

    // Load feedback patterns
    const feedbackPatterns = loadFeedbackPatterns();

    // Emit pipeline.started
    eventBus.emit('pipeline.started', {
      run_id: runId,
      triggered_by: triggeredBy,
    });

    logger.milestone(`Pipeline started — Model: ${modelToUse}`, { model: modelToUse, segments: SEGMENTS, leads_per_segment: TOP_N_PER_SEGMENT });

    // Research all 3 segments in parallel
    emitProgress('research');
    logger.phaseStart('research', `Researching ${SEGMENTS.length} segments (${TOP_N_PER_SEGMENT} leads each)...`);
    const researchResults = await Promise.all(
      SEGMENTS.map((segment) =>
        researchSegment(segment, icpConfig, exclusions, feedbackPatterns, modelToUse, tracker)
      )
    );

    const allCandidates: { segment: Segment; candidates: ResearchCandidate[] }[] =
      SEGMENTS.map((segment, i) => ({
        segment,
        candidates: researchResults[i],
      }));

    const candidateSummary = allCandidates.map((r) => `${r.segment}=${r.candidates.length}`).join(', ');
    logger.phaseComplete('research', `Research complete — ${candidateSummary}`, {
      candidates_per_segment: Object.fromEntries(allCandidates.map(r => [r.segment, r.candidates.length])),
    });

    // Enrich candidates with external data sources
    emitProgress('enrichment');
    logger.phaseStart('enrichment', 'Enriching candidates with external data sources...');
    for (const segResult of allCandidates) {
      logger.thinking('enrichment', `Enriching ${segResult.segment} candidates — checking Clearbit, LinkedIn, web sources...`);
      const { candidates: enriched, summary } = await enrichCandidates(segResult.candidates);
      segResult.candidates = enriched;
      if (summary.enriched_count > 0) {
        logger.finding('enrichment', segResult.segment, `Enriched ${summary.enriched_count}/${summary.total_candidates} candidates`, {
          sources_used: summary.sources_used,
          enriched_count: summary.enriched_count,
        });
      }
    }
    logger.phaseComplete('enrichment', 'Enrichment complete');

    // Score all candidates
    const scoredCandidates: {
      segment: Segment;
      candidate: ResearchCandidate;
      score: ScoringResult;
    }[] = [];

    // Update total steps now that we know actual candidate count
    const totalCandidateCount = allCandidates.reduce((s, r) => s + r.candidates.length, 0);
    totalSteps = SEGMENTS.length + SEGMENTS.length + totalCandidateCount + (TOP_N_PER_SEGMENT * SEGMENTS.length);

    logger.phaseStart('scoring', `Scoring ${totalCandidateCount} candidates against ICP...`);
    for (const { segment, candidates } of allCandidates) {
      for (const candidate of candidates) {
        emitProgress('scoring', candidate.company_name);
        logger.thinking('scoring', `Scoring ${candidate.company_name} against ICP criteria...`);
        const score = await scoreCandidate(candidate, icpConfig, modelToUse, tracker);
        scoredCandidates.push({ segment, candidate, score });
        logger.finding('scoring', candidate.company_name, `Score: ${score.fit_score}/100 — ${score.fit_score_label}`, {
          fit_score: score.fit_score,
          label: score.fit_score_label,
          confidence: score.confidence,
        });
      }
    }

    logger.phaseComplete('scoring', `Scoring complete — ${scoredCandidates.length} candidates scored`, {
      total_scored: scoredCandidates.length,
      avg_score: Math.round(scoredCandidates.reduce((s, c) => s + c.score.fit_score, 0) / scoredCandidates.length),
    });

    // Select top N per segment
    const selected: typeof scoredCandidates = [];
    for (const segment of SEGMENTS) {
      const segmentCandidates = scoredCandidates
        .filter((sc) => sc.segment === segment)
        .sort((a, b) => b.score.fit_score - a.score.fit_score)
        .slice(0, TOP_N_PER_SEGMENT);
      selected.push(...segmentCandidates);
    }

    logger.thinking('brief_generation', `Selected top ${selected.length} candidates for brief generation`);

    // Generate briefs for selected candidates
    const briefResults: {
      candidate: ResearchCandidate;
      score: ScoringResult;
      brief: BriefResult;
    }[] = [];

    // Generate briefs sequentially for progress tracking
    logger.phaseStart('brief_generation', `Generating outreach briefs for ${selected.length} candidates...`);
    for (const { candidate, score } of selected) {
      emitProgress('brief_generation', candidate.company_name);
      logger.thinking('brief_generation', `Writing outreach brief for ${candidate.company_name}...`);
      const brief = await generateBrief(candidate, score, icpConfig, modelToUse, tracker);
      briefResults.push({ candidate, score, brief });
      logger.finding('brief_generation', candidate.company_name, `Brief ready — ${brief.personas?.length || 0} personas identified`);
    }

    logger.phaseComplete('brief_generation', `Brief generation complete — ${briefResults.length} briefs ready`);

    // Insert leads and personas into DB
    const insertLead = db.prepare(
      `INSERT INTO leads (
        id, run_id, company_name, segment, hq_location, employee_count,
        founded_year, funding_stage, total_funding, investors, website,
        fit_score, fit_score_label, confidence, why_now, score_breakdown,
        pain_hypotheses, tech_stack, competitive_displacement,
        outreach_strategy, source_citations, brief_markdown, signal_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    );

    const insertPersona = db.prepare(
      `INSERT INTO personas (
        id, lead_id, role_type, name, title, linkedin_url, department,
        tenure, outreach_angle, talking_points, outreach_message,
        social_signals, buying_signals, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    );

    const findLedgerEntry = db.prepare(
      `SELECT id, times_recommended FROM recommendations_ledger WHERE company_name = ?`
    );

    const insertLedger = db.prepare(
      `INSERT INTO recommendations_ledger (id, company_name, domain, first_recommended_at, last_recommended_at, times_recommended)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), 1)`
    );

    const updateLedger = db.prepare(
      `UPDATE recommendations_ledger
       SET last_recommended_at = datetime('now'), times_recommended = times_recommended + 1
       WHERE id = ?`
    );

    const insertAll = db.transaction(() => {
      for (const { candidate, score, brief } of briefResults) {
        const leadId = uuidv4();

        const sourceCitations = brief.source_citations || [];
        const signalCount = Array.isArray(sourceCitations) ? sourceCitations.length : 0;
        insertLead.run(
          leadId,
          runId,
          candidate.company_name,
          candidate.segment,
          candidate.hq_location,
          candidate.employee_count_estimate,
          candidate.founded_year,
          candidate.funding_stage,
          candidate.total_funding,
          candidate.investors,
          candidate.domain,
          score.fit_score,
          score.fit_score_label,
          score.confidence,
          JSON.stringify(brief.why_now),
          JSON.stringify(score.score_breakdown),
          JSON.stringify(brief.pain_hypotheses),
          JSON.stringify(brief.tech_stack),
          JSON.stringify(brief.competitive_displacement),
          brief.outreach_strategy,
          JSON.stringify(sourceCitations),
          brief.brief_markdown,
          signalCount
        );

        // Insert personas
        for (const persona of brief.personas) {
          insertPersona.run(
            uuidv4(),
            leadId,
            persona.role_type,
            persona.name,
            persona.title,
            persona.linkedin_url,
            persona.department,
            persona.tenure,
            persona.outreach_angle,
            persona.talking_points,
            persona.outreach_message,
            persona.social_signals,
            persona.buying_signals
          );
        }

        // Update recommendations ledger
        const existing = findLedgerEntry.get(candidate.company_name) as
          | { id: string; times_recommended: number }
          | undefined;
        if (existing) {
          updateLedger.run(existing.id);
        } else {
          insertLedger.run(uuidv4(), candidate.company_name, candidate.domain);
        }
      }
    });

    insertAll();

    // Emit events for created leads
    for (const { candidate, score } of briefResults) {
      eventBus.emit('lead.created', {
        lead_id: '',
        company_name: candidate.company_name,
        source_type: 'outbound_research',
        domain: candidate.domain || undefined,
      });
      eventBus.emit('lead.scored', {
        lead_id: '',
        company_name: candidate.company_name,
        fit_score: score.fit_score,
        fit_score_label: score.fit_score_label,
        confidence: score.confidence,
      });
    }

    // Update pipeline run status with token usage
    const usage = tracker.getSummary();
    db.prepare(
      `UPDATE pipeline_runs
       SET status = 'completed', completed_at = datetime('now'), lead_count = ?,
           input_tokens = ?, output_tokens = ?, estimated_cost = ?, model_used = ?
       WHERE id = ?`
    ).run(briefResults.length, usage.input_tokens, usage.output_tokens, usage.estimated_cost, usage.model, runId);

    // Emit pipeline.completed
    eventBus.emit('pipeline.completed', {
      run_id: runId,
      lead_count: briefResults.length,
      estimated_cost: usage.estimated_cost,
    });

    logger.milestone(`Pipeline complete — ${briefResults.length} leads generated`, {
      lead_count: briefResults.length,
      tokens: usage.total_tokens,
      estimated_cost: usage.estimated_cost,
      model: usage.model,
    });

    return runId;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('pipeline', 'Pipeline failed', errorMessage);

    db.prepare(
      `UPDATE pipeline_runs
       SET status = 'failed', completed_at = datetime('now'), error_message = ?
       WHERE id = ?`
    ).run(errorMessage, runId);

    eventBus.emit('pipeline.failed', {
      run_id: runId,
      error: errorMessage,
    });

    throw err;
  }
}

function loadExclusions(): Exclusion[] {
  const db = getDb();
  return db.prepare('SELECT * FROM exclusions').all() as Exclusion[];
}

function loadFeedbackPatterns(): FeedbackPattern[] {
  const db = getDb();
  const patterns: FeedbackPattern[] = [];

  // Aggregate feedback by verdict to find patterns
  const feedbackRows = db
    .prepare(
      `SELECT lf.verdict, lf.reason, l.segment, l.company_name
       FROM lead_feedback lf
       JOIN leads l ON l.id = lf.lead_id
       ORDER BY lf.created_at DESC
       LIMIT 100`
    )
    .all() as Array<{
    verdict: string;
    reason: string | null;
    segment: string;
    company_name: string;
  }>;

  // Count positive and negative feedback reasons
  const reasonCounts: Record<string, { direction: 'positive' | 'negative'; count: number }> = {};

  for (const row of feedbackRows) {
    if (!row.reason) continue;
    const key = row.reason.toLowerCase().trim();
    if (!reasonCounts[key]) {
      reasonCounts[key] = {
        direction: row.verdict === 'good_fit' ? 'positive' : 'negative',
        count: 0,
      };
    }
    reasonCounts[key].count++;
  }

  for (const [pattern, data] of Object.entries(reasonCounts)) {
    if (data.count >= 2) {
      patterns.push({ pattern, direction: data.direction, count: data.count });
    }
  }

  return patterns;
}
