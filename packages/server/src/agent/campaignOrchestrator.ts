import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { getDb } from '../db/schema.js';
import { scoreCandidate } from './scorer.js';
import { generateBrief } from './briefWriter.js';
import { auditBrief, aiAuditBrief } from './briefAuditor.js';
import { getCampaignResearchPrompt } from './prompts/campaign.js';
import { TokenTracker, MultiModelTokenTracker } from './tokenTracker.js';
import { ActivityLogger } from './activityLogger.js';
import { registerRun, unregisterRun } from './runRegistry.js';
import type { ResearchCandidate } from './researcher.js';
import type { ScoringResult } from './scorer.js';
import type { BriefResult } from './briefWriter.js';
import type { CampaignParsed, Exclusion, FunnelConfig, FunnelStepConfig } from '../types/index.js';
import type { ExtendedICPConfig } from './prompts/research.js';
import { getSetting, getDefaultPipelineConfig, getDefaultPromptConfig, getDefaultFunnelConfig } from '../routes/icp.js';
import { loadExtendedIcpConfig } from './config/icpConfigLoader.js';
import { enrichCandidates } from './enrichment/service.js';
import { validateCandidateDomains, shouldKeepCandidate } from './validation/domainValidator.js';
import { eventBus } from '../events/eventBus.js';

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) return jsonMatch[1].trim();
  return text.trim();
}

