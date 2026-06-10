import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { streamAICall } from './streamingAI.js';
import { getScoringPrompt, getFactExtractionPrompt, buildFactExtractionUserMessage } from './prompts/scoring.js';
import { withRetry } from './retry.js';
import type {
  ExtendedICPConfig, ScoreBreakdown, FunnelStepConfig,
  FactSheet, ScoringDimensions, DataConfidenceGrade, SignalDensity,
  SignalEntry, SignalCategory, EnrichmentMetadata, ScoringSignals,
  SubScore, DimensionBreakdown,
} from '../types/index.js';
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
  dimensions?: ScoringDimensions;
  fact_sheet?: FactSheet;
  scoring_version?: number;
  factsheet_changes?: FactSheetChange[];
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
        thinking: { type: 'adaptive' },
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

// ── Deterministic Rules Engine ──────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeIcpFit(fs: FactSheet, icpConfig: ExtendedICPConfig, scoringSignals?: ScoringSignals): { score: number; breakdown: DimensionBreakdown } {
  let score = 0;
  const painSigs = scoringSignals?.pain_signals;
  const dispSigs = scoringSignals?.displacement_signals;
  const subScores: SubScore[] = [];

  // Segment & Scale (0-20)
  let segScore = 0;
  const segEvidence: string[] = [];
  if (fs.employee_count_range !== 'unknown') {
    if (fs.employee_count_confirmed) {
      segScore += 20;
      segEvidence.push(`Employee count confirmed (${fs.employee_count_range})`);
    } else {
      segScore += 12;
      segEvidence.push(`Employee range: ${fs.employee_count_range} (unconfirmed)`);
    }
  } else {
    segScore += 3;
    segEvidence.push('Employee count unknown');
  }
  if (fs.engineering_team_evidence) { segScore += 3; segEvidence.push('Engineering team evidence'); }
  if (fs.contractor_usage_evidence) { segScore += 2; segEvidence.push('Contractor usage evidence'); }
  const segFinal = Math.min(segScore, 20);
  score += segFinal;
  subScores.push({ label: 'Segment & Scale', points: segFinal, max: 20, evidence: segEvidence });

  // Remote Access Pain (0-20)
  let rapScore = 0;
  const rapEvidence: string[] = [];
  if (painSigs?.includes('byoc') && fs.byod_byoc_evidence) {
    rapScore += 20;
    rapEvidence.push('BYOC evidence (campaign signal)');
  } else if (fs.remote_workforce_evidence === 'confirmed' && fs.byod_byoc_evidence) {
    rapScore += 20;
    rapEvidence.push('Remote workforce confirmed + BYOD/BYOC');
  } else if (fs.remote_workforce_evidence === 'confirmed') {
    rapScore += 14;
    rapEvidence.push('Remote workforce confirmed');
  } else if (fs.remote_workforce_evidence === 'inferred') {
    rapScore += 8;
    rapEvidence.push('Remote workforce inferred');
  }
  if (painSigs?.includes('multi_office') && fs.multi_office) {
    rapScore += 4;
    rapEvidence.push(`Multi-office (campaign signal)`);
  } else if (fs.multi_office && (fs.office_count ?? 0) >= 3) {
    rapScore += 4;
    rapEvidence.push(`Multi-office: ${fs.office_count} offices`);
  }
  if (painSigs?.includes('developer_experience') && fs.developer_experience_initiative) {
    rapScore += 5;
    rapEvidence.push('DevEx initiative (campaign signal)');
  } else if (fs.developer_experience_initiative) {
    rapScore += 3;
    rapEvidence.push('Developer experience initiative');
  }
  const rapFinal = Math.min(20, rapScore);
  score += rapFinal;
  subScores.push({ label: 'Remote Access Pain', points: rapFinal, max: 20, evidence: rapEvidence });

  // Displacement Wedge (0-20)
  let dispScore = 0;
  const dispEvidence: string[] = [];
  const confirmedVpn = fs.vpn_products_detected.filter(v => v.confidence === 'confirmed');
  const inferredVpn = fs.vpn_products_detected.filter(v => v.confidence === 'inferred');
  const confirmedComp = fs.competitor_products_detected.filter(v => v.confidence === 'confirmed');
  const inferredComp = fs.competitor_products_detected.filter(v => v.confidence === 'inferred');

  if (confirmedVpn.length > 0) {
    dispScore = 20;
    dispEvidence.push(`VPN confirmed: ${confirmedVpn.map(v => v.product).join(', ')}`);
  } else if (confirmedComp.length > 0) {
    dispScore = 16;
    dispEvidence.push(`Competitor confirmed: ${confirmedComp.map(c => c.product).join(', ')}`);
  } else if (dispSigs?.includes('byoc') && fs.byod_byoc_evidence) {
    dispScore = 14;
    dispEvidence.push('BYOC displacement (campaign signal)');
  } else if (inferredVpn.length > 0) {
    dispScore = 14;
    dispEvidence.push(`VPN inferred: ${inferredVpn.map(v => v.product).join(', ')}`);
  } else if (dispSigs?.includes('private_networking') && fs.byod_byoc_evidence) {
    dispScore = 12;
    dispEvidence.push('Private networking displacement (campaign signal)');
  } else if (inferredComp.length > 0) {
    dispScore = 10;
    dispEvidence.push(`Competitor inferred: ${inferredComp.map(c => c.product).join(', ')}`);
  } else if (fs.legacy_solution_indicators.length >= 2) {
    dispScore = 8;
    dispEvidence.push(`Legacy indicators: ${fs.legacy_solution_indicators.join(', ')}`);
  } else if (dispSigs?.includes('distributed_team') && fs.multi_office) {
    dispScore = 8;
    dispEvidence.push('Distributed team displacement (campaign signal)');
  } else if (fs.multi_office && (fs.office_count ?? 0) >= 3) {
    dispScore = 8;
    dispEvidence.push(`Multi-office displacement: ${fs.office_count} offices`);
  }
  score += dispScore;
  subScores.push({ label: 'Displacement Wedge', points: dispScore, max: 20, evidence: dispEvidence });

  // Vertical Match (0-15)
  let vertScore = 0;
  const vertEvidence: string[] = [];
  if (fs.vertical_match === 'exact' && fs.success_story_similarity === 'strong') {
    vertScore = 15;
    vertEvidence.push(`Exact vertical: ${fs.vertical_name || 'matched'}, strong success story`);
  } else if (fs.vertical_match === 'exact') {
    vertScore = 12;
    vertEvidence.push(`Exact vertical: ${fs.vertical_name || 'matched'}`);
  } else if (fs.vertical_match === 'adjacent') {
    vertScore = 8;
    vertEvidence.push(`Adjacent vertical: ${fs.vertical_name || 'matched'}`);
  } else if (fs.vertical_match === 'tangential') {
    vertScore = 4;
    vertEvidence.push(`Tangential vertical: ${fs.vertical_name || 'matched'}`);
  }
  score += vertScore;
  subScores.push({ label: 'Vertical Match', points: vertScore, max: 15, evidence: vertEvidence });

  // Buyer Access (0-10)
  let buyerScore = 0;
  const buyerEvidence: string[] = [];
  const champions = fs.named_contacts.filter(c => c.role_fit === 'champion');
  if (champions.length > 0 && champions.some(c => c.has_linkedin)) {
    buyerScore = 10;
    buyerEvidence.push(`Champion: ${champions[0].name} — ${champions[0].title} (LinkedIn)`);
  } else if (champions.length > 0) {
    buyerScore = 7;
    buyerEvidence.push(`Champion: ${champions[0].name} — ${champions[0].title} (no LinkedIn)`);
  } else if (fs.security_team_visible || fs.it_org_visible) {
    buyerScore = 5;
    if (fs.security_team_visible) buyerEvidence.push('Security team visible');
    if (fs.it_org_visible) buyerEvidence.push('IT org visible');
  }
  score += buyerScore;
  subScores.push({ label: 'Buyer Access', points: buyerScore, max: 10, evidence: buyerEvidence });

  // Penalties
  const penalties: { points: number; reason: string }[] = [];
  const disqualifiers = icpConfig.disqualifiers || [];
  const prospectText = [
    fs.industry, fs.sub_industry, fs.vertical_name,
    ...fs.legacy_solution_indicators,
    ...fs.vpn_products_detected.map(v => v.product),
    ...fs.competitor_products_detected.map(c => c.product),
  ].filter(Boolean).join(' ').toLowerCase();
  let penaltyTotal = 0;
  for (const dq of disqualifiers) {
    if (prospectText.includes(dq.signal.toLowerCase())) {
      const pts = dq.severity === 'hard' ? 20 : 5;
      penaltyTotal += pts;
      penalties.push({ points: -pts, reason: `${dq.severity === 'hard' ? 'Hard' : 'Soft'} disqualifier: ${dq.signal}` });
    }
  }
  score -= Math.min(penaltyTotal, 30);

  const finalScore = clamp(score, 0, 100);
  return {
    score: finalScore,
    breakdown: {
      dimension: 'icp_fit',
      score: finalScore,
      max: 100,
      sub_scores: subScores,
      penalties: penalties.length > 0 ? penalties : undefined,
    },
  };
}

