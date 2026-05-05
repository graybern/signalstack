import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, AuthRequest, requireOperator, requireAdmin } from '../auth/middleware.js';
import { logActivity } from '../services/activityLog.js';
import type { Lead, Persona, LeadFeedback } from '../types/index.js';

const router = Router();

const VALID_VERDICTS = ['bad_fit', 'good_fit_response', 'good_fit_booked', 'good_fit_try_again', 'good_fit_no_response'];
// Keep legacy verdicts for backward compat reads
const ALL_VERDICTS = [...VALID_VERDICTS, 'good_fit', 'not_fit'];

router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const {
    run_id, segment, campaign_id, source_type, lead_status, feedback,
    needs_reoutreach, min_score, max_score, min_signals, date_from, date_to,
    page = '1', limit = '50', sort = 'fit_score', order = 'desc',
  } = req.query;
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (run_id) { conditions.push('l.run_id = ?'); params.push(run_id); }
  if (segment) { conditions.push('l.segment = ?'); params.push(segment); }
  if (campaign_id) { conditions.push('l.campaign_id = ?'); params.push(campaign_id); }
  if (source_type) { conditions.push('l.source_type = ?'); params.push(source_type); }
  if (lead_status) { conditions.push('l.lead_status = ?'); params.push(lead_status); }
  if (feedback) { conditions.push('l.current_feedback = ?'); params.push(feedback); }
  if (needs_reoutreach === 'true') {
    conditions.push("l.current_feedback = 'good_fit_try_again' AND l.next_outreach_date <= date('now')");
  }
  if (min_score) { conditions.push('l.fit_score >= ?'); params.push(parseInt(min_score as string)); }
  if (max_score) { conditions.push('l.fit_score <= ?'); params.push(parseInt(max_score as string)); }
  if (min_signals) { conditions.push('l.signal_count >= ?'); params.push(parseInt(min_signals as string)); }
  if (date_from) { conditions.push('l.created_at >= ?'); params.push(date_from); }
  if (date_to) { conditions.push('l.created_at <= ?'); params.push(date_to + ' 23:59:59'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const allowedSorts = ['fit_score', 'company_name', 'segment', 'created_at', 'lead_status', 'convergence_score', 'current_feedback', 'next_outreach_date'];
  const sortCol = allowedSorts.includes(sort as string) ? sort : 'fit_score';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM leads l ${where}`).get(...params) as any).c;
  const leads = db.prepare(
    `SELECT l.*,
      c.name as campaign_name,
      (SELECT json_group_array(json_object('id',p.id,'role_type',p.role_type,'name',p.name,'title',p.title,'linkedin_url',p.linkedin_url))
       FROM personas p WHERE p.lead_id = l.id) as personas_json,
      (SELECT json_group_array(json_object('id',f.id,'verdict',f.verdict,'reason',f.reason,'user_id',f.user_id,'retry_date',f.retry_date,'feedback_source',f.feedback_source,'created_at',f.created_at))
       FROM lead_feedback f WHERE f.lead_id = l.id ORDER BY f.created_at DESC) as feedback_json
     FROM leads l
     LEFT JOIN campaigns c ON c.id = l.campaign_id
     ${where}
     ORDER BY l.${sortCol} ${sortOrder}
     LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit as string), offset);

  res.json({
    leads: leads.map(parseLead),
    total,
    page: parseInt(page as string),
    limit: parseInt(limit as string),
  });
});

// Aggregate stats for leads page header
router.get('/stats', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as c FROM leads').get() as any).c;
  const avgScore = (db.prepare('SELECT AVG(fit_score) as avg FROM leads').get() as any).avg;
  const needsReoutreach = (db.prepare(
    "SELECT COUNT(*) as c FROM leads WHERE current_feedback = 'good_fit_try_again' AND next_outreach_date <= date('now')"
  ).get() as any).c;
  const withFeedback = (db.prepare(
    "SELECT COUNT(*) as c FROM leads WHERE current_feedback IS NOT NULL"
  ).get() as any).c;
  const feedbackRate = total > 0 ? Math.round((withFeedback / total) * 100) : 0;

  // Breakdown by feedback type
  const feedbackBreakdown = db.prepare(
    `SELECT current_feedback as verdict, COUNT(*) as count FROM leads WHERE current_feedback IS NOT NULL GROUP BY current_feedback`
  ).all();

  res.json({
    total,
    avg_score: avgScore ? Math.round(avgScore) : null,
    needs_reoutreach: needsReoutreach,
    feedback_rate: feedbackRate,
    with_feedback: withFeedback,
    feedback_breakdown: feedbackBreakdown,
  });
});