function normalizeCompanyName(name: string): string {
  return name.toLowerCase()
    .replace(/[,.]|inc|llc|ltd|corp|corporation|co|company|technologies|technology|tech|solutions|software|group|holdings|international|global/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFuzzyDuplicate(name1: string, name2: string): boolean {
  const n1 = normalizeCompanyName(name1);
  const n2 = normalizeCompanyName(name2);
  if (n1 === n2) return true;
  // Check if one is a substring of the other (for "Acme" vs "Acme Corp")
  if (n1.length > 2 && n2.length > 2) {
    if (n1.includes(n2) || n2.includes(n1)) return true;
  }
  return false;
}

function parseCampaignRow(row: any): CampaignParsed {
  return {
    ...row,
    example_companies: JSON.parse(row.example_companies || '[]'),
    target_signals: JSON.parse(row.target_signals || '[]'),
    anti_patterns: JSON.parse(row.anti_patterns || '[]'),
    target_categories: JSON.parse(row.target_categories || '[]'),
    search_patterns: JSON.parse(row.search_patterns || '[]'),
    icp_overrides: row.icp_overrides ? JSON.parse(row.icp_overrides) : null,
    pipeline_overrides: row.pipeline_overrides ? JSON.parse(row.pipeline_overrides) : null,
    prompt_overrides: row.prompt_overrides ? JSON.parse(row.prompt_overrides) : null,
    source_overrides: row.source_overrides ? JSON.parse(row.source_overrides) : null,
    exclusion_config: row.exclusion_config ? JSON.parse(row.exclusion_config) : null,
    schedule_cron: row.schedule_cron || null,
    schedule_enabled: row.schedule_enabled || 0,
    rss_enabled: row.rss_enabled || 0,
    funnel_config: row.funnel_config ? JSON.parse(row.funnel_config) : null,
  };
}

/**
 * Build a legacy funnel config that matches the old hardcoded 4-step flow.
 * Used when campaign.funnel_config is null (backward compat).
 */
function buildLegacyFunnel(pipelineConfig: Record<string, any>): FunnelConfig {
  const model = pipelineConfig.model || 'claude-opus-4-6@default';
  return {
    version: 1,
    steps: [
      { id: 'discover', enabled: true, model, max_tokens: pipelineConfig.max_tokens_research || 16384, source_strategy: 'search_augmented' as const, search_max_queries: 8, search_max_results_per_query: 5 },
      { id: 'qualify', enabled: false, candidate_limit: 999 },
      { id: 'enrich', enabled: true },
      { id: 'score', enabled: true, model, max_tokens: pipelineConfig.max_tokens_scoring || 2048 },
      { id: 'brief', enabled: true, model, max_tokens: pipelineConfig.max_tokens_brief || 4096 },
      { id: 'audit', enabled: true, audit_quality_threshold: 60 },
    ],
  };
}

function recalcSegment(emp: number | null, icpConfig: ExtendedICPConfig): 'ENT' | 'MM' | 'SMB' {
  if (emp == null) return 'MM';
  const sd = icpConfig.segment_details;
  const entMin = sd?.ENT?.employee_min ?? 651;
  const mmMin = sd?.MM?.employee_min ?? 351;
  if (emp >= entMin) return 'ENT';
  if (emp >= mmMin) return 'MM';
  return 'SMB';
}

// ── Qualify step: rules-based, zero-token filtering ──────────
function executeQualifyStep(
  step: FunnelStepConfig,
  candidates: ResearchCandidate[],
  campaign: CampaignParsed,
  icpConfig: ExtendedICPConfig,
  logger: ActivityLogger
): ResearchCandidate[] {
  logger.phaseStart('qualify', `Qualifying ${candidates.length} candidates (rules-based, no AI cost)...`);

  const qualCriteria = step.qualification_criteria || [];
  const icpHardDqs = (icpConfig.disqualifiers || []).filter(d => d.severity === 'hard').map(d => d.signal);
  const disqualCriteria = [...(step.disqualification_criteria || []), ...(campaign.anti_patterns || []), ...icpHardDqs];
  const icpSoftDqs = (icpConfig.disqualifiers || []).filter(d => d.severity === 'soft');
  const limit = step.candidate_limit || candidates.length;

  const excludedDomainPatterns = icpConfig.excluded_domain_patterns || ['.gov', '.mil', '.gov.uk', '.gov.au', '.gc.ca'];

  const qualified: ResearchCandidate[] = [];
  let disqualified = 0;

  for (const c of candidates) {
    const searchText = `${c.notes} ${c.signals.join(' ')} ${c.company_name} ${c.domain}`.toLowerCase();

    // Domain-pattern disqualification — configurable via ICP excluded_domain_patterns
    if (c.domain && excludedDomainPatterns.length > 0) {
      const domainLower = c.domain.toLowerCase();
      const domainMatch = excludedDomainPatterns.find(suffix => domainLower.endsWith(suffix.toLowerCase()));
      if (domainMatch) {
        logger.thinking('qualify', `Disqualified ${c.company_name}: domain matches excluded pattern "${domainMatch}"`);
        disqualified++;
        continue;
      }
    }

    // Check disqualification criteria (step + campaign + ICP hard DQs)
    const disqualMatch = disqualCriteria.find(d => searchText.includes(d.toLowerCase()));
    if (disqualMatch) {
      logger.thinking('qualify', `Disqualified ${c.company_name}: matches anti-pattern "${disqualMatch}"`);
      disqualified++;
      continue;
    }

    // Annotate soft DQ matches for scorer visibility (don't disqualify)
    const softMatches = icpSoftDqs.filter(d => searchText.includes(d.signal.toLowerCase()));
    if (softMatches.length > 0) {
      c.notes += `\n[SOFT DQ: ${softMatches.map(d => d.signal).join('; ')}]`;
      logger.thinking('qualify', `Soft DQ match for ${c.company_name}: ${softMatches.map(d => d.signal).join(', ')} — passing to scoring`);
    }

    // Segment filter
    if (step.segment_filter) {
      const sf = step.segment_filter;
      const segLower = c.segment.toLowerCase() as 'smb' | 'mm' | 'ent';
      if (!sf[segLower]) {
        logger.thinking('qualify', `Disqualified ${c.company_name}: segment ${c.segment} not in filter`);
        disqualified++;
        continue;
      }
    }

    // Employee range (step-level override or ICP segment ranges)
    if (step.employee_range && c.employee_count_estimate) {
      if (step.employee_range.min && c.employee_count_estimate < step.employee_range.min) {
        logger.thinking('qualify', `Disqualified ${c.company_name}: ${c.employee_count_estimate} employees below minimum ${step.employee_range.min}`);
        disqualified++;
        continue;
      }
      if (step.employee_range.max && c.employee_count_estimate > step.employee_range.max) {
        logger.thinking('qualify', `Disqualified ${c.company_name}: ${c.employee_count_estimate} employees above maximum ${step.employee_range.max}`);
        disqualified++;
        continue;
      }
    } else if (c.employee_count_estimate && icpConfig.segment_details) {
      const segDetail = icpConfig.segment_details[c.segment];
      if (segDetail) {
        const min = segDetail.employee_min;
        const max = segDetail.employee_max;
        if (min && c.employee_count_estimate < min * 0.5) {
          logger.thinking('qualify', `Disqualified ${c.company_name}: ${c.employee_count_estimate} employees below segment floor`);
          disqualified++;
          continue;
        }
        if (max && c.employee_count_estimate > max * 2) {
          logger.thinking('qualify', `Disqualified ${c.company_name}: ${c.employee_count_estimate} employees above segment ceiling`);
          disqualified++;
          continue;
        }
      }
    }

    // Funding stage filter
    if (step.qualify_funding_stages?.length) {
      if (c.funding_stage && !step.qualify_funding_stages.some(f => c.funding_stage!.toLowerCase().includes(f.toLowerCase()))) {
        logger.thinking('qualify', `Disqualified ${c.company_name}: funding stage "${c.funding_stage}" not in filter`);
        disqualified++;
        continue;
      }
    }

    // Geographic filter
    if (step.geo_filter) {
      const loc = (c.hq_location || '').toLowerCase();
      if (step.geo_filter.include?.length && !step.geo_filter.include.some(g => loc.includes(g.toLowerCase()))) {
        logger.thinking('qualify', `Disqualified ${c.company_name}: location "${c.hq_location}" not in geo include`);
        disqualified++;
        continue;
      }
      if (step.geo_filter.exclude?.length && step.geo_filter.exclude.some(g => loc.includes(g.toLowerCase()))) {
        logger.thinking('qualify', `Disqualified ${c.company_name}: location "${c.hq_location}" in geo exclude`);
        disqualified++;
        continue;
      }
    }

    // Min signal count
    if (step.min_signal_count && c.signals.length < step.min_signal_count) {
      logger.thinking('qualify', `Disqualified ${c.company_name}: only ${c.signals.length} signals (min: ${step.min_signal_count})`);
      disqualified++;
      continue;
    }

    // Check qualification criteria (match mode: any vs all)
    if (qualCriteria.length > 0) {
      const matchFn = step.match_mode === 'all'
        ? qualCriteria.every(q => searchText.includes(q.toLowerCase()))
        : qualCriteria.some(q => searchText.includes(q.toLowerCase()));
      if (!matchFn) {
        logger.thinking('qualify', `Disqualified ${c.company_name}: no qualifying criteria matched (mode: ${step.match_mode || 'any'})`);
        disqualified++;
        continue;
      }
    }

    qualified.push(c);
    if (qualified.length >= limit) break;
  }

  logger.phaseComplete('qualify', `Qualification complete — ${qualified.length} qualified, ${disqualified} disqualified`, {
    qualified: qualified.length,
    disqualified,
    limit,
  });

  return qualified;
}

export async function runCampaign(campaignId: string, triggeredBy: string | null, requestedSteps?: string[], targetLeadIds?: string[], runType?: string): Promise<string> {
  const db = getDb();
  const runId = uuidv4();

  // Load campaign
  const campaignRow = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as any;
  if (!campaignRow) throw new Error(`Campaign ${campaignId} not found`);
  const campaign = parseCampaignRow(campaignRow);

  // Create pipeline run record
  db.prepare(
    `INSERT INTO pipeline_runs (id, triggered_by, campaign_id, status, started_at, steps_run, target_lead_ids, run_type, created_at)
     VALUES (?, ?, ?, 'running', datetime('now'), ?, ?, ?, datetime('now'))`
  ).run(
    runId, triggeredBy, campaignId,
    requestedSteps ? JSON.stringify(requestedSteps) : null,
    targetLeadIds?.length ? JSON.stringify(targetLeadIds) : null,
    runType || (targetLeadIds?.length ? 'stage_rerun' : 'campaign'),
  );

  const logger = new ActivityLogger(runId, campaignId);
  const controller = registerRun(runId);
  const signal = controller.signal;

  try {
    const { pipelineConfig, promptConfig, icpConfig, exclusions } = loadCampaignConfig(campaign);
    icpConfig.campaign_target_signals = campaign.target_signals;
    icpConfig.campaign_value_prop_angle = campaign.value_prop_angle || undefined;
    const targetCount = campaign.target_count || 12;

    // Resolve funnel config: explicit > legacy (matches old behavior)
    const funnelConfig: FunnelConfig = campaign.funnel_config || buildLegacyFunnel(pipelineConfig);
    let activeSteps = funnelConfig.steps.filter(s => s.enabled);
    const defaultModel = pipelineConfig.model || getAIConfig().defaultModel;

    // Individual step execution: filter to only requested steps
    if (requestedSteps?.length) {
      activeSteps = activeSteps.filter(s => requestedSteps.includes(s.id));
    }

    // Multi-model tracker for accurate per-step cost calculation
    const tracker = new MultiModelTokenTracker(defaultModel);

    // Progress tracking
    let stepNumber = 0;
    // Estimate total steps: 1 per funnel phase + per-candidate work for score/brief
    let totalSteps = activeSteps.length + targetCount * 2;

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
      eventBus.emit('campaign.progress', {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        run_id: runId,
        run_type: runType || 'campaign',
        ...progressData,
      });
    };

    // Emit token updates on each API call
    tracker.onUsage((summary) => {
      logger.setTokens({ input_tokens: summary.input_tokens, output_tokens: summary.output_tokens, estimated_cost: summary.estimated_cost });
      eventBus.emit('campaign.progress', {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        run_id: runId,
        run_type: runType || 'campaign',
        phase: 'processing',
        step_number: stepNumber,
        total_steps: totalSteps,
        tokens: tracker.getSummary(),
      });
    });

    // Emit campaign.started
    eventBus.emit('campaign.started', {
      campaign_id: campaignId,
      campaign_name: campaign.name,
      run_id: runId,
      triggered_by: triggeredBy || 'system',
      run_type: runType || 'campaign',
    });

    const stepModels = activeSteps.filter(s => s.model).map(s => `${s.id}:${s.model}`).join(', ') || defaultModel;
    logger.milestone(`Campaign "${campaign.name}" started — Funnel: ${activeSteps.map(s => s.id).join(' → ')}`, {
      models: stepModels,
      target_count: targetCount,
      campaign_name: campaign.name,
      funnel_steps: activeSteps.length,
    });

    // ── Pipeline state ──
    let candidates: ResearchCandidate[] = [];
    let scoredCandidates: { candidate: ResearchCandidate; score: ScoringResult }[] = [];
    const briefResults: { candidate: ResearchCandidate; score: ScoringResult; brief: BriefResult }[] = [];

    // ── Intermediate persistence helpers ──
    const upsertLeadStage = db.prepare(
      `INSERT INTO leads (
        id, run_id, campaign_id, company_name, segment, hq_location, employee_count,
        founded_year, funding_stage, total_funding, investors, website, domain,
        fit_score, fit_score_label, confidence, why_now, score_breakdown,
        pain_hypotheses, tech_stack, competitive_displacement,
        outreach_strategy, source_citations, brief_markdown, signal_count,
        pipeline_stage, candidate_data, lead_status, scorer_thinking, brief_thinking, linkedin_company_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        segment = excluded.segment,
        hq_location = excluded.hq_location,
        employee_count = excluded.employee_count,
        founded_year = excluded.founded_year,
        funding_stage = excluded.funding_stage,
        total_funding = excluded.total_funding,
        investors = excluded.investors,
        website = excluded.website,
        domain = excluded.domain,
        fit_score = excluded.fit_score,
        fit_score_label = excluded.fit_score_label,
        confidence = excluded.confidence,
        why_now = excluded.why_now,
        score_breakdown = excluded.score_breakdown,
        pain_hypotheses = excluded.pain_hypotheses,
        tech_stack = excluded.tech_stack,
        competitive_displacement = excluded.competitive_displacement,
        outreach_strategy = excluded.outreach_strategy,
        source_citations = excluded.source_citations,
        brief_markdown = excluded.brief_markdown,
        signal_count = excluded.signal_count,
        pipeline_stage = excluded.pipeline_stage,
        candidate_data = excluded.candidate_data,
        lead_status = excluded.lead_status,
        scorer_thinking = COALESCE(excluded.scorer_thinking, leads.scorer_thinking),
        brief_thinking = COALESCE(excluded.brief_thinking, leads.brief_thinking),
        linkedin_company_url = COALESCE(excluded.linkedin_company_url, leads.linkedin_company_url),
        run_id = excluded.run_id,
        updated_at = datetime('now')`
    );

    // Track lead IDs so we can upsert across phases
    const leadIdMap = new Map<string, string>();
    function getLeadId(companyName: string): string {
      if (!leadIdMap.has(companyName)) leadIdMap.set(companyName, uuidv4());
      return leadIdMap.get(companyName)!;
    }

    function persistCandidates(stage: string, candidateList: ResearchCandidate[], scores?: Map<string, ScoringResult>, briefs?: Map<string, BriefResult>, thinkingMap?: Map<string, { scorer?: string; brief?: string }>) {
      const persistTx = db.transaction(() => {
        for (const c of candidateList) {
          const leadId = getLeadId(c.company_name);
          const score = scores?.get(c.company_name);
          const brief = briefs?.get(c.company_name);
          const thinking = thinkingMap?.get(c.company_name);
          const sourceCitations = brief?.source_citations || [];
          const signalCount = (brief && sourceCitations.length > 0)
            ? sourceCitations.length
            : (Array.isArray(c.signals) ? c.signals.length : 0);
          const leadStatus = stage === 'briefed' ? 'scored' : stage;
          const candidateData: Record<string, any> = { signals: c.signals, sources: c.sources, notes: c.notes };
          if (score?.score_breakdown) candidateData.score_breakdown = score.score_breakdown;
          if (score?.reasoning) candidateData.reasoning = score.reasoning;
          upsertLeadStage.run(
            leadId, runId, campaignId,
            c.company_name, c.segment,
            c.hq_location, c.employee_count_estimate,
            c.founded_year, c.funding_stage,
            c.total_funding, c.investors, c.domain, c.domain,
            score?.fit_score ?? 0,
            score?.fit_score_label || null,
            score?.confidence || null,
            brief?.why_now ? JSON.stringify(brief.why_now) : null,
            score?.score_breakdown ? JSON.stringify(score.score_breakdown) : null,
            brief?.pain_hypotheses ? JSON.stringify(brief.pain_hypotheses) : null,
            brief?.tech_stack ? JSON.stringify(brief.tech_stack) : null,
            brief?.competitive_displacement ? JSON.stringify(brief.competitive_displacement) : null,
            brief?.outreach_strategy || null,
            JSON.stringify(sourceCitations),
            brief?.brief_markdown || null,
            signalCount,
            stage,
            JSON.stringify(candidateData),
            leadStatus,
            thinking?.scorer || null,
            thinking?.brief || null,
            c.linkedin_company_url || null
          );
        }
      });
      persistTx();
    }

    // When running mid-pipeline steps individually, load existing leads
    const startsAfterDiscover = requestedSteps?.length && !requestedSteps.includes('discover');
    if (startsAfterDiscover) {
      let existingLeads: any[];
      if (targetLeadIds?.length) {
        const placeholders = targetLeadIds.map(() => '?').join(',');
        existingLeads = db.prepare(
          `SELECT * FROM leads WHERE campaign_id = ? AND id IN (${placeholders}) ORDER BY fit_score DESC`
        ).all(campaignId, ...targetLeadIds) as any[];
      } else {
        existingLeads = db.prepare(
          `SELECT * FROM leads WHERE campaign_id = ? ORDER BY fit_score DESC`
        ).all(campaignId) as any[];
      }

      candidates = existingLeads.map((l: any) => {
        // Restore lead ID mapping so upserts work
        leadIdMap.set(l.company_name, l.id);
        const candidateData = l.candidate_data ? JSON.parse(l.candidate_data) : {};
        return {
          company_name: l.company_name,
          domain: l.website || l.domain || '',
          segment: recalcSegment(l.employee_count, icpConfig),
          employee_count_estimate: l.employee_count,
          hq_location: l.hq_location,
          founded_year: l.founded_year,
          funding_stage: l.funding_stage,
          total_funding: l.total_funding,
          investors: l.investors,
          signals: candidateData.signals || [],
          sources: candidateData.sources || [],
          notes: candidateData.notes || '',
          linkedin_company_url: l.linkedin_company_url || undefined,
        };
      }) as ResearchCandidate[];

      // If starting from brief, pre-populate scored candidates
      if (!requestedSteps.includes('score') && requestedSteps.includes('brief')) {
        scoredCandidates = existingLeads
          .filter((l: any) => l.fit_score > 0)
          .map((l: any) => ({
            candidate: candidates.find(c => c.company_name === l.company_name)!,
            score: {
              fit_score: l.fit_score,
              fit_score_label: l.fit_score_label || '',
              confidence: l.confidence || 'medium',
              score_breakdown: l.score_breakdown ? JSON.parse(l.score_breakdown) : {} as any,
            } as ScoringResult,
          }))
          .filter(sc => sc.candidate);
      }

      // If starting from audit, pre-populate brief results
      if (!requestedSteps.includes('brief') && requestedSteps.includes('audit')) {
        for (const l of existingLeads) {
          if (!l.brief_markdown) continue;
          const candidate = candidates.find(c => c.company_name === l.company_name);
          if (!candidate) continue;
          scoredCandidates.push({
            candidate,
            score: {
              fit_score: l.fit_score || 0,
              fit_score_label: l.fit_score_label || '',
              confidence: l.confidence || 'medium',
              score_breakdown: l.score_breakdown ? JSON.parse(l.score_breakdown) : {} as any,
            } as ScoringResult,
          });
          briefResults.push({
            candidate,
            score: scoredCandidates[scoredCandidates.length - 1].score,
            brief: {
              brief_markdown: l.brief_markdown,
              company_snapshot: '',
              personas: [],
              pain_hypotheses: l.pain_hypotheses ? JSON.parse(l.pain_hypotheses) : [],
              tech_stack: l.tech_stack ? JSON.parse(l.tech_stack) : null,
              competitive_displacement: l.competitive_displacement ? JSON.parse(l.competitive_displacement) : null,
              outreach_strategy: l.outreach_strategy || '',
              source_citations: l.source_citations ? JSON.parse(l.source_citations) : [],
              why_now: l.why_now ? JSON.parse(l.why_now) : [],
            } as any,
          });
        }
      }

      logger.milestone(
        targetLeadIds?.length
          ? `Loaded ${candidates.length} targeted leads for stage rerun`
          : `Loaded ${candidates.length} existing leads for partial run`,
        {
          steps: requestedSteps,
          existing_leads: candidates.length,
          targeted: targetLeadIds?.length || 0,
        }
      );
    }

    // ── Iterate funnel steps ──
    for (const step of activeSteps) {
      if (signal.aborted) throw new Error('Run cancelled by user');

      const stepModel = step.model || defaultModel;

      switch (step.id) {
        case 'discover': {
          emitProgress('discover');
          logger.phaseStart('discover', `Discovering candidates (model: ${stepModel}): "${campaign.pattern_thesis}"...`);
          // Override pipeline config with step-level model/tokens
          const stepPipelineConfig = {
            ...pipelineConfig,
            model: stepModel,
            max_tokens_research: step.max_tokens || pipelineConfig.max_tokens_research || 16384,
          };
          const stepTracker = tracker.getTrackerForModel(stepModel);
          // Resolve prompt: append to global preamble, or override it
          const globalPreamble = promptConfig?.research_preamble || '';
          let discoverPrompt: string | undefined;
          if (step.prompt_mode === 'override' && step.prompt_instructions) {
            discoverPrompt = step.prompt_instructions;
          } else if (step.prompt_instructions) {
            discoverPrompt = [globalPreamble, step.prompt_instructions].filter(Boolean).join('\n\n');
          } else if (globalPreamble) {
            discoverPrompt = globalPreamble;
          }
          // ── Search-augmented discovery ──
          let searchContext: string | undefined;
          if (step.source_strategy === 'search_augmented') {
            try {
              const { runSearchAugmentedDiscovery } = await import('./discovery/searchAugmented.js');
              searchContext = await runSearchAugmentedDiscovery(campaign, icpConfig, step, logger);
            } catch (err) {
              logger.error('discover', 'Search augmentation failed — proceeding with AI-only discovery',
                err instanceof Error ? err.message : String(err));
            }
          }

          // ── Build dedup sets for post-discover filtering ──
          const filterExistingLeads = step.filter_existing_leads !== false;
          const ledgerDays = step.filter_ledger_days ?? 90;
          const minEmployees = step.filter_min_employees ?? 0;
          const allowSnoozedRetry = step.filter_allow_snoozed_retry !== false;

          let existingLeadNames = new Set<string>();
          let recentLedgerNames = new Set<string>();

          if (filterExistingLeads) {
            const existingLeads = db.prepare(
              `SELECT l.company_name, l.domain, lf.verdict, lf.retry_date
               FROM leads l
               LEFT JOIN lead_feedback lf ON lf.lead_id = l.id
               WHERE l.campaign_id != ? OR l.campaign_id IS NULL`
            ).all(campaignId) as any[];

            const now = new Date().toISOString();
            for (const l of existingLeads) {
              // Allow snoozed leads whose retry date has passed
              if (allowSnoozedRetry && l.verdict === 'not_fit' && l.retry_date && l.retry_date < now) {
                continue;
              }
              existingLeadNames.add(l.company_name.toLowerCase());
              if (l.domain) existingLeadNames.add(l.domain.toLowerCase());
            }
          }

          if (ledgerDays > 0) {
            const cutoffDate = new Date(Date.now() - ledgerDays * 86400000).toISOString();
            const recentRecs = db.prepare(
              'SELECT company_name FROM recommendations_ledger WHERE last_recommended_at > ?'
            ).all(cutoffDate) as any[];
            recentLedgerNames = new Set(recentRecs.map((r: any) => r.company_name.toLowerCase()));
          }

          const minLeads = step.lead_count_min || campaign.target_count || 15;
          const maxAttempts = 3;
          let attempt = 0;
          candidates = [];

          while (attempt < maxAttempts) {
            attempt++;
            if (attempt > 1) {
              logger.thinking('discover', `Backfill attempt ${attempt}/${maxAttempts} — need ${minLeads - candidates.length} more candidates`);
            }

            let batchCandidates = await researchCampaignPattern(campaign, icpConfig, exclusions, stepPipelineConfig, stepTracker, logger, signal, discoverPrompt, step, searchContext, { runId, campaignId });

            // ── Post-discover programmatic filters ──

            // 1. Exclusion filter — deterministic removal of excluded companies
            const exclusionNames = new Set(exclusions.map(e => e.company_name.toLowerCase()));
            const exclusionDomains = new Set(exclusions.filter(e => e.domain).map(e => e.domain!.toLowerCase()));
            const beforeExcl = batchCandidates.length;
            batchCandidates = batchCandidates.filter(c => {
              const nameMatch = exclusionNames.has(c.company_name.toLowerCase());
              const domainMatch = c.domain && exclusionDomains.has(c.domain.toLowerCase());
              return !nameMatch && !domainMatch;
            });
            if (beforeExcl !== batchCandidates.length) {
              logger.thinking('discover', `Removed ${beforeExcl - batchCandidates.length} excluded companies (${beforeExcl} → ${batchCandidates.length})`);
            }

            // 2. Employee count validation — hard floor + segment thresholds
            const sd = icpConfig.segment_details;
            const segmentThresholds = {
              SMB: { min: sd?.SMB?.employee_min ?? 30, max: sd?.SMB?.employee_max ?? 350 },
              MM: { min: sd?.MM?.employee_min ?? 351, max: sd?.MM?.employee_max ?? 650 },
              ENT: { min: sd?.ENT?.employee_min ?? 651, max: Infinity },
            };
            const beforeSeg = batchCandidates.length;
            batchCandidates = batchCandidates.filter(c => {
              if (!c.employee_count_estimate) return true;
              if (minEmployees > 0 && c.employee_count_estimate < minEmployees) return false;
              const threshold = segmentThresholds[c.segment];
              if (!threshold) return true;
              return c.employee_count_estimate >= threshold.min;
            });
            if (beforeSeg !== batchCandidates.length) {
              logger.thinking('discover', `Removed ${beforeSeg - batchCandidates.length} candidates below employee threshold (${beforeSeg} → ${batchCandidates.length})`);
            }

            // 3. Existing leads dedup
            if (filterExistingLeads && existingLeadNames.size > 0) {
              const beforeLeads = batchCandidates.length;
              batchCandidates = batchCandidates.filter(c => {
                return !existingLeadNames.has(c.company_name.toLowerCase()) &&
                       !(c.domain && existingLeadNames.has(c.domain.toLowerCase()));
              });
              if (beforeLeads !== batchCandidates.length) {
                logger.thinking('discover', `Removed ${beforeLeads - batchCandidates.length} candidates already in leads (${beforeLeads} → ${batchCandidates.length})`);
              }
            }

            // 4. Recommendations ledger dedup
            if (recentLedgerNames.size > 0) {
              const beforeLedger = batchCandidates.length;
              batchCandidates = batchCandidates.filter(c => !recentLedgerNames.has(c.company_name.toLowerCase()));
              if (beforeLedger !== batchCandidates.length) {
                logger.thinking('discover', `Removed ${beforeLedger - batchCandidates.length} recently recommended candidates (within ${ledgerDays}d) (${beforeLedger} → ${batchCandidates.length})`);
              }
            }

            // 5. Fuzzy dedup against already-found candidates in this run
            const beforeDedup = batchCandidates.length;
            batchCandidates = batchCandidates.filter(c =>
              !candidates.some(existing => isFuzzyDuplicate(existing.company_name, c.company_name))
            );
            if (beforeDedup !== batchCandidates.length) {
              logger.thinking('discover', `Removed ${beforeDedup - batchCandidates.length} fuzzy duplicates`);
            }

            candidates.push(...batchCandidates);

            // Add newly found candidates to exclusions for next attempt prompt
            // (these are temporary — only used within this run's retry loop)
            for (const c of batchCandidates) {
              exclusions.push({ id: '', company_name: c.company_name, domain: c.domain } as Exclusion);
            }

            if (candidates.length >= minLeads) break;
            if (signal?.aborted) break;
          }

          // Apply candidate limit
          if (step.candidate_limit && candidates.length > step.candidate_limit) {
            logger.thinking('discover', `Limiting to ${step.candidate_limit} of ${candidates.length} discovered candidates`);
            candidates = candidates.slice(0, step.candidate_limit);
          }
          logger.phaseComplete('discover', `Discovery complete — ${candidates.length} candidates${attempt > 1 ? ` (${attempt} attempts)` : ''}`, {
            candidate_count: candidates.length,
            model: stepModel,
            attempts: attempt,
            companies: candidates.slice(0, 5).map(c => c.company_name),
          });

          // ── Domain validation sub-phase ──
          if (step.validate_domains !== false && candidates.length > 0) {
            logger.phaseStart('discover', `Validating domains for ${candidates.length} candidates...`);
            const validationResults = await validateCandidateDomains(candidates, logger);
            const beforeValidation = candidates.length;
            candidates = candidates.filter(c => {
              if (!c.domain) return false;
              const result = validationResults.get(c.domain);
              if (!result) return true;
              if (!shouldKeepCandidate(result)) {
                logger.thinking('discover', `Dropping ${c.company_name} (${c.domain}): ${result.error || (result.isParked ? 'parked domain' : 'domain not found')}`);
                return false;
              }
              c.domain_validated = true;
              return true;
            });
            if (beforeValidation !== candidates.length) {
              logger.phaseComplete('discover', `Domain validation removed ${beforeValidation - candidates.length} invalid candidates (${candidates.length} remaining)`);
            } else {
              logger.phaseComplete('discover', `All ${candidates.length} domains validated`);
            }
          }

          // ── Light enrichment sub-phase (website + DNS only) ──
          if (step.light_enrich !== false && candidates.length > 0) {
            logger.phaseStart('discover', `Running light enrichment (website + DNS) on ${candidates.length} candidates...`);
            const lightSourceOverrides: Record<string, boolean> = {
              website_analysis: true,
              dns_fingerprint: true,
              // Disable everything else for light enrichment
              github_presence: false,
              job_postings: false,
              wikipedia: false,
              google_news: false,
              hacker_news: false,
              tech_fingerprint: false,
              web_search: false,
              crunchbase: false,
              apollo: false,
              salesforce: false,
              serper_search: false,
            };
            const { candidates: lightEnriched, summary: lightSummary } = await enrichCandidates(
              candidates,
              { sourceOverrides: lightSourceOverrides }
            );
            candidates = lightEnriched;
            if (lightSummary.enriched_count > 0) {
              logger.phaseComplete('discover', `Light enrichment: ${lightSummary.enriched_count}/${lightSummary.total_candidates} candidates enriched with website/DNS data`);
            } else {
              logger.phaseComplete('discover', `Light enrichment: no additional data found`);
            }
          }

          persistCandidates('discovered', candidates);
          break;
        }

        case 'qualify': {
          emitProgress('qualify');
          candidates = executeQualifyStep(step, candidates, campaign, icpConfig, logger);
          persistCandidates('qualified', candidates);
          break;
        }

        case 'enrich': {
          if (step.candidate_limit && candidates.length > step.candidate_limit) {
            logger.thinking('enrich', `Limiting enrichment to top ${step.candidate_limit} of ${candidates.length} candidates`);
            candidates = candidates.slice(0, step.candidate_limit);
          }
          emitProgress('enrich');
          if (targetLeadIds?.length) {
            for (const candidate of candidates) {
              const leadId = getLeadId(candidate.company_name);
              eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'enrich', status: 'processing', message: `Enriching ${candidate.company_name}...`, run_id: runId });
            }
          }
          logger.phaseStart('enrich', `Enriching ${candidates.length} candidates with external data (no LLM)...`);
          if (signal.aborted) throw new Error('Run cancelled by user');
          const enrichSourceOverrides = step.source_overrides || campaign.source_overrides;
          // Skip sources already run during light enrichment (check if any candidate has pre-existing enrichment data)
          const lightEnrichRan = candidates.some(c => (c.enrichment_source_count || 0) > 0);
          const skipSources = lightEnrichRan ? ['website_analysis', 'dns_fingerprint'] : undefined;
          const { candidates: enrichedCandidates, summary: enrichmentSummary } = await enrichCandidates(
            candidates,
            { sourceOverrides: enrichSourceOverrides, skipSources }
          );
          for (const c of enrichedCandidates) {
            c.segment = recalcSegment(c.employee_count_estimate, icpConfig);
          }
          if (enrichmentSummary.enriched_count > 0) {
            logger.finding('enrich', '', `Enriched ${enrichmentSummary.enriched_count}/${enrichmentSummary.total_candidates} candidates`, {
              sources_used: enrichmentSummary.sources_used,
              enriched_count: enrichmentSummary.enriched_count,
            });
          }

          // ── Enrichment success gate ──
          const minSources = step.min_enrichment_sources ?? 1;
          if (minSources > 0) {
            const beforeGate = enrichedCandidates.length;
            candidates = enrichedCandidates.filter(c => {
              const count = c.enrichment_source_count || 0;
              if (count < minSources) {
                logger.thinking('enrich', `Dropping ${c.company_name}: only ${count} enrichment sources (min: ${minSources})`);
                return false;
              }
              return true;
            });
            if (beforeGate !== candidates.length) {
              logger.phaseComplete('enrich', `Enrichment gate: ${beforeGate - candidates.length} candidates dropped for insufficient data (${candidates.length} remaining)`);
            } else {
              logger.phaseComplete('enrich', `Enrichment complete — all ${candidates.length} candidates met data threshold`);
            }
          } else {
            candidates = enrichedCandidates;
            logger.phaseComplete('enrich', 'Enrichment complete');
          }
          if (targetLeadIds?.length) {
            for (const candidate of candidates) {
              const leadId = getLeadId(candidate.company_name);
              eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'enrich', status: 'completed', message: `Enrichment complete — ${candidate.enrichment_source_count || 0} sources`, run_id: runId });
            }
          }
          persistCandidates('enriched', candidates);
          break;
        }

        case 'score': {
          // Update total steps now we know actual candidate count
          totalSteps = stepNumber + candidates.length + Math.min(candidates.length, targetCount) + 1;
          logger.phaseStart('score', `Scoring ${candidates.length} candidates against ICP (model: ${stepModel})...`);
          const scoreTracker = tracker.getTrackerForModel(stepModel);
          scoredCandidates = [];
          for (const candidate of candidates) {
            if (signal.aborted) throw new Error('Run cancelled by user');
            const leadId = getLeadId(candidate.company_name);
            if (targetLeadIds?.length) {
              eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'score', status: 'processing', message: `Scoring ${candidate.company_name}...`, run_id: runId });
            }
            emitProgress('score', candidate.company_name);
            logger.thinking('score', `Scoring ${candidate.company_name} against ICP criteria...`);
            const score = await scoreCandidate(candidate, icpConfig, stepModel, scoreTracker, step.prompt_instructions, step, { runId, campaignId, phase: 'score' });
            scoredCandidates.push({ candidate, score });
            if (score.reasoning) {
              logger.thinking('score', `[${candidate.company_name}] ${score.reasoning.substring(0, 300)}${score.reasoning.length > 300 ? '...' : ''}`);
            }
            logger.finding('score', candidate.company_name, `Score: ${score.fit_score}/100 — ${score.fit_score_label}`, {
              fit_score: score.fit_score,
              label: score.fit_score_label,
              confidence: score.confidence,
            });
            if (targetLeadIds?.length) {
              eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'score', status: 'completed', message: `Score: ${score.fit_score}/100 — ${score.fit_score_label}`, run_id: runId });
            }
          }
          logger.phaseComplete('score', `Scoring complete — ${scoredCandidates.length} candidates scored`, {
            total_scored: scoredCandidates.length,
            avg_score: scoredCandidates.length > 0 ? Math.round(scoredCandidates.reduce((s, c) => s + c.score.fit_score, 0) / scoredCandidates.length) : 0,
            model: stepModel,
          });
          // Sort by score descending
          scoredCandidates.sort((a, b) => b.score.fit_score - a.score.fit_score);
          // Persist ALL scored candidates before filtering — so every score is saved
          const allScoreMap = new Map(scoredCandidates.map(sc => [sc.candidate.company_name, sc.score]));
          const scoreThinkingMap = new Map(scoredCandidates.map(sc => [sc.candidate.company_name, { scorer: sc.score.reasoning || undefined }]));
          persistCandidates('scored', scoredCandidates.map(sc => sc.candidate), allScoreMap, undefined, scoreThinkingMap);
          // Apply filters to select candidates for brief step
          if (step.min_score_threshold) {
            const before = scoredCandidates.length;
            scoredCandidates = scoredCandidates.filter(sc => sc.score.fit_score >= step.min_score_threshold!);
            if (before !== scoredCandidates.length) {
              logger.thinking('score', `Filtered ${before - scoredCandidates.length} candidates below score threshold ${step.min_score_threshold}`);
            }
          }
          if (step.confidence_filter && step.confidence_filter !== 'all') {
            const before = scoredCandidates.length;
            if (step.confidence_filter === 'high_only') {
              scoredCandidates = scoredCandidates.filter(sc => sc.score.confidence === 'high');
            } else if (step.confidence_filter === 'medium_high') {
              scoredCandidates = scoredCandidates.filter(sc => sc.score.confidence === 'high' || sc.score.confidence === 'medium');
            }
            if (before !== scoredCandidates.length) {
              logger.thinking('score', `Filtered ${before - scoredCandidates.length} candidates by confidence (${step.confidence_filter})`);
            }
          }
          if (step.candidate_limit) {
            scoredCandidates = scoredCandidates.slice(0, step.candidate_limit);
          }
          break;
        }

        case 'brief': {
          const briefLimit = step.candidate_limit || targetCount;
          const selected = scoredCandidates.slice(0, briefLimit);
          logger.phaseStart('brief', `Generating outreach briefs for ${selected.length} candidates (model: ${stepModel})...`);
          const briefTracker = tracker.getTrackerForModel(stepModel);
          for (const { candidate, score } of selected) {
            if (signal.aborted) throw new Error('Run cancelled by user');
            const leadId = getLeadId(candidate.company_name);
            if (targetLeadIds?.length) {
              eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'brief', status: 'processing', message: `Generating brief for ${candidate.company_name}...`, run_id: runId });
              eventBus.emit('lead.brief_rerun', { lead_id: leadId, company_name: candidate.company_name, status: 'generating', message: `Generating brief with ${stepModel}...` });
            }
            emitProgress('brief', candidate.company_name);
            logger.thinking('brief', `Writing outreach brief for ${candidate.company_name}...`);
            try {
              // Outreach tone: prefer funnel step config, fall back to prompt config
              const briefTone = step.outreach_tone || promptConfig?.outreach_tone;
              const brief = await generateBrief(candidate, score, icpConfig, stepModel, briefTracker, step.prompt_instructions, briefTone, step, { runId, campaignId, phase: 'brief' });
              briefResults.push({ candidate, score, brief });
              const painSummary = brief.pain_hypotheses?.slice(0, 2).map((p: any) => typeof p === 'string' ? p : p.hypothesis || p.pain).filter(Boolean).join('; ');
              logger.finding('brief', candidate.company_name, `Brief ready — ${brief.personas?.length || 0} personas, ${brief.why_now?.length || 0} triggers`, {
                personas: brief.personas?.map((p: any) => `${p.title || p.role_type}`),
                pain_hypotheses: painSummary,
                outreach_strategy: brief.outreach_strategy?.substring(0, 200),
              });
              if (targetLeadIds?.length) {
                eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'brief', status: 'completed', message: `Brief ready — ${brief.personas?.length || 0} personas`, run_id: runId });
                eventBus.emit('lead.brief_rerun', { lead_id: leadId, company_name: candidate.company_name, status: 'completed', message: `Brief generated for ${candidate.company_name}` });
              }
            } catch (briefErr) {
              logger.error('brief', `Brief failed for ${candidate.company_name} — skipping`, briefErr instanceof Error ? briefErr.message : String(briefErr));
              if (targetLeadIds?.length) {
                eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'brief', status: 'failed', message: briefErr instanceof Error ? briefErr.message : 'Brief generation failed', run_id: runId });
                eventBus.emit('lead.brief_rerun', { lead_id: leadId, company_name: candidate.company_name, status: 'failed', message: briefErr instanceof Error ? briefErr.message : 'Brief generation failed' });
              }
            }
          }
          logger.phaseComplete('brief', `Brief generation complete — ${briefResults.length} briefs ready`, { model: stepModel });
          // Persist briefed leads with thinking
          const briefScoreMap = new Map(briefResults.map(br => [br.candidate.company_name, br.score]));
          const briefMap = new Map(briefResults.map(br => [br.candidate.company_name, br.brief]));
          const briefThinkingMap = new Map(briefResults.map(br => [br.candidate.company_name, { scorer: br.score.reasoning || undefined, brief: br.brief.thinking || undefined }]));
          persistCandidates('briefed', briefResults.map(br => br.candidate), briefScoreMap, briefMap, briefThinkingMap);
          break;
        }

        case 'audit': {
          if (briefResults.length === 0) {
            logger.thinking('audit', 'No briefs to audit — skipping');
            break;
          }
          emitProgress('audit');
          const threshold = step.audit_quality_threshold ?? 60;
          const useAiAudit = step.audit_use_ai === true;
          const auditModel = step.model || 'claude-haiku-4-5@20251001';
          logger.phaseStart('audit', `Auditing ${briefResults.length} briefs (threshold: ${threshold}/100${useAiAudit ? `, AI: ${auditModel}` : ', rules-only'})...`);

          const auditTracker = useAiAudit ? tracker.getTrackerForModel(auditModel) : undefined;
          const auditResults: { company: string; score: number; passed: boolean; issues: number; errorCount: number; warnCount: number }[] = [];

          for (const { candidate, score, brief } of briefResults) {
            if (targetLeadIds?.length) {
              const leadId = getLeadId(candidate.company_name);
              eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'audit', status: 'processing', message: `Auditing ${candidate.company_name}...`, run_id: runId });
              if (requestedSteps?.includes('brief')) {
                eventBus.emit('lead.brief_rerun', { lead_id: leadId, company_name: candidate.company_name, status: 'auditing', message: 'Running quality audit...' });
              }
            }
            const rulesAudit = auditBrief({ brief, candidate, score }, threshold);
            let finalScore = rulesAudit.score;
            let allIssues = [...rulesAudit.issues];
            let aiResultJson: string | null = null;

            if (useAiAudit) {
              try {
                logger.thinking('audit', `Running AI review for ${candidate.company_name}...`);
                const aiResult = await aiAuditBrief(
                  { brief, candidate, score, icpConfig },
                  auditModel,
                  auditTracker
                );
                finalScore = Math.round(rulesAudit.score * 0.3 + aiResult.overall_score * 0.7);
                allIssues = [...rulesAudit.issues, ...aiResult.issues];
                aiResultJson = JSON.stringify(aiResult);

                logger.thinking('audit', `AI audit for ${candidate.company_name}: ${aiResult.verdict} (${aiResult.overall_score}/100) — ${aiResult.summary}`);
              } catch (err) {
                logger.thinking('audit', `AI audit failed for ${candidate.company_name}, using rules-only score: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            const passed = finalScore >= threshold;
            auditResults.push({
              company: candidate.company_name,
              score: finalScore,
              passed,
              issues: allIssues.length,
              errorCount: allIssues.filter(i => i.severity === 'error').length,
              warnCount: allIssues.filter(i => i.severity === 'warning').length,
            });

            const leadId = getLeadId(candidate.company_name);
            try {
              db.prepare('UPDATE leads SET audit_score = ?, audit_issues = ?, ai_audit_result = ?, pipeline_stage = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(finalScore, JSON.stringify(allIssues), aiResultJson, 'audited', leadId);
            } catch { /* column may not exist yet */ }

            if (targetLeadIds?.length) {
              eventBus.emit('lead.stage_rerun', { lead_id: leadId, company_name: candidate.company_name, stage: 'audit', status: 'completed', message: `Audit ${passed ? 'passed' : 'below threshold'} (${finalScore}/100)`, run_id: runId });
              if (requestedSteps?.includes('brief')) {
                eventBus.emit('lead.brief_rerun', { lead_id: leadId, company_name: candidate.company_name, status: 'completed', message: `Brief generated — audit ${finalScore}/100`, audit_score: finalScore });
              }
            }

            if (passed) {
              logger.finding('audit', candidate.company_name, `Audit passed (${finalScore}/100${useAiAudit ? ' combined' : ''})`, {
                checks: Object.fromEntries(Object.entries(rulesAudit.checks).map(([k, v]) => [k, `${v.score}pts ${v.passed ? '✓' : '✗'}`])),
              });
            } else {
              const topIssues = allIssues.filter(i => i.severity === 'error').slice(0, 3).map(i => i.message);
              logger.thinking('audit', `${candidate.company_name}: below threshold (${finalScore}/${threshold}) — ${topIssues.join('; ')}`);
            }
          }

          const passCount = auditResults.filter(r => r.passed).length;
          const avgScore = Math.round(auditResults.reduce((s, r) => s + r.score, 0) / auditResults.length);
          logger.phaseComplete('audit', `Audit complete — ${passCount}/${auditResults.length} passed (avg: ${avgScore}/100${useAiAudit ? ', AI-powered' : ''})`, {
            passed: passCount,
            failed: auditResults.length - passCount,
            avg_score: avgScore,
            threshold,
            ai_enabled: useAiAudit,
          });
          break;
        }
      }
    }

    // ── Insert personas and ledger entries for briefed leads ──
    const insertPersona = db.prepare(
      `INSERT INTO personas (
        id, lead_id, role_type, name, title, linkedin_url, department,
        tenure, outreach_angle, talking_points, outreach_message,
        social_signals, buying_signals, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    );

    const findLedgerEntry = db.prepare(
      'SELECT id, times_recommended FROM recommendations_ledger WHERE company_name = ?'
    );
    const insertLedger = db.prepare(
      `INSERT INTO recommendations_ledger (id, company_name, domain, first_recommended_at, last_recommended_at, times_recommended)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), 1)`
    );
    const updateLedger = db.prepare(
      `UPDATE recommendations_ledger SET last_recommended_at = datetime('now'), times_recommended = times_recommended + 1 WHERE id = ?`
    );

    const insertAll = db.transaction(() => {
      for (const { candidate, score, brief } of briefResults) {
        const leadId = getLeadId(candidate.company_name);

        for (const persona of brief.personas) {
          insertPersona.run(
            uuidv4(), leadId,
            persona.role_type, persona.name, persona.title,
            persona.linkedin_url, persona.department, persona.tenure,
            persona.outreach_angle, persona.talking_points,
            persona.outreach_message, persona.social_signals,
            persona.buying_signals
          );
        }

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

    // Emit events for each created lead
    for (const { candidate, score } of briefResults) {
      eventBus.emit('lead.created', {
        lead_id: getLeadId(candidate.company_name),
        company_name: candidate.company_name,
        source_type: 'outbound_campaign',
        domain: candidate.domain || undefined,
        campaign_id: campaignId,
      });
      eventBus.emit('lead.scored', {
        lead_id: getLeadId(candidate.company_name),
        company_name: candidate.company_name,
        fit_score: score.fit_score,
        fit_score_label: score.fit_score_label,
        confidence: score.confidence,
      });
    }

    const totalLeads = leadIdMap.size;
    const usage = tracker.getSummary();
    db.prepare(
      `UPDATE pipeline_runs SET status = 'completed', completed_at = datetime('now'), lead_count = ?,
       input_tokens = ?, output_tokens = ?, estimated_cost = ?, model_used = ?
       WHERE id = ?`
    ).run(totalLeads, usage.input_tokens, usage.output_tokens, usage.estimated_cost, usage.model, runId);

    // Emit campaign.completed
    eventBus.emit('campaign.completed', {
      campaign_id: campaignId,
      campaign_name: campaign.name,
      run_id: runId,
      lead_count: totalLeads,
      estimated_cost: usage.estimated_cost,
      run_type: runType || 'campaign',
    });

    logger.milestone(`Campaign complete — ${totalLeads} leads generated`, {
      lead_count: totalLeads,
      tokens: usage.total_tokens,
      estimated_cost: usage.estimated_cost,
      model: usage.model,
    });
    return runId;

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const wasCancelled = signal.aborted || errorMessage.includes('cancelled');

    if (wasCancelled) {
      logger.milestone('Run cancelled by user', { partial_leads: 0 });
      db.prepare(
        `UPDATE pipeline_runs SET status = 'cancelled', completed_at = datetime('now'), error_message = 'Cancelled by user' WHERE id = ?`
      ).run(runId);
      eventBus.emit('campaign.cancelled', {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        run_id: runId,
        partial_leads: 0,
        run_type: runType || 'campaign',
      });
    } else {
      logger.error('campaign', 'Campaign run failed', errorMessage);
      db.prepare(
        `UPDATE pipeline_runs SET status = 'failed', completed_at = datetime('now'), error_message = ? WHERE id = ?`
      ).run(errorMessage, runId);
      eventBus.emit('campaign.failed', {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        run_id: runId,
        error: errorMessage,
        run_type: runType || 'campaign',
      });
      throw err;
    }

    return runId;
  } finally {
    unregisterRun(runId);
  }
}

async function researchCampaignPattern(
  campaign: CampaignParsed,
  icpConfig: ExtendedICPConfig,
  exclusions: Exclusion[],
  pipelineConfig: any,
  tracker?: TokenTracker,
  logger?: ActivityLogger,
  signal?: AbortSignal,
  promptInstructions?: string,
  discoverStep?: FunnelStepConfig,
  searchContext?: string,
  streamCtx?: { runId: string; campaignId?: string }
): Promise<ResearchCandidate[]> {
  const aiConfig = getAIConfig();
  const client = await createAIClient();

  const systemPrompt = getCampaignResearchPrompt(campaign, icpConfig, exclusions, promptInstructions, discoverStep, searchContext);
  const modelToUse = resolveModel(pipelineConfig.model || aiConfig.defaultModel, aiConfig.provider);

  logger?.thinking('research', `Sending research prompt to ${modelToUse}...`, {
    target_count: campaign.target_count,
    search_patterns: campaign.search_patterns?.length || 0,
    example_companies: campaign.example_companies?.length || 0,
    exclusions: exclusions.length,
  });

  // Use streaming to show real-time progress during long research calls
  const stream = client.messages.stream({
    model: modelToUse,
    max_tokens: pipelineConfig.max_tokens_research || 16384,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Research and identify at least ${campaign.target_count} companies matching the "${campaign.name}" pattern. Return the results as a JSON array.`,
      },
    ],
  });

  // Wire abort signal to cancel the stream mid-flight
  if (signal) {
    signal.addEventListener('abort', () => stream.abort(), { once: true });
  }

  let accumulatedText = '';
  let lastLoggedLength = 0;
  let lastCandidateCount = 0;

  stream.on('text', (text: string) => {
    accumulatedText += text;

    if (streamCtx) {
      eventBus.emit('run.ai_stream', {
        run_id: streamCtx.runId,
        campaign_id: streamCtx.campaignId,
        phase: 'discover',
        block_type: 'text',
        delta: text,
        done: false,
      });
    }

    // Log progress every ~1500 chars
    if (accumulatedText.length - lastLoggedLength > 1500) {
      const candidateMatches = accumulatedText.match(/"company_name"/g);
      const candidateCount = candidateMatches ? candidateMatches.length : 0;
      if (candidateCount > lastCandidateCount) {
        const nameMatches = accumulatedText.match(/"company_name"\s*:\s*"([^"]+)"/g);
        const latestName = nameMatches ? nameMatches[nameMatches.length - 1]?.replace(/"company_name"\s*:\s*"/, '').replace(/"$/, '') : '';
        logger?.thinking('research', `Claude is researching... ${candidateCount} candidates identified${latestName ? ` (latest: ${latestName})` : ''}`, {
          chars_generated: accumulatedText.length,
          candidates_so_far: candidateCount,
        });
        lastCandidateCount = candidateCount;
      } else {
        logger?.thinking('research', `Claude is generating response... ${Math.round(accumulatedText.length / 1000)}k chars`, {
          chars_generated: accumulatedText.length,
        });
      }
      lastLoggedLength = accumulatedText.length;
    }
  });

  const response = await stream.finalMessage();

  if (streamCtx) {
    eventBus.emit('run.ai_stream', {
      run_id: streamCtx.runId,
      campaign_id: streamCtx.campaignId,
      phase: 'discover',
      block_type: 'text',
      delta: '',
      done: true,
    });
  }

  if (tracker) tracker.addUsage(response);

  const rawText = accumulatedText || (response.content[0].type === 'text' ? (response.content[0] as any).text : '');
  const responseLength = rawText.length;
  const stopReason = response.stop_reason;

  logger?.thinking('research', `Research complete — ${responseLength} chars generated (stop: ${stopReason}). Parsing candidates...`, {
    response_length: responseLength,
    stop_reason: stopReason,
    usage: { input: response.usage?.input_tokens, output: response.usage?.output_tokens },
  });

  // If response was truncated, that's likely the problem
  if (stopReason === 'max_tokens') {
    logger?.error('research', 'Response truncated — max_tokens reached. Increase max_tokens_research in pipeline config.', `Response ended mid-stream at ${responseLength} chars`);
  }

  const jsonStr = extractJson(rawText);

  let candidates: ResearchCandidate[];
  const parseJsonFlexibly = (str: string): any => {
    // First try direct parse
    try { return JSON.parse(str); } catch {}

    // If truncated, try to salvage by closing brackets
    if (stopReason === 'max_tokens') {
      logger?.thinking('research', 'Response was truncated, attempting to salvage partial JSON...');
      // Find the last complete object in the array (last "},")
      const lastCompleteObj = str.lastIndexOf('},');
      if (lastCompleteObj > 0) {
        const salvaged = str.substring(0, lastCompleteObj + 1) + ']';
        try {
          const result = JSON.parse(salvaged);
          logger?.thinking('research', `Salvaged ${Array.isArray(result) ? result.length : 'unknown'} candidates from truncated response`);
          return result;
        } catch {}
      }
      // Try closing with just ]
      const lastBrace = str.lastIndexOf('}');
      if (lastBrace > 0) {
        try {
          const result = JSON.parse(str.substring(0, lastBrace + 1) + ']');
          logger?.thinking('research', `Salvaged ${Array.isArray(result) ? result.length : 'unknown'} candidates (brace close)`);
          return result;
        } catch {}
      }
    }
    return null;
  };

  try {
    const parsed = parseJsonFlexibly(jsonStr);
    if (!parsed) throw new Error('Could not parse JSON');
    // Handle case where Claude wraps array in an object
    if (Array.isArray(parsed)) {
      candidates = parsed;
    } else if (parsed && typeof parsed === 'object') {
      // Look for an array property (Claude sometimes wraps in { "companies": [...] } or { "candidates": [...] })
      const arrayProp = Object.values(parsed).find(v => Array.isArray(v)) as any[] | undefined;
      if (arrayProp) {
        logger?.thinking('research', `Response was an object, extracted array from property (${arrayProp.length} items)`);
        candidates = arrayProp;
      } else {
        logger?.error('research', 'Parsed JSON is an object but contains no array property', JSON.stringify(Object.keys(parsed)));
        candidates = [];
      }
    } else {
      logger?.error('research', 'Parsed JSON is neither array nor object', typeof parsed);
      candidates = [];
    }
  } catch (err) {
    logger?.error('research', `JSON parse failed — Claude may have returned non-JSON`, `${String(err).substring(0, 200)}\n\nFirst 500 chars of response:\n${rawText.substring(0, 500)}`);
    console.error(`[campaign] Failed to parse JSON for campaign "${campaign.name}":`, err);
    console.error(`[campaign] Raw response (first 1000 chars):`, rawText.substring(0, 1000));
    candidates = [];
  }

  logger?.thinking('research', `Parsed ${candidates.length} raw candidates from response`);

  // Log what we found before filtering
  if (candidates.length > 0) {
    // Log first candidate's keys to diagnose field name mismatches
    const sampleKeys = Object.keys(candidates[0]);
    logger?.thinking('research', `Sample candidate fields: [${sampleKeys.join(', ')}]`);
  }

  // More forgiving filtering — also accept 'name' as alias for 'company_name'
  const normalized = candidates
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      company_name: c.company_name || (c as any).name || (c as any).company || '',
      domain: c.domain || (c as any).website || (c as any).url || '',
      segment: (() => {
        const emp = c.employee_count_estimate ?? (c as any).employees ?? (c as any).employee_count ?? null;
        if (emp != null) return recalcSegment(emp, icpConfig);
        return (['ENT', 'MM', 'SMB'].includes(c.segment) ? c.segment : 'MM') as 'ENT' | 'MM' | 'SMB';
      })(),
      employee_count_estimate: c.employee_count_estimate ?? (c as any).employees ?? (c as any).employee_count ?? null,
      hq_location: c.hq_location ?? (c as any).location ?? (c as any).headquarters ?? null,
      founded_year: c.founded_year ?? (c as any).year_founded ?? null,
      funding_stage: c.funding_stage ?? (c as any).stage ?? null,
      total_funding: c.total_funding ?? (c as any).funding ?? null,
      investors: c.investors ?? null,
      signals: Array.isArray(c.signals) ? c.signals : [],
      sources: Array.isArray(c.sources) ? c.sources : [],
      notes: c.notes || (c as any).reason || (c as any).why || '',
    }))
    .filter(c => c.company_name && c.domain);

  const droppedCount = candidates.length - normalized.length;
  if (droppedCount > 0) {
    logger?.thinking('research', `Filtered out ${droppedCount} candidates missing company_name or domain`);
  }

  // Log each found candidate
  for (const c of normalized.slice(0, 8)) {
    logger?.finding('research', c.company_name, `${c.domain} — ${c.segment} — ${c.notes?.substring(0, 100) || 'no notes'}`, {
      segment: c.segment,
      hq: c.hq_location,
      signals: c.signals?.length || 0,
    });
  }
  if (normalized.length > 8) {
    logger?.thinking('research', `...and ${normalized.length - 8} more candidates`);
  }

  return normalized;
}

/**
 * Loads fully merged configuration for a campaign.
 * Global settings serve as defaults; campaign overrides replace at the key level.
 * Arrays are replaced (not merged). Null/undefined values inherit from global.
 */
export function loadCampaignConfig(campaign: CampaignParsed) {
  const globalPipeline = getSetting('pipeline', getDefaultPipelineConfig());
  const globalPrompts = getSetting('prompts', getDefaultPromptConfig());

  // Deep merge with null-inheritance: campaign values override global, nulls fall back to global
  const pipelineConfig = mergeWithNullInheritance(globalPipeline, campaign.pipeline_overrides);
  const promptConfig = mergeWithNullInheritance(globalPrompts, campaign.prompt_overrides);
  const icpConfig = loadExtendedIcpConfig(promptConfig, campaign.icp_overrides);
  const exclusions = loadMergedExclusions(campaign.exclusion_config);

  return { pipelineConfig, promptConfig, icpConfig, exclusions };
}

function mergeWithNullInheritance(global: Record<string, any>, overrides?: Record<string, any> | null): Record<string, any> {
  if (!overrides) return { ...global };
  const merged = { ...global };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
    // null/undefined: inherit from global (already there)
  }
  return merged;
}

function loadMergedExclusions(campaignExclusionConfig?: { additions?: any[]; exemptions?: string[] } | null): Exclusion[] {
  const globalExclusions = getDb().prepare('SELECT * FROM exclusions').all() as Exclusion[];

  if (!campaignExclusionConfig) return globalExclusions;

  const exemptSet = new Set(campaignExclusionConfig.exemptions || []);
  const filtered = globalExclusions.filter(e => !exemptSet.has(e.id));

  const additions: Exclusion[] = (campaignExclusionConfig.additions || []).map((a: any, i: number) => ({
    id: `campaign_add_${i}`,
    company_name: a.company_name,
    domain: a.domain || null,
    industry: null,
    employees: null,
    reason: a.reason || null,
    category: a.category || 'custom',
    added_by: null,
    created_at: new Date().toISOString(),
  }));

  return [...filtered, ...additions];
}

// ── Single-lead brief rerun ─────────────────────────────────────────

export async function rerunBriefForLead(leadId: string): Promise<{ success: boolean; audit_score?: number; error?: string }> {
  const db = getDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;
  if (!lead) return { success: false, error: 'Lead not found' };
  if (!lead.campaign_id) return { success: false, error: 'Lead has no campaign' };

  const campaignRow = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(lead.campaign_id);
  if (!campaignRow) return { success: false, error: 'Campaign not found' };
  const campaign = parseCampaignRow(campaignRow);
  const { pipelineConfig, icpConfig, promptConfig } = loadCampaignConfig(campaign);

  const funnelConfig = campaign.funnel_config || buildLegacyFunnel(pipelineConfig);
  const briefStep = funnelConfig.steps.find((s: FunnelStepConfig) => s.id === 'brief');
  const auditStep = funnelConfig.steps.find((s: FunnelStepConfig) => s.id === 'audit');
  const aiConfig = getAIConfig();
  const model = briefStep?.model || aiConfig.defaultModel;

  const candidateData = lead.candidate_data ? JSON.parse(lead.candidate_data) : {};
  const candidate: ResearchCandidate = {
    company_name: lead.company_name,
    domain: lead.website || lead.domain || '',
    segment: recalcSegment(lead.employee_count, icpConfig),
    employee_count_estimate: lead.employee_count,
    hq_location: lead.hq_location,
    founded_year: lead.founded_year,
    funding_stage: lead.funding_stage,
    total_funding: lead.total_funding,
    investors: lead.investors,
    signals: candidateData.signals || [],
    sources: candidateData.sources || [],
    notes: candidateData.notes || '',
    enrichment_source_count: candidateData.enrichment_source_count,
    domain_validated: candidateData.domain_validated,
  };

  const scoreBreakdown = lead.score_breakdown ? JSON.parse(lead.score_breakdown) : {};
  const score: ScoringResult = {
    fit_score: lead.fit_score || 0,
    fit_score_label: lead.fit_score_label || '',
    confidence: lead.confidence || 'medium',
    score_breakdown: scoreBreakdown,
    reasoning: candidateData.reasoning,
  };

  const tracker = new TokenTracker(model);
  const briefTone = briefStep?.outreach_tone || promptConfig?.outreach_tone;

  eventBus.emit('lead.brief_rerun', {
    lead_id: leadId,
    company_name: lead.company_name,
    status: 'generating',
    message: `Generating brief with ${model}...`,
  });

  const brief = await generateBrief(
    candidate, score, icpConfig, model, tracker,
    briefStep?.prompt_instructions, briefTone, briefStep,
    { runId: lead.run_id, campaignId: lead.campaign_id, phase: 'brief-rerun' }
  );

  // Update lead with new brief data
  db.prepare(`UPDATE leads SET
    brief_markdown = ?, pain_hypotheses = ?, tech_stack = ?,
    competitive_displacement = ?, outreach_strategy = ?,
    source_citations = ?, why_now = ?, brief_thinking = ?,
    signal_count = ?, pipeline_stage = 'briefed', updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    brief.brief_markdown || null,
    brief.pain_hypotheses ? JSON.stringify(brief.pain_hypotheses) : null,
    brief.tech_stack ? JSON.stringify(brief.tech_stack) : null,
    brief.competitive_displacement ? JSON.stringify(brief.competitive_displacement) : null,
    brief.outreach_strategy || null,
    brief.source_citations ? JSON.stringify(brief.source_citations) : null,
    brief.why_now ? JSON.stringify(brief.why_now) : null,
    brief.thinking || null,
    brief.source_citations?.length || candidate.signals.length || 0,
    leadId
  );

  // Replace personas
  db.prepare('DELETE FROM personas WHERE lead_id = ?').run(leadId);
  const insertPersona = db.prepare(
    `INSERT INTO personas (id, lead_id, role_type, name, title, linkedin_url, department, tenure, outreach_angle, talking_points, outreach_message, social_signals, buying_signals, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  );
  for (const persona of brief.personas) {
    insertPersona.run(
      uuidv4(), leadId,
      persona.role_type, persona.name, persona.title,
      persona.linkedin_url, persona.department, persona.tenure,
      persona.outreach_angle, persona.talking_points,
      persona.outreach_message, persona.social_signals,
      persona.buying_signals
    );
  }

  // Run audit if enabled
  let auditScore: number | undefined;
  if (auditStep?.enabled !== false) {
    const auditUseAi = auditStep?.audit_use_ai === true;
    eventBus.emit('lead.brief_rerun', {
      lead_id: leadId,
      company_name: lead.company_name,
      status: 'auditing',
      message: auditUseAi ? 'Running rules + AI audit...' : 'Running quality audit...',
    });

    const threshold = auditStep?.audit_quality_threshold ?? 60;
    const rulesAudit = auditBrief({ brief, candidate, score }, threshold);
    let finalScore = rulesAudit.score;
    let allIssues = [...rulesAudit.issues];
    let aiResultJson: string | null = null;

    if (auditUseAi) {
      try {
        const aiResult = await aiAuditBrief(
          { brief, candidate, score, icpConfig },
          auditStep!.model || 'claude-haiku-4-5@20251001',
          tracker
        );
        finalScore = Math.round(rulesAudit.score * 0.3 + aiResult.overall_score * 0.7);
        allIssues = [...rulesAudit.issues, ...aiResult.issues];
        aiResultJson = JSON.stringify(aiResult);
      } catch (err) {
        console.error(`[rerunBrief] AI audit failed for ${lead.company_name}:`, err);
      }
    }

    auditScore = finalScore;
    try {
      db.prepare('UPDATE leads SET audit_score = ?, audit_issues = ?, ai_audit_result = ?, pipeline_stage = ? WHERE id = ?')
        .run(finalScore, JSON.stringify(allIssues), aiResultJson, 'audited', leadId);
    } catch { /* column may not exist */ }
  }

  eventBus.emit('lead.brief_rerun', {
    lead_id: leadId,
    company_name: lead.company_name,
    status: 'completed',
    message: `Brief regenerated${auditScore != null ? ` — audit: ${auditScore}/100` : ''}`,
    audit_score: auditScore,
  });

  return { success: true, audit_score: auditScore };
}