export function computeTiming(fs: FactSheet): { score: number; breakdown: DimensionBreakdown } {
  let score = 0;
  const subScores: SubScore[] = [];

  // Active Evaluation (0-30)
  let evalScore = 0;
  const evalEvidence: string[] = [];
  const confirmedEval = fs.active_evaluation_evidence.filter(e => e.confidence === 'confirmed');
  const inferredEval = fs.active_evaluation_evidence.filter(e => e.confidence === 'inferred');
  if (confirmedEval.length > 0) {
    evalScore = 30;
    evalEvidence.push(...confirmedEval.map(e => `Confirmed: ${e.description}`));
  } else if (inferredEval.length > 0) {
    evalScore = 15;
    evalEvidence.push(...inferredEval.map(e => `Inferred: ${e.description}`));
  }
  score += evalScore;
  subScores.push({ label: 'Active Evaluation', points: evalScore, max: 30, evidence: evalEvidence });

  // Recent Triggers (0-25 total)
  const triggerEvidence: string[] = [];
  const recentFunding = fs.funding_events.filter(f => f.recency === 'recent');
  const recentLeadership = fs.leadership_changes.filter(l => l.recency === 'recent');
  let triggerScore = 0;
  if (recentFunding.length > 0) {
    triggerScore += Math.min(25, 15 + recentFunding.length * 3);
    triggerEvidence.push(...recentFunding.map(f => `Funding: ${f.type}${f.amount ? ` (${f.amount})` : ''}`));
  }
  if (recentLeadership.length > 0) {
    triggerScore += Math.min(15, 10 + recentLeadership.length * 2);
    triggerEvidence.push(...recentLeadership.map(l => `Leadership: ${l.title}`));
  }
  if (fs.compliance_signals.length > 0) {
    triggerScore += 10;
    triggerEvidence.push(...fs.compliance_signals.map(c => `Compliance: ${c.regulation}`));
  }
  const triggerFinal = Math.min(25, triggerScore);
  score += triggerFinal;
  subScores.push({ label: 'Recent Triggers', points: triggerFinal, max: 25, evidence: triggerEvidence });

  // Hiring Signals (0-20)
  let hiringScore = 0;
  const hiringEvidence: string[] = [];
  const vpnKeywords = ['vpn', 'ztna', 'zero trust', 'network access', 'remote access', 'sase'];
  const recentHiring = fs.hiring_signals.filter(h => h.recency === 'recent');
  const vpnHiring = recentHiring.filter(h =>
    h.keywords.some(k => vpnKeywords.some(vk => k.toLowerCase().includes(vk)))
  );
  if (vpnHiring.length > 0) {
    hiringScore = Math.min(20, 15 + vpnHiring.length * 2);
    hiringEvidence.push(...vpnHiring.map(h => `VPN-related: ${h.role}`));
  } else if (recentHiring.length > 0) {
    hiringScore = Math.min(10, 5 + recentHiring.length * 2);
    hiringEvidence.push(...recentHiring.map(h => `Hiring: ${h.role}`));
  }
  const agedHiring = fs.hiring_signals.filter(h => h.recency === 'aged' || h.recency === 'unknown');
  if (agedHiring.length > 0 && recentHiring.length === 0) {
    hiringScore += 3;
    hiringEvidence.push(`${agedHiring.length} aged hiring signal(s)`);
  }
  score += hiringScore;
  subScores.push({ label: 'Hiring Signals', points: hiringScore, max: 20, evidence: hiringEvidence });

  // Compound Growth (0-15)
  let compoundScore = 0;
  const compoundEvidence: string[] = [];
  const signalCategories = new Set<string>();
  if (recentFunding.length > 0) signalCategories.add('funding');
  if (recentHiring.length > 0) signalCategories.add('hiring');
  if (recentLeadership.length > 0) signalCategories.add('leadership');
  if (fs.compliance_signals.length > 0) signalCategories.add('compliance');
  if (confirmedEval.length > 0 || inferredEval.length > 0) signalCategories.add('evaluation');
  if (signalCategories.size >= 3) {
    compoundScore = 15;
    compoundEvidence.push(`${signalCategories.size} signal categories: ${[...signalCategories].join(', ')}`);
  } else if (signalCategories.size === 2) {
    compoundScore = 8;
    compoundEvidence.push(`2 signal categories: ${[...signalCategories].join(', ')}`);
  } else if (signalCategories.size === 1) {
    compoundScore = 3;
    compoundEvidence.push(`1 signal category: ${[...signalCategories].join(', ')}`);
  }
  score += compoundScore;
  subScores.push({ label: 'Compound Growth', points: compoundScore, max: 15, evidence: compoundEvidence });

  // Recency Modifier (0-10)
  let recencyScore = 0;
  const recencyEvidence: string[] = [];
  const allTimingSignals = [
    ...fs.funding_events.map(f => f.recency),
    ...fs.hiring_signals.map(h => h.recency),
    ...fs.leadership_changes.map(l => l.recency),
  ];
  if (allTimingSignals.length > 0) {
    const recentPct = allTimingSignals.filter(r => r === 'recent').length / allTimingSignals.length;
    if (recentPct > 0.5) {
      recencyScore = 10;
      recencyEvidence.push(`${Math.round(recentPct * 100)}% of signals are recent`);
    } else if (recentPct >= 0.25) {
      recencyScore = 5;
      recencyEvidence.push(`${Math.round(recentPct * 100)}% of signals are recent`);
    }
  }
  score += recencyScore;
  subScores.push({ label: 'Recency Modifier', points: recencyScore, max: 10, evidence: recencyEvidence });

  // Model knowledge penalty
  const modelKnowledgeEval = fs.active_evaluation_evidence.filter(e => e.confidence === 'model_knowledge');
  if (modelKnowledgeEval.length > 0 && confirmedEval.length === 0 && inferredEval.length === 0) {
    score = Math.round(score * 0.4);
  }

  const finalScore = clamp(score, 0, 100);
  return {
    score: finalScore,
    breakdown: {
      dimension: 'timing',
      score: finalScore,
      max: 100,
      sub_scores: subScores,
    },
  };
}

