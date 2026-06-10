import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, AuthRequest, requireOperator, requireAdmin, requireMember, requireSuperAdmin } from '../auth/middleware.js';
import { logActivity } from '../services/activityLog.js';
import { analyzeCampaignFeedback, getCampaignFeedbackCount } from '../agent/feedbackAnalyzer.js';
import { computeAllDimensions, computeCompositeV2, generateVerdict, dimensionsToLegacyBreakdown } from '../agent/scorer.js';
import { loadCampaignConfig } from '../agent/campaignOrchestrator.js';
import type { Lead, Persona, LeadFeedback, FeedbackVerdict, FactSheet, EnrichmentMetadata } from '../types/index.js';

const router = Router();

// Throttle view logging to avoid spamming activity_log
const recentViews = new Map<string, number>();
const VIEW_COOLDOWN_MS = 5 * 60 * 1000;

function shouldLogView(userId: string, entityType: string, entityId: string): boolean {
  const key = `${userId}:${entityType}:${entityId}`;
  const now = Date.now();
  const last = recentViews.get(key);
  if (last && now - last < VIEW_COOLDOWN_MS) return false;
  recentViews.set(key, now);
  if (recentViews.size > 10000) {
    for (const [k, v] of recentViews) {
      if (now - v > VIEW_COOLDOWN_MS) recentViews.delete(k);
    }
  }
  return true;
}

const VALID_VERDICTS: FeedbackVerdict[] = [
  'bad_fit', 'good_fit_response', 'good_fit_booked', 'good_fit_try_again', 'good_fit_no_response',
  'closed_won', 'closed_lost', 'existing_customer', 'stalled', 'nurture',
];
const ALL_VERDICTS: string[] = [...VALID_VERDICTS, 'good_fit', 'not_fit'];

const VERDICT_TO_LEAD_STATUS: Record<string, string> = {
  good_fit_booked: 'meeting_booked',
  closed_won: 'closed_won',
  closed_lost: 'closed_lost',
  existing_customer: 'customer',
  stalled: 'stalled',
  nurture: 'nurture',
  bad_fit: 'disqualified',
  good_fit_response: 'contacted',
  good_fit_no_response: 'contacted',
};

function buildLeadFilterConditions(query: Record<string, any>): { conditions: string[]; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (query.run_id) { conditions.push('l.run_id = ?'); params.push(query.run_id); }
  if (query.segment) { conditions.push('l.segment = ?'); params.push(query.segment); }
  if (query.campaign_id) { conditions.push('l.campaign_id = ?'); params.push(query.campaign_id); }
  if (query.source_type) { conditions.push('l.source_type = ?'); params.push(query.source_type); }
  if (query.lead_status) { conditions.push('l.lead_status = ?'); params.push(query.lead_status); }
  if (query.feedback) { conditions.push('l.current_feedback = ?'); params.push(query.feedback); }
  if (query.needs_reoutreach === 'true') {
    conditions.push("l.current_feedback = 'good_fit_try_again' AND l.next_outreach_date <= date('now')");
  }
  if (query.min_score) { conditions.push('l.fit_score >= ?'); params.push(parseInt(query.min_score as string)); }
  if (query.max_score) { conditions.push('l.fit_score <= ?'); params.push(parseInt(query.max_score as string)); }
  if (query.min_signals) { conditions.push('l.signal_count >= ?'); params.push(parseInt(query.min_signals as string)); }
  if (query.date_from) { conditions.push('l.created_at >= ?'); params.push(query.date_from); }
  if (query.date_to) { conditions.push('l.created_at <= ?'); params.push(query.date_to + ' 23:59:59'); }
  if (query.search) {
    const term = `%${query.search}%`;
    conditions.push('(l.company_name LIKE ? OR l.domain LIKE ?)');
    params.push(term, term);
  }

  const dimRanges: Array<[string, string]> = [
    ['min_potential', 'l.potential_score'], ['max_potential', 'l.potential_score'],
    ['min_urgency', 'l.urgency_score'], ['max_urgency', 'l.urgency_score'],
    ['min_icp_fit', 'l.icp_fit_score'], ['max_icp_fit', 'l.icp_fit_score'],
    ['min_reachability', 'l.reachability_score'], ['max_reachability', 'l.reachability_score'],
    ['min_signal_quality', 'l.signal_quality_score'], ['max_signal_quality', 'l.signal_quality_score'],
  ];
  for (const [param, col] of dimRanges) {
    if (query[param] != null && query[param] !== '') {
      const op = param.startsWith('min_') ? '>=' : '<=';
      conditions.push(`${col} IS NOT NULL AND ${col} ${op} ?`);
      params.push(parseInt(query[param] as string));
    }
  }

  if (query.data_confidence) {
    const validGrades = ['A', 'B', 'C', 'D', 'F'];
    const grades = (query.data_confidence as string).split(',')
      .map(g => g.trim().toUpperCase())
      .filter(g => validGrades.includes(g));
    if (grades.length > 0) {
      conditions.push(`l.data_confidence IN (${grades.map(() => '?').join(',')})`);
      params.push(...grades);
    }
  }

  if (query.watch_candidate === 'true') {
    conditions.push('l.potential_score >= 60 AND l.urgency_score < 35');
  }

  if (query.composite_version != null && query.composite_version !== '') {
    conditions.push('l.composite_version = ?');
    params.push(parseInt(query.composite_version as string));
  }

  return { conditions, params };
}

