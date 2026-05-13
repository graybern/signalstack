import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, requirePermission, AuthRequest } from '../auth/middleware.js';
import { generateRecommendations } from '../agent/recommendationEngine.js';
import { ActivityLogger } from '../agent/activityLogger.js';
import { logActivity } from '../services/activityLog.js';
import { getSetting, saveSetting } from './icp.js';
import { analyzeGlobalPatterns } from '../agent/feedbackAnalyzer.js';

function safeJsonParse(val: string | null | undefined, fallback: any): any {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

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

  const scoreDistribution = db.prepare(
    `SELECT
       CASE
         WHEN fit_score >= 80 THEN '80-100'
         WHEN fit_score >= 60 THEN '60-79'
         WHEN fit_score >= 40 THEN '40-59'
         ELSE '0-39'
       END as range,
       COUNT(*) as total
     FROM leads
     GROUP BY range ORDER BY range DESC`
  ).all();

  res.json({ score_by_feedback: scoreByFeedback, score_ranges: scoreRanges, score_distribution: scoreDistribution });
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
      `INSERT INTO ai_recommendations (id, type, title, description, rationale, data_snapshot, action_data, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    );

    const tx = db.transaction(() => {
      for (const rec of recommendations) {
        insert.run(uuid(), rec.type, rec.title, rec.description, rec.rationale, JSON.stringify(snapshot), rec.action_data ? JSON.stringify(rec.action_data) : null);
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
  const rec = db.prepare('SELECT * FROM ai_recommendations WHERE id = ?').get(req.params.id) as any;
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });

  db.prepare(
    `UPDATE ai_recommendations SET status = ?, acted_at = datetime('now'), acted_by = ? WHERE id = ?`
  ).run(status, req.user!.id, req.params.id);

  const applied: string[] = [];

  if (status === 'accepted' && rec.action_data) {
    try {
      const actionData = JSON.parse(rec.action_data);

      if (rec.type === 'exclusion_suggestion' && actionData.companies?.length) {
        for (const comp of actionData.companies) {
          const existingExcl = db.prepare('SELECT id FROM exclusions WHERE company_name = ?').get(comp.company_name);
          if (!existingExcl) {
            const exclId = uuid();
            db.prepare(
              `INSERT INTO exclusions (id, company_name, domain, reason, category) VALUES (?, ?, ?, ?, 'disqualifying_criteria')`
            ).run(exclId, comp.company_name, comp.domain || null, comp.reason || rec.title);
            applied.push(`Excluded ${comp.company_name}`);
          }
        }
      }

      if (rec.type === 'icp_adjustment' && actionData.field && actionData.proposed != null) {
        const weights: any[] = getSetting('icp.signal_weights', []);
        const existing = weights.find((w: any) => w.signal === actionData.field);
        if (existing) {
          existing.weight = actionData.proposed;
        } else {
          weights.push({ signal: actionData.field, weight: actionData.proposed, category: 'ai_recommended' });
        }
        saveSetting('icp.signal_weights', weights, req.user!.id);
        applied.push(`Updated ICP weight: ${actionData.field} → ${actionData.proposed}`);
      }
    } catch (err) {
      console.error('[recommendations] Failed to apply action_data:', err);
    }
  }

  logActivity({
    userId: req.user!.id,
    entityType: 'setting',
    entityId: req.params.id,
    entityTitle: rec.title,
    action: status === 'accepted' ? 'updated' : 'deleted',
    changes: {
      status: { old: rec.status, new: status },
      ...(applied.length ? { applied_actions: { old: null, new: applied } } : {}),
    },
    snapshot: { type: rec.type, title: rec.title, description: rec.description, rationale: rec.rationale },
  });

  res.json({ success: true, applied });
});

// ── GET /cross-campaign — overlapping leads, conversion comparison ──
router.get('/cross-campaign', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();

  // Per-campaign conversion metrics
  const campaignMetrics = db.prepare(`
    SELECT c.id, c.name,
      COUNT(l.id) as total_leads,
      AVG(l.fit_score) as avg_score,
      SUM(CASE WHEN l.current_feedback IN ('good_fit_booked','good_fit_response','closed_won') THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN l.current_feedback IN ('bad_fit','closed_lost') THEN 1 ELSE 0 END) as negative,
      SUM(CASE WHEN l.current_feedback = 'closed_won' THEN 1 ELSE 0 END) as won,
      SUM(CASE WHEN l.current_feedback = 'closed_lost' THEN 1 ELSE 0 END) as lost,
      SUM(CASE WHEN l.current_feedback IS NOT NULL THEN 1 ELSE 0 END) as with_feedback
    FROM campaigns c
    LEFT JOIN leads l ON l.campaign_id = c.id
    WHERE c.status = 'active'
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all() as any[];

  const campaigns = campaignMetrics.map(c => ({
    id: c.id,
    name: c.name,
    total_leads: c.total_leads,
    avg_score: c.avg_score ? Math.round(c.avg_score) : null,
    positive: c.positive,
    negative: c.negative,
    won: c.won,
    lost: c.lost,
    win_rate: (c.won + c.lost) > 0 ? Math.round((c.won / (c.won + c.lost)) * 100) : null,
    feedback_rate: c.total_leads > 0 ? Math.round((c.with_feedback / c.total_leads) * 100) : 0,
  }));

  // Overlapping leads — companies appearing in multiple campaigns
  const overlaps = db.prepare(`
    SELECT domain, company_name, COUNT(DISTINCT campaign_id) as campaign_count,
      GROUP_CONCAT(DISTINCT campaign_id) as campaign_ids
    FROM leads
    WHERE domain IS NOT NULL AND campaign_id IS NOT NULL
    GROUP BY domain
    HAVING campaign_count > 1
    ORDER BY campaign_count DESC
    LIMIT 50
  `).all() as any[];

  const overlapDetails = overlaps.map(o => {
    const campaignIds = o.campaign_ids.split(',');
    const campaignNames = campaignIds.map((cid: string) => {
      const c = campaignMetrics.find(cm => cm.id === cid);
      return c?.name || cid;
    });
    return {
      domain: o.domain,
      company_name: o.company_name,
      campaign_count: o.campaign_count,
      campaigns: campaignNames,
    };
  });

  // Cost comparison (from pipeline_runs)
  const costByCampaign = db.prepare(`
    SELECT c.id, c.name,
      COUNT(pr.id) as run_count,
      SUM(pr.estimated_cost) as total_cost,
      SUM(pr.lead_count) as total_leads_generated,
      SUM(pr.input_tokens) as total_input_tokens,
      SUM(pr.output_tokens) as total_output_tokens
    FROM campaigns c
    LEFT JOIN pipeline_runs pr ON pr.campaign_id = c.id AND pr.status = 'completed'
    WHERE c.status = 'active'
    GROUP BY c.id
    ORDER BY total_cost DESC
  `).all() as any[];

  const costComparison = costByCampaign.map(c => ({
    ...c,
    cost_per_lead: c.total_leads_generated > 0
      ? Math.round((c.total_cost / c.total_leads_generated) * 100) / 100
      : null,
  }));

  res.json({ campaigns, overlapping_leads: overlapDetails, cost_comparison: costComparison });
});

