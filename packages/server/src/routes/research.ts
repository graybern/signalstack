import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, requirePermission, AuthRequest } from '../auth/middleware.js';
import { userHasPermission } from '../auth/permissions.js';

const router = Router();

router.post('/', authenticate, requirePermission('research:execute'), async (req: AuthRequest, res: Response) => {
  const { domain, campaign_id, context } = req.body;
  if (!domain || !campaign_id) {
    return res.status(400).json({ error: 'domain and campaign_id are required' });
  }

  const db = getDb();

  const campaign = db.prepare("SELECT id, name FROM campaigns WHERE id = ? AND status = 'active'").get(campaign_id) as any;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found or archived' });

  const activeRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status IN ('pending','running') LIMIT 1"
  ).get(campaign_id) as any;
  if (activeRun) return res.status(409).json({ error: 'A run is already in progress for this campaign' });

  const normalizedDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').trim();
  if (!normalizedDomain) return res.status(400).json({ error: 'Invalid domain' });

  let lead = db.prepare(
    'SELECT id FROM leads WHERE campaign_id = ? AND domain = ?'
  ).get(campaign_id, normalizedDomain) as any;

  const isExisting = !!lead;

  if (!lead) {
    const leadId = uuid();
    const namePart = normalizedDomain.split('.')[0];
    const companyName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    db.prepare(
      `INSERT INTO leads (id, campaign_id, company_name, domain, segment, fit_score, pipeline_stage, lead_status, source_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'MM', 0, 'discovered', 'pending', 'quick_research', datetime('now'), datetime('now'))`
    ).run(leadId, campaign_id, companyName, normalizedDomain);
    lead = { id: leadId };
  }

  if (context?.trim()) {
    const row = db.prepare('SELECT candidate_data FROM leads WHERE id = ?').get(lead.id) as any;
    const existing = row?.candidate_data ? JSON.parse(row.candidate_data) : {};
    const header = `## Pre-Research Context\n${context.trim()}`;
    existing.notes = existing.notes ? `${header}\n\n${existing.notes}` : header;
    db.prepare('UPDATE leads SET candidate_data = ? WHERE id = ?')
      .run(JSON.stringify(existing), lead.id);
  }

  const { runCampaign } = await import('../agent/campaignOrchestrator.js');
  const steps = ['enrich', 'score', 'brief', 'audit'];

  const runPromise = runCampaign(campaign_id, req.user!.id, steps, [lead.id], 'quick_research', { skipScoreThreshold: true });
  runPromise.catch(err => {
    console.error('[quick-research] Failed:', err);
  });

  await new Promise(resolve => setTimeout(resolve, 50));
  const newRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(campaign_id) as any;

  res.json({
    status: 'started',
    run_id: newRun?.id || null,
    lead_id: lead.id,
    domain: normalizedDomain,
    is_existing: isExisting,
  });
});

