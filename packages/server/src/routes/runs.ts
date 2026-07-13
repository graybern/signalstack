import { Router, Response } from 'express';
import { CronExpressionParser } from 'cron-parser';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, requireSuperAdmin, AuthRequest } from '../auth/middleware.js';
import { runPipeline } from '../agent/orchestrator.js';
import { cancelRun } from '../agent/runRegistry.js';
import { analyzeRunForResume, runCampaign } from '../agent/campaignOrchestrator.js';

const router = Router();

// ── GET / — List runs with stats aggregation ─────────────────
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { type, campaign_id, status, date_from, date_to, limit: rawLimit } = req.query;
  const pageLimit = Math.min(parseInt(rawLimit as string) || 50, 200);

  const conditions: string[] = [];
  const params: any[] = [];

  if (type) { conditions.push('pr.run_type = ?'); params.push(type); }
  if (campaign_id) { conditions.push('pr.campaign_id = ?'); params.push(campaign_id); }
  if (status) { conditions.push('pr.status = ?'); params.push(status); }
  if (date_from) { conditions.push('pr.created_at >= ?'); params.push(date_from); }
  if (date_to) { conditions.push('pr.created_at <= ?'); params.push(date_to + ' 23:59:59'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const runs = db.prepare(
    `SELECT pr.*,
       u.display_name as triggered_by_name,
       c.name as campaign_name,
       (SELECT COUNT(*) FROM pipeline_runs pr2 WHERE pr2.created_at <= pr.created_at) as run_number
     FROM pipeline_runs pr
     LEFT JOIN users u ON u.id = pr.triggered_by
     LEFT JOIN campaigns c ON c.id = pr.campaign_id
     ${where}
     ORDER BY pr.created_at DESC LIMIT ?`
  ).all(...params, pageLimit);

  // Attach resumed_by info for failed/cancelled runs
  const resumable = runs.filter((r: any) => r.status === 'failed' || r.status === 'cancelled');
  if (resumable.length > 0) {
    const placeholders = resumable.map(() => '?').join(',');
    const resumeChildren = db.prepare(
      `SELECT resumed_from_run_id, id as resumed_by_run_id, status as resumed_by_status
       FROM pipeline_runs WHERE resumed_from_run_id IN (${placeholders})`
    ).all(...resumable.map((r: any) => r.id)) as any[];
    const childMap = new Map(resumeChildren.map(c => [c.resumed_from_run_id, c]));
    for (const r of resumable as any[]) {
      const child = childMap.get(r.id);
      if (child) {
        r.resumed_by_run_id = child.resumed_by_run_id;
        r.resumed_by_status = child.resumed_by_status;
      }
    }
  }

  // Stats aggregation
  const stats = db.prepare(
    `SELECT
       COUNT(*) as total_runs,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_runs,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs,
       SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) as missed_runs,
       SUM(lead_count) as total_leads,
       AVG(CASE WHEN lead_count > 0 THEN lead_count END) as avg_leads_per_run,
       SUM(estimated_cost) as total_cost,
       AVG(CASE WHEN estimated_cost > 0 THEN estimated_cost END) as avg_cost_per_run
     FROM pipeline_runs ${where}`
  ).get(...params) as any;

  const successRate = stats.total_runs > 0
    ? Math.round((stats.completed_runs / stats.total_runs) * 100)
    : 0;

  res.json({
    runs,
    stats: {
      total_runs: stats.total_runs || 0,
      completed_runs: stats.completed_runs || 0,
      failed_runs: stats.failed_runs || 0,
      missed_runs: stats.missed_runs || 0,
      success_rate: successRate,
      total_leads: stats.total_leads || 0,
      avg_leads_per_run: Math.round(stats.avg_leads_per_run || 0),
      total_cost: Math.round((stats.total_cost || 0) * 100) / 100,
      avg_cost_per_run: Math.round((stats.avg_cost_per_run || 0) * 100) / 100,
    },
  });
});