router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '50', sort = 'fit_score', order = 'desc' } = req.query;
  const db = getDb();
  const { conditions, params } = buildLeadFilterConditions(req.query);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const allowedSorts = [
    'fit_score', 'icp_fit_score', 'timing_score', 'company_name', 'segment', 'created_at',
    'lead_status', 'convergence_score', 'current_feedback', 'next_outreach_date',
    'potential_score', 'urgency_score', 'reachability_score', 'signal_quality_score',
    'data_confidence_score', 'evidence_modifier',
  ];
  const sortCol = allowedSorts.includes(sort as string) ? sort : 'fit_score';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM leads l ${where}`).get(...params) as any).c;
  const leads = db.prepare(
    `SELECT l.*,
      c.name as campaign_name,
      (SELECT json_group_array(json_object('id',p.id,'role_type',p.role_type,'confidence',p.confidence,'name',p.name,'title',p.title,'linkedin_url',p.linkedin_url))
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
       l.icp_fit_score, l.timing_score, l.data_confidence, l.reachability_score,
       l.scoring_version,
       c.name as campaign_name
     FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id
     ${where}
     ORDER BY l.fit_score DESC`
  ).all(...params) as any[];

  const allFields = ['company_name', 'domain', 'segment', 'fit_score', 'fit_score_label', 'confidence',
    'hq_location', 'employee_count', 'founded_year', 'funding_stage', 'total_funding',
    'current_feedback', 'next_outreach_date', 'signal_count', 'campaign_name', 'created_at',
    'icp_fit_score', 'timing_score', 'data_confidence', 'reachability_score', 'scoring_version'];

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
      (SELECT json_group_array(json_object('id',p.id,'role_type',p.role_type,'confidence',p.confidence,'name',p.name,'title',p.title,'linkedin_url',p.linkedin_url,'department',p.department,'tenure',p.tenure,'outreach_angle',p.outreach_angle,'talking_points',p.talking_points,'outreach_message',p.outreach_message,'social_signals',p.social_signals,'buying_signals',p.buying_signals))
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

router.get('/count', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { conditions, params } = buildLeadFilterConditions(req.query);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const count = (db.prepare(`SELECT COUNT(*) as c FROM leads l ${where}`).get(...params) as any).c;

  const v2Conditions = [...conditions, 'l.composite_version = 2'];
  const v2Where = `WHERE ${v2Conditions.join(' AND ')}`;
  const v2Count = (db.prepare(`SELECT COUNT(*) as c FROM leads l ${v2Where}`).get(...params) as any).c;

  res.json({ count, v2_count: v2Count });
});

router.get('/saved-filters', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const filters = db.prepare(
    'SELECT * FROM saved_filters WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC'
  ).all(req.user!.id) as any[];

  res.json(filters.map(f => ({
    ...f,
    filter_config: JSON.parse(f.filter_config),
    is_default: !!f.is_default,
  })));
});

router.post('/saved-filters', authenticate, (req: AuthRequest, res: Response) => {
  const { name, filter_config, is_default } = req.body;
  if (!name || !filter_config) return res.status(400).json({ error: 'name and filter_config are required' });

  const db = getDb();
  const id = uuid();

  const insertTx = db.transaction(() => {
    if (is_default) {
      db.prepare('UPDATE saved_filters SET is_default = 0 WHERE user_id = ?').run(req.user!.id);
    }
    db.prepare(
      'INSERT INTO saved_filters (id, user_id, name, filter_config, is_default) VALUES (?, ?, ?, ?, ?)'
    ).run(id, req.user!.id, name, JSON.stringify(filter_config), is_default ? 1 : 0);
  });
  insertTx();

  res.status(201).json({ id, name, filter_config, is_default: !!is_default });
});

router.delete('/saved-filters/:filterId', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM saved_filters WHERE id = ? AND user_id = ?'
  ).run(req.params.filterId, req.user!.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Saved filter not found' });
  res.json({ success: true });
});

router.post('/bulk-action', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const { lead_ids, filter, action, params: actionParams } = req.body;
  if (!action) return res.status(400).json({ error: 'action is required' });

  const validActions = ['add_to_watchlist', 'update_feedback', 'export'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
  }

  const db = getDb();
  let targetIds: string[];

  if (lead_ids && Array.isArray(lead_ids) && lead_ids.length > 0) {
    targetIds = lead_ids;
  } else if (filter && typeof filter === 'object') {
    const { conditions, params } = buildLeadFilterConditions(filter);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT l.id FROM leads l ${where}`).all(...params) as { id: string }[];
    targetIds = rows.map(r => r.id);
  } else {
    return res.status(400).json({ error: 'Either lead_ids or filter is required' });
  }

  if (targetIds.length === 0) {
    return res.json({ success: true, action, affected: 0 });
  }

  const MAX_BULK = 100;
  if (targetIds.length > MAX_BULK) {
    return res.status(400).json({ error: `Bulk operations limited to ${MAX_BULK} leads` });
  }

  let result: any;

  switch (action) {
    case 'add_to_watchlist': {
      if (!actionParams?.snooze_until) {
        return res.status(400).json({ error: 'params.snooze_until is required for add_to_watchlist' });
      }
      const { snooze_until, category = 'timing_watch', rerun_on_wake = true, notes } = actionParams;
      let added = 0;
      const insertTx = db.transaction(() => {
        for (const leadId of targetIds) {
          const lead = db.prepare(
            'SELECT id, campaign_id, fit_score, potential_score, urgency_score, signal_quality_score, evidence_modifier FROM leads WHERE id = ?'
          ).get(leadId) as any;
          if (!lead || !lead.campaign_id) continue;
          const existing = db.prepare(
            "SELECT id FROM watch_items WHERE lead_id = ? AND status = 'active'"
          ).get(leadId);
          if (existing) continue;
          const snapshot = JSON.stringify({
            fit_score: lead.fit_score,
            potential_score: lead.potential_score,
            urgency_score: lead.urgency_score,
            signal_quality: lead.signal_quality_score,
            evidence_modifier: lead.evidence_modifier,
          });
          db.prepare(
            'INSERT INTO watch_items (id, lead_id, campaign_id, category, snooze_until, rerun_on_wake, notes, created_by, score_snapshot) VALUES (?,?,?,?,?,?,?,?,?)'
          ).run(uuid(), leadId, lead.campaign_id, category, snooze_until, rerun_on_wake ? 1 : 0, notes || null, req.user!.id, snapshot);
          added++;
        }
      });
      insertTx();
      result = { added, skipped: targetIds.length - added };
      break;
    }

    case 'update_feedback': {
      if (!actionParams?.verdict) {
        return res.status(400).json({ error: 'params.verdict is required for update_feedback' });
      }
      let mappedVerdict = actionParams.verdict;
      if (mappedVerdict === 'not_fit') mappedVerdict = 'bad_fit';
      if (mappedVerdict === 'good_fit') mappedVerdict = 'good_fit_response';
      if (!ALL_VERDICTS.includes(actionParams.verdict) && !VALID_VERDICTS.includes(actionParams.verdict)) {
        return res.status(400).json({ error: `Invalid verdict. Must be one of: ${VALID_VERDICTS.join(', ')}` });
      }
      const newStatus = VERDICT_TO_LEAD_STATUS[mappedVerdict];
      let updated = 0;
      const feedbackTx = db.transaction(() => {
        for (const leadId of targetIds) {
          db.prepare(
            `INSERT INTO lead_feedback (id, lead_id, user_id, verdict, reason, feedback_source) VALUES (?,?,?,?,?,?)
             ON CONFLICT(lead_id, user_id) DO UPDATE SET verdict=excluded.verdict, reason=excluded.reason, created_at=datetime('now')`
          ).run(uuid(), leadId, req.user!.id, mappedVerdict, actionParams.reason || null, 'bulk');
          if (newStatus) {
            db.prepare(
              `UPDATE leads SET current_feedback = ?, lead_status = ?, updated_at = datetime('now') WHERE id = ?`
            ).run(mappedVerdict, newStatus, leadId);
          } else {
            db.prepare(
              `UPDATE leads SET current_feedback = ?, updated_at = datetime('now') WHERE id = ?`
            ).run(mappedVerdict, leadId);
          }
          updated++;
        }
      });
      feedbackTx();
      result = { updated };
      break;
    }

    case 'export': {
      const placeholders = targetIds.map(() => '?').join(',');
      const leads = db.prepare(
        `SELECT l.company_name, l.domain, l.segment, l.fit_score, l.potential_score, l.urgency_score,
                l.icp_fit_score, l.timing_score, l.data_confidence, l.data_confidence_score,
                l.reachability_score, l.signal_quality_score, l.research_completeness,
                l.current_feedback, l.lead_status, l.scoring_verdict, l.created_at,
                c.name as campaign_name
         FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id
         WHERE l.id IN (${placeholders})
         ORDER BY l.fit_score DESC`
      ).all(...targetIds) as any[];

      const exportFields = [
        'company_name', 'domain', 'segment', 'fit_score', 'potential_score', 'urgency_score',
        'icp_fit_score', 'timing_score', 'data_confidence', 'data_confidence_score',
        'reachability_score', 'signal_quality_score', 'research_completeness',
        'current_feedback', 'lead_status', 'scoring_verdict', 'campaign_name', 'created_at',
      ];
      const header = exportFields.join(',');
      const rows = leads.map(l => exportFields.map(f => {
        const val = (l as any)[f];
        if (val == null) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(','));

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="leads-bulk-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send([header, ...rows].join('\n'));
    }
  }

  res.json({ success: true, action, affected: targetIds.length, ...result });
});