// Batch research — multiple domains at once
router.post('/batch', authenticate, requirePermission('research:execute'), async (req: AuthRequest, res: Response) => {
  const { domains, campaign_id, context, csv_context, force_brief, score_only } = req.body;
  if (!Array.isArray(domains) || domains.length === 0 || !campaign_id) {
    return res.status(400).json({ error: 'domains (array) and campaign_id are required' });
  }
  if (score_only && force_brief) {
    return res.status(400).json({ error: 'score_only and force_brief are mutually exclusive' });
  }
  const maxBatchSize = score_only ? 10000 : 50;
  if (domains.length > maxBatchSize) {
    return res.status(400).json({ error: `Maximum ${maxBatchSize} domains per batch${score_only ? ' (score-only mode)' : ''}` });
  }
  if (score_only && domains.length > 50) {
    if (!userHasPermission(req.user!.role, 'research:bulk', req.apiKeyScopes, req.user!.id)) {
      return res.status(403).json({ error: 'research:bulk permission required for score-only batches over 50 domains', your_role: req.user!.role });
    }
  }

  const db = getDb();

  const campaign = db.prepare("SELECT id, name FROM campaigns WHERE id = ? AND status = 'active'").get(campaign_id) as any;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found or archived' });

  const activeRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status IN ('pending','running') LIMIT 1"
  ).get(campaign_id) as any;
  if (activeRun) return res.status(409).json({ error: 'A run is already in progress for this campaign' });

  // Normalize and deduplicate
  const seen = new Set<string>();
  const normalizedDomains: string[] = [];
  for (const d of domains) {
    const norm = String(d).toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').trim();
    if (norm && norm.includes('.') && !seen.has(norm)) {
      seen.add(norm);
      normalizedDomains.push(norm);
    }
  }
  const duplicatesSkipped = domains.length - normalizedDomains.length;

  if (normalizedDomains.length === 0) {
    return res.status(400).json({ error: 'No valid domains found after normalization' });
  }

  // Upsert leads for each domain
  const leadIds: string[] = [];
  for (const domain of normalizedDomains) {
    let lead = db.prepare(
      'SELECT id FROM leads WHERE campaign_id = ? AND domain = ?'
    ).get(campaign_id, domain) as any;

    if (!lead) {
      const leadId = uuid();
      const namePart = domain.split('.')[0];
      const companyName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
      db.prepare(
        `INSERT INTO leads (id, campaign_id, company_name, domain, segment, fit_score, pipeline_stage, lead_status, source_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'MM', 0, 'discovered', 'pending', 'batch_research', datetime('now'), datetime('now'))`
      ).run(leadId, campaign_id, companyName, domain);
      lead = { id: leadId };
    }

    // Store CSV original row data and inject as AI research context
    if (csv_context?.rows) {
      const csvRow = csv_context.rows[domain];
      if (csvRow) {
        const row = db.prepare('SELECT candidate_data FROM leads WHERE id = ?').get(lead.id) as any;
        const existing = row?.candidate_data ? JSON.parse(row.candidate_data) : {};
        existing.csv_original = csvRow;

        const domainCol = csv_context.domain_column || '';
        const contextLines = Object.entries(csvRow)
          .filter(([k, v]) => k !== domainCol && String(v).trim())
          .map(([k, v]) => `${k}: ${v}`);
        if (contextLines.length > 0) {
          const csvNotes = `## CSV Context\n${contextLines.join('\n')}`;
          existing.notes = existing.notes ? `${csvNotes}\n\n${existing.notes}` : csvNotes;
        }

        db.prepare('UPDATE leads SET candidate_data = ? WHERE id = ?')
          .run(JSON.stringify(existing), lead.id);
      }
    }

    // Apply shared context if provided
    if (context?.trim()) {
      const row = db.prepare('SELECT candidate_data FROM leads WHERE id = ?').get(lead.id) as any;
      const existing = row?.candidate_data ? JSON.parse(row.candidate_data) : {};
      const header = `## Pre-Research Context\n${context.trim()}`;
      existing.notes = existing.notes ? `${header}\n\n${existing.notes}` : header;
      db.prepare('UPDATE leads SET candidate_data = ? WHERE id = ?')
        .run(JSON.stringify(existing), lead.id);
    }

    leadIds.push(lead.id);
  }

  const { runCampaign } = await import('../agent/campaignOrchestrator.js');
  const steps = score_only ? ['enrich', 'score', 'audit'] : ['enrich', 'score', 'brief', 'audit'];

  const opts: { skipScoreThreshold?: boolean; skipCandidateLimits?: boolean } = { skipCandidateLimits: true };
  if (force_brief) opts.skipScoreThreshold = true;
  const runPromise = runCampaign(campaign_id, req.user!.id, steps, leadIds, 'batch_research', opts);
  runPromise.catch(err => {
    console.error('[batch-research] Failed:', err);
  });

  await new Promise(resolve => setTimeout(resolve, 50));
  const newRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(campaign_id) as any;

  // Store batch context for export roundtrip
  if (newRun?.id && csv_context) {
    db.prepare('UPDATE pipeline_runs SET batch_context = ? WHERE id = ?')
      .run(JSON.stringify(csv_context), newRun.id);
  }

  res.json({
    status: 'started',
    run_id: newRun?.id || null,
    lead_ids: leadIds,
    domain_count: normalizedDomains.length,
    duplicates_skipped: duplicatesSkipped,
  });
});

