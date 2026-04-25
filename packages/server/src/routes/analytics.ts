import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, AuthRequest } from '../auth/middleware.js';
import { generateRecommendations } from '../agent/recommendationEngine.js';
import { ActivityLogger } from '../agent/activityLogger.js';

const router = Router();

// ── GET /overview — aggregate stats ────────────────────────────
router.get('/overview', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const leads = db.prepare('SELECT COUNT(*) as c FROM leads').get() as any;
  const campaigns = db.prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'active'").get() as any;
  const totalRuns = db.prepare('SELECT COUNT(*) as c FROM pipeline_runs').get() as any;
  const completedRuns = db.prepare("SELECT COUNT(*) as c FROM pipeline_runs WHERE status = 'completed'").get() as any;
  const avgScore = db.prepare('SELECT AVG(fit_score) as avg FROM leads').get() as any;
  const withFeedback = db.prepare("SELECT COUNT(*) as c FROM leads WHERE current_feedback IS NOT NULL").get() as any;

  const feedbackBreakdown = db.prepare(
    `SELECT current_feedback as verdict, COUNT(*) as count FROM leads WHERE current_feedback IS NOT NULL GROUP BY current_feedback`
  ).all();

  res.json({
    total_leads: leads.c,
    active_campaigns: campaigns.c,
    total_runs: totalRuns.c,
    completed_runs: completedRuns.c,
    success_rate: totalRuns.c > 0 ? Math.round((completedRuns.c / totalRuns.c) * 100) : 0,
    avg_score: avgScore.avg ? Math.round(avgScore.avg) : null,
    feedback_rate: leads.c > 0 ? Math.round((withFeedback.c / leads.c) * 100) : 0,
    feedback_breakdown: feedbackBreakdown,
  });
});

// ── GET /trends — time-series data ─────────────────────────────
router.get('/trends', authenticate, (req: AuthRequest, res: Response) => {
  const { days = '30' } = req.query;
  const db = getDb();

  const leadsByDay = db.prepare(
    `SELECT date(created_at) as day, COUNT(*) as count, AVG(fit_score) as avg_score
     FROM leads
     WHERE created_at >= date('now', '-' || ? || ' days')
     GROUP BY date(created_at)
     ORDER BY day`
  ).all(parseInt(days as string));

  const runsByDay = db.prepare(
    `SELECT date(created_at) as day, COUNT(*) as count,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
     FROM pipeline_runs
     WHERE created_at >= date('now', '-' || ? || ' days')
     GROUP BY date(created_at)
     ORDER BY day`
  ).all(parseInt(days as string));

  res.json({ leads_by_day: leadsByDay, runs_by_day: runsByDay });
});

// ── GET /segments — breakdown by segment ───────────────────────
router.get('/segments', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const segments = db.prepare(
    `SELECT segment, COUNT(*) as count, AVG(fit_score) as avg_score,
       SUM(CASE WHEN current_feedback IN ('good_fit_response','good_fit_booked') THEN 1 ELSE 0 END) as converted
     FROM leads GROUP BY segment ORDER BY count DESC`
  ).all();
  res.json(segments);
});

// ── GET /verticals — industry/vertical breakdown ──────────────
router.get('/verticals', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();

  // Get ICP verticals config
  const icpRow = db.prepare('SELECT verticals FROM icp_config ORDER BY version DESC LIMIT 1').get() as { verticals: string } | undefined;
  const configuredVerticals: string[] = icpRow ? JSON.parse(icpRow.verticals) : [];

  // Count leads by campaign target_categories (proxy for vertical)
  const campaignVerticals = db.prepare(
    `SELECT c.target_categories, COUNT(l.id) as lead_count, AVG(l.fit_score) as avg_score
     FROM campaigns c
     LEFT JOIN leads l ON l.campaign_id = c.id
     WHERE c.status = 'active'
     GROUP BY c.id`
  ).all() as any[];

  // Aggregate by vertical
  const verticalMap: Record<string, { count: number; total_score: number; leads: number }> = {};
  for (const row of campaignVerticals) {
    const categories: string[] = JSON.parse(row.target_categories || '[]');
    for (const cat of categories) {
      if (!verticalMap[cat]) verticalMap[cat] = { count: 0, total_score: 0, leads: 0 };
      verticalMap[cat].count += 1;
      verticalMap[cat].leads += row.lead_count || 0;
      verticalMap[cat].total_score += (row.avg_score || 0) * (row.lead_count || 0);
    }
  }

  const verticals = Object.entries(verticalMap)
    .map(([name, data]) => ({
      name,
      campaigns: data.count,
      leads: data.leads,
      avg_score: data.leads > 0 ? Math.round(data.total_score / data.leads) : null,
    }))
    .sort((a, b) => b.leads - a.leads);

  res.json({ configured_verticals: configuredVerticals, verticals });
});

// ── GET /feedback — feedback accuracy metrics ──────────────────
router.get('/feedback', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();

  // Score vs feedback correlation: avg score per feedback type
  const scoreByFeedback = db.prepare(
    `SELECT current_feedback as verdict, COUNT(*) as count, AVG(fit_score) as avg_score
     FROM leads WHERE current_feedback IS NOT NULL
     GROUP BY current_feedback ORDER BY avg_score DESC`
  ).all();

  // Score ranges and their feedback outcomes
  const scoreRanges = db.prepare(
    `SELECT
       CASE
         WHEN fit_score >= 80 THEN '80-100'
         WHEN fit_score >= 60 THEN '60-79'
         WHEN fit_score >= 40 THEN '40-59'
         ELSE '0-39'
       END as range,
       COUNT(*) as total,
       SUM(CASE WHEN current_feedback IN ('good_fit_response','good_fit_booked') THEN 1 ELSE 0 END) as positive,
       SUM(CASE WHEN current_feedback = 'bad_fit' THEN 1 ELSE 0 END) as negative
     FROM leads WHERE current_feedback IS NOT NULL
     GROUP BY range ORDER BY range DESC`
  ).all();

  res.json({ score_by_feedback: scoreByFeedback, score_ranges: scoreRanges });
});