export function computeDataConfidence(fs: FactSheet, enrichMeta?: EnrichmentMetadata): { grade: DataConfidenceGrade; score: number; breakdown: DimensionBreakdown } {
  let raw = 0;
  const subScores: SubScore[] = [];

  // Source count (0-30): 6pts per source
  const sourceCount = enrichMeta?.sources_responded.length ?? 0;
  let srcScore = Math.min(30, sourceCount * 6);
  const srcEvidence: string[] = [`${sourceCount} source(s) responded`];
  if (sourceCount >= 8) { srcScore += 5; srcEvidence.push('Bonus: 8+ sources'); }
  srcScore = Math.min(35, srcScore);
  raw += srcScore;
  subScores.push({ label: 'Source Count', points: srcScore, max: 35, evidence: srcEvidence });

  // Field completeness (0-25)
  let fieldScore = 0;
  const fieldEvidence: string[] = [];
  const fields = enrichMeta?.field_completeness;
  if (fields) {
    const completed = Object.values(fields).filter(Boolean).length;
    fieldScore = Math.round((completed / 6) * 25);
    const present = Object.entries(fields).filter(([, v]) => v).map(([k]) => k);
    if (present.length > 0) fieldEvidence.push(`Fields: ${present.join(', ')}`);
  } else {
    if (fs.employee_count_confirmed) { fieldScore += 4; fieldEvidence.push('Employee count confirmed'); }
    if (fs.industry) { fieldScore += 4; fieldEvidence.push(`Industry: ${fs.industry}`); }
  }
  raw += fieldScore;
  subScores.push({ label: 'Field Completeness', points: fieldScore, max: 25, evidence: fieldEvidence });

  // Source corroboration (0-25)
  const corrobCount = enrichMeta?.corroboration_count ?? 0;
  const corrobScore = Math.min(25, corrobCount * 5);
  const corrobEvidence = corrobCount > 0 ? [`${corrobCount} field(s) corroborated by multiple sources`] : [];
  raw += corrobScore;
  subScores.push({ label: 'Corroboration', points: corrobScore, max: 25, evidence: corrobEvidence });

  // Domain validation (0-10)
  const domainScore = enrichMeta?.field_completeness?.website ? 10 : 0;
  const domainEvidence = domainScore > 0 ? ['Website validated'] : [];
  raw += domainScore;
  subScores.push({ label: 'Domain Validation', points: domainScore, max: 10, evidence: domainEvidence });

  // Signal-to-inference ratio (0-10)
  let ratioScore = 0;
  const ratioEvidence: string[] = [];
  const totalFacts = fs.facts_from_enrichment + fs.facts_from_model_knowledge;
  if (totalFacts > 0) {
    const enrichmentRatio = fs.facts_from_enrichment / totalFacts;
    ratioScore = Math.round(enrichmentRatio * 10);
    ratioEvidence.push(`${Math.round(enrichmentRatio * 100)}% from enrichment (${fs.facts_from_enrichment}/${totalFacts})`);
  }
  raw += ratioScore;
  subScores.push({ label: 'Signal-to-Inference', points: ratioScore, max: 10, evidence: ratioEvidence });

  raw = clamp(raw, 0, 100);

  let grade: DataConfidenceGrade;
  if (raw >= 80) grade = 'A';
  else if (raw >= 65) grade = 'B';
  else if (raw >= 45) grade = 'C';
  else if (raw >= 25) grade = 'D';
  else grade = 'F';

  return {
    grade,
    score: raw,
    breakdown: { dimension: 'data_confidence', score: raw, max: 100, sub_scores: subScores },
  };
}