router.get('/history', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const runs = db.prepare(
    `SELECT pr.id, pr.status, pr.campaign_id, pr.target_lead_ids, pr.started_at, pr.completed_at, pr.estimated_cost, pr.lead_count, pr.error_message, pr.created_at, pr.steps_run, pr.run_type,
            c.name as campaign_name,
            u.display_name as triggered_by_name
     FROM pipeline_runs pr
     LEFT JOIN campaigns c ON c.id = pr.campaign_id
     LEFT JOIN users u ON u.id = pr.triggered_by
     WHERE pr.run_type IN ('quick_research', 'batch_research', 'webhook_research')
        OR (pr.run_type = 'resume' AND pr.resumed_from_run_id IN (
          SELECT id FROM pipeline_runs WHERE run_type IN ('quick_research', 'batch_research', 'webhook_research')
        ))
     ORDER BY pr.created_at DESC LIMIT 50`
  ).all() as any[];

  const enriched = runs.map(run => {
    let leadInfo = null;
    let batchLeads: any[] | null = null;

    if (run.target_lead_ids) {
      try {
        const leadIds: string[] = JSON.parse(run.target_lead_ids);
        if (run.run_type === 'batch_research' || run.run_type === 'webhook_research' || (run.run_type === 'resume' && leadIds.length > 1)) {
          // For batch runs, load summary for all leads
          const placeholders = leadIds.map(() => '?').join(',');
          batchLeads = db.prepare(
            `SELECT id, company_name, domain, fit_score, fit_score_label, segment, lead_status FROM leads WHERE id IN (${placeholders})`
          ).all(...leadIds) as any[];
        } else if (leadIds.length > 0) {
          leadInfo = db.prepare(
            'SELECT id, company_name, domain, fit_score, fit_score_label, segment FROM leads WHERE id = ?'
          ).get(leadIds[0]) as any;
        }
      } catch {}
    }
    return { ...run, lead: leadInfo, batch_leads: batchLeads };
  });

  // Attach resumed_by info for failed/cancelled runs
  const resumableRuns = enriched.filter((r: any) => r.status === 'failed' || r.status === 'cancelled');
  if (resumableRuns.length > 0) {
    const ph = resumableRuns.map(() => '?').join(',');
    const resumeChildren = db.prepare(
      `SELECT resumed_from_run_id, id as resumed_by_run_id, status as resumed_by_status
       FROM pipeline_runs WHERE resumed_from_run_id IN (${ph})`
    ).all(...resumableRuns.map((r: any) => r.id)) as any[];
    const childMap = new Map(resumeChildren.map((c: any) => [c.resumed_from_run_id, c]));
    for (const r of resumableRuns) {
      const child = childMap.get(r.id);
      if (child) {
        r.resumed_by_run_id = child.resumed_by_run_id;
        r.resumed_by_status = child.resumed_by_status;
      }
    }
  }

  res.json(enriched);
});

