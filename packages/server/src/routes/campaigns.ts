import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireOperator, requireMember, AuthRequest } from '../auth/middleware.js';
import { runCampaign } from '../agent/campaignOrchestrator.js';
import { getSetting, getDefaultPipelineConfig, getDefaultPromptConfig, getDefaultExcludedDomainPatterns, getDefaultFunnelConfig } from './icp.js';
import { registerCampaignCron, unregisterCampaignCron } from '../scheduler/campaignScheduler.js';
import { logActivity, computeChanges } from '../services/activityLog.js';
import { sendTestNotification } from '../services/notificationDispatcher.js';
import { analyzeCampaignFeedback } from '../agent/feedbackAnalyzer.js';
import type { CampaignParsed, CampaignExclusionConfig, Exclusion, CampaignInsight } from '../types/index.js';

const router = Router();

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
    notification_destinations: JSON.parse(row.notification_destinations || '[]'),
    notification_base_url: row.notification_base_url || null,
  };
}

// List active campaigns
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const campaigns = db.prepare(
    "SELECT * FROM campaigns WHERE status = 'active' ORDER BY created_at DESC"
  ).all();

  // Attach stats to each campaign
  const withStats = campaigns.map((c: any) => {
    const parsed = parseCampaignRow(c);
    const leadCount = db.prepare(
      'SELECT COUNT(*) as count FROM leads WHERE campaign_id = ?'
    ).get(c.id) as { count: number };
    const lastRun = db.prepare(
      "SELECT * FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(c.id) as any;
    const avgScore = db.prepare(
      'SELECT AVG(fit_score) as avg FROM leads WHERE campaign_id = ?'
    ).get(c.id) as { avg: number | null };
    const runCount = db.prepare(
      'SELECT COUNT(*) as count FROM pipeline_runs WHERE campaign_id = ?'
    ).get(c.id) as { count: number };

    return {
      ...parsed,
      lead_count: leadCount.count,
      avg_score: avgScore.avg ? Math.round(avgScore.avg) : null,
      last_run: lastRun || null,
      run_count: runCount.count,
      last_run_cost: lastRun?.estimated_cost || null,
    };
  });

  res.json(withStats);
});

// Campaign detail
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const parsed = parseCampaignRow(campaign);

  const leadCount = db.prepare(
    'SELECT COUNT(*) as count FROM leads WHERE campaign_id = ?'
  ).get(req.params.id) as { count: number };

  const avgScore = db.prepare(
    'SELECT AVG(fit_score) as avg FROM leads WHERE campaign_id = ?'
  ).get(req.params.id) as { avg: number | null };

  const runs = db.prepare(
    'SELECT * FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 10'
  ).all(req.params.id);

  const leads = db.prepare(
    'SELECT id, run_id, company_name, segment, fit_score, fit_score_label, confidence, employee_count, hq_location, created_at FROM leads WHERE campaign_id = ? ORDER BY fit_score DESC'
  ).all(req.params.id);

  res.json({
    ...parsed,
    lead_count: leadCount.count,
    avg_score: avgScore.avg ? Math.round(avgScore.avg) : null,
    runs,
    leads,
  });
});