export function computeReachability(fs: FactSheet, enrichMeta?: EnrichmentMetadata, scoringSignals?: ScoringSignals): { score: number; breakdown: DimensionBreakdown } {
  let score = 0;
  const subScores: SubScore[] = [];
  const creditRoleFit = scoringSignals?.credit_role_fit_without_urls ?? false;

  const champions = fs.named_contacts.filter(c => c.role_fit === 'champion');
  const econBuyers = fs.named_contacts.filter(c => c.role_fit === 'economic_buyer');
  const others = fs.named_contacts.filter(c => !['champion', 'economic_buyer'].includes(c.role_fit));

  // Champions (max 30)
  let champScore = 0;
  const champEvidence: string[] = [];
  const champLinked = champions.filter(c => c.has_linkedin).length;
  champScore += Math.min(30, champLinked * 30);
  if (champLinked > 0) champEvidence.push(...champions.filter(c => c.has_linkedin).map(c => `${c.name} — ${c.title} (LinkedIn)`));
  if (creditRoleFit && champLinked === 0 && champions.length > 0) {
    champScore += Math.min(15, champions.length * 15);
    champEvidence.push(...champions.map(c => `${c.name} — ${c.title} (role fit, no LinkedIn)`));
  }
  score += champScore;
  subScores.push({ label: 'Champions', points: champScore, max: 30, evidence: champEvidence });

  // Economic Buyers (max 20)
  let econScore = 0;
  const econEvidence: string[] = [];
  const econLinked = econBuyers.filter(c => c.has_linkedin).length;
  econScore += Math.min(20, econLinked * 20);
  if (econLinked > 0) econEvidence.push(...econBuyers.filter(c => c.has_linkedin).map(c => `${c.name} — ${c.title} (LinkedIn)`));
  if (creditRoleFit && econLinked === 0 && econBuyers.length > 0) {
    econScore += Math.min(10, econBuyers.length * 10);
    econEvidence.push(...econBuyers.map(c => `${c.name} — ${c.title} (role fit, no LinkedIn)`));
  }
  score += econScore;
  subScores.push({ label: 'Economic Buyers', points: econScore, max: 20, evidence: econEvidence });

  // Other Contacts (max 20)
  const othersLinked = others.filter(c => c.has_linkedin);
  const otherScore = Math.min(20, othersLinked.length * 10);
  const otherEvidence = othersLinked.map(c => `${c.name} — ${c.title} (LinkedIn)`);
  score += otherScore;
  subScores.push({ label: 'Other Contacts', points: otherScore, max: 20, evidence: otherEvidence });

  // Org Visibility (max 15)
  let orgScore = 0;
  const orgEvidence: string[] = [];
  if (fs.it_org_visible || fs.security_team_visible) {
    orgScore += 10;
    if (fs.security_team_visible) orgEvidence.push('Security team visible');
    if (fs.it_org_visible) orgEvidence.push('IT org visible');
  }
  if (enrichMeta?.field_completeness?.website) {
    orgScore += 5;
    orgEvidence.push('Company website validated');
  }
  score += orgScore;
  subScores.push({ label: 'Org Visibility', points: orgScore, max: 15, evidence: orgEvidence });

  // Emails (max 15)
  const emailContacts = fs.named_contacts.filter(c => c.has_email);
  const emailScore = Math.min(15, emailContacts.length * 5);
  const emailEvidence = emailContacts.map(c => `${c.name} — ${c.title} (email)`);
  score += emailScore;
  subScores.push({ label: 'Email Contacts', points: emailScore, max: 15, evidence: emailEvidence });

  const finalScore = clamp(score, 0, 100);
  return {
    score: finalScore,
    breakdown: { dimension: 'reachability', score: finalScore, max: 100, sub_scores: subScores },
  };
}