// ── GET /upcoming — Next scheduled runs across campaigns ─────
router.get('/upcoming', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const campaigns = db.prepare(
    `SELECT id, name, schedule_cron, schedule_enabled, schedule_timezone
     FROM campaigns
     WHERE schedule_enabled = 1 AND status = 'active'
     ORDER BY name`
  ).all() as any[];

  const upcoming = campaigns.map((c: any) => {
    const lastRun = db.prepare(
      `SELECT status, completed_at, created_at FROM pipeline_runs
       WHERE campaign_id = ? AND status != 'missed'
       ORDER BY created_at DESC LIMIT 1`
    ).get(c.id) as any;

    const missedCount = (db.prepare(
      `SELECT COUNT(*) as cnt FROM pipeline_runs
       WHERE campaign_id = ? AND status = 'missed'`
    ).get(c.id) as any)?.cnt || 0;

    let next_run_at: string | null = null;
    let last_expected_at: string | null = null;
    let is_overdue = false;

    try {
      const cronOpts = c.schedule_timezone ? { currentDate: new Date(), tz: c.schedule_timezone } : {};
      const expr = CronExpressionParser.parse(c.schedule_cron, cronOpts);
      next_run_at = expr.next().toISOString();
      const prevExpr = CronExpressionParser.parse(c.schedule_cron, cronOpts);
      last_expected_at = prevExpr.prev().toISOString();

      const lastRunTime = lastRun?.completed_at || lastRun?.created_at;
      if (last_expected_at && lastRunTime) {
        is_overdue = new Date(last_expected_at) > new Date(lastRunTime + 'Z');
      } else if (last_expected_at && !lastRunTime) {
        is_overdue = true;
      }
    } catch {}

    return {
      campaign_id: c.id,
      campaign_name: c.name,
      schedule_cron: c.schedule_cron,
      last_run_status: lastRun?.status || null,
      last_run_at: lastRun?.completed_at || lastRun?.created_at || null,
      next_run_at,
      last_expected_at,
      is_overdue,
      missed_count: missedCount,
    };
  });

  res.json(upcoming);
});

// ── GET /:id — Detailed run view with inline leads ───────────
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const run = db.prepare(
    `SELECT pr.*,
       u.display_name as triggered_by_name,
       c.name as campaign_name
     FROM pipeline_runs pr
     LEFT JOIN users u ON u.id = pr.triggered_by
     LEFT JOIN campaigns c ON c.id = pr.campaign_id
     WHERE pr.id = ?`
  ).get(req.params.id) as any;
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const resumedByRun = db.prepare(
    `SELECT id, status, created_at FROM pipeline_runs WHERE resumed_from_run_id = ? LIMIT 1`
  ).get(req.params.id) as any;
  if (resumedByRun) {
    run.resumed_by_run_id = resumedByRun.id;
    run.resumed_by_status = resumedByRun.status;
  }

  let leads: any[];
  if (run.target_lead_ids) {
    try {
      const ids: string[] = JSON.parse(run.target_lead_ids);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        leads = db.prepare(
          `SELECT id, company_name, domain, segment, fit_score, fit_score_label,
                  confidence, employee_count, hq_location, lead_status, current_feedback,
                  potential_score, urgency_score, evidence_modifier, scoring_version, why_now,
                  linkedin_company_url, enrichment_metadata,
                  created_at
           FROM leads WHERE id IN (${placeholders}) ORDER BY fit_score DESC`
        ).all(...ids);
      } else {
        leads = [];
      }
    } catch {
      leads = [];
    }
  } else {
    leads = db.prepare(
      `SELECT id, company_name, domain, segment, fit_score, fit_score_label,
              confidence, employee_count, hq_location, lead_status, current_feedback,
              potential_score, urgency_score, evidence_modifier, scoring_version, why_now,
              linkedin_company_url, enrichment_metadata,
              created_at
       FROM leads WHERE run_id = ? ORDER BY fit_score DESC`
    ).all(req.params.id);
  }

  const linkedin_summary = { total: leads.length, high: 0, medium: 0, low: 0, none: 0, user_corrected: 0 };
  for (const lead of leads as any[]) {
    if (lead.enrichment_metadata) {
      try {
        const meta = JSON.parse(lead.enrichment_metadata);
        const match = meta.linkedin_match;
        if (match) {
          if (match.user_corrected) linkedin_summary.user_corrected++;
          if (match.confidence === 'high') linkedin_summary.high++;
          else if (match.confidence === 'medium') linkedin_summary.medium++;
          else if (match.confidence === 'low') linkedin_summary.low++;
          else linkedin_summary.none++;
        } else {
          linkedin_summary.none++;
        }
      } catch {
        linkedin_summary.none++;
      }
    } else {
      linkedin_summary.none++;
    }
  }

  res.json({ run, leads, linkedin_summary });
});

// ── GET /:id/activity — Activity log entries for a run ──────
router.get('/:id/activity', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const run = db.prepare('SELECT id FROM pipeline_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const activities = db.prepare(
    `SELECT id, run_id, campaign_id, activity_type, phase, company_name, title, details, error_message, created_at
     FROM run_activity_log
     WHERE run_id = ?
     ORDER BY created_at ASC`
  ).all(req.params.id);

  // Parse details JSON
  const parsed = activities.map((a: any) => ({
    ...a,
    details: a.details ? JSON.parse(a.details) : null,
  }));

  res.json({ run_id: req.params.id, activities: parsed });
});

