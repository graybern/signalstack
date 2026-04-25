import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { getScoringPrompt } from './prompts/scoring.js';
import type { ICPConfigParsed, ScoreBreakdown, FunnelStepConfig } from '../types/index.js';
import type { ResearchCandidate } from './researcher.js';
import type { TokenTracker } from './tokenTracker.js';

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
  icpConfig: ICPConfigParsed,
  model?: string,
  tracker?: TokenTracker,
  promptInstructions?: string,
  stepConfig?: FunnelStepConfig
): Promise<ScoringResult> {
  const aiConfig = getAIConfig();
  const client = await createAIClient();

  const enrichmentSourceCount = candidate.enrichment_source_count ?? 0;
  const systemPrompt = getScoringPrompt(stepConfig?.scoring_weights, enrichmentSourceCount);

  // ICP overrides from step config (skip overrides when use_org_icp is true)
  const useOrg = stepConfig?.use_org_icp !== false;
  const verticals = (!useOrg && stepConfig?.icp_verticals_override?.length) ? stepConfig.icp_verticals_override : icpConfig.verticals;
  const techSignals = (!useOrg && stepConfig?.icp_tech_signals_override?.length) ? stepConfig.icp_tech_signals_override : icpConfig.tech_signals;
  const competitors = (!useOrg && stepConfig?.icp_competitors_override?.length) ? stepConfig.icp_competitors_override : icpConfig.competitors;

  const signalCount = candidate.signals.length;
  const sourceCount = candidate.sources.length;

  const userMessage = `Score the following prospect company against Twingate's ICP.

## Company Information
- **Company:** ${candidate.company_name}
- **Domain:** ${candidate.domain}
- **Segment:** ${candidate.segment}
- **Employee Count (est.):** ${candidate.employee_count_estimate ?? 'Unknown'}
- **HQ:** ${candidate.hq_location ?? 'Unknown'}
- **Founded:** ${candidate.founded_year ?? 'Unknown'}
- **Funding Stage:** ${candidate.funding_stage ?? 'Unknown'}
- **Total Funding:** ${candidate.total_funding ?? 'Unknown'}
- **Investors:** ${candidate.investors ?? 'Unknown'}

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
- **Segment Config:** VPN users range ${icpConfig.segments[candidate.segment].vpn_users_min}–${icpConfig.segments[candidate.segment].vpn_users_max}

Score this company using the rubric. Apply the Evidence Density Modifier: ${signalCount} signals from ${sourceCount} sources should directly influence where you place scores within each tier. Cite specific signal counts in each category's evidence array.${promptInstructions ? `\n\n## Additional Instructions\n${promptInstructions}` : ''}`;

  const response = await client.messages.create({
    model: resolveModel(model || aiConfig.defaultModel, aiConfig.provider),
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  if (tracker) tracker.addUsage(response);

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonStr = extractJson(rawText);

  // Extract reasoning (text before the JSON block)
  const jsonStart = rawText.indexOf(jsonStr);
  const reasoning = jsonStart > 0 ? rawText.substring(0, jsonStart).trim() : undefined;

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
  if (score >= 90) return '5 stars';
  if (score >= 75) return '4 stars';
  if (score >= 60) return '3 stars';
  if (score >= 40) return '2 stars';
  return '1 star';
}

function validateConfidence(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}