// ── GET /customer-intel — aggregate customer knowledge ──────────
router.get('/customer-intel', authenticate, requirePermission('customers:read'), (_req: AuthRequest, res: Response) => {
  const db = getDb();

  const customers = db.prepare(
    'SELECT * FROM customer_profiles ORDER BY updated_at DESC'
  ).all() as any[];

  const parsed = customers.map(c => ({
    ...c,
    products_used: safeJsonParse(c.products_used, []),
    environment: safeJsonParse(c.environment, {}),
  }));

  // Aggregate characteristics
  const productCounts: Record<string, number> = {};
  const envKeys: Record<string, Record<string, number>> = {};
  const buyReasons: string[] = [];

  for (const c of parsed) {
    if (Array.isArray(c.products_used)) {
      for (const p of c.products_used) {
        productCounts[p] = (productCounts[p] || 0) + 1;
      }
    }
    if (c.environment && typeof c.environment === 'object') {
      for (const [key, val] of Object.entries(c.environment)) {
        if (!envKeys[key]) envKeys[key] = {};
        const v = String(val);
        envKeys[key][v] = (envKeys[key][v] || 0) + 1;
      }
    }
    if (c.why_they_bought) buyReasons.push(c.why_they_bought);
  }

  res.json({
    total_customers: customers.length,
    customers: parsed,
    aggregate: {
      product_usage: Object.entries(productCounts).sort((a, b) => b[1] - a[1]),
      environment_patterns: envKeys,
      buy_reasons: buyReasons.slice(0, 20),
    },
  });
});