// Export briefs as markdown files (JSON payload for frontend zip)
router.get('/export/briefs', authenticate, (req: AuthRequest, res: Response) => {
  const { campaign_id, segment, run_id, feedback, min_score, max_score } = req.query;
  const db = getDb();
  const conditions: string[] = ["l.brief_markdown IS NOT NULL AND l.brief_markdown != ''"];
  const params: any[] = [];

  if (campaign_id) { conditions.push('l.campaign_id = ?'); params.push(campaign_id); }
  if (segment) { conditions.push('l.segment = ?'); params.push(segment); }
  if (run_id) { conditions.push('l.run_id = ?'); params.push(run_id); }
  if (feedback) { conditions.push('l.current_feedback = ?'); params.push(feedback); }
  if (min_score) { conditions.push('l.fit_score >= ?'); params.push(parseInt(min_score as string)); }
  if (max_score) { conditions.push('l.fit_score <= ?'); params.push(parseInt(max_score as string)); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const leads = db.prepare(
    `SELECT l.company_name, l.domain, l.segment, l.fit_score, l.brief_markdown
     FROM leads l
     ${where}
     ORDER BY l.fit_score DESC`
  ).all(...params) as any[];

  const briefs = leads.map(l => {
    const slug = l.company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return {
      filename: `${slug}-brief`,
      company_name: l.company_name,
      segment: l.segment,
      fit_score: l.fit_score,
      markdown: l.brief_markdown,
    };
  });

  res.json({ briefs, total: briefs.length });
});

// Export leads as JSON/CSV
router.get('/export', authenticate, (req: AuthRequest, res: Response) => {
  const { format = 'csv', campaign_id, segment, feedback, min_score, max_score, fields: fieldsParam } = req.query;
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (campaign_id) { conditions.push('l.campaign_id = ?'); params.push(campaign_id); }
  if (segment) { conditions.push('l.segment = ?'); params.push(segment); }
  if (feedback) { conditions.push('l.current_feedback = ?'); params.push(feedback); }
  if (min_score) { conditions.push('l.fit_score >= ?'); params.push(parseInt(min_score as string)); }
  if (max_score) { conditions.push('l.fit_score <= ?'); params.push(parseInt(max_score as string)); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const leads = db.prepare(
    `SELECT l.company_name, l.domain, l.segment, l.fit_score, l.fit_score_label, l.confidence,
       l.hq_location, l.employee_count, l.founded_year, l.funding_stage, l.total_funding,
       l.current_feedback, l.next_outreach_date, l.signal_count, l.created_at,
       c.name as campaign_name
     FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id
     ${where}
     ORDER BY l.fit_score DESC`
  ).all(...params) as any[];

  // All available fields
  const allFields = ['company_name', 'domain', 'segment', 'fit_score', 'fit_score_label', 'confidence',
    'hq_location', 'employee_count', 'founded_year', 'funding_stage', 'total_funding',
    'current_feedback', 'next_outreach_date', 'signal_count', 'campaign_name', 'created_at'];

  // If fields param provided, filter to only requested fields (validated against available)
  let fields = allFields;
  if (fieldsParam && typeof fieldsParam === 'string') {
    const requested = fieldsParam.split(',').map(f => f.trim()).filter(f => allFields.includes(f));
    if (requested.length > 0) fields = requested;
  }

  if (format === 'json') {
    const filtered = leads.map(l => {
      const obj: Record<string, any> = {};
      for (const f of fields) obj[f] = (l as any)[f] ?? null;
      return obj;
    });
    res.json(filtered);
    return;
  }

  // CSV export
  const header = fields.join(',');
  const rows = leads.map(l => fields.map(f => {
    const val = (l as any)[f];
    if (val == null) return '';
    const str = String(val);
    return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(','));

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header, ...rows].join('\n'));
});

router.get('/latest', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { campaign_id } = req.query;

  const latestRun = campaign_id
    ? db.prepare(
        `SELECT id FROM pipeline_runs WHERE status = 'completed' AND campaign_id = ? ORDER BY completed_at DESC LIMIT 1`
      ).get(campaign_id) as { id: string } | undefined
    : db.prepare(
        `SELECT id FROM pipeline_runs WHERE status = 'completed' AND campaign_id IS NULL ORDER BY completed_at DESC LIMIT 1`
      ).get() as { id: string } | undefined;

  if (!latestRun) return res.json({ run: null, leads: { ENT: [], MM: [], SMB: [] } });

  const leads = db.prepare(
    `SELECT l.*,
      (SELECT json_group_array(json_object('id',p.id,'role_type',p.role_type,'name',p.name,'title',p.title,'linkedin_url',p.linkedin_url,'department',p.department,'tenure',p.tenure,'outreach_angle',p.outreach_angle,'talking_points',p.talking_points,'outreach_message',p.outreach_message,'social_signals',p.social_signals,'buying_signals',p.buying_signals))
       FROM personas p WHERE p.lead_id = l.id) as personas_json,
      (SELECT json_group_array(json_object('id',f.id,'verdict',f.verdict,'reason',f.reason,'user_id',f.user_id,'retry_date',f.retry_date,'created_at',f.created_at))
       FROM lead_feedback f WHERE f.lead_id = l.id ORDER BY f.created_at DESC) as feedback_json
     FROM leads l WHERE l.run_id = ? ORDER BY l.fit_score DESC`
  ).all(latestRun.id);

  const grouped = { ENT: [] as any[], MM: [] as any[], SMB: [] as any[] };
  for (const lead of leads) {
    const parsed = parseLead(lead);
    if (parsed.segment in grouped) grouped[parsed.segment as keyof typeof grouped].push(parsed);
  }

  const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(latestRun.id);
  res.json({ run, leads: grouped });
});

router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const lead = db.prepare(
    `SELECT l.*,
      (SELECT json_group_array(json_object('id',p.id,'role_type',p.role_type,'name',p.name,'title',p.title,'linkedin_url',p.linkedin_url,'department',p.department,'tenure',p.tenure,'outreach_angle',p.outreach_angle,'talking_points',p.talking_points,'outreach_message',p.outreach_message,'social_signals',p.social_signals,'buying_signals',p.buying_signals))
       FROM personas p WHERE p.lead_id = l.id) as personas_json,
      (SELECT json_group_array(json_object('id',f.id,'verdict',f.verdict,'reason',f.reason,'user_id',f.user_id,'retry_date',f.retry_date,'feedback_source',f.feedback_source,'created_at',f.created_at))
       FROM lead_feedback f WHERE f.lead_id = l.id ORDER BY f.created_at DESC) as feedback_json
     FROM leads l WHERE l.id = ?`
  ).get(req.params.id);

  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json(parseLead(lead));
});