export function computeResearchCompleteness(enrichMeta?: EnrichmentMetadata): number {
  if (!enrichMeta || enrichMeta.sources_available.length === 0) return 0;
  const checked = enrichMeta.sources_responded.length + enrichMeta.sources_failed.length;
  return clamp(Math.round((checked / enrichMeta.sources_available.length) * 100), 0, 100);
}

export function computeSignalDensity(fs: FactSheet): SignalDensity {
  const entries: SignalEntry[] = [];

  for (const v of fs.vpn_products_detected) {
    entries.push({ category: 'competitive', description: `VPN: ${v.product}`, recency: 'unknown', source_type: v.confidence === 'model_knowledge' ? 'model_knowledge' : 'enrichment', source: v.source });
  }
  for (const c of fs.competitor_products_detected) {
    entries.push({ category: 'competitive', description: `Competitor: ${c.product}`, recency: 'unknown', source_type: c.confidence === 'model_knowledge' ? 'model_knowledge' : 'enrichment', source: c.source });
  }
  for (const f of fs.funding_events) {
    entries.push({ category: 'funding', description: `${f.type}${f.amount ? ` (${f.amount})` : ''}`, recency: f.recency, source_type: 'enrichment' });
  }
  for (const h of fs.hiring_signals) {
    entries.push({ category: 'hiring', description: h.role, recency: h.recency, source_type: 'enrichment' });
  }
  for (const l of fs.leadership_changes) {
    entries.push({ category: 'leadership', description: l.title, recency: l.recency, source_type: 'enrichment' });
  }
  for (const c of fs.compliance_signals) {
    entries.push({ category: 'compliance', description: c.regulation, recency: 'unknown', source_type: 'enrichment' });
  }

  const byCategory = {} as Record<SignalCategory, number>;
  const cats: SignalCategory[] = ['tech', 'hiring', 'funding', 'compliance', 'competitive', 'news', 'leadership'];
  for (const cat of cats) byCategory[cat] = 0;
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] || 0) + 1;

  return {
    total: entries.length,
    by_category: byCategory,
    recent_count: entries.filter(e => e.recency === 'recent').length,
    aged_count: entries.filter(e => e.recency === 'aged').length,
    model_knowledge_count: entries.filter(e => e.source_type === 'model_knowledge').length,
    entries,
  };
}

const SIGNAL_INTENT_WEIGHTS: Record<string, number> = {
  vpn_detection: 15, competitor: 12, hiring_vpn: 10,
  hiring_general: 5, compliance: 6, evaluation: 20,
  funding: 5, leadership: 3, news: 2,
};
const CONFIDENCE_MULT: Record<string, number> = { confirmed: 1.0, inferred: 0.7, model_knowledge: 0.3 };
const FRESHNESS_MULT: Record<string, number> = { recent: 1.0, aged: 0.5, unknown: 0.7 };

export function computeSignalQuality(fs: FactSheet, scoringSignals?: ScoringSignals): { score: number; breakdown: DimensionBreakdown } {
  let total = 0;
  const subScores: SubScore[] = [];
  const weights = { ...SIGNAL_INTENT_WEIGHTS, ...scoringSignals?.signal_intent_weights } as Record<string, number>;

  // VPN detections
  let vpnTotal = 0;
  const vpnEvidence: string[] = [];
  for (const v of fs.vpn_products_detected) {
    const pts = weights.vpn_detection * (CONFIDENCE_MULT[v.confidence] ?? 0.3) * FRESHNESS_MULT.unknown;
    vpnTotal += pts;
    vpnEvidence.push(`${v.product} (${v.confidence}) = ${Math.round(pts)}pts`);
  }
  if (vpnTotal > 0) subScores.push({ label: 'VPN Detection', points: Math.round(vpnTotal), max: 30, evidence: vpnEvidence });
  total += vpnTotal;

  // Competitor detections
  let compTotal = 0;
  const compEvidence: string[] = [];
  for (const c of fs.competitor_products_detected) {
    const pts = weights.competitor * (CONFIDENCE_MULT[c.confidence] ?? 0.3) * FRESHNESS_MULT.unknown;
    compTotal += pts;
    compEvidence.push(`${c.product} (${c.confidence}) = ${Math.round(pts)}pts`);
  }
  if (compTotal > 0) subScores.push({ label: 'Competitor Detection', points: Math.round(compTotal), max: 24, evidence: compEvidence });
  total += compTotal;

  // Active evaluation
  let evalTotal = 0;
  const evalEvidence: string[] = [];
  for (const e of fs.active_evaluation_evidence) {
    const pts = weights.evaluation * (CONFIDENCE_MULT[e.confidence] ?? 0.3) * FRESHNESS_MULT.recent;
    evalTotal += pts;
    evalEvidence.push(`${e.description} (${e.confidence}) = ${Math.round(pts)}pts`);
  }
  if (evalTotal > 0) subScores.push({ label: 'Active Evaluation', points: Math.round(evalTotal), max: 40, evidence: evalEvidence });
  total += evalTotal;

  // Hiring signals
  let hiringTotal = 0;
  const hiringEvidence: string[] = [];
  const vpnKeywords = ['vpn', 'ztna', 'zero trust', 'network access', 'remote access', 'sase'];
  for (const h of fs.hiring_signals) {
    const isVpn = h.keywords.some(k => vpnKeywords.some(vk => k.toLowerCase().includes(vk)));
    const weight = isVpn ? weights.hiring_vpn : weights.hiring_general;
    const pts = weight * CONFIDENCE_MULT.inferred * (FRESHNESS_MULT[h.recency] ?? 0.7);
    hiringTotal += pts;
    hiringEvidence.push(`${h.role}${isVpn ? ' (VPN-related)' : ''} [${h.recency}] = ${Math.round(pts)}pts`);
  }
  if (hiringTotal > 0) subScores.push({ label: 'Hiring Signals', points: Math.round(hiringTotal), max: 20, evidence: hiringEvidence });
  total += hiringTotal;

  // Funding & leadership & compliance
  let otherTotal = 0;
  const otherEvidence: string[] = [];
  for (const f of fs.funding_events) {
    const pts = weights.funding * CONFIDENCE_MULT.confirmed * (FRESHNESS_MULT[f.recency] ?? 0.7);
    otherTotal += pts;
    otherEvidence.push(`Funding: ${f.type}${f.amount ? ` (${f.amount})` : ''} [${f.recency}] = ${Math.round(pts)}pts`);
  }
  for (const l of fs.leadership_changes) {
    const pts = weights.leadership * CONFIDENCE_MULT.confirmed * (FRESHNESS_MULT[l.recency] ?? 0.7);
    otherTotal += pts;
    otherEvidence.push(`Leadership: ${l.title} [${l.recency}] = ${Math.round(pts)}pts`);
  }
  for (const c of fs.compliance_signals) {
    const pts = weights.compliance * CONFIDENCE_MULT.inferred * FRESHNESS_MULT.unknown;
    otherTotal += pts;
    otherEvidence.push(`Compliance: ${c.regulation} = ${Math.round(pts)}pts`);
  }
  if (otherTotal > 0) subScores.push({ label: 'Other Signals', points: Math.round(otherTotal), max: 20, evidence: otherEvidence });
  total += otherTotal;

  const finalScore = clamp(Math.round(total), 0, 100);
  return {
    score: finalScore,
    breakdown: { dimension: 'signal_quality', score: finalScore, max: 100, sub_scores: subScores },
  };
}

