import { v4 as uuid } from 'uuid';
import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { getDb } from '../db/schema.js';
import type { CampaignInsight, InsightType } from '../types/index.js';

const MIN_FEEDBACK_FOR_ANALYSIS = 5;

interface FeedbackRow {
  verdict: string;
  reason: string | null;
  fit_score: number;
  segment: string | null;
  company_name: string;
  lead_status: string | null;
  created_at: string;
  effective_persona: string | null;
  effective_channel: string | null;
  effective_angle: string | null;
  competitor_lost_to: string | null;
  loss_reason: string | null;
  bad_fit_reasons: string | null;
  why_they_bought: string | null;
  deal_value: string | null;
  sales_cycle_days: number | null;
  stalled_stage: string | null;
}

interface AnalysisDataSnapshot {
  feedbackCount: number;
  verdictDistribution: Record<string, number>;
  segmentPerformance: Record<string, { positive: number; negative: number; total: number }>;
  scoreCorrelation: { positiveAvg: number; negativeAvg: number; gap: number } | null;
  personaEffectiveness: Record<string, number>;
  channelEffectiveness: Record<string, number>;
  competitorLosses: Record<string, number>;
  badFitReasons: Record<string, number>;
  effectiveAngles: string[];
  whyTheyBought: string[];
  winRate: { won: number; lost: number; rate: number } | null;
  salesCycleDays: number[];
  stalledStages: Record<string, number>;
}

function buildDataSnapshot(rows: FeedbackRow[]): AnalysisDataSnapshot {
  const positiveVerdicts = ['good_fit_booked', 'good_fit_response', 'closed_won'];
  const negativeVerdicts = ['bad_fit', 'closed_lost'];

  const verdictDistribution: Record<string, number> = {};
  const segmentPerformance: Record<string, { positive: number; negative: number; total: number }> = {};
  const personaEffectiveness: Record<string, number> = {};
  const channelEffectiveness: Record<string, number> = {};
  const competitorLosses: Record<string, number> = {};
  const badFitReasons: Record<string, number> = {};
  const effectiveAngles: string[] = [];
  const whyTheyBought: string[] = [];
  const salesCycleDays: number[] = [];
  const stalledStages: Record<string, number> = {};

  const positiveScores: number[] = [];
  const negativeScores: number[] = [];
  let won = 0;
  let lost = 0;

  for (const row of rows) {
    verdictDistribution[row.verdict] = (verdictDistribution[row.verdict] || 0) + 1;

    if (row.segment) {
      if (!segmentPerformance[row.segment]) segmentPerformance[row.segment] = { positive: 0, negative: 0, total: 0 };
      segmentPerformance[row.segment].total++;
      if (positiveVerdicts.includes(row.verdict)) segmentPerformance[row.segment].positive++;
      if (negativeVerdicts.includes(row.verdict)) segmentPerformance[row.segment].negative++;
    }

    if (positiveVerdicts.includes(row.verdict) && row.fit_score) positiveScores.push(row.fit_score);
    if (negativeVerdicts.includes(row.verdict) && row.fit_score) negativeScores.push(row.fit_score);

    if (row.verdict === 'closed_won') won++;
    if (row.verdict === 'closed_lost') lost++;

    if (row.effective_persona) personaEffectiveness[row.effective_persona] = (personaEffectiveness[row.effective_persona] || 0) + 1;
    if (row.effective_channel) channelEffectiveness[row.effective_channel] = (channelEffectiveness[row.effective_channel] || 0) + 1;
    if (row.competitor_lost_to) competitorLosses[row.competitor_lost_to] = (competitorLosses[row.competitor_lost_to] || 0) + 1;
    if (row.effective_angle) effectiveAngles.push(row.effective_angle);
    if (row.why_they_bought) whyTheyBought.push(row.why_they_bought);
    if (row.sales_cycle_days) salesCycleDays.push(row.sales_cycle_days);
    if (row.stalled_stage) stalledStages[row.stalled_stage] = (stalledStages[row.stalled_stage] || 0) + 1;

    if (row.bad_fit_reasons) {
      try {
        const reasons = JSON.parse(row.bad_fit_reasons) as string[];
        for (const r of reasons) badFitReasons[r] = (badFitReasons[r] || 0) + 1;
      } catch {}
    }
  }

  const positiveAvg = positiveScores.length > 0 ? Math.round(positiveScores.reduce((a, b) => a + b, 0) / positiveScores.length) : 0;
  const negativeAvg = negativeScores.length > 0 ? Math.round(negativeScores.reduce((a, b) => a + b, 0) / negativeScores.length) : 0;

  return {
    feedbackCount: rows.length,
    verdictDistribution,
    segmentPerformance,
    scoreCorrelation: (positiveScores.length > 0 || negativeScores.length > 0)
      ? { positiveAvg, negativeAvg, gap: positiveAvg - negativeAvg }
      : null,
    personaEffectiveness,
    channelEffectiveness,
    competitorLosses,
    badFitReasons,
    effectiveAngles: effectiveAngles.slice(0, 10),
    whyTheyBought: whyTheyBought.slice(0, 10),
    winRate: (won + lost > 0) ? { won, lost, rate: Math.round((won / (won + lost)) * 100) } : null,
    salesCycleDays,
    stalledStages,
  };
}