router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const lead = db.prepare(
    `SELECT l.*,
      c.name as campaign_name,
      c.funnel_config as campaign_funnel_config,
      (SELECT json_group_array(json_object('id',p.id,'role_type',p.role_type,'confidence',p.confidence,'name',p.name,'title',p.title,'linkedin_url',p.linkedin_url,'department',p.department,'tenure',p.tenure,'outreach_angle',p.outreach_angle,'talking_points',p.talking_points,'outreach_message',p.outreach_message,'social_signals',p.social_signals,'buying_signals',p.buying_signals))
       FROM personas p WHERE p.lead_id = l.id) as personas_json,
      (SELECT json_group_array(json_object(
         'id',f.id,'verdict',f.verdict,'reason',f.reason,'user_id',f.user_id,
         'retry_date',f.retry_date,'feedback_source',f.feedback_source,'created_at',f.created_at,
         'effective_persona',od.effective_persona,'effective_channel',od.effective_channel,
         'effective_angle',od.effective_angle,'deal_value',od.deal_value,
         'competitor_lost_to',od.competitor_lost_to,'loss_reason',od.loss_reason,
         'bad_fit_reasons',od.bad_fit_reasons,'stalled_stage',od.stalled_stage
       ))
       FROM lead_feedback f
       LEFT JOIN feedback_outcome_details od ON od.feedback_id = f.id
       WHERE f.lead_id = l.id ORDER BY f.created_at DESC) as feedback_json,
      (SELECT json_group_array(json_object(
         'id',w.id,'category',w.category,'status',w.status,
         'snooze_until',w.snooze_until,'rerun_on_wake',w.rerun_on_wake,
         'notes',w.notes,'score_snapshot',w.score_snapshot,
         'wake_delta',w.wake_delta,'woken_at',w.woken_at,'created_at',w.created_at
       ))
       FROM watch_items w WHERE w.lead_id = l.id ORDER BY w.created_at DESC) as watch_items_json
     FROM leads l
     LEFT JOIN campaigns c ON c.id = l.campaign_id
     WHERE l.id = ?`
  ).get(req.params.id);

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Track lead view (throttled)
  if (req.user && shouldLogView(req.user.id, 'lead', req.params.id)) {
    logActivity({
      userId: req.user.id,
      entityType: 'lead',
      entityId: req.params.id,
      entityTitle: (lead as any).company_name,
      action: 'viewed',
    });
  }

  const parsed = parseLead(lead);

  // Attach active or recent run info for banner hydration
  if (parsed.campaign_id) {
    const activeRun = db.prepare(`
      SELECT id, status, progress_json, steps_run, started_at, completed_at
      FROM pipeline_runs
      WHERE campaign_id = ? AND (
        status IN ('pending', 'running')
        OR (status = 'completed' AND completed_at > datetime('now', '-60 seconds'))
      )
      AND (target_lead_ids LIKE ? OR target_lead_ids IS NULL)
      ORDER BY
        CASE WHEN status IN ('pending', 'running') THEN 0 ELSE 1 END,
        started_at DESC
      LIMIT 1
    `).get(parsed.campaign_id, `%"${req.params.id}"%`) as any;

    if (activeRun) {
      let progress = null;
      try { progress = JSON.parse(activeRun.progress_json || '{}'); } catch {}
      (parsed as any).active_run = {
        id: activeRun.id,
        status: activeRun.status,
        progress,
        steps_run: activeRun.steps_run,
        started_at: activeRun.started_at,
        completed_at: activeRun.completed_at,
      };
    }
  }

  // Extract brief threshold from campaign funnel config
  if ((lead as any).campaign_funnel_config) {
    try {
      const fc = JSON.parse((lead as any).campaign_funnel_config);
      const scoreStep = fc.steps?.find((s: any) => s.id === 'score');
      const briefStep = fc.steps?.find((s: any) => s.id === 'brief');
      if (scoreStep?.min_score_threshold) {
        (parsed as any).brief_threshold = scoreStep.min_score_threshold;
      }
      if (briefStep?.candidate_limit) {
        (parsed as any).brief_candidate_limit = briefStep.candidate_limit;
      }
    } catch {}
  }
  delete (parsed as any).campaign_funnel_config;

  // Cross-campaign: find this company in other campaigns
  if (parsed.domain) {
    const crossCampaign = db.prepare(`
      SELECT l.id, l.campaign_id, l.fit_score, l.lead_status, l.current_feedback, l.created_at,
        c.name as campaign_name
      FROM leads l
      JOIN campaigns c ON c.id = l.campaign_id
      WHERE l.domain = ? AND l.id != ? AND l.campaign_id IS NOT NULL
      ORDER BY l.created_at DESC
    `).all(parsed.domain, req.params.id) as any[];

    if (crossCampaign.length > 0) {
      (parsed as any).cross_campaign = crossCampaign.map(cc => ({
        lead_id: cc.id,
        campaign_id: cc.campaign_id,
        campaign_name: cc.campaign_name,
        fit_score: cc.fit_score,
        lead_status: cc.lead_status,
        feedback: cc.current_feedback,
        created_at: cc.created_at,
      }));
    }
  }

  res.json(parsed);
});