// Export enriched CSV for a batch research run
router.get('/batch/:runId/export', authenticate, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const run = db.prepare(
    "SELECT id, run_type, target_lead_ids, batch_context FROM pipeline_runs WHERE id = ?"
  ).get(req.params.runId) as any;

  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (!['batch_research', 'webhook_research', 'resume'].includes(run.run_type)) {
    return res.status(400).json({ error: 'Export is only available for batch research runs' });
  }

  const leadIds: string[] = run.target_lead_ids ? JSON.parse(run.target_lead_ids) : [];
  if (leadIds.length === 0) return res.status(400).json({ error: 'No leads in this run' });

  const placeholders = leadIds.map(() => '?').join(',');
  const leads = db.prepare(
    `SELECT id, company_name, domain, segment, fit_score, fit_score_label, confidence,
            hq_location, employee_count, founded_year, funding_stage, total_funding,
            why_now, outreach_strategy, tech_stack, lead_status, candidate_data,
            source_citations, brief_markdown, scorer_thinking, score_breakdown
     FROM leads WHERE id IN (${placeholders})
     ORDER BY fit_score DESC`
  ).all(...leadIds) as any[];

  const batchContext = run.batch_context ? JSON.parse(run.batch_context) : null;
  const csvHeaders = batchContext?.headers || [];
  const domainRowMap: Record<string, Record<string, string>> = batchContext?.rows || {};

  // Build enriched columns
  const enrichedCols = [
    'ss_fit_score', 'ss_fit_score_label', 'ss_confidence', 'ss_segment',
    'ss_employee_count', 'ss_hq_location', 'ss_founded_year', 'ss_funding_stage',
    'ss_total_funding', 'ss_why_now', 'ss_outreach_strategy', 'ss_lead_status',
    'ss_fit_rationale', 'ss_tech_signals', 'ss_score_summary', 'ss_brief_summary',
  ];

  // Determine final headers: original CSV columns (if any) + enriched columns
  // If no CSV context, use domain + company_name as base columns
  const hasOriginalCsv = csvHeaders.length > 0;
  const finalHeaders = hasOriginalCsv
    ? [...csvHeaders, ...enrichedCols]
    : ['company_name', 'domain', ...enrichedCols];

  const escapeCSV = (val: string | null | undefined): string => {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const CATEGORY_MAX_POINTS: Record<string, number> = {
    segment_scale_fit: 20, why_now_triggers: 15, remote_access_pain: 20,
    displacement_wedge: 20, vertical_playbook: 15, buyer_access_readiness: 10,
  };
  const CATEGORY_LABELS: Record<string, string> = {
    segment_scale_fit: 'Segment Fit', why_now_triggers: 'Why Now', remote_access_pain: 'Remote Access Pain',
    displacement_wedge: 'Displacement Wedge', vertical_playbook: 'Vertical Playbook', buyer_access_readiness: 'Buyer Access',
  };

  const buildFitRationale = (val: string | null): string => {
    if (!val) return '';
    try {
      const bd = JSON.parse(val);
      const strengths: string[] = [];
      const gaps: string[] = [];
      for (const [key, maxPts] of Object.entries(CATEGORY_MAX_POINTS)) {
        const cat = bd[key];
        if (!cat) continue;
        const label = CATEGORY_LABELS[key] || key;
        const pts = cat.points || 0;
        const evidence = Array.isArray(cat.evidence) ? cat.evidence.slice(0, 2).join(', ') : '';
        if (pts >= (maxPts as number) * 0.5) {
          strengths.push(evidence ? `${label} ${pts}/${maxPts} (${evidence})` : `${label} ${pts}/${maxPts}`);
        } else if (pts < (maxPts as number) * 0.25) {
          gaps.push(`${label} ${pts}/${maxPts}`);
        }
      }
      const parts: string[] = [];
      if (strengths.length) parts.push(`Strengths: ${strengths.join('; ')}`);
      if (gaps.length) parts.push(`Gaps: ${gaps.join('; ')}`);
      if (Array.isArray(bd.penalties) && bd.penalties.length) {
        const penStr = bd.penalties.map((p: any) => `${p.points} ${p.reason || ''}`).join('; ');
        parts.push(`Penalties: ${penStr}`);
      }
      return parts.join('. ') || '';
    } catch { return ''; }
  };

  const summarizeTechStack = (val: string | null): string => {
    if (!val) return '';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 5).map((t: any) => t.product || t).join(', ');
      }
      const parts: string[] = [];
      if (parsed.vpn_product) parts.push(`VPN: ${parsed.vpn_product}`);
      if (parsed.pam_product) parts.push(`PAM: ${parsed.pam_product}`);
      if (parsed.recent_purchases?.length) parts.push(`Recent: ${parsed.recent_purchases.slice(0, 3).join(', ')}`);
      if (parsed.cloud_infra?.length) parts.push(`Cloud: ${parsed.cloud_infra.slice(0, 3).join(', ')}`);
      return parts.join('; ') || '';
    } catch { return String(val).slice(0, 200); }
  };

  const extractScoreSummary = (lead: any): string => {
    if (lead.scorer_thinking) return String(lead.scorer_thinking).slice(0, 500);
    if (lead.candidate_data) {
      try {
        const cd = JSON.parse(lead.candidate_data);
        if (cd.reasoning) return String(cd.reasoning).slice(0, 500);
      } catch {}
    }
    return '';
  };

  const summarizeJson = (val: string | null): string => {
    if (!val) return '';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.slice(0, 3).map((v: any) => typeof v === 'string' ? v : v.signal || v.title || JSON.stringify(v)).join('; ');
      if (typeof parsed === 'string') return parsed;
      return JSON.stringify(parsed).slice(0, 200);
    } catch { return String(val).slice(0, 200); }
  };

  const rows = leads.map(lead => {
    const enrichedValues: Record<string, string> = {
      ss_fit_score: String(lead.fit_score ?? ''),
      ss_fit_score_label: lead.fit_score_label || '',
      ss_confidence: lead.confidence || '',
      ss_segment: lead.segment || '',
      ss_employee_count: lead.employee_count ? String(lead.employee_count) : '',
      ss_hq_location: lead.hq_location || '',
      ss_founded_year: lead.founded_year ? String(lead.founded_year) : '',
      ss_funding_stage: lead.funding_stage || '',
      ss_total_funding: lead.total_funding || '',
      ss_why_now: summarizeJson(lead.why_now),
      ss_outreach_strategy: typeof lead.outreach_strategy === 'string' ? lead.outreach_strategy.slice(0, 300) : summarizeJson(lead.outreach_strategy),
      ss_lead_status: lead.lead_status || '',
      ss_fit_rationale: buildFitRationale(lead.score_breakdown),
      ss_tech_signals: summarizeTechStack(lead.tech_stack),
      ss_score_summary: extractScoreSummary(lead),
      ss_brief_summary: lead.brief_markdown ? String(lead.brief_markdown).slice(0, 500) : '',
    };

    if (hasOriginalCsv) {
      const originalRow = domainRowMap[lead.domain] || {};
      return finalHeaders.map(h =>
        escapeCSV(enrichedCols.includes(h) ? enrichedValues[h] : originalRow[h])
      ).join(',');
    } else {
      return finalHeaders.map(h => {
        if (h === 'company_name') return escapeCSV(lead.company_name);
        if (h === 'domain') return escapeCSV(lead.domain);
        return escapeCSV(enrichedValues[h]);
      }).join(',');
    }
  });

  const csv = '﻿' + finalHeaders.join(',') + '\n' + rows.join('\n');
  const date = new Date().toISOString().split('T')[0];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="signalstack-batch-${date}.csv"`);
  res.send(csv);
});

export default router;