export function generateVerdict(dims: ScoringDimensions): string {
  const parts: string[] = [];

  if (dims.icp_fit >= 70) parts.push('Strong ICP match');
  else if (dims.icp_fit >= 50) parts.push('Moderate ICP fit');
  else parts.push('Weak ICP fit');

  if (dims.signal_quality >= 60) parts.push('strong buying signals');
  else if (dims.timing >= 60) parts.push('active buying signals');
  else if (dims.timing >= 30) parts.push('limited timing signals');
  else parts.push('no recent triggers');

  if (dims.data_confidence === 'D' || dims.data_confidence === 'F')
    parts.push('needs more research');
  if (dims.reachability < 30) parts.push('hard to reach');
  if (dims.watch_candidate) parts.push('watch candidate');

  return parts.join(', ');
}

export function computeAllDimensions(
  fs: FactSheet,
  icpConfig: ExtendedICPConfig,
  enrichMeta?: EnrichmentMetadata,
  scoringSignals?: ScoringSignals,
): ScoringDimensions {
  const { score: icp_fit, breakdown: icpBreakdown } = computeIcpFit(fs, icpConfig, scoringSignals);
  const { score: timing, breakdown: timingBreakdown } = computeTiming(fs);
  const { grade: data_confidence, score: data_confidence_score, breakdown: dcBreakdown } = computeDataConfidence(fs, enrichMeta);
  const { score: reachability, breakdown: reachBreakdown } = computeReachability(fs, enrichMeta, scoringSignals);
  const research_completeness = computeResearchCompleteness(enrichMeta);
  const signal_density = computeSignalDensity(fs);
  const { score: signal_quality, breakdown: sqBreakdown } = computeSignalQuality(fs, scoringSignals);

  const partialDims: ScoringDimensions = {
    icp_fit, timing, data_confidence, data_confidence_score,
    reachability, research_completeness, signal_density, signal_quality,
    potential_score: 0, urgency_score: 0, evidence_modifier: 1, watch_candidate: false, watch_reason: null, verdict: '',
    breakdowns: {
      icp_fit: icpBreakdown,
      timing: timingBreakdown,
      data_confidence: dcBreakdown,
      reachability: reachBreakdown,
      signal_quality: sqBreakdown,
    },
  };
  const composite = computeCompositeV2(partialDims);
  partialDims.potential_score = composite.potential_score;
  partialDims.urgency_score = composite.urgency_score;
  partialDims.evidence_modifier = composite.evidence_modifier;
  partialDims.watch_candidate = composite.potential_score >= 60 && composite.urgency_score < 35;
  partialDims.watch_reason = partialDims.watch_candidate
    ? `High fit (${composite.potential_score}) but low intent (${composite.urgency_score})`
    : null;
  partialDims.verdict = generateVerdict(partialDims);
  return partialDims;
}

export function computeComposite(dims: ScoringDimensions, weightIcp = 60, weightTiming = 40): number {
  return clamp(Math.round(dims.icp_fit * (weightIcp / 100) + dims.timing * (weightTiming / 100)), 0, 100);
}

export function computeCompositeV2(
  dims: ScoringDimensions,
  weightPotential = 55,
  weightUrgency = 45,
): { fit_score: number; potential_score: number; urgency_score: number; evidence_modifier: number } {
  const potential_score = Math.round(dims.icp_fit * 0.70 + dims.reachability * 0.20 + dims.data_confidence_score * 0.10);
  const urgency_score = Math.round(dims.timing * 0.60 + dims.signal_quality * 0.40);
  const evidence_modifier = 0.5 + (dims.research_completeness / 200);
  const raw = (potential_score * (weightPotential / 100) + urgency_score * (weightUrgency / 100)) * evidence_modifier;
  return {
    fit_score: clamp(Math.round(raw), 0, 100),
    potential_score: clamp(potential_score, 0, 100),
    urgency_score: clamp(urgency_score, 0, 100),
    evidence_modifier: Math.round(evidence_modifier * 1000) / 1000,
  };
}

