import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, requireOperator, AuthRequest } from '../auth/middleware.js';
import { runCampaign } from '../agent/campaignOrchestrator.js';
import { eventBus } from '../events/eventBus.js';

const router = Router();

// GET / — List watch items grouped by wake timing
router.get('/', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { campaign_id, category, status } = req.query;

  let where = '1=1';
  const params: any[] = [];
  if (campaign_id) { where += ' AND w.campaign_id = ?'; params.push(campaign_id); }
  if (category) { where += ' AND w.category = ?'; params.push(category); }
  if (status) { where += ' AND w.status = ?'; params.push(status); }

  const rows = db.prepare(`
    SELECT w.*, l.company_name, l.segment, l.domain, l.fit_score, l.fit_score_label,
           l.potential_score as lead_potential, l.urgency_score as lead_urgency
    FROM watch_items w
    JOIN leads l ON l.id = w.lead_id
    WHERE ${where}
    ORDER BY w.snooze_until ASC
  `).all(...params) as any[];

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const result: Record<string, any[]> = {
    waking_today: [],
    waking_this_week: [],
    watching: [],
  };
  if (req.query.include_dismissed === 'true') result.dismissed = [];

  for (const row of rows) {
    const item = formatWatchItem(row);
    if (row.status === 'dismissed') {
      if (result.dismissed) result.dismissed.push(item);
    } else if (row.status === 'woken') {
      result.waking_today.push(item);
    } else if (row.status === 'converted') {
      continue;
    } else if (row.snooze_until <= today) {
      result.waking_today.push(item);
    } else if (row.snooze_until <= weekEnd) {
      result.waking_this_week.push(item);
    } else {
      result.watching.push(item);
    }
  }

  res.json(result);
});

// GET /stats — Aggregate counts
router.get('/stats', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const total = db.prepare(
    "SELECT COUNT(*) as count FROM watch_items WHERE status = 'active'"
  ).get() as { count: number };

  const wakingToday = db.prepare(
    "SELECT COUNT(*) as count FROM watch_items WHERE status = 'active' AND snooze_until <= ?"
  ).get(today) as { count: number };

  const wakingThisWeek = db.prepare(
    "SELECT COUNT(*) as count FROM watch_items WHERE status = 'active' AND snooze_until > ? AND snooze_until <= ?"
  ).get(today, weekEnd) as { count: number };

  const byCategory = db.prepare(
    "SELECT category, COUNT(*) as count FROM watch_items WHERE status = 'active' GROUP BY category"
  ).all() as { category: string; count: number }[];

  const wokenCount = db.prepare(
    "SELECT COUNT(*) as count FROM watch_items WHERE status = 'woken'"
  ).get() as { count: number };

  res.json({
    total_watching: total.count,
    waking_today: wakingToday.count,
    waking_this_week: wakingThisWeek.count,
    woken: wokenCount.count,
    by_category: Object.fromEntries(byCategory.map(r => [r.category, r.count])),
  });
});

// GET /waking — Items waking today or overdue
router.get('/waking', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT w.*, l.company_name, l.segment, l.domain, l.fit_score, l.fit_score_label,
           l.potential_score as lead_potential, l.urgency_score as lead_urgency
    FROM watch_items w
    JOIN leads l ON l.id = w.lead_id
    WHERE (w.status = 'active' AND w.snooze_until <= ?) OR w.status = 'woken'
    ORDER BY w.snooze_until ASC
  `).all(today) as any[];

  res.json(rows.map(formatWatchItem));
});

// POST /:leadId — Add lead to watch list
router.post('/:leadId', authenticate, requireMember, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { leadId } = req.params;
  const { snooze_until, category = 'timing_watch', notes, rerun_on_wake = true } = req.body;

  if (!snooze_until) {
    return res.status(400).json({ error: 'snooze_until is required' });
  }

  const lead = db.prepare('SELECT id, company_name, campaign_id, fit_score, potential_score, urgency_score, signal_quality_score, evidence_modifier FROM leads WHERE id = ?').get(leadId) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const existing = db.prepare(
    "SELECT id FROM watch_items WHERE lead_id = ? AND status = 'active'"
  ).get(leadId) as any;
  if (existing) return res.status(409).json({ error: 'Lead already has an active watch item', watch_id: existing.id });

  const id = uuid();
  const snapshot = JSON.stringify({
    fit_score: lead.fit_score,
    potential_score: lead.potential_score,
    urgency_score: lead.urgency_score,
    signal_quality: lead.signal_quality_score,
    evidence_modifier: lead.evidence_modifier,
  });

  db.prepare(`
    INSERT INTO watch_items (id, lead_id, campaign_id, category, snooze_until, rerun_on_wake, notes, created_by, score_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, leadId, lead.campaign_id, category, snooze_until, rerun_on_wake ? 1 : 0, notes || null, req.user!.id, snapshot);

  eventBus.emit('watch.created', {
    watch_id: id,
    lead_id: leadId,
    company_name: lead.company_name,
    category,
    snooze_until,
  });

  res.status(201).json({ id, lead_id: leadId, category, snooze_until, status: 'active' });
});