router.post('/:id/rerun-brief', authenticate, requireMember, async (req: AuthRequest, res: Response) => {
  try {
    const { runCampaign } = await import('../agent/campaignOrchestrator.js');
    const { eventBus } = await import('../events/eventBus.js');
    const leadId = req.params.id;
    const db = getDb();
    const lead = db.prepare('SELECT id, campaign_id, company_name FROM leads WHERE id = ?').get(leadId) as any;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.campaign_id) return res.status(400).json({ error: 'Lead has no campaign' });

    const forceBrief = req.body?.force_brief === true;
    const steps = forceBrief ? ['brief', 'audit'] : ['enrich', 'score', 'brief', 'audit'];

    const activeRun = db.prepare(
      "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status IN ('pending','running') LIMIT 1"
    ).get(lead.campaign_id) as any;
    if (activeRun) {
      return res.status(409).json({ error: 'A run is already in progress for this campaign' });
    }

    res.json({ status: 'started', lead_id: lead.id, steps });

    runCampaign(lead.campaign_id, req.user!.id, steps, [lead.id], 'stage_rerun').catch(err => {
      console.error(`[rerun-stage] Failed for lead ${lead.id}:`, err);
      eventBus.emit('lead.stage_rerun', {
        lead_id: lead.id,
        company_name: lead.company_name,
        stage: steps[0],
        status: 'failed',
        message: err instanceof Error ? err.message : 'Stage rerun failed',
      });
      if (steps[0] === 'brief') {
        eventBus.emit('lead.brief_rerun', {
          lead_id: lead.id,
          company_name: lead.company_name,
          status: 'failed',
          message: err instanceof Error ? err.message : 'Brief rerun failed',
        });
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to start stage rerun' });
  }
});

router.post('/:id/feedback', authenticate, (req: AuthRequest, res: Response) => {
  const { verdict, reason, retry_date, outcome_details } = req.body;

  let mappedVerdict = verdict;
  if (verdict === 'not_fit') mappedVerdict = 'bad_fit';
  if (verdict === 'good_fit') mappedVerdict = 'good_fit_response';

  if (!ALL_VERDICTS.includes(verdict) && !VALID_VERDICTS.includes(verdict as FeedbackVerdict)) {
    return res.status(400).json({ error: `verdict must be one of: ${VALID_VERDICTS.join(', ')}` });
  }

  const db = getDb();
  const lead = db.prepare('SELECT id, company_name, domain, campaign_id, current_feedback, lead_status FROM leads WHERE id = ?').get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const feedbackId = uuid();

  const sideEffects = { exclusion_added: null as string | null, customer_created: false };

  const feedbackTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO lead_feedback (id, lead_id, user_id, verdict, reason, retry_date, feedback_source) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(lead_id, user_id) DO UPDATE SET verdict=excluded.verdict, reason=excluded.reason, retry_date=excluded.retry_date, created_at=datetime('now')`
    ).run(feedbackId, req.params.id, req.user!.id, mappedVerdict, reason || null, retry_date || null, 'manual');

    // Get the actual feedback ID (may differ if upserted)
    const actualFeedback = db.prepare('SELECT id FROM lead_feedback WHERE lead_id = ? AND user_id = ?').get(req.params.id, req.user!.id) as any;
    const actualFeedbackId = actualFeedback?.id || feedbackId;

    // Update denormalized columns + lead_status sync
    const newStatus = VERDICT_TO_LEAD_STATUS[mappedVerdict];
    const nextOutreach = mappedVerdict === 'good_fit_try_again' ? (retry_date || null) : null;
    if (newStatus) {
      db.prepare(
        `UPDATE leads SET current_feedback = ?, next_outreach_date = ?, lead_status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(mappedVerdict, nextOutreach, newStatus, req.params.id);
    } else {
      db.prepare(
        `UPDATE leads SET current_feedback = ?, next_outreach_date = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(mappedVerdict, nextOutreach, req.params.id);
    }

    // Store structured outcome details if provided
    if (outcome_details && typeof outcome_details === 'object') {
      const od = outcome_details;
      db.prepare(`DELETE FROM feedback_outcome_details WHERE feedback_id = ?`).run(actualFeedbackId);
      db.prepare(
        `INSERT INTO feedback_outcome_details (id, feedback_id, lead_id, campaign_id, effective_persona, effective_channel, effective_angle, deal_value, sales_cycle_days, competitor_lost_to, loss_reason, bad_fit_reasons, customer_products, customer_environment, why_they_bought, stalled_stage)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        uuid(), actualFeedbackId, req.params.id, lead.campaign_id || null,
        od.effective_persona || null, od.effective_channel || null, od.effective_angle || null,
        od.deal_value || null, od.sales_cycle_days || null,
        od.competitor_lost_to || null, od.loss_reason || null,
        od.bad_fit_reasons ? JSON.stringify(od.bad_fit_reasons) : null,
        od.customer_products ? JSON.stringify(od.customer_products) : null,
        od.customer_environment ? JSON.stringify(od.customer_environment) : null,
        od.why_they_bought || null, od.stalled_stage || null,
      );
    }

    // Auto-exclusion + customer profile for won/customer verdicts
    if (['existing_customer', 'closed_won'].includes(mappedVerdict)) {
      const existingExcl = db.prepare(
        'SELECT id FROM exclusions WHERE company_name = ? OR (domain IS NOT NULL AND domain = ?)'
      ).get(lead.company_name, lead.domain || '') as any;

      if (!existingExcl) {
        db.prepare(
          `INSERT INTO exclusions (id, company_name, domain, reason, category, added_by) VALUES (?,?,?,?,?,?)`
        ).run(
          uuid(), lead.company_name, lead.domain || null,
          mappedVerdict === 'closed_won' ? 'Won deal — auto-excluded' : 'Existing customer — auto-excluded',
          'existing_customers', req.user!.id,
        );
        sideEffects.exclusion_added = lead.company_name;
      }

      // Upsert customer profile
      const od = outcome_details || {};
      db.prepare(
        `INSERT INTO customer_profiles (id, company_name, domain, products_used, environment, why_they_bought, deal_value, close_date, original_lead_id, campaign_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(domain) DO UPDATE SET
           products_used = COALESCE(excluded.products_used, customer_profiles.products_used),
           environment = COALESCE(excluded.environment, customer_profiles.environment),
           why_they_bought = COALESCE(excluded.why_they_bought, customer_profiles.why_they_bought),
           deal_value = COALESCE(excluded.deal_value, customer_profiles.deal_value),
           updated_at = datetime('now')`
      ).run(
        uuid(), lead.company_name, lead.domain || null,
        od.customer_products ? JSON.stringify(od.customer_products) : null,
        od.customer_environment ? JSON.stringify(od.customer_environment) : null,
        od.why_they_bought || null, od.deal_value || null,
        mappedVerdict === 'closed_won' ? new Date().toISOString().slice(0, 10) : null,
        req.params.id, lead.campaign_id || null,
      );
      sideEffects.customer_created = true;
    }

    // Auto-exclusion for competitors (bad_fit with is_competitor reason)
    if (mappedVerdict === 'bad_fit' && outcome_details?.bad_fit_reasons?.includes('is_competitor')) {
      const existingExcl = db.prepare(
        'SELECT id FROM exclusions WHERE company_name = ? OR (domain IS NOT NULL AND domain = ?)'
      ).get(lead.company_name, lead.domain || '') as any;

      if (!existingExcl) {
        db.prepare(
          `INSERT INTO exclusions (id, company_name, domain, reason, category, added_by) VALUES (?,?,?,?,?,?)`
        ).run(
          uuid(), lead.company_name, lead.domain || null,
          'Competitor — auto-excluded',
          'competitors', req.user!.id,
        );
        sideEffects.exclusion_added = lead.company_name;
      }
    }
  });

  feedbackTx();

  // Activity log for feedback changes
  const changes: Record<string, { old?: unknown; new: unknown }> = {
    feedback: { old: lead.current_feedback || null, new: mappedVerdict },
  };
  if (reason) changes.reason = { old: null, new: reason };
  if (sideEffects.exclusion_added) changes.exclusion_added = { old: null, new: sideEffects.exclusion_added };
  if (sideEffects.customer_created) changes.customer_created = { old: null, new: true };
  if (outcome_details) {
    if (outcome_details.effective_persona) changes.persona = { old: null, new: outcome_details.effective_persona };
    if (outcome_details.effective_channel) changes.channel = { old: null, new: outcome_details.effective_channel };
    if (outcome_details.deal_value) changes.deal_value = { old: null, new: outcome_details.deal_value };
    if (outcome_details.competitor_lost_to) changes.competitor = { old: null, new: outcome_details.competitor_lost_to };
    if (outcome_details.loss_reason) changes.loss_reason = { old: null, new: outcome_details.loss_reason };
  }
  logActivity({
    userId: req.user!.id,
    entityType: 'lead',
    entityId: req.params.id,
    entityTitle: lead.company_name,
    action: lead.current_feedback ? 'updated' : 'created',
    changes,
    snapshot: { verdict: mappedVerdict, lead_status: VERDICT_TO_LEAD_STATUS[mappedVerdict] || null },
  });

  // Threshold trigger: auto-analyze every 10 feedback entries
  let analysis_triggered = false;
  if (lead.campaign_id) {
    const count = getCampaignFeedbackCount(lead.campaign_id);
    if (count >= 10 && count % 10 === 0) {
      analysis_triggered = true;
      const cid = lead.campaign_id;
      setImmediate(() => {
        analyzeCampaignFeedback(cid).catch(err =>
          console.error(`[leads] Auto-analysis for campaign ${cid} failed:`, err)
        );
      });
    }
  }

  res.json({
    success: true,
    verdict: mappedVerdict,
    lead_status: VERDICT_TO_LEAD_STATUS[mappedVerdict] || null,
    exclusion_added: sideEffects.exclusion_added,
    customer_created: sideEffects.customer_created,
    analysis_triggered,
  });
});