// ── POST /:id/cancel — Cancel a running pipeline ──────────────
router.post('/:id/cancel', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const run = db.prepare(
    "SELECT id, status FROM pipeline_runs WHERE id = ?"
  ).get(req.params.id) as any;

  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status !== 'running' && run.status !== 'pending') {
    return res.status(400).json({ error: 'Run is not active' });
  }

  const cancelled = cancelRun(req.params.id);
  if (!cancelled) {
    // Run exists in DB but not in memory registry — force-mark as cancelled
    db.prepare(
      "UPDATE pipeline_runs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);
    return res.json({ success: true, message: 'Run marked as cancelled (was not in active registry)' });
  }

  res.json({ success: true, message: 'Cancellation requested' });
});

// ── POST /trigger — Deprecated: use POST /campaigns/:id/run ──
router.post('/trigger', authenticate, requireMember, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const activeRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE status IN ('pending','running') LIMIT 1"
  ).get();
  if (activeRun) return res.status(409).json({ error: 'A pipeline run is already in progress' });

  runPipeline(req.user!.id).catch(err => {
    console.error('Pipeline run failed:', err);
  });

  res.json({ message: 'Pipeline run triggered', status: 'pending' });
});

// ── GET /:id/resume-analysis — Analyze what a resume would do ────────
router.get('/:id/resume-analysis', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const run = db.prepare('SELECT id, status, campaign_id FROM pipeline_runs WHERE id = ?').get(req.params.id) as any;
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (!['failed', 'cancelled'].includes(run.status)) {
    return res.status(400).json({ error: 'Only failed or cancelled runs can be resumed' });
  }
  if (!run.campaign_id) {
    return res.status(400).json({ error: 'Run has no associated campaign' });
  }
  try {
    const analysis = analyzeRunForResume(req.params.id);
    res.json(analysis);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/resume — Resume a failed/cancelled run ────────────────
router.post('/:id/resume', authenticate, requireMember, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(req.params.id) as any;
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (!['failed', 'cancelled'].includes(run.status)) {
    return res.status(400).json({ error: 'Only failed or cancelled runs can be resumed' });
  }
  if (!run.campaign_id) {
    return res.status(400).json({ error: 'Run has no associated campaign' });
  }

  const activeRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status IN ('pending','running') LIMIT 1"
  ).get(run.campaign_id);
  if (activeRun) return res.status(409).json({ error: 'A campaign run is already in progress' });

  const analysis = analyzeRunForResume(req.params.id);
  if (!analysis.resumable) {
    return res.status(400).json({ error: analysis.reason || 'Run cannot be resumed' });
  }

  // Belt-and-suspenders: intersect with original run's steps_run
  let stepsToRun = analysis.resume_plan.steps_to_run;
  if (run.steps_run) {
    try {
      const originalSteps: string[] = JSON.parse(run.steps_run);
      stepsToRun = stepsToRun.filter((s: string) => originalSteps.includes(s));
    } catch {}
  }

  const runPromise = runCampaign(
    run.campaign_id,
    req.user!.id,
    stepsToRun,
    analysis.resume_plan.lead_ids,
    'resume',
    { skipScoreThreshold: true, skipCandidateLimits: true },
    run.id,
  );
  runPromise.catch(err => {
    console.error('Resume run failed:', err);
  });

  await new Promise(resolve => setTimeout(resolve, 50));
  const newRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(run.campaign_id) as any;

  // Copy batch_context from parent so CSV export works on the resume run
  if (newRun && run.batch_context) {
    db.prepare('UPDATE pipeline_runs SET batch_context = ? WHERE id = ?').run(run.batch_context, newRun.id);
  }

  res.json({
    message: 'Resume triggered',
    status: 'running',
    run_id: newRun?.id || null,
    original_run_id: run.id,
    resume_plan: analysis.resume_plan,
  });
});

