/**
 * Inbound Lead Orchestrator
 *
 * Processes imported leads (CSV, manual, webhook) through the same
 * enrichment → scoring → brief pipeline as outbound research.
 *
 * Flow:
 * 1. Load shell leads from DB (status = 'imported')
 * 2. Convert to ResearchCandidate format
 * 3. Enrich with all enabled data sources
 * 4. Score each candidate against ICP
 * 5. Generate brief + personas
 * 6. Check signal convergence with active campaigns
 * 7. Update lead records with results
 */

import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getAIConfig } from '../config/vertexConfig.js';
import { getDb } from '../db/schema.js';
import { enrichCandidates } from './enrichment/service.js';
import { scoreCandidate } from './scorer.js';
import { generateBrief } from './briefWriter.js';
import { TokenTracker } from './tokenTracker.js';
import { checkConvergence } from './convergenceChecker.js';
import { eventBus } from '../events/eventBus.js';
import type { ResearchCandidate } from './researcher.js';
import type { ICPConfigParsed } from '../types/index.js';
import type { ExtendedICPConfig } from './prompts/research.js';
import { getSetting, getDefaultPipelineConfig, getDefaultPromptConfig } from '../routes/icp.js';

export async function processInboundImport(importId: string): Promise<void> {
  const db = getDb();

  try {
    // Update import status
    db.prepare("UPDATE inbound_imports SET status = 'processing' WHERE id = ?").run(importId);

    // Load pipeline config
    const pipelineConfig = getSetting('pipeline', getDefaultPipelineConfig());
    const promptConfig = getSetting('prompts', getDefaultPromptConfig());
    const modelToUse = pipelineConfig.model || getAIConfig().defaultModel;
    const tracker = new TokenTracker(modelToUse);
    const icpConfig = loadExtendedIcpConfig(promptConfig);
    const qualifyThreshold = pipelineConfig.qualify_threshold || 50;

    // Load shell leads for this import
    const leads = db
      .prepare("SELECT * FROM leads WHERE import_id = ? AND lead_status = 'imported'")
      .all(importId) as any[];

    if (leads.length === 0) {
      db.prepare(
        "UPDATE inbound_imports SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
      ).run(importId);
      return;
    }

    console.log(`[inbound] Processing ${leads.length} leads for import ${importId}. Model: ${modelToUse}`);

    // Mark as enriching
    db.prepare("UPDATE leads SET lead_status = 'enriching' WHERE import_id = ? AND lead_status = 'imported'")
      .run(importId);

    // Convert to ResearchCandidate format
    const candidates: ResearchCandidate[] = leads.map(lead => ({
      company_name: lead.company_name,
      domain: lead.domain || null,
      segment: lead.segment || 'MM',
      employee_count_estimate: lead.employee_count || null,
      hq_location: lead.hq_location || null,
      founded_year: lead.founded_year || null,
      funding_stage: lead.funding_stage || null,
      total_funding: lead.total_funding || null,
      investors: lead.investors || null,
      signals: [],
      sources: [],
      notes: '',
    }));

    // Emit lead.created events for all leads
    for (const lead of leads) {
      eventBus.emit('lead.created', {
        lead_id: lead.id,
        company_name: lead.company_name,
        source_type: lead.source_type || 'inbound_csv',
        domain: lead.domain || undefined,
        import_id: importId,
      });
    }

    // Enrich all candidates
    const { candidates: enrichedCandidates, summary } = await enrichCandidates(candidates);
    console.log(
      `[inbound] Enriched ${summary.enriched_count}/${summary.total_candidates} from: ${summary.sources_used.join(', ')}`
    );

    // Emit lead.enriched events
    for (let i = 0; i < leads.length; i++) {
      eventBus.emit('lead.enriched', {
        lead_id: leads[i].id,
        company_name: leads[i].company_name,
        sources_used: summary.sources_used,
      });
    }

    let processedCount = 0;
    let qualifiedCount = 0;

    // Score, brief, and update each lead
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const candidate = enrichedCandidates[i];

      try {
        // Score
        const score = await scoreCandidate(candidate, icpConfig, modelToUse, tracker);

        // Generate brief
        const brief = await generateBrief(candidate, score, icpConfig, modelToUse, tracker);

        // Check convergence with active campaigns
        const convergence = checkConvergence(
          candidate.company_name,
          candidate.domain,
          candidate.signals
        );

        // Emit lead.scored
        eventBus.emit('lead.scored', {
          lead_id: lead.id,
          company_name: candidate.company_name,
          fit_score: score.fit_score,
          fit_score_label: score.fit_score_label,
          confidence: score.confidence,
        });

        // Determine status
        const isQualified = score.fit_score >= qualifyThreshold || convergence.score > 50;
        const leadStatus = isQualified ? 'qualified' : 'disqualified';
        if (isQualified) qualifiedCount++;

        // Emit qualification event
        eventBus.emit(isQualified ? 'lead.qualified' : 'lead.disqualified', {
          lead_id: lead.id,
          company_name: candidate.company_name,
          fit_score: score.fit_score,
          source_type: lead.source_type || 'inbound_csv',
        });

        // Emit convergence if detected
        if (convergence.score > 50) {
          eventBus.emit('convergence.detected', {
            lead_id: lead.id,
            company_name: candidate.company_name,
            convergence_score: convergence.score,
            matched_campaigns: convergence.matched_campaigns.map(m => m.name),
          });
        }

        // Update lead record
        db.prepare(`
          UPDATE leads SET
            segment = ?,
            hq_location = ?,
            employee_count = ?,
            founded_year = ?,
            funding_stage = ?,
            total_funding = ?,
            investors = ?,
            website = ?,
            fit_score = ?,
            fit_score_label = ?,
            confidence = ?,
            why_now = ?,
            score_breakdown = ?,
            pain_hypotheses = ?,
            tech_stack = ?,
            competitive_displacement = ?,
            outreach_strategy = ?,
            source_citations = ?,
            brief_markdown = ?,
            lead_status = ?,
            convergence_score = ?,
            convergence_details = ?
          WHERE id = ?
        `).run(
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
          JSON.stringify(brief.source_citations),
          brief.brief_markdown,
          leadStatus,
          convergence.score,
          convergence.details || null,
          lead.id
        );

        // Insert personas
        for (const persona of brief.personas) {
          db.prepare(`
            INSERT INTO personas (
              id, lead_id, role_type, name, title, linkedin_url, department,
              tenure, outreach_angle, talking_points, outreach_message,
              social_signals, buying_signals, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            uuidv4(),
            lead.id,
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

        processedCount++;

        // Update import progress
        db.prepare('UPDATE inbound_imports SET processed_count = ?, qualified_count = ? WHERE id = ?')
          .run(processedCount, qualifiedCount, importId);

      } catch (err) {
        console.error(`[inbound] Error processing lead ${lead.company_name}:`, err);
        db.prepare("UPDATE leads SET lead_status = 'imported' WHERE id = ?").run(lead.id);
      }
    }

    // Mark import complete
    db.prepare(
      "UPDATE inbound_imports SET status = 'completed', processed_count = ?, qualified_count = ?, completed_at = datetime('now') WHERE id = ?"
    ).run(processedCount, qualifiedCount, importId);

    // Emit import.completed
    const importRow = db.prepare('SELECT * FROM inbound_imports WHERE id = ?').get(importId) as any;
    eventBus.emit('import.completed', {
      import_id: importId,
      source_type: importRow?.source_type || 'inbound_csv',
      row_count: leads.length,
      processed_count: processedCount,
      qualified_count: qualifiedCount,
    });

    console.log(
      `[inbound] Import ${importId} complete. Processed: ${processedCount}/${leads.length}, Qualified: ${qualifiedCount}`
    );

  } catch (err) {
    console.error(`[inbound] Import ${importId} failed:`, err);
    db.prepare(
      "UPDATE inbound_imports SET status = 'failed', error_message = ? WHERE id = ?"
    ).run(err instanceof Error ? err.message : String(err), importId);

    eventBus.emit('import.failed', {
      import_id: importId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Load extended ICP config (same pattern as orchestrator.ts)
 */
function loadExtendedIcpConfig(promptConfig: any): ExtendedICPConfig {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 1')
    .get() as Record<string, string> | undefined;

  const base: ICPConfigParsed = row
    ? {
        segments: JSON.parse(row.segments),
        verticals: JSON.parse(row.verticals),
        tech_signals: JSON.parse(row.tech_signals),
        competitors: JSON.parse(row.competitors),
        success_stories: row.success_stories ? JSON.parse(row.success_stories) : {},
      }
    : {
        segments: {
          SMB: { vpn_users_min: 100, vpn_users_max: 350 },
          MM: { vpn_users_min: 350, vpn_users_max: 650 },
          ENT: { vpn_users_min: 650, vpn_users_max: 10000 },
        },
        verticals: ['Gaming', 'Developer Tools', 'Cloud-Native SaaS', 'FinTech'],
        tech_signals: ['VPN replacement', 'Zero trust initiative', 'Kubernetes/K8s adoption'],
        competitors: ['Zscaler', 'Cloudflare Access', 'Tailscale', 'Cisco AnyConnect'],
        success_stories: {},
      };

  return {
    ...base,
    company_context: getSetting('icp.company_context', undefined),
    geographies: getSetting('icp.geographies', undefined),
    segment_details: getSetting('icp.segment_details', undefined),
    disqualifiers: getSetting('icp.disqualifiers', undefined),
    signal_weights: getSetting('icp.signal_weights', undefined),
    buyer_personas: getSetting('icp.buyer_personas', undefined),
    prompt_config: promptConfig,
  };
}