// Create campaign
router.post('/', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const body = req.body;
  const id = uuid();
  const db = getDb();

  db.prepare(
    `INSERT INTO campaigns (id, name, description, pattern_thesis, example_companies, target_signals, anti_patterns, target_categories, search_patterns, value_prop_angle, target_count, icp_overrides, pipeline_overrides, prompt_overrides, source_overrides, schedule_cron, schedule_enabled, exclusion_config, rss_enabled, funnel_config, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    body.name,
    body.description || null,
    body.pattern_thesis,
    JSON.stringify(body.example_companies || []),
    JSON.stringify(body.target_signals || []),
    JSON.stringify(body.anti_patterns || []),
    JSON.stringify(body.target_categories || []),
    JSON.stringify(body.search_patterns || []),
    body.value_prop_angle || null,
    body.target_count || 12,
    body.icp_overrides ? JSON.stringify(body.icp_overrides) : null,
    body.pipeline_overrides ? JSON.stringify(body.pipeline_overrides) : null,
    body.prompt_overrides ? JSON.stringify(body.prompt_overrides) : null,
    body.source_overrides ? JSON.stringify(body.source_overrides) : null,
    body.schedule_cron || null,
    body.schedule_enabled ? 1 : 0,
    body.exclusion_config ? JSON.stringify(body.exclusion_config) : null,
    body.rss_enabled ? 1 : 0,
    body.funnel_config ? JSON.stringify(body.funnel_config) : JSON.stringify(getDefaultFunnelConfig()),
    req.user!.id,
  );

  db.pragma('wal_checkpoint(TRUNCATE)');

  const created = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as any;

  logActivity({
    userId: req.user!.id,
    entityType: 'campaign',
    entityId: id,
    entityTitle: body.name,
    action: 'created',
    snapshot: created,
  });

  res.status(201).json(parseCampaignRow(created));
});

// Update campaign
router.put('/:id', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Campaign not found' });

  const body = req.body;
  db.prepare(
    `UPDATE campaigns SET
      name = ?, description = ?, pattern_thesis = ?, example_companies = ?,
      target_signals = ?, anti_patterns = ?, target_categories = ?, search_patterns = ?,
      value_prop_angle = ?, target_count = ?,
      icp_overrides = ?, pipeline_overrides = ?, prompt_overrides = ?, source_overrides = ?,
      schedule_cron = ?, schedule_enabled = ?, exclusion_config = ?, rss_enabled = ?,
      funnel_config = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    body.name,
    body.description || null,
    body.pattern_thesis,
    JSON.stringify(body.example_companies || []),
    JSON.stringify(body.target_signals || []),
    JSON.stringify(body.anti_patterns || []),
    JSON.stringify(body.target_categories || []),
    JSON.stringify(body.search_patterns || []),
    body.value_prop_angle || null,
    body.target_count || 12,
    body.icp_overrides ? JSON.stringify(body.icp_overrides) : null,
    body.pipeline_overrides ? JSON.stringify(body.pipeline_overrides) : null,
    body.prompt_overrides ? JSON.stringify(body.prompt_overrides) : null,
    body.source_overrides ? JSON.stringify(body.source_overrides) : null,
    body.schedule_cron || null,
    body.schedule_enabled ? 1 : 0,
    body.exclusion_config ? JSON.stringify(body.exclusion_config) : null,
    body.rss_enabled ? 1 : 0,
    body.funnel_config ? JSON.stringify(body.funnel_config) : null,
    req.params.id,
  );

  db.pragma('wal_checkpoint(TRUNCATE)');

  const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;

  const changes = computeChanges(existing, updated);
  if (changes) {
    logActivity({
      userId: req.user!.id,
      entityType: 'campaign',
      entityId: req.params.id,
      entityTitle: updated.name,
      action: 'updated',
      changes,
      snapshot: existing,
    });
  }

  res.json(parseCampaignRow(updated));
});

// Archive campaign (soft delete)
router.delete('/:id', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;
  db.prepare("UPDATE campaigns SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  if (existing) {
    logActivity({
      userId: req.user!.id,
      entityType: 'campaign',
      entityId: req.params.id,
      entityTitle: existing.name,
      action: 'deleted',
      snapshot: existing,
    });
  }

  res.json({ success: true });
});