export function dimensionsToLegacyBreakdown(dims: ScoringDimensions, fs: FactSheet): ScoreBreakdown {
  return {
    segment_scale_fit: {
      points: Math.round(dims.icp_fit * 0.2),
      evidence: [
        fs.employee_count_confirmed ? `Employee count confirmed (${fs.employee_count_range})` : `Employee range: ${fs.employee_count_range}`,
        ...(fs.engineering_team_evidence ? ['Engineering team evidence found'] : []),
        ...(fs.contractor_usage_evidence ? ['Contractor usage evidence found'] : []),
      ],
    },
    why_now_triggers: {
      points: Math.round(dims.timing * 0.15),
      evidence: [
        ...fs.funding_events.map(f => `Funding: ${f.type}${f.amount ? ` (${f.amount})` : ''} [${f.recency}]`),
        ...fs.hiring_signals.map(h => `Hiring: ${h.role} [${h.recency}]`),
        ...fs.leadership_changes.map(l => `Leadership: ${l.title} [${l.recency}]`),
        ...(fs.active_evaluation_evidence.length > 0 ? [`Active evaluation: ${fs.active_evaluation_evidence[0].description}`] : []),
        `Signal quality: ${dims.signal_quality}/100`,
      ],
    },
    remote_access_pain: {
      points: Math.min(20, Math.round(dims.icp_fit * 0.2)),
      evidence: [
        `Remote workforce: ${fs.remote_workforce_evidence}`,
        ...(fs.byod_byoc_evidence ? ['BYOD/BYOC evidence found'] : []),
        ...(fs.multi_office ? [`Multi-office: ${fs.office_count ?? 'yes'}`] : []),
      ],
    },
    displacement_wedge: {
      points: Math.round(dims.icp_fit * 0.2),
      evidence: [
        ...fs.vpn_products_detected.map(v => `VPN: ${v.product} (${v.confidence})`),
        ...fs.competitor_products_detected.map(c => `Competitor: ${c.product} (${c.confidence})`),
        ...fs.legacy_solution_indicators.map(i => `Legacy indicator: ${i}`),
      ],
    },
    vertical_playbook: {
      points: Math.round(dims.icp_fit * 0.15),
      evidence: [
        `Vertical: ${fs.vertical_name ?? 'none'} (${fs.vertical_match})`,
        `Success story similarity: ${fs.success_story_similarity}`,
      ],
    },
    buyer_access_readiness: {
      points: Math.min(10, Math.round(dims.reachability * 0.1)),
      evidence: [
        `Named contacts: ${fs.named_contacts.length}`,
        ...(fs.security_team_visible ? ['Security team visible'] : []),
        ...(fs.it_org_visible ? ['IT org visible'] : []),
      ],
    },
    penalties: [],
    total: 0,
  };
}

export interface FactSheetChange {
  field: string;
  type: 'upgrade' | 'downgrade' | 'new' | 'removed' | 'changed';
  old_value: any;
  new_value: any;
}

export function diffFactSheets(oldFs: FactSheet, newFs: FactSheet): FactSheetChange[] {
  const changes: FactSheetChange[] = [];

  const scalarFields: (keyof FactSheet)[] = [
    'industry', 'sub_industry', 'employee_count_confirmed', 'employee_count_range',
    'engineering_team_evidence', 'contractor_usage_evidence', 'multi_office', 'office_count',
    'remote_workforce_evidence', 'byod_byoc_evidence', 'developer_experience_initiative',
    'vertical_match', 'vertical_name', 'success_story_similarity',
    'security_team_visible', 'it_org_visible',
    'facts_from_enrichment', 'facts_from_model_knowledge', 'fact_confidence',
  ];

  for (const field of scalarFields) {
    const oldVal = oldFs[field];
    const newVal = newFs[field];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      let type: FactSheetChange['type'] = 'changed';
      if (oldVal == null && newVal != null) type = 'new';
      else if (oldVal != null && newVal == null) type = 'removed';
      else if (field === 'fact_confidence') {
        const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
        type = (rank[newVal as string] ?? 0) > (rank[oldVal as string] ?? 0) ? 'upgrade' : 'downgrade';
      }
      changes.push({ field: field as string, type, old_value: oldVal, new_value: newVal });
    }
  }

  const arrayFields: { field: keyof FactSheet; itemKey: string; confKey?: string }[] = [
    { field: 'vpn_products_detected', itemKey: 'product', confKey: 'confidence' },
    { field: 'competitor_products_detected', itemKey: 'product', confKey: 'confidence' },
    { field: 'active_evaluation_evidence', itemKey: 'description', confKey: 'confidence' },
  ];

  for (const { field, itemKey, confKey } of arrayFields) {
    const oldArr = (oldFs[field] as any[]) || [];
    const newArr = (newFs[field] as any[]) || [];
    const oldKeys = new Set(oldArr.map(i => i[itemKey]));
    const newKeys = new Set(newArr.map(i => i[itemKey]));

    for (const item of newArr) {
      if (!oldKeys.has(item[itemKey])) {
        changes.push({ field: `${field as string}.${item[itemKey]}`, type: 'new', old_value: null, new_value: item });
      } else if (confKey) {
        const oldItem = oldArr.find(o => o[itemKey] === item[itemKey]);
        if (oldItem && oldItem[confKey] !== item[confKey]) {
          const type = item[confKey] === 'confirmed' ? 'upgrade' : oldItem[confKey] === 'confirmed' ? 'downgrade' : 'changed';
          changes.push({ field: `${field as string}.${item[itemKey]}`, type, old_value: oldItem, new_value: item });
        }
      }
    }
    for (const item of oldArr) {
      if (!newKeys.has(item[itemKey])) {
        changes.push({ field: `${field as string}.${item[itemKey]}`, type: 'removed', old_value: item, new_value: null });
      }
    }
  }

  return changes;
}