// Reset lead feedback — clears verdict, associated exclusions, and customer profiles
router.post('/:id/reset-feedback', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const lead = db.prepare(
    'SELECT id, company_name, domain, campaign_id, current_feedback, lead_status FROM leads WHERE id = ?'
  ).get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (!lead.current_feedback) return res.status(400).json({ error: 'Lead has no feedback to reset' });

  const previousFeedback = lead.current_feedback;
  const previousStatus = lead.lead_status;
  const sideEffects = { exclusion_removed: null as string | null, customer_removed: false };

  const resetTx = db.transaction(() => {
    // Get feedback IDs before deleting (for outcome details cleanup)
    const feedbackIds = db.prepare('SELECT id FROM lead_feedback WHERE lead_id = ?').all(req.params.id) as { id: string }[];
    for (const f of feedbackIds) {
      db.prepare('DELETE FROM feedback_outcome_details WHERE feedback_id = ?').run(f.id);
    }
    db.prepare('DELETE FROM lead_feedback WHERE lead_id = ?').run(req.params.id);

    db.prepare(
      `UPDATE leads SET current_feedback = NULL, next_outreach_date = NULL, lead_status = 'scored', updated_at = datetime('now') WHERE id = ?`
    ).run(req.params.id);

    // Remove auto-created exclusion for closed_won / existing_customer
    if (['closed_won', 'existing_customer'].includes(previousFeedback)) {
      const exclusion = db.prepare(
        "SELECT id FROM exclusions WHERE (company_name = ? OR (domain IS NOT NULL AND domain != '' AND domain = ?)) AND category = 'existing_customers'"
      ).get(lead.company_name, lead.domain || '') as any;
      if (exclusion) {
        db.prepare('DELETE FROM exclusions WHERE id = ?').run(exclusion.id);
        sideEffects.exclusion_removed = lead.company_name;
      }

      const customerProfile = db.prepare('SELECT id FROM customer_profiles WHERE original_lead_id = ?').get(req.params.id) as any;
      if (customerProfile) {
        db.prepare('DELETE FROM customer_profiles WHERE id = ?').run(customerProfile.id);
        sideEffects.customer_removed = true;
      }
    }

    // Remove auto-created exclusion for bad_fit competitors
    if (previousFeedback === 'bad_fit') {
      const exclusion = db.prepare(
        "SELECT id FROM exclusions WHERE (company_name = ? OR (domain IS NOT NULL AND domain != '' AND domain = ?)) AND category = 'competitors'"
      ).get(lead.company_name, lead.domain || '') as any;
      if (exclusion) {
        db.prepare('DELETE FROM exclusions WHERE id = ?').run(exclusion.id);
        sideEffects.exclusion_removed = lead.company_name;
      }
    }
  });

  resetTx();

  logActivity({
    userId: req.user!.id,
    entityType: 'lead',
    entityId: req.params.id,
    entityTitle: lead.company_name,
    action: 'updated',
    changes: {
      feedback_reset: { old: previousFeedback, new: null },
      lead_status: { old: previousStatus, new: 'scored' },
      ...(sideEffects.exclusion_removed ? { exclusion_removed: { old: sideEffects.exclusion_removed, new: null } } : {}),
      ...(sideEffects.customer_removed ? { customer_profile_removed: { old: true, new: null } } : {}),
    },
  });

  res.json({
    success: true,
    previous_feedback: previousFeedback,
    previous_status: previousStatus,
    exclusion_removed: sideEffects.exclusion_removed,
    customer_removed: sideEffects.customer_removed,
  });
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

// ── Admin: Backfill v2 composite scores from stored FactSheets ─

function parseCampaignForBackfill(row: any) {
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
    funnel_config: row.funnel_config ? JSON.parse(row.funnel_config) : null,
    schedule_cron: row.schedule_cron || null,
    schedule_enabled: row.schedule_enabled || 0,
    rss_enabled: row.rss_enabled || 0,
    notification_destinations: [],
    notification_base_url: null,
  };
}