// Get merged campaign config (global defaults + campaign overrides)
router.get('/:id/config', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const parsed = parseCampaignRow(campaign);
  const globalPipeline = getSetting('pipeline', getDefaultPipelineConfig());
  const globalPrompts = getSetting('prompts', getDefaultPromptConfig());

  // Deep merge: campaign overrides win
  const mergedPipeline = { ...globalPipeline, ...(parsed.pipeline_overrides || {}) };
  const mergedPrompts = { ...globalPrompts, ...(parsed.prompt_overrides || {}) };

  // Full org ICP (core + extended) for campaign UI
  const icpRow = db.prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 1').get() as any;
  const icpBase = icpRow ? {
    verticals: JSON.parse(icpRow.verticals),
    tech_signals: JSON.parse(icpRow.tech_signals),
    competitors: JSON.parse(icpRow.competitors),
  } : { verticals: [], tech_signals: [], competitors: [] };
  const orgICP = {
    ...icpBase,
    company_context: getSetting('icp.company_context', {}),
    disqualifiers: getSetting('icp.disqualifiers', []),
    signal_weights: getSetting('icp.signal_weights', []),
    buyer_personas: getSetting('icp.buyer_personas', {}),
    geographies: getSetting('icp.geographies', {}),
    segment_details: getSetting('icp.segment_details', {}),
    excluded_domain_patterns: getSetting('icp.excluded_domain_patterns', getDefaultExcludedDomainPatterns()),
  };

  res.json({
    icp_overrides: parsed.icp_overrides,
    org_icp: orgICP,
    pipeline: mergedPipeline,
    prompts: mergedPrompts,
    source_overrides: parsed.source_overrides,
    schedule_cron: parsed.schedule_cron,
    schedule_enabled: parsed.schedule_enabled,
    schedule_timezone: parsed.schedule_timezone,
    exclusion_config: parsed.exclusion_config,
    rss_enabled: parsed.rss_enabled,
    funnel_config: parsed.funnel_config,
    notification_destinations: parsed.notification_destinations,
    notification_base_url: parsed.notification_base_url,
  });
});