router.post('/:id/rerun-brief', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { rerunBriefForLead } = await import('../agent/campaignOrchestrator.js');
    res.json({ status: 'started', lead_id: req.params.id });
    rerunBriefForLead(req.params.id).catch(err => {
      console.error(`[rerun-brief] Failed for lead ${req.params.id}:`, err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to start brief rerun' });
  }
});

router.post('/:id/feedback', authenticate, (req: AuthRequest, res: Response) => {
  const { verdict, reason, retry_date } = req.body;

  // Map legacy verdicts to new ones
  let mappedVerdict = verdict;
  if (verdict === 'not_fit') mappedVerdict = 'bad_fit';
  if (verdict === 'good_fit') mappedVerdict = 'good_fit_response';

  if (!ALL_VERDICTS.includes(verdict) && !VALID_VERDICTS.includes(verdict)) {
    return res.status(400).json({ error: `verdict must be one of: ${VALID_VERDICTS.join(', ')}` });
  }

  const db = getDb();
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const id = uuid();
  db.prepare(
    `INSERT INTO lead_feedback (id, lead_id, user_id, verdict, reason, retry_date, feedback_source) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(lead_id, user_id) DO UPDATE SET verdict=excluded.verdict, reason=excluded.reason, retry_date=excluded.retry_date, created_at=datetime('now')`
  ).run(id, req.params.id, req.user!.id, mappedVerdict, reason || null, retry_date || null, 'manual');

  // Update denormalized columns on the lead
  db.prepare(
    `UPDATE leads SET current_feedback = ?, next_outreach_date = ? WHERE id = ?`
  ).run(mappedVerdict, mappedVerdict === 'good_fit_try_again' ? (retry_date || null) : null, req.params.id);

  res.json({ success: true });
});

// Delete all leads from a specific run
router.delete('/by-run/:runId', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const run = db.prepare('SELECT id, campaign_id FROM pipeline_runs WHERE id = ?').get(req.params.runId) as any;
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const leads = db.prepare('SELECT id, company_name FROM leads WHERE run_id = ?').all(req.params.runId) as any[];
  const deleteTx = db.transaction(() => {
    for (const lead of leads) {
      db.prepare('DELETE FROM lead_feedback WHERE lead_id = ?').run(lead.id);
    }
    db.prepare('DELETE FROM leads WHERE run_id = ?').run(req.params.runId);
  });
  deleteTx();

  logActivity({
    userId: req.user!.id,
    entityType: 'lead',
    entityId: req.params.runId,
    entityTitle: `Cleared ${leads.length} leads from run`,
    action: 'deleted',
    snapshot: { lead_count: leads.length, companies: leads.map(l => l.company_name) },
  });

  res.json({ success: true, deleted: leads.length });
});