export async function scoreCandidateDeterministic(
  candidate: ResearchCandidate,
  icpConfig: ExtendedICPConfig,
  model?: string,
  tracker?: TokenTracker,
  promptInstructions?: string,
  stepConfig?: FunnelStepConfig,
  streamCtx?: StreamContext,
  enrichmentMeta?: EnrichmentMetadata,
  feedbackContext?: FeedbackContext | null,
  previousFactSheet?: FactSheet | null,
): Promise<ScoringResult> {
  const aiConfig = getAIConfig();
  const client = await createAIClient();

  // Apply per-campaign ICP overrides from step config
  const useOrg = stepConfig?.use_org_icp !== false;
  const effectiveIcp = { ...icpConfig };
  if (!useOrg && stepConfig?.icp_verticals_override?.length) effectiveIcp.verticals = stepConfig.icp_verticals_override;
  if (!useOrg && stepConfig?.icp_tech_signals_override?.length) effectiveIcp.tech_signals = stepConfig.icp_tech_signals_override;
  if (!useOrg && stepConfig?.icp_competitors_override?.length) effectiveIcp.competitors = stepConfig.icp_competitors_override;

  const systemPrompt = getFactExtractionPrompt(effectiveIcp);
  let userMessage = buildFactExtractionUserMessage(candidate);
  if (promptInstructions) {
    userMessage += `\n\n## Additional Instructions\n${promptInstructions}`;
  }
  if (feedbackContext) {
    userMessage += `\n\n## Historical Campaign Patterns (from ${feedbackContext.feedbackCount} reviewed leads)\n${feedbackContext.scoring_adjustments}\n\n### Known Bad-Fit Patterns\n${feedbackContext.known_bad_patterns}`;
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
        thinking: { type: 'adaptive' },
      } as any),
    );
    if (tracker) tracker.addUsage(response);
    rawText = response.content.find((b: any) => b.type === 'text')?.text || '';
    thinkingText = response.content.find((b: any) => b.type === 'thinking')?.thinking || '';
  }

  const jsonStr = extractJson(rawText);

  try {
    const factSheet: FactSheet = JSON.parse(jsonStr);

    const factsheet_changes = previousFactSheet ? diffFactSheets(previousFactSheet, factSheet) : undefined;
    if (factsheet_changes?.length) {
      const downgrades = factsheet_changes.filter(c => c.type === 'downgrade');
      if (downgrades.length > 0) {
        console.warn(`[scorer-v2] FactSheet downgrades for ${candidate.company_name}: ${downgrades.map(d => d.field).join(', ')}`);
      }
    }

    const dimensions = computeAllDimensions(factSheet, effectiveIcp, enrichmentMeta, stepConfig?.scoring_signals);
    const cw = stepConfig?.composite_weights;
    const isV2 = !cw || ('version' in cw && cw.version === 2);
    const fitScore = isV2
      ? computeCompositeV2(dimensions, (cw && 'potential' in cw) ? cw.potential : 55, (cw && 'urgency' in cw) ? cw.urgency : 45).fit_score
      : computeComposite(dimensions, (cw && 'icp_fit' in cw) ? cw.icp_fit : 60, (cw && 'timing' in cw) ? cw.timing : 40);
    const label = scoreToLabel(fitScore);
    const breakdown = dimensionsToLegacyBreakdown(dimensions, factSheet);
    breakdown.total = fitScore;

    let confidence: 'low' | 'medium' | 'high';
    if (dimensions.data_confidence === 'A' || dimensions.data_confidence === 'B') {
      confidence = 'high';
    } else if (dimensions.data_confidence === 'C') {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    const enrichmentSourceCount = candidate.enrichment_source_count ?? 0;
    if (enrichmentSourceCount === 0) confidence = 'low';
    else if (enrichmentSourceCount === 1 && confidence === 'high') confidence = 'medium';

    return {
      fit_score: fitScore,
      fit_score_label: label,
      confidence,
      score_breakdown: breakdown,
      dimensions,
      fact_sheet: factSheet,
      scoring_version: 2,
      reasoning: thinkingText || undefined,
      factsheet_changes,
    };
  } catch (err) {
    console.error(`[scorer-v2] Failed to parse FactSheet for ${candidate.company_name}:`, err);
    console.error(`[scorer-v2] Raw response:`, rawText.substring(0, 500));
    return {
      fit_score: 0,
      fit_score_label: '1 star',
      confidence: 'low',
      score_breakdown: {
        segment_scale_fit: { points: 0, evidence: ['Fact extraction failed'] },
        why_now_triggers: { points: 0, evidence: ['Fact extraction failed'] },
        remote_access_pain: { points: 0, evidence: ['Fact extraction failed'] },
        displacement_wedge: { points: 0, evidence: ['Fact extraction failed'] },
        vertical_playbook: { points: 0, evidence: ['Fact extraction failed'] },
        buyer_access_readiness: { points: 0, evidence: ['Fact extraction failed'] },
        penalties: [],
        total: 0,
      },
      scoring_version: 2,
    };
  }
}