function buildAnalysisPrompt(campaignName: string, snapshot: AnalysisDataSnapshot): { system: string; user: string } {
  const system = `You are a sales intelligence analyst reviewing campaign feedback data. Analyze the patterns and produce actionable insights that can improve future campaign performance.

You must return a JSON array of insight objects. Each insight should have:
- "insight_type": one of "scoring_accuracy", "persona_effectiveness", "vertical_performance", "messaging_patterns", "timing_patterns", "competitive_intel", or "composite"
- "title": concise title (under 80 chars)
- "summary": 1-2 sentence summary with specific numbers
- "details": object with structured analysis data
- "recommendations": array of objects, each with "action" (what to do), "field" (campaign config field it maps to, if any), "value" (suggested value, if applicable)
- "confidence": "low" (< 10 data points), "medium" (10-25), or "high" (> 25)

Focus on patterns that are statistically meaningful given the sample size. Do NOT generate insights where the data is too thin to be reliable.

Return ONLY a JSON array — no markdown, no explanation outside the JSON.`;

  const lines: string[] = [
    `Analyze feedback patterns for campaign "${campaignName}".`,
    '',
    `## Dataset: ${snapshot.feedbackCount} feedback entries`,
    '',
    '## Verdict Distribution',
    ...Object.entries(snapshot.verdictDistribution).map(([v, c]) => `- ${v}: ${c}`),
  ];

  if (snapshot.scoreCorrelation) {
    lines.push('', '## Score vs. Outcome Correlation');
    lines.push(`- Positive outcome avg score: ${snapshot.scoreCorrelation.positiveAvg}/100`);
    lines.push(`- Negative outcome avg score: ${snapshot.scoreCorrelation.negativeAvg}/100`);
    lines.push(`- Score gap: ${snapshot.scoreCorrelation.gap} points`);
  }

  if (Object.keys(snapshot.segmentPerformance).length > 0) {
    lines.push('', '## Segment Performance');
    for (const [seg, stats] of Object.entries(snapshot.segmentPerformance)) {
      const rate = stats.total > 0 ? Math.round((stats.positive / stats.total) * 100) : 0;
      lines.push(`- ${seg}: ${stats.positive} positive, ${stats.negative} negative, ${stats.total} total (${rate}% positive rate)`);
    }
  }

  if (Object.keys(snapshot.personaEffectiveness).length > 0) {
    lines.push('', '## Persona Effectiveness (from positive outcomes)');
    for (const [p, c] of Object.entries(snapshot.personaEffectiveness)) lines.push(`- ${p}: ${c} positive outcomes`);
  }

  if (Object.keys(snapshot.channelEffectiveness).length > 0) {
    lines.push('', '## Channel Effectiveness');
    for (const [ch, c] of Object.entries(snapshot.channelEffectiveness)) lines.push(`- ${ch}: ${c} positive outcomes`);
  }

  if (Object.keys(snapshot.competitorLosses).length > 0) {
    lines.push('', '## Competitive Losses');
    for (const [comp, c] of Object.entries(snapshot.competitorLosses)) lines.push(`- Lost to ${comp}: ${c} time(s)`);
  }

  if (Object.keys(snapshot.badFitReasons).length > 0) {
    lines.push('', '## Bad Fit Reasons');
    for (const [r, c] of Object.entries(snapshot.badFitReasons)) lines.push(`- ${r}: ${c} occurrence(s)`);
  }

  if (snapshot.effectiveAngles.length > 0) {
    lines.push('', '## Messaging Angles That Worked');
    for (const a of snapshot.effectiveAngles) lines.push(`- "${a}"`);
  }

  if (snapshot.whyTheyBought.length > 0) {
    lines.push('', '## Why They Bought');
    for (const w of snapshot.whyTheyBought) lines.push(`- "${w}"`);
  }

  if (snapshot.winRate) {
    lines.push('', '## Win Rate');
    lines.push(`- Won: ${snapshot.winRate.won}, Lost: ${snapshot.winRate.lost}, Rate: ${snapshot.winRate.rate}%`);
  }

  if (snapshot.salesCycleDays.length > 0) {
    const avg = Math.round(snapshot.salesCycleDays.reduce((a, b) => a + b, 0) / snapshot.salesCycleDays.length);
    const min = Math.min(...snapshot.salesCycleDays);
    const max = Math.max(...snapshot.salesCycleDays);
    lines.push('', '## Sales Cycle');
    lines.push(`- Average: ${avg} days, Range: ${min}–${max} days, Sample: ${snapshot.salesCycleDays.length}`);
  }

  if (Object.keys(snapshot.stalledStages).length > 0) {
    lines.push('', '## Stall Points');
    for (const [stage, c] of Object.entries(snapshot.stalledStages)) lines.push(`- ${stage}: ${c} stalled`);
  }

  lines.push('', 'Generate insights based on these patterns. Only include insights where the data supports a clear conclusion.');

  return { system, user: lines.join('\n') };
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const jsonMatch = text.match(/(\[[\s\S]*\])/);
  if (jsonMatch) return jsonMatch[1].trim();
  return text.trim();
}

