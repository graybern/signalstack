import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { getResearchPrompt } from './prompts/research.js';
import type { ICPConfigParsed, Exclusion } from '../types/index.js';
import type { FeedbackPattern } from './prompts/research.js';
import type { TokenTracker } from './tokenTracker.js';

export interface ResearchCandidate {
  company_name: string;
  domain: string;
  segment: 'ENT' | 'MM' | 'SMB';
  employee_count_estimate: number | null;
  hq_location: string | null;
  founded_year: number | null;
  funding_stage: string | null;
  total_funding: string | null;
  investors: string | null;
  signals: string[];
  sources: string[];
  notes: string;
  enrichment_source_count?: number;
  domain_validated?: boolean;
}

function extractJson(text: string): string {
  // Try to extract JSON from markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // Try to find a JSON array or object directly
  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  return text.trim();
}

export async function researchSegment(
  segment: 'ENT' | 'MM' | 'SMB',
  icpConfig: ICPConfigParsed,
  exclusions: Exclusion[],
  feedbackPatterns: FeedbackPattern[],
  model?: string,
  tracker?: TokenTracker
): Promise<ResearchCandidate[]> {
  const aiConfig = getAIConfig();
  const client = await createAIClient();

  const systemPrompt = getResearchPrompt(segment, icpConfig, exclusions, feedbackPatterns);

  const response = await client.messages.create({
    model: resolveModel(model || aiConfig.defaultModel, aiConfig.provider),
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Research and identify at least 8 high-quality prospect companies for the ${segment} segment. Return the results as a JSON array.`,
      },
    ],
  });

  if (tracker) tracker.addUsage(response);

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonStr = extractJson(rawText);

  let candidates: ResearchCandidate[];
  try {
    candidates = JSON.parse(jsonStr);
  } catch (err) {
    console.error(`[researcher] Failed to parse JSON for ${segment} segment:`, err);
    console.error(`[researcher] Raw response:`, rawText.substring(0, 500));
    candidates = [];
  }

  // Validate and normalize each candidate
  return candidates
    .filter((c) => c && c.company_name && c.domain)
    .map((c) => ({
      company_name: c.company_name,
      domain: c.domain,
      segment,
      employee_count_estimate: c.employee_count_estimate ?? null,
      hq_location: c.hq_location ?? null,
      founded_year: c.founded_year ?? null,
      funding_stage: c.funding_stage ?? null,
      total_funding: c.total_funding ?? null,
      investors: c.investors ?? null,
      signals: Array.isArray(c.signals) ? c.signals : [],
      sources: Array.isArray(c.sources) ? c.sources : [],
      notes: c.notes || '',
    }));
}
