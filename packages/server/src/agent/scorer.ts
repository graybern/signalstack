import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { streamAICall } from './streamingAI.js';
import { getScoringPrompt } from './prompts/scoring.js';
import { withRetry } from './retry.js';
import type { ExtendedICPConfig, ScoreBreakdown, FunnelStepConfig } from '../types/index.js';
import type { ResearchCandidate } from './researcher.js';
import type { TokenTracker } from './tokenTracker.js';
import type { FeedbackContext } from './feedbackContext.js';

export interface StreamContext {
  runId: string;
  campaignId?: string;
  phase: string;
  companyName?: string;
}

export interface ScoringResult {
  fit_score: number;
  fit_score_label: string;
  confidence: 'low' | 'medium' | 'high';
  score_breakdown: ScoreBreakdown;
  reasoning?: string;
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  const jsonMatch = text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  return text.trim();
}

export async function scoreCandidate(
  candidate: ResearchCandidate,
  icpConfig: ExtendedICPConfig,
  model?: string,
  tracker?: TokenTracker,
  promptInstructions?: string,
  stepConfig?: FunnelStepConfig,
  streamCtx?: StreamContext,
  feedbackContext?: FeedbackContext | null,
): Promise<ScoringResult> {
  const aiConfig = getAIConfig();
  const client = await createAIClient();

  const enrichmentSourceCount = candidate.enrichment_source_count ?? 0;
  const systemPrompt = getScoringPrompt(icpConfig, stepConfig?.scoring_weights, enrichmentSourceCount);

  // ICP overrides from step config (skip overrides when use_org_icp is true)
  const useOrg = stepConfig?.use_org_icp !== false;
  const verticals = (!useOrg && stepConfig?.icp_verticals_override?.length) ? stepConfig.icp_verticals_override : icpConfig.verticals;
  const techSignals = (!useOrg && stepConfig?.icp_tech_signals_override?.length) ? stepConfig.icp_tech_signals_override : icpConfig.tech_signals;
  const competitors = (!useOrg && stepConfig?.icp_competitors_override?.length) ? stepConfig.icp_competitors_override : icpConfig.competitors;

  const signalCount = candidate.signals.length;
  const sourceCount = candidate.sources.length;
  const valueProps = icpConfig.company_context?.value_props || [];
  const differentiators = icpConfig.company_context?.differentiators || [];
  const campaignSignals = icpConfig.campaign_target_signals || [];
  const buyerPersonas = icpConfig.buyer_personas || {};
  const buyerPersonaSummary = Object.entries(buyerPersonas)
    .map(([key, p]) => `${(p as any).label || key} (${(p as any).titles?.slice(0, 2).join(', ') || 'N/A'})`)
    .join('; ');

  const companyName = icpConfig.company_context?.company_name || 'the';
  let userMessage: string;
  try {
  userMessage = `Score the following prospect company against ${companyName}'s ICP.

## Company Information
- **Company:** ${candidate.company_name}
- **Domain:** ${candidate.domain}
- **Segment:** ${candidate.segment}
- **Employee Count (est.):** ${candidate.employee_count_estimate ?? 'Unknown'}${!candidate.employee_count_estimate ? ' ⚠️ No employee count data — reduce confidence on Segment & Scale Fit score' : ''}
- **HQ:** ${candidate.hq_location ?? 'Unknown'}
- **Founded:** ${candidate.founded_year ?? 'Unknown'}
- **Funding Stage:** ${candidate.funding_stage ?? 'Unknown'}
- **Total Funding:** ${candidate.total_funding ?? 'Unknown'}
- **Investors:** ${candidate.investors ?? 'Unknown'}
- **LinkedIn:** ${candidate.linkedin_company_url ?? 'Not found'}

## Evidence Summary
- **${signalCount} buying signal(s)** identified from **${sourceCount} source(s)**, enriched by **${enrichmentSourceCount} external data source(s)**
- ${candidate.domain_validated ? 'Domain validated via DNS + HTTP' : 'Domain not externally validated'}

## Signals Identified (${signalCount})
${candidate.signals.map((s) => `- ${s}`).join('\n') || '- None identified'}

## Sources (${sourceCount})
${candidate.sources.map((s) => `- ${s}`).join('\n') || '- None'}

## Research Notes
${candidate.notes}

## ICP Context
- **Target Verticals:** ${verticals.join(', ')}
- **Tech Signals:** ${techSignals.join(', ')}
- **Competitors to Displace:** ${competitors.join(', ')}
- **Segment Config:** VPN users range ${icpConfig.segments[candidate.segment]?.vpn_users_min ?? 'N/A'}–${icpConfig.segments[candidate.segment]?.vpn_users_max ?? 'N/A'}
${valueProps.length > 0 ? `- **Value Propositions:** ${valueProps.join(', ')}\n` : ''}${differentiators.length > 0 ? `- **Key Differentiators:** ${differentiators.join(', ')}\n` : ''}${campaignSignals.length > 0 ? `- **Campaign Target Signals:** ${campaignSignals.join(', ')}\n` : ''}${icpConfig.campaign_value_prop_angle ? `- **Campaign Value Prop Angle:** ${icpConfig.campaign_value_prop_angle}\n` : ''}${buyerPersonaSummary ? `- **Target Buyer Roles:** ${buyerPersonaSummary}\n` : ''}
Score this company using the rubric. Apply the Evidence Density Modifier: ${signalCount} signals from ${sourceCount} sources should directly influence where you place scores within each tier. Cite specific signal counts in each category's evidence array.${promptInstructions ? `\n\n## Additional Instructions\n${promptInstructions}` : ''}${feedbackContext ? `\n\n## Historical Campaign Patterns (from ${feedbackContext.feedbackCount} reviewed leads)\n${feedbackContext.scoring_adjustments}\n\n### Known Bad-Fit Patterns\n${feedbackContext.known_bad_patterns}` : ''}`;
  } catch (buildErr) {
    console.error(`[scorer] Failed to build scoring prompt for ${candidate.company_name}:`, buildErr);
    throw buildErr;
  }

  let rawText: string;
  let thinkingText = '';

  const maxTok = stepConfig?.max_tokens || 4096;

  if (streamCtx) {
    const result = await withRetry(
      () => streamAICall({
        model: model || aiConfig.defaultModel,
        max_tokens: maxTok,
        system: systemPrompt,
        userMessage,
        thinking_budget: 8000,
        tracker,
        context: { ...streamCtx, companyName: candidate.company_name },
      }),
    );
    rawText = result.text;
    thinkingText = result.thinking;
  } else {
    const response = await withRetry(
      () => client.messages.create({
        model: resolveModel(model || aiConfig.defaultModel, aiConfig.provider),
        max_tokens: maxTok + 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        thinking: { type: 'enabled', budget_tokens: 8000 },
      } as any),
    );
    if (tracker) tracker.addUsage(response);
    rawText = response.content.find((b: any) => b.type === 'text')?.text || '';
    thinkingText = response.content.find((b: any) => b.type === 'thinking')?.thinking || '';
  }

  const jsonStr = extractJson(rawText);

  // Extract reasoning (text before the JSON block, or thinking if streamed)
  const jsonStart = rawText.indexOf(jsonStr);
  const textReasoning = jsonStart > 0 ? rawText.substring(0, jsonStart).trim() : undefined;
  const reasoning = thinkingText || textReasoning;

  try {
    const result = JSON.parse(jsonStr);
    let confidence = validateConfidence(result.confidence);
    let finalReasoning = reasoning || result.reasoning || '';

    // Confidence discount based on enrichment data quality
    if (enrichmentSourceCount === 0) {
      confidence = 'low';
      finalReasoning = finalReasoning
        ? `${finalReasoning}\n\n[Confidence override: forced to "low" — no external enrichment sources confirmed this company.]`
        : '[Confidence override: forced to "low" — no external enrichment sources confirmed this company.]';
    } else if (enrichmentSourceCount === 1 && confidence === 'high') {
      confidence = 'medium';
      finalReasoning = finalReasoning
        ? `${finalReasoning}\n\n[Confidence capped at "medium" — only 1 external enrichment source available.]`
        : '[Confidence capped at "medium" — only 1 external enrichment source available.]';
    }

    return {
      fit_score: Math.max(0, Math.min(100, result.fit_score ?? 0)),
      fit_score_label: result.fit_score_label ?? scoreToLabel(result.fit_score ?? 0),
      confidence,
      score_breakdown: result.score_breakdown,
      reasoning: finalReasoning || undefined,
    };
  } catch (err) {
    console.error(`[scorer] Failed to parse JSON for ${candidate.company_name}:`, err);
    console.error(`[scorer] Raw response:`, rawText.substring(0, 500));
    return {
      fit_score: 0,
      fit_score_label: '1 star',
      confidence: 'low',
      score_breakdown: {
        segment_scale_fit: { points: 0, evidence: ['Scoring failed'] },
        why_now_triggers: { points: 0, evidence: ['Scoring failed'] },
        remote_access_pain: { points: 0, evidence: ['Scoring failed'] },
        displacement_wedge: { points: 0, evidence: ['Scoring failed'] },
        vertical_playbook: { points: 0, evidence: ['Scoring failed'] },
        buyer_access_readiness: { points: 0, evidence: ['Scoring failed'] },
        penalties: [],
        total: 0,
      },
    };
  }
}

function scoreToLabel(score: number): string {
  if (score >= 85) return '5 stars';
  if (score >= 70) return '4 stars';
  if (score >= 55) return '3 stars';
  if (score >= 35) return '2 stars';
  return '1 star';
}

function validateConfidence(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}