export async function analyzeCampaignFeedback(campaignId: string): Promise<CampaignInsight[]> {
  const db = getDb();

  const campaign = db.prepare('SELECT name FROM campaigns WHERE id = ?').get(campaignId) as any;
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const rows = db.prepare(`
    SELECT lf.verdict, lf.reason, lf.created_at, l.fit_score, l.segment, l.company_name, l.lead_status,
           fod.effective_persona, fod.effective_channel, fod.effective_angle,
           fod.competitor_lost_to, fod.loss_reason, fod.bad_fit_reasons,
           fod.why_they_bought, fod.deal_value, fod.sales_cycle_days, fod.stalled_stage
    FROM lead_feedback lf
    JOIN leads l ON lf.lead_id = l.id
    LEFT JOIN feedback_outcome_details fod ON fod.feedback_id = lf.id
    WHERE l.campaign_id = ?
    ORDER BY lf.created_at DESC
  `).all(campaignId) as FeedbackRow[];

  if (rows.length < MIN_FEEDBACK_FOR_ANALYSIS) {
    return [];
  }

  const snapshot = buildDataSnapshot(rows);
  const { system, user } = buildAnalysisPrompt(campaign.name, snapshot);

  const aiConfig = getAIConfig();
  const client = await createAIClient();
  const model = aiConfig.defaultModel;

  const response = await client.messages.create({
    model: resolveModel(model, aiConfig.provider),
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const rawText = response.content.find((b: any) => b.type === 'text')?.text || '';
  const jsonStr = extractJson(rawText);

  let rawInsights: any[];
  try {
    rawInsights = JSON.parse(jsonStr);
    if (!Array.isArray(rawInsights)) rawInsights = [rawInsights];
  } catch {
    console.error('[feedbackAnalyzer] Failed to parse Claude response:', rawText.substring(0, 500));
    return [];
  }

  // Mark previous active insights as stale
  db.prepare(
    `UPDATE campaign_insights SET status = 'stale' WHERE campaign_id = ? AND status = 'active'`
  ).run(campaignId);

  const validTypes: InsightType[] = ['scoring_accuracy', 'persona_effectiveness', 'vertical_performance', 'messaging_patterns', 'timing_patterns', 'competitive_intel', 'composite'];

  const insights: CampaignInsight[] = [];
  const insertStmt = db.prepare(
    `INSERT INTO campaign_insights (id, campaign_id, insight_type, title, summary, details, recommendations, data_snapshot, feedback_count, confidence)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );

  for (const raw of rawInsights) {
    if (!raw.title || !raw.summary) continue;
    const insightType = validTypes.includes(raw.insight_type) ? raw.insight_type : 'composite';
    const confidence = ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium';

    const insight: CampaignInsight = {
      id: uuid(),
      campaign_id: campaignId,
      insight_type: insightType,
      title: String(raw.title).substring(0, 200),
      summary: String(raw.summary),
      details: raw.details || {},
      recommendations: Array.isArray(raw.recommendations) ? raw.recommendations : null,
      data_snapshot: snapshot,
      feedback_count: rows.length,
      confidence,
      status: 'active',
      created_at: new Date().toISOString(),
      applied_at: null,
      applied_by: null,
    };

    insertStmt.run(
      insight.id, campaignId, insight.insight_type,
      insight.title, insight.summary,
      JSON.stringify(insight.details),
      insight.recommendations ? JSON.stringify(insight.recommendations) : null,
      JSON.stringify(snapshot),
      rows.length, confidence,
    );

    insights.push(insight);
  }

  return insights;
}

export function getCampaignFeedbackCount(campaignId: string): number {
  const db = getDb();
  const result = db.prepare(
    'SELECT COUNT(*) as c FROM lead_feedback lf JOIN leads l ON lf.lead_id = l.id WHERE l.campaign_id = ?'
  ).get(campaignId) as { c: number };
  return result.c;
}

export async function analyzeGlobalPatterns(): Promise<CampaignInsight[]> {
  const db = getDb();

  // Gather cross-campaign feedback data
  const rows = db.prepare(`
    SELECT lf.verdict, lf.reason, l.fit_score, l.segment, l.company_name, l.lead_status,
           c.name as campaign_name, c.id as campaign_id,
           fod.effective_persona, fod.effective_channel, fod.effective_angle,
           fod.competitor_lost_to, fod.loss_reason, fod.bad_fit_reasons,
           fod.why_they_bought, fod.deal_value, fod.sales_cycle_days
    FROM lead_feedback lf
    JOIN leads l ON lf.lead_id = l.id
    LEFT JOIN campaigns c ON c.id = l.campaign_id
    LEFT JOIN feedback_outcome_details fod ON fod.feedback_id = lf.id
    ORDER BY lf.created_at DESC
  `).all() as any[];

  if (rows.length < MIN_FEEDBACK_FOR_ANALYSIS) return [];

  // Customer profiles for pattern matching
  const customers = db.prepare('SELECT * FROM customer_profiles').all() as any[];

  // Build cross-campaign snapshot
  const campaignPerformance: Record<string, { name: string; positive: number; negative: number; total: number }> = {};
  const globalSegmentPerf: Record<string, { positive: number; negative: number; total: number }> = {};
  const positiveVerdicts = ['good_fit_booked', 'good_fit_response', 'closed_won'];
  const negativeVerdicts = ['bad_fit', 'closed_lost'];

  for (const row of rows) {
    const cid = row.campaign_id || 'unknown';
    if (!campaignPerformance[cid]) campaignPerformance[cid] = { name: row.campaign_name || cid, positive: 0, negative: 0, total: 0 };
    campaignPerformance[cid].total++;
    if (positiveVerdicts.includes(row.verdict)) campaignPerformance[cid].positive++;
    if (negativeVerdicts.includes(row.verdict)) campaignPerformance[cid].negative++;

    if (row.segment) {
      if (!globalSegmentPerf[row.segment]) globalSegmentPerf[row.segment] = { positive: 0, negative: 0, total: 0 };
      globalSegmentPerf[row.segment].total++;
      if (positiveVerdicts.includes(row.verdict)) globalSegmentPerf[row.segment].positive++;
      if (negativeVerdicts.includes(row.verdict)) globalSegmentPerf[row.segment].negative++;
    }
  }

  const customerProducts: Record<string, number> = {};
  const customerEnvKeys: Record<string, Record<string, number>> = {};
  for (const c of customers) {
    const products = c.products_used ? JSON.parse(c.products_used) : [];
    for (const p of products) customerProducts[p] = (customerProducts[p] || 0) + 1;
    const env = c.environment ? JSON.parse(c.environment) : {};
    for (const [key, val] of Object.entries(env)) {
      if (!customerEnvKeys[key]) customerEnvKeys[key] = {};
      customerEnvKeys[key][String(val)] = (customerEnvKeys[key][String(val)] || 0) + 1;
    }
  }

  const systemPrompt = `You are a strategic ICP analyst reviewing cross-campaign performance data and customer profiles. Generate actionable ICP refinement suggestions.

Return a JSON array of insight objects. Each insight should have:
- "insight_type": one of "scoring_accuracy", "persona_effectiveness", "vertical_performance", "messaging_patterns", "competitive_intel", or "composite"
- "title": concise title (under 80 chars)
- "summary": 1-2 sentence summary with specific numbers
- "details": object with analysis data
- "recommendations": array of objects with "action" (what to do), "field" (ICP config field: verticals, tech_signals, competitors, segments, signal_weights), "value" (suggested value if applicable)
- "confidence": "low", "medium", or "high"

Focus on ICP-level recommendations that span across campaigns. These are global refinements, not campaign-specific.

Return ONLY a JSON array.`;

  const lines: string[] = [
    `Analyze cross-campaign patterns for ICP refinement.`,
    '',
    `## Cross-Campaign Performance (${Object.keys(campaignPerformance).length} campaigns, ${rows.length} total feedback)`,
  ];

  for (const [, perf] of Object.entries(campaignPerformance)) {
    const rate = perf.total > 0 ? Math.round((perf.positive / perf.total) * 100) : 0;
    lines.push(`- ${perf.name}: ${perf.positive} positive, ${perf.negative} negative, ${perf.total} total (${rate}% positive)`);
  }

  if (Object.keys(globalSegmentPerf).length > 0) {
    lines.push('', '## Segment Performance (Global)');
    for (const [seg, stats] of Object.entries(globalSegmentPerf)) {
      const rate = stats.total > 0 ? Math.round((stats.positive / stats.total) * 100) : 0;
      lines.push(`- ${seg}: ${rate}% positive (${stats.positive}/${stats.total})`);
    }
  }

  if (customers.length > 0) {
    lines.push('', `## Customer Profile Patterns (${customers.length} customers)`);
    if (Object.keys(customerProducts).length > 0) {
      lines.push('Products used:');
      for (const [p, c] of Object.entries(customerProducts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
        lines.push(`- ${p}: ${c} customer(s)`);
      }
    }
    if (Object.keys(customerEnvKeys).length > 0) {
      lines.push('Environment patterns:');
      for (const [key, vals] of Object.entries(customerEnvKeys)) {
        const top = Object.entries(vals).sort((a, b) => b[1] - a[1]).slice(0, 3);
        lines.push(`- ${key}: ${top.map(([v, c]) => `${v} (${c})`).join(', ')}`);
      }
    }
  }

  // Build snapshot from aggregated feedback
  const snapshot = buildDataSnapshot(rows as FeedbackRow[]);

  if (snapshot.competitorLosses && Object.keys(snapshot.competitorLosses).length > 0) {
    lines.push('', '## Competitive Losses (Global)');
    for (const [comp, count] of Object.entries(snapshot.competitorLosses)) {
      lines.push(`- Lost to ${comp}: ${count} time(s)`);
    }
  }

  lines.push('', 'Generate ICP refinement suggestions based on these cross-campaign patterns.');

  const aiConfig = getAIConfig();
  const client = await createAIClient();

  const response = await client.messages.create({
    model: resolveModel(aiConfig.defaultModel, aiConfig.provider),
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: lines.join('\n') }],
  });

  const rawText = response.content.find((b: any) => b.type === 'text')?.text || '';
  const jsonStr = extractJson(rawText);

  let rawInsights: any[];
  try {
    rawInsights = JSON.parse(jsonStr);
    if (!Array.isArray(rawInsights)) rawInsights = [rawInsights];
  } catch {
    console.error('[feedbackAnalyzer] Failed to parse global analysis:', rawText.substring(0, 500));
    return [];
  }

  const validTypes: InsightType[] = ['scoring_accuracy', 'persona_effectiveness', 'vertical_performance', 'messaging_patterns', 'competitive_intel', 'composite'];

  // Store as campaign_insights with campaign_id = '__global__'
  db.prepare(
    `UPDATE campaign_insights SET status = 'stale' WHERE campaign_id = '__global__' AND status = 'active'`
  ).run();

  const insights: CampaignInsight[] = [];
  const insertStmt = db.prepare(
    `INSERT INTO campaign_insights (id, campaign_id, insight_type, title, summary, details, recommendations, data_snapshot, feedback_count, confidence)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );

  for (const raw of rawInsights) {
    if (!raw.title || !raw.summary) continue;
    const insightType = validTypes.includes(raw.insight_type) ? raw.insight_type : 'composite';
    const confidence = ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium';

    const insight: CampaignInsight = {
      id: uuid(),
      campaign_id: '__global__',
      insight_type: insightType,
      title: String(raw.title).substring(0, 200),
      summary: String(raw.summary),
      details: raw.details || {},
      recommendations: Array.isArray(raw.recommendations) ? raw.recommendations : null,
      data_snapshot: { campaignPerformance, globalSegmentPerf, customerCount: customers.length },
      feedback_count: rows.length,
      confidence,
      status: 'active',
      created_at: new Date().toISOString(),
      applied_at: null,
      applied_by: null,
    };

    insertStmt.run(
      insight.id, '__global__', insight.insight_type,
      insight.title, insight.summary,
      JSON.stringify(insight.details),
      insight.recommendations ? JSON.stringify(insight.recommendations) : null,
      JSON.stringify(insight.data_snapshot),
      rows.length, confidence,
    );

    insights.push(insight);
  }

  return insights;
}