// ── POST /customer-intel/analyze — AI analysis of customer patterns ──
router.post('/customer-intel/analyze', authenticate, requirePermission('customers:read'), async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const customers = db.prepare('SELECT * FROM customer_profiles').all() as any[];
  if (customers.length < 3) {
    return res.status(400).json({ error: 'Need at least 3 customer profiles for meaningful analysis' });
  }

  try {
    const { createAIClient, getAIConfig, resolveModel } = await import('../config/vertexConfig.js');

    const outcomes = db.prepare(`
      SELECT fod.*, lf.verdict, l.segment, l.fit_score, l.company_name, c.name as campaign_name
      FROM feedback_outcome_details fod
      JOIN lead_feedback lf ON lf.id = fod.feedback_id
      JOIN leads l ON l.id = fod.lead_id
      LEFT JOIN campaigns c ON c.id = fod.campaign_id
      WHERE lf.verdict IN ('closed_won', 'existing_customer')
    `).all() as any[];

    const icpConfig = db.prepare("SELECT value FROM app_settings WHERE key = 'icp_config'").get() as any;
    const icp = icpConfig ? safeJsonParse(icpConfig.value, null) : null;

    const productCounts: Record<string, number> = {};
    const segmentCounts: Record<string, number> = {};
    const channelCounts: Record<string, number> = {};
    const personaCounts: Record<string, number> = {};
    const dealValues: number[] = [];
    const buyReasons: string[] = [];

    for (const c of customers) {
      const products = safeJsonParse(c.products_used, []);
      for (const p of products) productCounts[p] = (productCounts[p] || 0) + 1;
      if (c.why_they_bought) buyReasons.push(c.why_they_bought);
      if (c.deal_value) {
        const num = parseFloat(c.deal_value.replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) dealValues.push(num);
      }
    }

    for (const o of outcomes) {
      if (o.segment) segmentCounts[o.segment] = (segmentCounts[o.segment] || 0) + 1;
      if (o.effective_channel) channelCounts[o.effective_channel] = (channelCounts[o.effective_channel] || 0) + 1;
      if (o.effective_persona) personaCounts[o.effective_persona] = (personaCounts[o.effective_persona] || 0) + 1;
    }

    const lines: string[] = [
      `Analyze ${customers.length} customer profiles for patterns, ICP validation, and actionable insights.`,
      '',
      `## Customer Profiles`,
      ...customers.map((c: any) => {
        const products = safeJsonParse(c.products_used, []);
        return `- ${c.company_name}${c.domain ? ` (${c.domain})` : ''}: products=[${products.join(',')}], deal=${c.deal_value || 'unknown'}, why="${c.why_they_bought || 'unknown'}"`;
      }),
      '',
      `## Aggregate Data`,
      `Products: ${Object.entries(productCounts).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}(${c})`).join(', ') || 'none'}`,
      `Segments: ${Object.entries(segmentCounts).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s}(${c})`).join(', ') || 'none'}`,
      `Channels: ${Object.entries(channelCounts).sort((a, b) => b[1] - a[1]).map(([ch, c]) => `${ch}(${c})`).join(', ') || 'none'}`,
      `Personas: ${Object.entries(personaCounts).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}(${c})`).join(', ') || 'none'}`,
      `Deal values: ${dealValues.length > 0 ? `avg=$${Math.round(dealValues.reduce((a, b) => a + b, 0) / dealValues.length).toLocaleString()}, range=$${Math.min(...dealValues).toLocaleString()}-$${Math.max(...dealValues).toLocaleString()}` : 'no data'}`,
      `Buy reasons: ${buyReasons.slice(0, 10).join('; ') || 'none'}`,
    ];

    if (icp) {
      lines.push('', `## Current ICP Config (for validation)`, JSON.stringify(icp).substring(0, 1000));
    }

    const systemPrompt = `You are a customer intelligence analyst for a B2B sales intelligence platform. Analyze customer profiles and generate actionable insights.

Return a JSON array of insight objects. Each must have:
- "insight_type": one of "icp_validation", "win_patterns", "segment_concentration", "product_affinity", "revenue_insights", or "composite"
- "title": concise title (under 80 chars)
- "summary": 1-2 sentence summary with specific numbers/percentages
- "details": object with supporting data and analysis
- "recommendations": array of objects with "action" (what to do) and "rationale" (why)
- "confidence": "low", "medium", or "high"

Generate insights across ALL these categories:
1. ICP Validation — compare won profiles against ICP config. Flag mismatches or underweighted signals.
2. Win Patterns — which channels, personas, and messaging angles work best? What's the winning formula?
3. Segment Concentration — where do most customers come from vs. where campaigns target? Are we fishing in the right pond?
4. Product Affinity — cross-sell patterns, product adoption sequences.
5. Revenue Insights — deal size patterns by segment, channel, persona. Where's the highest ACV?

Return ONLY a JSON array.`;

    const aiConfig = getAIConfig();
    const client = await createAIClient();

    const response = await client.messages.create({
      model: resolveModel(aiConfig.defaultModel, aiConfig.provider),
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: lines.join('\n') }],
    });

    const rawText = response.content.find((b: any) => b.type === 'text')?.text || '';
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : '[]';

    let rawInsights: any[];
    try {
      rawInsights = JSON.parse(jsonStr);
      if (!Array.isArray(rawInsights)) rawInsights = [rawInsights];
    } catch {
      console.error('[analytics] Failed to parse customer analysis:', rawText.substring(0, 500));
      return res.status(500).json({ error: 'Failed to parse AI analysis' });
    }

    const validTypes = ['icp_validation', 'win_patterns', 'segment_concentration', 'product_affinity', 'revenue_insights', 'composite'];

    // Store in campaign_insights with campaign_id = '__customer_intel__'
    db.prepare(
      `UPDATE campaign_insights SET status = 'stale' WHERE campaign_id = '__customer_intel__' AND status = 'active'`
    ).run();

    const insertStmt = db.prepare(
      `INSERT INTO campaign_insights (id, campaign_id, insight_type, title, summary, details, recommendations, data_snapshot, feedback_count, confidence)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );

    const insights: any[] = [];
    for (const raw of rawInsights) {
      if (!raw.title || !raw.summary) continue;
      const insightType = validTypes.includes(raw.insight_type) ? raw.insight_type : 'composite';
      const confidence = ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium';
      const id = uuid();

      insertStmt.run(
        id, '__customer_intel__', insightType,
        String(raw.title).substring(0, 200), String(raw.summary),
        JSON.stringify(raw.details || {}),
        raw.recommendations ? JSON.stringify(raw.recommendations) : null,
        JSON.stringify({ customerCount: customers.length, productCounts, segmentCounts }),
        customers.length, confidence,
      );

      insights.push({
        id, campaign_id: '__customer_intel__', insight_type: insightType,
        title: raw.title, summary: raw.summary, details: raw.details || {},
        recommendations: raw.recommendations || [], confidence,
        status: 'active', created_at: new Date().toISOString(),
      });
    }

    res.json({ insights, count: insights.length });
  } catch (err) {
    console.error('[analytics] Customer analysis failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed' });
  }
});

// GET /customer-intel/insights — fetch stored customer insights
router.get('/customer-intel/insights', authenticate, requirePermission('customers:read'), (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const { status } = _req.query;

  let sql = "SELECT * FROM campaign_insights WHERE campaign_id = '__customer_intel__'";
  const params: any[] = [];

  if (status && typeof status === 'string') {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params) as any[];
  const insights = rows.map(row => ({
    ...row,
    details: safeJsonParse(row.details, {}),
    recommendations: safeJsonParse(row.recommendations, null),
    data_snapshot: safeJsonParse(row.data_snapshot, null),
  }));

  res.json(insights);
});

// PATCH /customer-intel/insights/:id — apply/dismiss customer insight
router.patch('/customer-intel/insights/:id', authenticate, requirePermission('customers:read'), (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  if (!['applied', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be applied or dismissed' });
  }

  const db = getDb();
  const insight = db.prepare("SELECT * FROM campaign_insights WHERE id = ? AND campaign_id = '__customer_intel__'").get(req.params.id) as any;
  if (!insight) return res.status(404).json({ error: 'Insight not found' });

  db.prepare(
    `UPDATE campaign_insights SET status = ?, applied_at = datetime('now'), applied_by = ? WHERE id = ?`
  ).run(status, req.user!.id, req.params.id);

  res.json({ success: true });
});

// ── GET /global-insights — ICP refinement suggestions ────────
router.get('/global-insights', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const { status } = _req.query;

  let sql = "SELECT * FROM campaign_insights WHERE campaign_id = '__global__'";
  const params: any[] = [];

  if (status && typeof status === 'string') {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params) as any[];
  const insights = rows.map(row => ({
    ...row,
    details: safeJsonParse(row.details, {}),
    recommendations: safeJsonParse(row.recommendations, null),
    data_snapshot: safeJsonParse(row.data_snapshot, null),
  }));

  res.json(insights);
});

router.post('/global-insights/analyze', authenticate, requireMember, async (_req: AuthRequest, res: Response) => {
  try {
    const insights = await analyzeGlobalPatterns();
    res.json({ insights, count: insights.length });
  } catch (err) {
    console.error('[analytics] Global analysis failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed' });
  }
});

// ── PATCH /global-insights/:id — apply/dismiss ────────────────
router.patch('/global-insights/:id', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  if (!['applied', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be applied or dismissed' });
  }

  const db = getDb();
  const insight = db.prepare('SELECT * FROM campaign_insights WHERE id = ?').get(req.params.id) as any;
  if (!insight) return res.status(404).json({ error: 'Insight not found' });

  db.prepare(
    `UPDATE campaign_insights SET status = ?, applied_at = datetime('now'), applied_by = ? WHERE id = ?`
  ).run(status, req.user!.id, req.params.id);

  logActivity({
    userId: req.user!.id,
    entityType: 'setting',
    entityId: req.params.id,
    entityTitle: insight.title,
    action: status === 'applied' ? 'updated' : 'deleted',
    changes: { status: { old: insight.status, new: status } },
    snapshot: { type: insight.insight_type, title: insight.title, summary: insight.summary },
  });

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