router.post('/backfill-composite', authenticate, requireSuperAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const campaignId = req.query.campaign_id as string | undefined;
  const dryRun = req.query.dry_run === 'true';

  let whereClause = 'fact_sheet IS NOT NULL AND (composite_version IS NULL OR composite_version = 1)';
  const params: any[] = [];
  if (campaignId) {
    whereClause += ' AND campaign_id = ?';
    params.push(campaignId);
  }

  const leads = db.prepare(
    `SELECT id, company_name, campaign_id, fit_score, fact_sheet, enrichment_metadata, scoring_version
     FROM leads WHERE ${whereClause}`
  ).all(...params) as any[];

  const campaignCache = new Map<string, any>();
  const results: any[] = [];
  let skipped = 0;

  const updateStmt = dryRun ? null : db.prepare(`
    UPDATE leads SET
      icp_fit_score = ?,
      timing_score = ?,
      data_confidence = ?,
      data_confidence_score = ?,
      reachability_score = ?,
      research_completeness = ?,
      signal_density = ?,
      signal_quality_score = ?,
      potential_score = ?,
      urgency_score = ?,
      evidence_modifier = ?,
      fit_score = ?,
      scoring_version = 2,
      composite_version = 2,
      scoring_verdict = ?,
      score_breakdown = ?,
      scoring_breakdown_v2 = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const lead of leads) {
    let factSheet: FactSheet;
    let enrichMeta: EnrichmentMetadata | undefined;
    try {
      factSheet = JSON.parse(lead.fact_sheet);
    } catch {
      skipped++;
      continue;
    }
    try {
      enrichMeta = lead.enrichment_metadata ? JSON.parse(lead.enrichment_metadata) : undefined;
    } catch {
      enrichMeta = undefined;
    }

    let icpConfig;
    let scoringSignals;
    try {
      if (!campaignCache.has(lead.campaign_id)) {
        const campaignRow = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(lead.campaign_id);
        if (campaignRow) {
          const parsed = parseCampaignForBackfill(campaignRow);
          const config = loadCampaignConfig(parsed);
          const scoreStep = parsed.funnel_config?.steps?.find((s: any) => s.id === 'score');
          campaignCache.set(lead.campaign_id, { icpConfig: config.icpConfig, scoringSignals: scoreStep?.scoring_signals });
        }
      }
      const cached = campaignCache.get(lead.campaign_id);
      icpConfig = cached?.icpConfig;
      scoringSignals = cached?.scoringSignals;
    } catch {
      icpConfig = undefined;
    }

    if (!icpConfig) {
      skipped++;
      continue;
    }

    const dimensions = computeAllDimensions(factSheet, icpConfig, enrichMeta, scoringSignals);
    const composite = computeCompositeV2(dimensions);
    const verdict = generateVerdict(dimensions);
    const breakdown = dimensionsToLegacyBreakdown(dimensions, factSheet);
    breakdown.total = composite.fit_score;

    if (!dryRun && updateStmt) {
      updateStmt.run(
        dimensions.icp_fit,
        dimensions.timing,
        dimensions.data_confidence,
        dimensions.data_confidence_score,
        dimensions.reachability,
        dimensions.research_completeness,
        JSON.stringify(dimensions.signal_density),
        dimensions.signal_quality,
        composite.potential_score,
        composite.urgency_score,
        composite.evidence_modifier,
        composite.fit_score,
        verdict,
        JSON.stringify(breakdown),
        dimensions.breakdowns ? JSON.stringify(dimensions.breakdowns) : null,
        lead.id,
      );
    }

    results.push({
      lead_id: lead.id,
      company_name: lead.company_name,
      old_score: lead.fit_score,
      new_score: composite.fit_score,
      potential: composite.potential_score,
      urgency: composite.urgency_score,
      evidence_modifier: composite.evidence_modifier,
      watch_candidate: composite.potential_score >= 60 && composite.urgency_score < 35,
      verdict,
    });
  }

  res.json({
    dry_run: dryRun,
    total_processed: results.length,
    total_skipped: skipped,
    results,
  });
});

// ── Admin: Backfill LinkedIn metadata (hq_location, founded_year) for leads enriched before extraction code was added ─

router.post('/backfill-enrich', authenticate, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  const { LinkedInAdapter } = await import('../agent/enrichment/adapters/linkedin.js');
  const db = getDb();
  const dryRun = req.query.dry_run === 'true';
  const campaignId = req.query.campaign_id as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  let whereClause = 'linkedin_company_url IS NOT NULL AND (hq_location IS NULL OR founded_year IS NULL)';
  const params: any[] = [];
  if (campaignId) {
    whereClause += ' AND campaign_id = ?';
    params.push(campaignId);
  }

  const leads = db.prepare(
    `SELECT id, company_name, domain, linkedin_company_url, hq_location, founded_year, enrichment_metadata
     FROM leads WHERE ${whereClause} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[];

  if (dryRun) {
    const totalCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM leads WHERE ${whereClause}`
    ).get(...params) as any;
    return res.json({ dry_run: true, total_found: totalCount.cnt, sample: leads.slice(0, 10).map((l: any) => ({ id: l.id, company: l.company_name, has_hq: !!l.hq_location, has_founded: !!l.founded_year })) });
  }

  const adapter = new LinkedInAdapter();
  const updateStmt = db.prepare(`
    UPDATE leads SET
      hq_location = COALESCE(hq_location, ?),
      founded_year = COALESCE(founded_year, ?),
      enrichment_metadata = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const details: any[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i] as any;

    if (i > 0 && i % 10 === 0) {
      await new Promise(r => setTimeout(r, 2000));
    }

    try {
      const enrichment = await adapter.enrichCompany(
        lead.company_name,
        lead.domain,
        { id: 'linkedin', name: 'LinkedIn', description: 'Backfill', category: 'company_data', enabled: true, requires_key: false, settings: { linkedin_url: lead.linkedin_company_url }, status: 'active' }
      );

      if (!enrichment.hq_location && !enrichment.founded_year) {
        skipped++;
        details.push({ id: lead.id, company: lead.company_name, status: 'no_new_data' });
        continue;
      }

      let metadata: any = {};
      try { metadata = JSON.parse(lead.enrichment_metadata || '{}'); } catch { /* */ }
      if (metadata.field_completeness) {
        if (enrichment.hq_location) metadata.field_completeness.hq_location = true;
        if (enrichment.founded_year) metadata.field_completeness.founded_year = true;
      }

      updateStmt.run(
        enrichment.hq_location ?? null,
        enrichment.founded_year ?? null,
        JSON.stringify(metadata),
        lead.id
      );
      updated++;
      details.push({ id: lead.id, company: lead.company_name, status: 'updated', hq: enrichment.hq_location, founded: enrichment.founded_year });
    } catch (err) {
      errors++;
      details.push({ id: lead.id, company: lead.company_name, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  res.json({ total_found: leads.length, updated, skipped, errors, details });
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
  try { lead.fact_sheet_parsed = JSON.parse(row.fact_sheet); } catch { lead.fact_sheet_parsed = null; }
  try { lead.signal_density_parsed = JSON.parse(row.signal_density); } catch { lead.signal_density_parsed = null; }
  try { lead.enrichment_metadata_parsed = JSON.parse(row.enrichment_metadata); } catch { lead.enrichment_metadata_parsed = null; }
  try { lead.scoring_breakdown_v2_parsed = JSON.parse(row.scoring_breakdown_v2); } catch { lead.scoring_breakdown_v2_parsed = null; }

  if (row.scoring_version === 2 && row.icp_fit_score != null) {
    const potential = row.potential_score ?? null;
    const urgency = row.urgency_score ?? null;
    lead.dimensions_parsed = {
      icp_fit: row.icp_fit_score,
      timing: row.timing_score,
      data_confidence: row.data_confidence,
      data_confidence_score: row.data_confidence_score,
      reachability: row.reachability_score,
      research_completeness: row.research_completeness,
      signal_density: lead.signal_density_parsed,
      signal_quality: row.signal_quality_score ?? null,
      potential_score: potential,
      urgency_score: urgency,
      evidence_modifier: row.evidence_modifier ?? null,
      watch_candidate: potential != null && urgency != null && potential >= 60 && urgency < 35,
      watch_reason: (potential != null && urgency != null && potential >= 60 && urgency < 35)
        ? `High fit (${potential}) but low intent (${urgency})`
        : null,
      verdict: row.scoring_verdict || null,
      breakdowns: lead.scoring_breakdown_v2_parsed || undefined,
    };
  } else {
    lead.dimensions_parsed = null;
  }

  let signalCount = 0;
  if (lead.sources_parsed && Array.isArray(lead.sources_parsed)) signalCount += lead.sources_parsed.length;
  lead.signal_count = signalCount;

  lead.personas = lead.personas.map((p: any) => {
    try { p.talking_points_parsed = JSON.parse(p.talking_points); } catch { p.talking_points_parsed = null; }
    try { p.social_signals_parsed = JSON.parse(p.social_signals); } catch { p.social_signals_parsed = null; }
    try { p.buying_signals_parsed = JSON.parse(p.buying_signals); } catch { p.buying_signals_parsed = null; }
    return p;
  });
  try { lead.watch_items = JSON.parse(row.watch_items_json || '[]').filter((w: any) => w.id !== null); }
  catch { lead.watch_items = []; }

  delete lead.personas_json;
  delete lead.feedback_json;
  delete lead.watch_items_json;
  return lead;
}

export default router;
