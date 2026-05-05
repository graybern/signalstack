import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { streamAICall } from './streamingAI.js';
import { getBriefPrompt } from './prompts/brief.js';
import type {
  ExtendedICPConfig,
  PainHypothesis,
  TechStackIntel,
  CompetitiveDisplacement,
  SourceCitation,
  FunnelStepConfig,
} from '../types/index.js';
import type { ResearchCandidate } from './researcher.js';
import type { ScoringResult } from './scorer.js';
import type { TokenTracker } from './tokenTracker.js';
import type { StreamContext } from './scorer.js';

export interface PersonaBrief {
  role_type: 'champion' | 'economic_buyer' | 'executive_sponsor';
  name: string | null;
  title: string | null;
  linkedin_url: string | null;
  department: string | null;
  tenure: string | null;
  outreach_angle: string | null;
  talking_points: string | null;
  outreach_message: string | null;
  social_signals: string | null;
  buying_signals: string | null;
}

export interface BriefResult {
  company_snapshot: string;
  pain_hypotheses: PainHypothesis[];
  personas: PersonaBrief[];
  tech_stack: TechStackIntel;
  competitive_displacement: CompetitiveDisplacement;
  outreach_strategy: string;
  source_citations: SourceCitation[];
  why_now: string[];
  brief_markdown: string;
  thinking?: string;
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

export async function generateBrief(
  candidate: ResearchCandidate,
  score: ScoringResult,
  icpConfig: ExtendedICPConfig,
  model?: string,
  tracker?: TokenTracker,
  promptInstructions?: string,
  outreachTone?: string,
  stepConfig?: FunnelStepConfig,
  streamCtx?: StreamContext
): Promise<BriefResult> {
  const aiConfig = getAIConfig();
  const client = await createAIClient();

  const enrichmentSourceCount = candidate.enrichment_source_count ?? 0;
  const signalCount = candidate.signals.length;
  const systemPrompt = getBriefPrompt(icpConfig, enrichmentSourceCount, signalCount);
  const valueProps = icpConfig.company_context?.value_props || [];
  const differentiators = icpConfig.company_context?.differentiators || [];

  const userMessage = `Generate a comprehensive lead brief for the following prospect.

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
- **${signalCount} buying signal(s)** from **${candidate.sources.length} source(s)**, enriched by **${enrichmentSourceCount} external data source(s)**
- ${candidate.domain_validated ? 'Domain validated via DNS + HTTP' : 'Domain not externally validated'}

## Signals (${signalCount})
${candidate.signals.map((s) => `- ${s}`).join('\n') || '- None identified'}

## Sources (${candidate.sources.length})
${candidate.sources.map((s) => `- ${s}`).join('\n') || '- None'}

## Research Notes
${candidate.notes}

## Scoring Result
- **Fit Score:** ${score.fit_score}/100 (${score.fit_score_label})
- **Confidence:** ${score.confidence}
- **Key Score Drivers:**
  - Segment/Scale Fit: ${score.score_breakdown.segment_scale_fit.points}/20
  - Why Now Triggers: ${score.score_breakdown.why_now_triggers.points}/15
  - Remote Access Pain: ${score.score_breakdown.remote_access_pain.points}/20
  - Displacement Wedge: ${score.score_breakdown.displacement_wedge.points}/20
  - Vertical/Playbook: ${score.score_breakdown.vertical_playbook.points}/15
  - Buyer Access: ${score.score_breakdown.buyer_access_readiness.points}/10

## ICP Context
${icpConfig.verticals?.length ? `- **Target Verticals:** ${icpConfig.verticals.join(', ')}\n` : ''}${icpConfig.competitors?.length ? `- **Competitors:** ${icpConfig.competitors.join(', ')}\n` : ''}${icpConfig.tech_signals?.length ? `- **Tech Signals:** ${icpConfig.tech_signals.join(', ')}\n` : ''}${valueProps.length > 0 ? `- **Value Propositions:** ${valueProps.join(', ')}\n` : ''}${differentiators.length > 0 ? `- **Key Differentiators:** ${differentiators.join(', ')}\n` : ''}${icpConfig.campaign_target_signals?.length ? `- **Campaign Target Signals:** ${icpConfig.campaign_target_signals.join(', ')}\n` : ''}${icpConfig.campaign_value_prop_angle ? `- **Value Prop Angle:** ${icpConfig.campaign_value_prop_angle}\n` : ''}${Object.keys(icpConfig.success_stories || {}).length > 0 ? `- **Success Stories:** ${Object.entries(icpConfig.success_stories).map(([v, c]) => `${v}: ${(c as string[]).join(', ')}`).join('; ')}\n` : ''}

Generate the full lead brief as a JSON object.${outreachTone ? `\n\n## Outreach Tone\nWrite all outreach messaging in a ${outreachTone} tone.` : ''}${stepConfig?.persona_types?.length ? `\n\n## Persona Types\nOnly generate personas for these roles: ${stepConfig.persona_types.join(', ')}. Do not include other role types.` : ''}${stepConfig?.brief_depth === 'quick' ? `\n\n## Brief Depth: Quick\nGenerate a snapshot: company overview, 2 pain hypotheses, 1 persona. Skip extended analysis.` : stepConfig?.brief_depth === 'comprehensive' ? `\n\n## Brief Depth: Comprehensive\nGenerate an exhaustive brief with extended analysis, multiple outreach variants per persona, detailed competitive positioning, and thorough why-now analysis.` : ''}${promptInstructions ? `\n\n## Additional Instructions\n${promptInstructions}` : ''}`;

  let rawText: string;
  let thinkingText = '';

  if (streamCtx) {
    const result = await streamAICall({
      model: model || aiConfig.defaultModel,
      max_tokens: stepConfig?.max_tokens || 16384,
      system: systemPrompt,
      userMessage,
      thinking_budget: 10000,
      tracker,
      context: { ...streamCtx, companyName: candidate.company_name },
    });
    rawText = result.text;
    thinkingText = result.thinking;
  } else {
    const maxTok = stepConfig?.max_tokens || 16384;
    const stream = client.messages.stream({
      model: resolveModel(model || aiConfig.defaultModel, aiConfig.provider),
      max_tokens: maxTok + 10000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      thinking: { type: 'enabled', budget_tokens: 10000 },
    } as any);
    const finalMessage = await stream.finalMessage();
    if (tracker) tracker.addUsage(finalMessage);
    rawText = finalMessage.content.find((b: any) => b.type === 'text')?.text || '';
    thinkingText = finalMessage.content.find((b: any) => b.type === 'thinking')?.thinking || '';
  }
  const jsonStr = extractJson(rawText);

  try {
    const result = JSON.parse(jsonStr);

    // Normalize personas
    let personas: PersonaBrief[] = (result.personas || []).map((p: Record<string, unknown>) => ({
      role_type: validateRoleType(p.role_type),
      name: p.name ?? null,
      title: p.title ?? null,
      linkedin_url: p.linkedin_url ?? null,
      department: p.department ?? null,
      tenure: p.tenure ?? null,
      outreach_angle: p.outreach_angle ?? null,
      talking_points: typeof p.talking_points === 'string'
        ? p.talking_points
        : JSON.stringify(p.talking_points ?? []),
      outreach_message: p.outreach_message ?? null,
      social_signals: p.social_signals ?? null,
      buying_signals: typeof p.buying_signals === 'string'
        ? p.buying_signals
        : JSON.stringify(p.buying_signals ?? null),
    }));

    // Filter to requested persona types
    if (stepConfig?.persona_types?.length) {
      personas = personas.filter(p => stepConfig.persona_types!.includes(p.role_type));
    }

    if (personas.length === 0) {
      personas.push(buildFallbackChampion(candidate.company_name, candidate.segment));
    }

    return {
      company_snapshot: result.company_snapshot || '',
      pain_hypotheses: result.pain_hypotheses || [],
      personas,
      tech_stack: result.tech_stack || {
        vpn_product: null,
        pam_product: null,
        recent_purchases: [],
        cloud_infra: [],
        dev_tools: [],
        notes: '',
      },
      competitive_displacement: result.competitive_displacement || {
        likely_current: [],
        evidence_sources: [],
        twingate_wedge: [],
        proof_points_to_use: [],
      },
      outreach_strategy: result.outreach_strategy || '',
      source_citations: result.source_citations || [],
      why_now: result.why_now || [],
      brief_markdown: result.brief_markdown || '',
      thinking: thinkingText || undefined,
    };
  } catch (err) {
    console.error(`[briefWriter] Failed to parse JSON for ${candidate.company_name}:`, err);
    console.error(`[briefWriter] Raw response:`, rawText.substring(0, 500));
    // Return a minimal brief instead of crashing the entire run
    return {
      company_snapshot: rawText.substring(0, 500),
      pain_hypotheses: [],
      personas: [buildFallbackChampion(candidate.company_name, candidate.segment, icpConfig)],
      tech_stack: { vpn_product: null, pam_product: null, recent_purchases: [], cloud_infra: [], dev_tools: [], notes: 'Brief generation failed — JSON parse error' },
      competitive_displacement: { likely_current: [], evidence_sources: [], twingate_wedge: [], proof_points_to_use: [] },
      outreach_strategy: '',
      source_citations: [],
      why_now: [],
      brief_markdown: `# ${candidate.company_name}\n\n*Brief generation encountered a parsing error. Raw response available in activity logs.*`,
    };
  }
}

function buildFallbackChampion(companyName: string, segment?: string, icpConfig?: ExtendedICPConfig): PersonaBrief {
  const championPersona = icpConfig?.buyer_personas?.champion;
  const fallbackTitle = championPersona?.titles?.[0] || (
    segment === 'ENT' ? 'Director of IT' :
    segment === 'MM' ? 'Senior IT Manager' : 'IT Manager'
  );
  const productName = icpConfig?.company_context?.product_name || 'our solution';
  return {
    role_type: 'champion',
    name: null,
    title: fallbackTitle,
    linkedin_url: null,
    department: championPersona?.departments?.[0] || 'IT / Infrastructure',
    tenure: null,
    outreach_angle: `Explore how ${companyName} handles secure access for distributed teams`,
    talking_points: JSON.stringify([
      'Current access architecture and pain points',
      `How ${productName} compares to their current approach`,
      'Deployment simplicity and time-to-value',
    ]),
    outreach_message: null,
    social_signals: null,
    buying_signals: null,
  };
}

function validateRoleType(
  value: unknown
): 'champion' | 'economic_buyer' | 'executive_sponsor' {
  if (
    value === 'champion' ||
    value === 'economic_buyer' ||
    value === 'executive_sponsor'
  ) {
    return value;
  }
  return 'champion';
}