// Save campaign config overrides
router.put('/:id/config', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Campaign not found' });

  const body = req.body;
  db.prepare(
    `UPDATE campaigns SET
      icp_overrides = ?, pipeline_overrides = ?, prompt_overrides = ?,
      source_overrides = ?, schedule_cron = ?, schedule_enabled = ?,
      schedule_timezone = ?,
      exclusion_config = ?, rss_enabled = ?, funnel_config = ?,
      notification_destinations = ?, notification_base_url = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    body.icp_overrides ? JSON.stringify(body.icp_overrides) : null,
    body.pipeline_overrides ? JSON.stringify(body.pipeline_overrides) : null,
    body.prompt_overrides ? JSON.stringify(body.prompt_overrides) : null,
    body.source_overrides ? JSON.stringify(body.source_overrides) : null,
    body.schedule_cron || null,
    body.schedule_enabled ? 1 : 0,
    body.schedule_timezone || null,
    body.exclusion_config ? JSON.stringify(body.exclusion_config) : null,
    body.rss_enabled ? 1 : 0,
    body.funnel_config ? JSON.stringify(body.funnel_config) : null,
    JSON.stringify(body.notification_destinations || []),
    body.notification_base_url || null,
    req.params.id,
  );

  db.pragma('wal_checkpoint(TRUNCATE)');

  const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;

  const changes = computeChanges(existing, updated);
  if (changes) {
    logActivity({
      userId: req.user!.id,
      entityType: 'campaign',
      entityId: req.params.id,
      entityTitle: updated.name,
      action: 'updated',
      changes,
      snapshot: existing,
    });
  }

  // Update campaign scheduler when schedule changes
  if (body.schedule_enabled && body.schedule_cron) {
    registerCampaignCron(req.params.id, updated?.name || '', body.schedule_cron, body.schedule_timezone || undefined);
  } else {
    unregisterCampaignCron(req.params.id);
  }

  res.json({ success: true });
});

// Get campaign exclusions (merged: global + campaign additions - campaign exemptions)
router.get('/:id/exclusions', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const globalExclusions = db.prepare('SELECT * FROM exclusions ORDER BY company_name').all() as Exclusion[];
  const config: CampaignExclusionConfig | null = campaign.exclusion_config
    ? JSON.parse(campaign.exclusion_config)
    : null;

  if (!config) {
    return res.json({ exclusions: globalExclusions, additions: [], exemptions: [], source: 'global_only' });
  }

  const exemptSet = new Set(config.exemptions || []);
  const filtered = globalExclusions.filter(e => !exemptSet.has(e.id));
  const additions = (config.additions || []).map((a, i) => ({
    id: `campaign_add_${i}`,
    ...a,
    source: 'campaign',
  }));

  res.json({
    exclusions: [...filtered, ...additions],
    global_count: globalExclusions.length,
    exempt_count: exemptSet.size,
    addition_count: additions.length,
    source: 'merged',
  });
});

// ── GET /:id/analytics — Campaign-specific analytics ─────────
router.get('/:id/analytics', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const cid = req.params.id;

  // Score trends: avg score per run over time
  const scoreTrends = db.prepare(
    `SELECT pr.id as run_id, pr.created_at, pr.lead_count,
            pr.estimated_cost, pr.input_tokens, pr.output_tokens,
            AVG(l.fit_score) as avg_score,
            MIN(l.fit_score) as min_score,
            MAX(l.fit_score) as max_score,
            COUNT(l.id) as lead_count_actual
     FROM pipeline_runs pr
     LEFT JOIN leads l ON l.run_id = pr.id
     WHERE pr.campaign_id = ? AND pr.status = 'completed'
     GROUP BY pr.id
     ORDER BY pr.created_at ASC`
  ).all(cid) as any[];

  // Feedback conversion: how leads with feedback performed
  const feedbackStats = db.prepare(
    `SELECT
       COUNT(*) as total_leads,
       SUM(CASE WHEN current_feedback IS NOT NULL THEN 1 ELSE 0 END) as with_feedback,
       SUM(CASE WHEN current_feedback IN ('good_fit_response','good_fit_booked') THEN 1 ELSE 0 END) as positive_outcomes,
       SUM(CASE WHEN current_feedback = 'good_fit_booked' THEN 1 ELSE 0 END) as booked,
       SUM(CASE WHEN current_feedback = 'bad_fit' THEN 1 ELSE 0 END) as bad_fit,
       AVG(fit_score) as avg_score,
       AVG(CASE WHEN current_feedback IN ('good_fit_response','good_fit_booked') THEN fit_score END) as avg_score_positive,
       AVG(CASE WHEN current_feedback = 'bad_fit' THEN fit_score END) as avg_score_bad
     FROM leads WHERE campaign_id = ?`
  ).get(cid) as any;

  // Cost per lead
  const costData = db.prepare(
    `SELECT
       SUM(estimated_cost) as total_cost,
       SUM(lead_count) as total_leads,
       SUM(input_tokens) as total_input_tokens,
       SUM(output_tokens) as total_output_tokens
     FROM pipeline_runs WHERE campaign_id = ? AND status = 'completed'`
  ).get(cid) as any;

  const costPerLead = costData.total_leads > 0
    ? Math.round((costData.total_cost / costData.total_leads) * 100) / 100
    : 0;

  // Score distribution buckets
  const scoreDistribution = db.prepare(
    `SELECT
       CASE
         WHEN fit_score >= 80 THEN '80-100'
         WHEN fit_score >= 60 THEN '60-79'
         WHEN fit_score >= 40 THEN '40-59'
         WHEN fit_score >= 20 THEN '20-39'
         ELSE '0-19'
       END as bucket,
       COUNT(*) as count
     FROM leads WHERE campaign_id = ?
     GROUP BY bucket
     ORDER BY bucket DESC`
  ).all(cid);

  // Health indicator: compare last 3 runs avg score vs prior 3
  const recentRuns = scoreTrends.slice(-3);
  const priorRuns = scoreTrends.slice(-6, -3);
  const recentAvg = recentRuns.length > 0
    ? recentRuns.reduce((s: number, r: any) => s + (r.avg_score || 0), 0) / recentRuns.length
    : 0;
  const priorAvg = priorRuns.length > 0
    ? priorRuns.reduce((s: number, r: any) => s + (r.avg_score || 0), 0) / priorRuns.length
    : 0;

  let health: 'trending_up' | 'trending_down' | 'stable' | 'insufficient_data' = 'insufficient_data';
  if (scoreTrends.length >= 4) {
    const diff = recentAvg - priorAvg;
    if (diff > 5) health = 'trending_up';
    else if (diff < -5) health = 'trending_down';
    else health = 'stable';
  }

  res.json({
    score_trends: scoreTrends.map(r => ({
      run_id: r.run_id,
      date: r.created_at,
      avg_score: Math.round(r.avg_score || 0),
      min_score: r.min_score || 0,
      max_score: r.max_score || 0,
      lead_count: r.lead_count_actual,
      cost: Math.round((r.estimated_cost || 0) * 100) / 100,
    })),
    feedback: {
      total_leads: feedbackStats.total_leads || 0,
      with_feedback: feedbackStats.with_feedback || 0,
      feedback_rate: feedbackStats.total_leads > 0
        ? Math.round((feedbackStats.with_feedback / feedbackStats.total_leads) * 100)
        : 0,
      positive_outcomes: feedbackStats.positive_outcomes || 0,
      booked: feedbackStats.booked || 0,
      bad_fit: feedbackStats.bad_fit || 0,
      conversion_rate: feedbackStats.with_feedback > 0
        ? Math.round((feedbackStats.positive_outcomes / feedbackStats.with_feedback) * 100)
        : 0,
      avg_score_positive: Math.round(feedbackStats.avg_score_positive || 0),
      avg_score_bad: Math.round(feedbackStats.avg_score_bad || 0),
    },
    cost: {
      total_cost: Math.round((costData.total_cost || 0) * 100) / 100,
      total_leads: costData.total_leads || 0,
      cost_per_lead: costPerLead,
      total_tokens: (costData.total_input_tokens || 0) + (costData.total_output_tokens || 0),
    },
    score_distribution: scoreDistribution,
    health,
  });
});

// Campaign templates (both paths for backward compat)
const templatesList = (_req: AuthRequest, res: Response) => {
  res.json([
    {
      id: 'byoc',
      name: 'BYOC Partners',
      description: 'SaaS companies deploying into customer environments',
      icon: 'server',
    },
    {
      id: 'dspm',
      name: 'DSPM & Data Security',
      description: 'Data security posture management companies',
      icon: 'shield',
    },
    {
      id: 'gaming',
      name: 'Gaming Verticals',
      description: 'Game studios and gaming infrastructure companies',
      icon: 'gamepad',
    },
    {
      id: 'general',
      name: 'General Research',
      description: 'Broad pattern-based research with custom criteria',
      icon: 'search',
    },
  ]);
};
router.get('/templates', authenticate, templatesList);
router.get('/templates/list', authenticate, templatesList);

// RSS feed for campaign — run-level summaries optimized for Slack
router.get('/:id/rss', async (req, res: Response) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) as any;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const destinations = JSON.parse(campaign.notification_destinations || '[]');
  const rssDest = destinations.find((d: any) => d.type === 'rss' && d.enabled);
  // Backward compat: also check legacy rss_enabled column
  if (!rssDest && !campaign.rss_enabled) return res.status(403).json({ error: 'RSS feed not enabled for this campaign' });

  const runs = db.prepare(
    'SELECT id, status, lead_count, started_at, completed_at, error_message FROM pipeline_runs WHERE campaign_id = ? ORDER BY started_at DESC LIMIT 20'
  ).all(req.params.id) as any[];

  const configuredBaseUrl = campaign.notification_base_url;
  const baseUrl = (configuredBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  const statusEmoji: Record<string, string> = {
    completed: '✅', failed: '❌', cancelled: '🚫', missed: '⏰', running: '🔄',
  };

  const items = runs.map(run => {
    const emoji = statusEmoji[run.status] || '❓';
    const date = run.completed_at || run.started_at || '';
    const pubDate = date ? new Date(date + 'Z').toUTCString() : new Date().toUTCString();
    const dateLabel = date.slice(0, 10);

    let title = '';
    let description = '';

    if (run.status === 'completed') {
      const leads = db.prepare(
        'SELECT id, company_name, employee_count, fit_score, fit_score_label, segment, why_now, pain_hypotheses, competitive_displacement, outreach_strategy FROM leads WHERE run_id = ? ORDER BY fit_score DESC'
      ).all(run.id) as any[];
      const topLeads = leads.slice(0, Math.max(3, Math.min(5, leads.length)));
      const avgScore = leads.length > 0 ? Math.round(leads.reduce((s: number, l: any) => s + l.fit_score, 0) / leads.length) : 0;
      const segments = leads.reduce((acc: Record<string, number>, l: any) => { acc[l.segment] = (acc[l.segment] || 0) + 1; return acc; }, {} as Record<string, number>);
      const segmentSummary = Object.entries(segments).map(([s, c]) => `${c} ${s}`).join(', ');

      title = `${emoji} Campaign "${campaign.name}" — ${run.lead_count} new leads (${dateLabel})`;
      const leadDetails = topLeads.map((l: any) => {
        const whyNow = safeJsonParse(l.why_now, []);
        const pains = safeJsonParse(l.pain_hypotheses, []);
        const competitive = safeJsonParse(l.competitive_displacement, {});
        const outreach = safeJsonParse(l.outreach_strategy, {});
        const signalCount = whyNow.length + pains.length;
        const stars = scoreToStars(l.fit_score);
        const topSignal = whyNow[0] || '';
        const pitch = outreach.one_line_pitch || '';
        const displaces = (competitive.likely_current || []).filter(Boolean).join(', ');
        const empLabel = l.employee_count ? `${l.employee_count.toLocaleString()} emp` : '';

        let detail = `${stars} ${l.company_name} (${l.segment}${empLabel ? ', ' + empLabel : ''}) · ${signalCount} signals`;
        if (topSignal) detail += `\nWhy now: ${topSignal}`;
        if (pitch) detail += `\nAngle: ${pitch}`;
        if (displaces) detail += `\nDisplaces: ${displaces}`;
        return detail;
      }).join('\n\n');

      const remaining = leads.length - topLeads.length;
      description = `Avg ${scoreToStars(avgScore)} | ${segmentSummary}\n\n${leadDetails}${remaining > 0 ? `\n\n+ ${remaining} more → ${baseUrl}/campaigns/${campaign.id}` : ''}`;
    } else if (run.status === 'failed') {
      title = `${emoji} Run failed — ${dateLabel}`;
      description = run.error_message || 'Pipeline run failed. Check the dashboard for details.';
    } else if (run.status === 'cancelled') {
      title = `${emoji} Run cancelled — ${dateLabel}`;
      description = 'Pipeline run was manually cancelled.';
    } else if (run.status === 'missed') {
      title = `${emoji} Scheduled run missed — ${dateLabel}`;
      description = 'Scheduled run did not fire. The server may have been offline during the scheduled window.';
    } else {
      title = `${emoji} Run ${run.status} — ${dateLabel}`;
      description = `Pipeline run is ${run.status}.`;
    }

    return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${baseUrl}/campaigns/${campaign.id}</link>
      <description>${escapeXml(description)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${escapeXml(run.id)}</guid>
    </item>`;
  }).join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SignalStack: ${escapeXml(campaign.name)}</title>
    <description>${escapeXml(campaign.description || campaign.pattern_thesis || '')}</description>
    <link>${baseUrl}/campaigns/${campaign.id}</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <ttl>60</ttl>
