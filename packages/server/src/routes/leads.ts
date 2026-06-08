import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, AuthRequest, requireOperator, requireAdmin, requireMember } from '../auth/middleware.js';
import { logActivity } from '../services/activityLog.js';
import { analyzeCampaignFeedback, getCampaignFeedbackCount } from '../agent/feedbackAnalyzer.js';
import type { Lead, Persona, LeadFeedback, FeedbackVerdict } from '../types/index.js';

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

router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const {
    run_id, segment, campaign_id, source_type, lead_status, feedback,
    needs_reoutreach, min_score, max_score, min_signals, date_from, date_to,
    search,
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
  if (search) {
    const term = `%${search}%`;
    conditions.push('(l.company_name LIKE ? OR l.domain LIKE ?)');
    params.push(term, term);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const allowedSorts = ['fit_score', 'icp_fit_score', 'timing_score', 'company_name', 'segment', 'created_at', 'lead_status', 'convergence_score', 'current_feedback', 'next_outreach_date'];
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
       WHERE f.lead_id = l.id ORDER BY f.created_at DESC) as feedback_json
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

  if (row.scoring_version === 2 && row.icp_fit_score != null) {
    lead.dimensions_parsed = {
      icp_fit: row.icp_fit_score,
      timing: row.timing_score,
      data_confidence: row.data_confidence,
      data_confidence_score: row.data_confidence_score,
      reachability: row.reachability_score,
      research_completeness: row.research_completeness,
      signal_density: lead.signal_density_parsed,
      verdict: row.scoring_verdict || null,
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
  delete lead.personas_json;
  delete lead.feedback_json;
  return lead;
}

export default router;