// ── DELETE /:id — Delete a run + associated data (superadmin only) ──
router.delete('/:id', authenticate, requireSuperAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const run = db.prepare('SELECT id, campaign_id, lead_count, resumed_from_run_id FROM pipeline_runs WHERE id = ?').get(req.params.id) as any;
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const force = req.query.force === 'true';
  if (!force) {
    const resumedBy = db.prepare('SELECT id FROM pipeline_runs WHERE resumed_from_run_id = ?').get(run.id) as any;
    if (resumedBy) {
      return res.status(409).json({
        error: 'This run has been resumed by another run. Deleting it may affect data integrity.',
        resumed_by_run_id: resumedBy.id,
        hint: 'Add ?force=true to delete anyway',
      });
    }
    if (run.resumed_from_run_id) {
      return res.status(409).json({
        error: 'This is a resume run linked to a parent. Deleting it may affect the resume chain.',
        resumed_from_run_id: run.resumed_from_run_id,
        hint: 'Add ?force=true to delete anyway',
      });
    }
  }

  const deleteTx = db.transaction(() => {
    const leads = db.prepare('SELECT id FROM leads WHERE run_id = ?').all(req.params.id) as any[];
    for (const lead of leads) {
      db.prepare('DELETE FROM personas WHERE lead_id = ?').run(lead.id);
      db.prepare('DELETE FROM lead_feedback WHERE lead_id = ?').run(lead.id);
    }
    db.prepare('DELETE FROM leads WHERE run_id = ?').run(req.params.id);
    db.prepare('DELETE FROM run_activity_log WHERE run_id = ?').run(req.params.id);
    db.prepare('DELETE FROM pipeline_runs WHERE id = ?').run(req.params.id);
  });
  deleteTx();

  res.json({ success: true, deleted_leads: run.lead_count || 0 });
});

// ── DELETE / — Bulk delete runs (superadmin only) ──
router.delete('/', authenticate, requireSuperAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const ids = req.body?.ids as string[] | undefined;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }

  const placeholders = ids.map(() => '?').join(',');
  let totalLeads = 0;

  const deleteTx = db.transaction(() => {
    for (const id of ids) {
      const leads = db.prepare('SELECT id FROM leads WHERE run_id = ?').all(id) as any[];
      for (const lead of leads) {
        db.prepare('DELETE FROM personas WHERE lead_id = ?').run(lead.id);
        db.prepare('DELETE FROM lead_feedback WHERE lead_id = ?').run(lead.id);
      }
      const result = db.prepare('DELETE FROM leads WHERE run_id = ?').run(id);
      totalLeads += result.changes;
    }
    db.prepare(`DELETE FROM run_activity_log WHERE run_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM pipeline_runs WHERE id IN (${placeholders})`).run(...ids);
  });
  deleteTx();

  res.json({ success: true, deleted_runs: ids.length, deleted_leads: totalLeads });
});

// ── GET /:id/chain-export — Export leads from a full resume chain ──
router.get('/:id/chain-export', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();

  // Walk the chain to find the root run
  let rootId = req.params.id;
  for (let i = 0; i < 20; i++) {
    const run = db.prepare('SELECT resumed_from_run_id FROM pipeline_runs WHERE id = ?').get(rootId) as any;
    if (!run || !run.resumed_from_run_id) break;
    rootId = run.resumed_from_run_id;
  }

  // Collect all run IDs in the chain (root + all descendants)
  const chainIds: string[] = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = db.prepare('SELECT id FROM pipeline_runs WHERE resumed_from_run_id = ?').all(current) as any[];
    for (const child of children) {
      chainIds.push(child.id);
      queue.push(child.id);
    }
  }

  // Fetch all leads from all runs in the chain, deduplicate by domain (prefer latest updated_at)
  const placeholders = chainIds.map(() => '?').join(',');
  const leads = db.prepare(
    `SELECT l.*,
      (SELECT json_group_array(json_object('id',p.id,'role_type',p.role_type,'name',p.name,'title',p.title,'linkedin_url',p.linkedin_url,'department',p.department,'outreach_angle',p.outreach_angle,'talking_points',p.talking_points,'outreach_message',p.outreach_message))
       FROM personas p WHERE p.lead_id = l.id) as personas_json
     FROM leads l WHERE l.run_id IN (${placeholders}) ORDER BY l.domain, l.updated_at DESC`
  ).all(...chainIds) as any[];

  // Deduplicate by domain
  const seen = new Set<string>();
  const deduped = leads.filter(l => {
    const key = (l.domain || l.company_name).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Generate CSV
  const fields = ['company_name', 'domain', 'segment', 'fit_score', 'fit_score_label', 'confidence',
    'hq_location', 'employee_count', 'pipeline_stage', 'outreach_strategy', 'brief_markdown'];
  const header = fields.join(',');
  const rows = deduped.map(l => fields.map(f => {
    const val = l[f];
    if (val == null) return '';
    const str = String(val);
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(','));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="signalstack-chain-export.csv"`);
  res.send([header, ...rows].join('\n'));
});

export default router;