${items}
  </channel>
</rss>`;

  res.type('application/rss+xml').send(rss);
});

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreToStars(score: number): string {
  if (score >= 90) return '★★★★★';
  if (score >= 75) return '★★★★';
  if (score >= 60) return '★★★';
  if (score >= 40) return '★★';
  return '★';
}

function safeJsonParse(val: string | null, fallback: any): any {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// Test notification destination
router.post('/:id/test-notification', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const { destination_id } = req.body;
  if (!destination_id) return res.status(400).json({ ok: false, error: 'destination_id required' });
  const result = await sendTestNotification(req.params.id, destination_id);
  res.json(result);
});

// Trigger campaign run
router.post('/:id/run', authenticate, requireMember, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ? AND status = 'active'").get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found or archived' });

  const activeRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status IN ('pending','running') LIMIT 1"
  ).get(req.params.id);
  if (activeRun) return res.status(409).json({ error: 'A campaign run is already in progress' });

  // Accept optional steps to run individually
  const validStepIds = new Set(['discover', 'qualify', 'enrich', 'score', 'brief', 'audit']);
  const rawSteps = req.body?.steps;
  let requestedSteps: string[] | undefined = Array.isArray(rawSteps)
    ? rawSteps.filter((s: any) => typeof s === 'string' && validStepIds.has(s))
    : undefined;

  // Accept optional lead_ids for targeted stage reruns
  let targetLeadIds: string[] | undefined;
  const rawLeadIds = req.body?.lead_ids;
  if (Array.isArray(rawLeadIds) && rawLeadIds.length > 0) {
    const validLeadIds = rawLeadIds.filter((id: any) => typeof id === 'string');
    if (validLeadIds.length > 0) {
      const placeholders = validLeadIds.map(() => '?').join(',');
      const validCount = (db.prepare(
        `SELECT COUNT(*) as c FROM leads WHERE campaign_id = ? AND id IN (${placeholders})`
      ).get(req.params.id, ...validLeadIds) as any).c;
      if (validCount !== validLeadIds.length) {
        return res.status(400).json({ error: `Some lead IDs do not belong to this campaign` });
      }
      targetLeadIds = validLeadIds;
    }
    if (requestedSteps?.includes('discover')) {
      return res.status(400).json({ error: 'Cannot run discover step with specific lead IDs' });
    }
    if (!requestedSteps?.length) {
      requestedSteps = ['enrich', 'score', 'brief', 'audit'];
    }
  }

  // runCampaign inserts the pipeline_runs record synchronously, then does async AI work
  const runType = targetLeadIds?.length ? 'stage_rerun' : undefined;
  const runPromise = runCampaign(req.params.id, req.user!.id, requestedSteps, targetLeadIds, runType);
  runPromise.catch(err => {
    console.error('Campaign run failed:', err);
  });

  // Wait a tick for the synchronous DB insert to complete, then read the run_id
  await new Promise(resolve => setTimeout(resolve, 50));
  const newRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(req.params.id) as any;

  res.json({
    message: targetLeadIds ? 'Stage rerun triggered' : 'Campaign run triggered',
    status: 'running',
    run_id: newRun?.id || null,
    targeted_leads: targetLeadIds?.length || 0,
  });
});

// ── Campaign Insights ───────────────────────────────────────────

router.get('/:id/insights', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { status, type } = req.query;

  let sql = 'SELECT * FROM campaign_insights WHERE campaign_id = ?';
  const params: any[] = [req.params.id];

  if (status && typeof status === 'string') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (type && typeof type === 'string') {
    sql += ' AND insight_type = ?';
    params.push(type);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params) as any[];
  const insights: CampaignInsight[] = rows.map(row => ({
    ...row,
    details: safeJsonParse(row.details, {}),
    recommendations: safeJsonParse(row.recommendations, null),
    data_snapshot: safeJsonParse(row.data_snapshot, null),
  }));

  res.json(insights);
});

router.post('/:id/analyze', authenticate, requireMember, async (req: AuthRequest, res: Response) => {
  try {
    const insights = await analyzeCampaignFeedback(req.params.id);
    res.json({ insights, count: insights.length });
  } catch (err) {
    console.error('[campaigns] Analysis failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed' });
  }
});

router.patch('/:id/insights/:insightId', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const { status } = req.body;

  if (!status || !['applied', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'status must be "applied" or "dismissed"' });
  }

  const insight = db.prepare(
    'SELECT * FROM campaign_insights WHERE id = ? AND campaign_id = ?'
  ).get(req.params.insightId, req.params.id) as any;

  if (!insight) return res.status(404).json({ error: 'Insight not found' });

  if (status === 'applied') {
    db.prepare(
      `UPDATE campaign_insights SET status = 'applied', applied_at = datetime('now'), applied_by = ? WHERE id = ?`
    ).run(req.user!.id, req.params.insightId);

    const ALLOWED_ICP_FIELDS = new Set([
      'min_employees', 'max_employees', 'target_industries', 'exclude_industries',
      'target_regions', 'tech_signals', 'anti_patterns', 'target_categories',
      'min_score', 'segment', 'verticals',
    ]);
    const recommendations = safeJsonParse(insight.recommendations, []);
    const configUpdates: Record<string, any> = {};
    for (const rec of recommendations) {
      if (rec.field && rec.value !== undefined && ALLOWED_ICP_FIELDS.has(rec.field)) {
        configUpdates[rec.field] = rec.value;
      }
    }

    if (Object.keys(configUpdates).length > 0) {
      const campaign = db.prepare('SELECT icp_overrides FROM campaigns WHERE id = ?').get(req.params.id) as any;
      const existing = safeJsonParse(campaign?.icp_overrides, {});
      const merged = { ...existing, ...configUpdates };
      db.prepare('UPDATE campaigns SET icp_overrides = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(JSON.stringify(merged), req.params.id);
    }
  } else {
    db.prepare(
      `UPDATE campaign_insights SET status = 'dismissed' WHERE id = ?`
    ).run(req.params.insightId);
  }

  res.json({ success: true, status });
});

export default router;