// PATCH /:id — Update watch item
router.patch('/:id', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { snooze_until, category, notes, rerun_on_wake } = req.body;

  const item = db.prepare('SELECT id, status FROM watch_items WHERE id = ?').get(id) as any;
  if (!item) return res.status(404).json({ error: 'Watch item not found' });
  if (item.status !== 'active') return res.status(400).json({ error: 'Can only update active watch items' });

  const updates: string[] = [];
  const params: any[] = [];
  if (snooze_until !== undefined) { updates.push('snooze_until = ?'); params.push(snooze_until); }
  if (category !== undefined) { updates.push('category = ?'); params.push(category); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (rerun_on_wake !== undefined) { updates.push('rerun_on_wake = ?'); params.push(rerun_on_wake ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE watch_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ id, updated: true });
});

// POST /:id/dismiss — Dismiss a watch item
router.post('/:id/dismiss', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { reason = '' } = req.body;

  const item = db.prepare(`
    SELECT w.id, w.lead_id, w.status, l.company_name
    FROM watch_items w JOIN leads l ON l.id = w.lead_id
    WHERE w.id = ?
  `).get(id) as any;
  if (!item) return res.status(404).json({ error: 'Watch item not found' });
  if (item.status === 'dismissed') return res.status(400).json({ error: 'Already dismissed' });

  db.prepare(
    "UPDATE watch_items SET status = 'dismissed', notes = COALESCE(notes || ' | ', '') || ?, updated_at = datetime('now') WHERE id = ?"
  ).run(`Dismissed: ${reason}`, id);

  eventBus.emit('watch.dismissed', {
    watch_id: id,
    lead_id: item.lead_id,
    company_name: item.company_name,
    reason,
  });

  res.json({ id, status: 'dismissed' });
});

// POST /:id/convert — Convert to active lead
router.post('/:id/convert', authenticate, requireMember, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { trigger_rescore = false } = req.body;

  const item = db.prepare(`
    SELECT w.*, l.company_name, l.campaign_id
    FROM watch_items w JOIN leads l ON l.id = w.lead_id
    WHERE w.id = ?
  `).get(id) as any;
  if (!item) return res.status(404).json({ error: 'Watch item not found' });
  if (item.status === 'converted') return res.status(400).json({ error: 'Already converted' });

  db.prepare(
    "UPDATE watch_items SET status = 'converted', updated_at = datetime('now') WHERE id = ?"
  ).run(id);

  if (trigger_rescore) {
    try {
      await runCampaign(item.campaign_id, req.user!.id, ['enrich', 'score'], [item.lead_id], 'stage_rerun');
    } catch (err) {
      console.error(`[watchlist] Re-score failed for ${item.company_name}:`, err);
    }
  }

  res.json({ id, status: 'converted' });
});

// POST /:id/wake — Manually wake a snoozed item
router.post('/:id/wake', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const item = db.prepare(`
    SELECT w.*, l.company_name, l.campaign_id, l.fit_score, l.potential_score, l.urgency_score
    FROM watch_items w JOIN leads l ON l.id = w.lead_id
    WHERE w.id = ?
  `).get(id) as any;
  if (!item) return res.status(404).json({ error: 'Watch item not found' });
  if (item.status !== 'active') return res.status(400).json({ error: 'Can only wake active watch items' });

  db.prepare(
    "UPDATE watch_items SET status = 'woken', woken_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(id);

  let delta: { fit_score_change: number; potential_change: number; urgency_change: number } | null = null;

  if (item.rerun_on_wake) {
    try {
      await runCampaign(item.campaign_id, req.user!.id, ['enrich', 'score'], [item.lead_id], 'stage_rerun');
      const updated = db.prepare('SELECT fit_score, potential_score, urgency_score FROM leads WHERE id = ?').get(item.lead_id) as any;
      if (updated) {
        const snapshot = JSON.parse(item.score_snapshot || '{}');
        delta = {
          fit_score_change: (updated.fit_score ?? 0) - (snapshot.fit_score ?? 0),
          potential_change: (updated.potential_score ?? 0) - (snapshot.potential_score ?? 0),
          urgency_change: (updated.urgency_score ?? 0) - (snapshot.urgency_score ?? 0),
        };
        db.prepare("UPDATE watch_items SET wake_delta = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(delta), id);
      }
    } catch (err) {
      console.error(`[watchlist] Re-enrich failed for ${item.company_name}:`, err);
    }
  }

  eventBus.emit('watch.woken', {
    watch_id: id,
    lead_id: item.lead_id,
    company_name: item.company_name,
    delta,
  });

  res.json({ id, status: 'woken', delta });
});

function formatWatchItem(row: any) {
  let score_snapshot = null;
  let wake_delta = null;
  try { score_snapshot = JSON.parse(row.score_snapshot); } catch { /* */ }
  try { wake_delta = JSON.parse(row.wake_delta); } catch { /* */ }

  return {
    id: row.id,
    lead_id: row.lead_id,
    campaign_id: row.campaign_id,
    category: row.category,
    status: row.status,
    snooze_until: row.snooze_until,
    rerun_on_wake: !!row.rerun_on_wake,
    notes: row.notes,
    created_by: row.created_by,
    score_snapshot,
    delta: wake_delta,
    woken_at: row.woken_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lead: {
      company_name: row.company_name,
      segment: row.segment,
      domain: row.domain,
      fit_score: row.fit_score,
      fit_score_label: row.fit_score_label,
    },
  };
}

export default router;