// ── GET /sources — data source performance ─────────────────────
router.get('/sources', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();

  // Leads with most signals tend to score higher
  const signalCorrelation = db.prepare(
    `SELECT
       CASE
         WHEN signal_count >= 5 THEN '5+'
         WHEN signal_count >= 3 THEN '3-4'
         WHEN signal_count >= 1 THEN '1-2'
         ELSE '0'
       END as signal_range,
       COUNT(*) as count, AVG(fit_score) as avg_score
     FROM leads GROUP BY signal_range ORDER BY avg_score DESC`
  ).all();

  res.json({ signal_correlation: signalCorrelation });
});

// ── GET /recommendations — list AI recommendations ─────────────
router.get('/recommendations', authenticate, (req: AuthRequest, res: Response) => {
  const { status = 'all' } = req.query;
  const db = getDb();

  let query = 'SELECT * FROM ai_recommendations';
  const params: any[] = [];
  if (status !== 'all') {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC LIMIT 50';

  const recs = db.prepare(query).all(...params);
  res.json(recs);
});

// ── POST /recommendations/generate — trigger Claude analysis ───
router.post('/recommendations/generate', authenticate, requireMember, async (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    // Gather analytics snapshot for the engine
    const totalLeads = (db.prepare('SELECT COUNT(*) as c FROM leads').get() as any).c;
    const avgScore = (db.prepare('SELECT AVG(fit_score) as avg FROM leads').get() as any).avg;

    const segmentBreakdown = db.prepare(
      `SELECT segment, COUNT(*) as count, AVG(fit_score) as avg_score FROM leads GROUP BY segment`
    ).all();

    const feedbackBreakdown = db.prepare(
      `SELECT current_feedback as verdict, COUNT(*) as count, AVG(fit_score) as avg_score
       FROM leads WHERE current_feedback IS NOT NULL GROUP BY current_feedback`
    ).all();

    const scoreRanges = db.prepare(
      `SELECT
         CASE WHEN fit_score >= 80 THEN '80-100' WHEN fit_score >= 60 THEN '60-79' WHEN fit_score >= 40 THEN '40-59' ELSE '0-39' END as range,
         COUNT(*) as total,
         SUM(CASE WHEN current_feedback IN ('good_fit_response','good_fit_booked') THEN 1 ELSE 0 END) as positive,
         SUM(CASE WHEN current_feedback = 'bad_fit' THEN 1 ELSE 0 END) as negative
       FROM leads WHERE current_feedback IS NOT NULL GROUP BY range`
    ).all();

    const topCampaigns = db.prepare(
      `SELECT c.name, COUNT(l.id) as lead_count, AVG(l.fit_score) as avg_score
       FROM campaigns c LEFT JOIN leads l ON l.campaign_id = c.id
       WHERE c.status = 'active' GROUP BY c.id ORDER BY avg_score DESC LIMIT 10`
    ).all();

    const snapshot = {
      total_leads: totalLeads,
      avg_score: avgScore ? Math.round(avgScore) : null,
      segments: segmentBreakdown,
      feedback: feedbackBreakdown,
      score_ranges: scoreRanges,
      campaigns: topCampaigns,
    };

    const recRunId = `rec_${uuid()}`;
    const logger = new ActivityLogger(recRunId);
    logger.milestone('Generating AI recommendations...', { total_leads: totalLeads, avg_score: avgScore });
    const recommendations = await generateRecommendations(snapshot, logger);

    // Insert recommendations
    const insert = db.prepare(
      `INSERT INTO ai_recommendations (id, type, title, description, rationale, data_snapshot, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    );

    const tx = db.transaction(() => {
      for (const rec of recommendations) {
        insert.run(uuid(), rec.type, rec.title, rec.description, rec.rationale, JSON.stringify(snapshot));
      }
    });
    tx();

    res.json({ generated: recommendations.length, recommendations });
  } catch (err: any) {
    console.error('[recommendations] Generation failed:', err);
    res.status(500).json({ error: 'Failed to generate recommendations', detail: err.message });
  }
});

// ── PATCH /recommendations/:id — accept/dismiss ────────────────
router.patch('/recommendations/:id', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  if (!['accepted', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted or dismissed' });
  }

  const db = getDb();
  const rec = db.prepare('SELECT id FROM ai_recommendations WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });

  db.prepare(
    `UPDATE ai_recommendations SET status = ?, acted_at = datetime('now'), acted_by = ? WHERE id = ?`
  ).run(status, req.user!.id, req.params.id);

  res.json({ success: true });
});

// ── GET /run-trends — Cross-campaign score + cost trends ──────
router.get('/run-trends', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const trends = db.prepare(`
    SELECT pr.id as run_id, pr.created_at, pr.lead_count, pr.estimated_cost,
           pr.input_tokens, pr.output_tokens, pr.campaign_id, c.name as campaign_name,
           AVG(l.fit_score) as avg_score, MIN(l.fit_score) as min_score,
           MAX(l.fit_score) as max_score
    FROM pipeline_runs pr
    LEFT JOIN leads l ON l.run_id = pr.id
    LEFT JOIN campaigns c ON c.id = pr.campaign_id
    WHERE pr.status = 'completed'
    GROUP BY pr.id
    ORDER BY pr.created_at DESC
    LIMIT ?
  `).all(limit);

  res.json({ trends: (trends as any[]).reverse() });
});

export default router;