// Bulk delete leads (admin only) — supports ids array, campaign_id query, or all
router.delete('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { campaign_id } = req.query;
  const ids = req.body?.ids as string[] | undefined;

  let count: number;
  const deleteTx = db.transaction(() => {
    if (ids && Array.isArray(ids) && ids.length > 0) {
      for (const id of ids) {
        db.prepare('DELETE FROM personas WHERE lead_id = ?').run(id);
        db.prepare('DELETE FROM lead_feedback WHERE lead_id = ?').run(id);
        db.prepare('DELETE FROM leads WHERE id = ?').run(id);
      }
      count = ids.length;
    } else if (campaign_id) {
      const leads = db.prepare('SELECT id FROM leads WHERE campaign_id = ?').all(campaign_id as string) as any[];
      for (const lead of leads) {
        db.prepare('DELETE FROM personas WHERE lead_id = ?').run(lead.id);
        db.prepare('DELETE FROM lead_feedback WHERE lead_id = ?').run(lead.id);
      }
      const result = db.prepare('DELETE FROM leads WHERE campaign_id = ?').run(campaign_id as string);
      count = result.changes;
    } else {
      db.prepare('DELETE FROM personas').run();
      db.prepare('DELETE FROM lead_feedback').run();
      const result = db.prepare('DELETE FROM leads').run();
      count = result.changes;
    }
  });
  deleteTx();

  logActivity({
    userId: req.user!.id,
    entityType: 'lead',
    entityId: ids ? 'bulk' : campaign_id as string || 'all',
    entityTitle: `Bulk deleted ${count!} leads${ids ? ' (selected)' : campaign_id ? ' from campaign' : ''}`,
    action: 'deleted',
    snapshot: { count: count!, campaign_id: campaign_id || null, ids: ids || null },
  });

  res.json({ success: true, deleted: count! });
});

// Delete a single lead (must be after /by-run to avoid route conflict)
router.delete('/:id', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const lead = db.prepare('SELECT id, company_name, campaign_id FROM leads WHERE id = ?').get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const deleteTx = db.transaction(() => {
    db.prepare('DELETE FROM lead_feedback WHERE lead_id = ?').run(req.params.id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  });
  deleteTx();

  logActivity({
    userId: req.user!.id,
    entityType: 'lead',
    entityId: req.params.id,
    entityTitle: lead.company_name,
    action: 'deleted',
    snapshot: lead,
  });

  res.json({ success: true, deleted: 1 });
});

function parseLead(row: any) {
  const lead = { ...row };
  try { lead.personas = JSON.parse(row.personas_json || '[]').filter((p: any) => p.id !== null); } catch { lead.personas = []; }
  try { lead.feedback = JSON.parse(row.feedback_json || '[]').filter((f: any) => f.id !== null); } catch { lead.feedback = []; }
  try { lead.score_breakdown_parsed = JSON.parse(row.score_breakdown); } catch { lead.score_breakdown_parsed = null; }
  try { lead.pain_hypotheses_parsed = JSON.parse(row.pain_hypotheses); } catch { lead.pain_hypotheses_parsed = null; }
  try { lead.tech_stack_parsed = JSON.parse(row.tech_stack); } catch { lead.tech_stack_parsed = null; }
  try { lead.competitive_displacement_parsed = JSON.parse(row.competitive_displacement); } catch { lead.competitive_displacement_parsed = null; }
  try { lead.sources_parsed = JSON.parse(row.source_citations); } catch { lead.sources_parsed = null; }
  try { lead.why_now_parsed = JSON.parse(row.why_now); } catch { lead.why_now_parsed = null; }
  try { lead.investors_parsed = JSON.parse(row.investors); } catch { lead.investors_parsed = null; }
  try { lead.outreach_strategy_parsed = JSON.parse(row.outreach_strategy); } catch { lead.outreach_strategy_parsed = null; }
  try { lead.candidate_data_parsed = JSON.parse(row.candidate_data); } catch { lead.candidate_data_parsed = null; }
  try { lead.audit_issues_parsed = JSON.parse(row.audit_issues); } catch { lead.audit_issues_parsed = null; }
  try { lead.ai_audit = JSON.parse(row.ai_audit_result); } catch { lead.ai_audit = null; }

  let signalCount = 0;
  if (lead.sources_parsed && Array.isArray(lead.sources_parsed)) signalCount += lead.sources_parsed.length;
  lead.signal_count = signalCount;

  lead.personas = lead.personas.map((p: any) => {
    try { p.talking_points_parsed = JSON.parse(p.talking_points); } catch { p.talking_points_parsed = null; }
    try { p.social_signals_parsed = JSON.parse(p.social_signals); } catch { p.social_signals_parsed = null; }
    try { p.buying_signals_parsed = JSON.parse(p.buying_signals); } catch { p.buying_signals_parsed = null; }
    return p;
  });
  delete lead.personas_json;
  delete lead.feedback_json;
  return lead;
}

export default router;
