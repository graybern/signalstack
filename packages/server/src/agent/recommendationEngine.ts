import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { ActivityLogger } from './activityLogger.js';

interface Recommendation {
  type: string;
  title: string;
  description: string;
  rationale: string;
  action_data?: Record<string, any>;
}

interface AnalyticsSnapshot {
  total_leads: number;
  avg_score: number | null;
  segments: any[];
  feedback: any[];
  score_ranges: any[];
  campaigns: any[];
}

export async function generateRecommendations(snapshot: AnalyticsSnapshot, logger?: ActivityLogger): Promise<Recommendation[]> {
  const aiConfig = getAIConfig();
  const client = await createAIClient();

  logger?.phaseStart('analysis', 'Analyzing lead generation data for recommendations...');
  logger?.thinking('analysis', `Reviewing ${snapshot.total_leads} leads across ${snapshot.segments.length} segments`);

  const systemPrompt = `You are an AI analyst for SignalStack, a B2B prospect intelligence platform. Your job is to analyze lead generation data and provide actionable recommendations to improve ICP targeting, data source usage, and campaign strategy.

Analyze the data provided and generate 2-5 recommendations. Each recommendation must be one of these types:
- icp_adjustment: Suggest changes to ICP scoring weights or criteria
- source_priority: Suggest changes to data source prioritization
- campaign_suggestion: Suggest new campaign ideas or changes to existing ones
- exclusion_suggestion: Suggest new exclusion rules based on patterns

Return a JSON array of recommendations. Each must have:
- type: one of the types above
- title: short actionable title (under 80 chars)
- description: 1-2 sentence explanation of what to change
- rationale: 1-2 sentence explanation of why, citing specific data points
- action_data: structured object with the specific changes to apply when accepted:
  - For icp_adjustment: { "field": "scoring_weight_name", "current": value, "proposed": value }
  - For exclusion_suggestion: { "companies": [{"company_name": "...", "domain": "...", "reason": "..."}] }
  - For campaign_suggestion: { "campaign_name": "...", "pattern_thesis": "...", "target_signals": [...] }
  - For source_priority: { "sources": {"source_id": true/false, ...}, "reason": "..." }

Only return the JSON array, no other text.`;

  const userMessage = `Here is the current analytics snapshot for our lead generation platform:

**Overview:**
- Total leads: ${snapshot.total_leads}
- Average fit score: ${snapshot.avg_score ?? 'N/A'}

**Segment Breakdown:**
${JSON.stringify(snapshot.segments, null, 2)}

**Feedback Distribution (verdict → count + avg score):**
${JSON.stringify(snapshot.feedback, null, 2)}

**Score Ranges vs Feedback Outcomes:**
${JSON.stringify(snapshot.score_ranges, null, 2)}

**Top Campaigns:**
${JSON.stringify(snapshot.campaigns, null, 2)}

Based on this data, generate actionable recommendations to improve our lead quality and targeting.`;

  const response = await client.messages.create({
    model: resolveModel(aiConfig.defaultModel, aiConfig.provider),
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text as string)
    .join('');

  try {
    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found in response');
    const recommendations: Recommendation[] = JSON.parse(jsonMatch[0]);
    const filtered = recommendations.filter(r => r.type && r.title && r.description && r.rationale);

    for (const rec of filtered) {
      logger?.finding('analysis', '', `${rec.title}`, { type: rec.type, rationale: rec.rationale });
    }
    logger?.phaseComplete('analysis', `Generated ${filtered.length} recommendations`);

    return filtered;
  } catch (err) {
    logger?.error('analysis', 'Failed to parse AI recommendations', String(err));
    console.error('[recommendationEngine] Failed to parse response:', text);
    throw new Error('Failed to parse AI recommendations');
  }
}
