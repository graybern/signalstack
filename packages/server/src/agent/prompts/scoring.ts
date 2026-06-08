import type { ExtendedICPConfig } from '../../types/index.js';

export interface ScoringWeights {
  segment_scale_fit?: number;
  why_now_triggers?: number;
  remote_access_pain?: number;
  displacement_wedge?: number;
  vertical_playbook?: number;
  buyer_access_readiness?: number;
}

const DEFAULT_WEIGHTS: Required<ScoringWeights> = {
  segment_scale_fit: 20,
  why_now_triggers: 15,
  remote_access_pain: 20,
  displacement_wedge: 20,
  vertical_playbook: 15,
  buyer_access_readiness: 10,
};

export function getScoringPrompt(icpConfig: ExtendedICPConfig, scoringWeights?: ScoringWeights, enrichmentSourceCount?: number): string {
  const w = { ...DEFAULT_WEIGHTS, ...scoringWeights };
  const total = w.segment_scale_fit + w.why_now_triggers + w.remote_access_pain + w.displacement_wedge + w.vertical_playbook + w.buyer_access_readiness;

  const scale = (pct: number) => Math.round(pct * total / 100);

  const companyName = icpConfig.company_context?.company_name || 'the company';
  const oneLiner = icpConfig.company_context?.one_liner || 'a B2B technology solution';
  const competitors = icpConfig.competitors || [];
  const verticals = icpConfig.verticals || [];
  const techSignals = icpConfig.tech_signals || [];
  const productsToReplace = icpConfig.products_to_replace || [];
  const platformInitiatives = icpConfig.platform_initiatives || [];
  const disqualifiers = icpConfig.disqualifiers || [];
  const signalWeights = icpConfig.signal_weights || [];
  const valueProps = icpConfig.company_context?.value_props || [];
  const differentiators = icpConfig.company_context?.differentiators || [];
  const buyerPersonas = icpConfig.buyer_personas || {};
  const successStories = icpConfig.success_stories || {};
  const productName = icpConfig.company_context?.product_name || companyName;

  const topCompetitors = competitors.slice(0, 3).join(', ') || 'legacy solutions';
  const topVerticals = verticals.slice(0, 3).join(', ') || 'target verticals';

  const srcCount = enrichmentSourceCount ?? 0;
  let dataQualitySection = `\n## Data Quality Context\nThis candidate was enriched by ${srcCount} external data source(s).\n`;
  if (srcCount === 0) {
    dataQualitySection += 'WARNING: No external data sources confirmed this company. All information comes from AI research only. Score conservatively and set confidence to "low".\n';
  } else if (srcCount === 1) {
    dataQualitySection += 'Note: Limited external validation. Consider setting confidence to "medium" unless evidence is very strong.\n';
  } else if (srcCount >= 3) {
    dataQualitySection += 'Multiple data sources corroborate this company\'s information. High-confidence scoring is appropriate if evidence supports it.\n';
  }

  // Build disqualifiers section from ICP config
  let disqualifiersSection = '';
  if (disqualifiers.length > 0) {
    const hardDqs = disqualifiers.filter(d => d.severity === 'hard');
    const softDqs = disqualifiers.filter(d => d.severity === 'soft');
    disqualifiersSection = `\n### ICP Disqualifiers\nApply additional penalties for these company-specific signals:\n`;
    if (hardDqs.length > 0) {
      disqualifiersSection += hardDqs.map(d => `- **HARD PENALTY (-15 to -25):** ${d.signal}${d.notes ? ` — ${d.notes}` : ''}`).join('\n') + '\n';
    }
    if (softDqs.length > 0) {
      disqualifiersSection += softDqs.map(d => `- **SOFT PENALTY (-3 to -8):** ${d.signal}${d.notes ? ` — ${d.notes}` : ''}`).join('\n') + '\n';
    }
  }

  // Build signal weights section from ICP config
  let signalWeightsSection = '';
  if (signalWeights.length > 0) {
    const topSignals = [...signalWeights].sort((a, b) => b.weight - a.weight).slice(0, 8);
    signalWeightsSection = `\n### Signal Prioritization\nWhen evaluating evidence, weight these signals according to ICP priority:\n${topSignals.map(s => `- [${s.weight}/10] ${s.signal} (${s.category})`).join('\n')}\n`;
  }

  return `You are an expert B2B sales scoring analyst for ${companyName}${productName !== companyName ? ` (${productName})` : ''}, ${oneLiner}. Your job is to evaluate a prospect company against ${companyName}'s Ideal Customer Profile and assign a fit score using a precise ${total}-point rubric.
${dataQualitySection}
## Scoring Rubric (${total} points total)

### 1. Segment + Scale Fit (0–${w.segment_scale_fit} points)
- ${w.segment_scale_fit}: Perfect segment match with confirmed user count in range
- ${Math.round(w.segment_scale_fit * 0.75)}: Strong match — employee count and tech footprint clearly indicate segment fit
- ${Math.round(w.segment_scale_fit * 0.5)}: Likely fit based on available signals, but some data gaps
- ${Math.round(w.segment_scale_fit * 0.25)}: Marginal fit — on the edge of segment boundaries
- 0: Poor fit — clearly outside segment parameters

Evidence to consider: employee count, engineering team size, office locations, contractor usage, estimated user count.

### 2. Why Now Triggers (0–${w.why_now_triggers} points)
- ${w.why_now_triggers}: Active evaluation or replacement project confirmed
- ${Math.round(w.why_now_triggers * 0.8)}: Recent trigger event (security incident, compliance mandate, new CTO/CISO, IPO prep)
- ${Math.round(w.why_now_triggers * 0.6)}: Relevant job postings, RFP signals, or **multiple compounding growth signals** (e.g., recent funding + hiring surge + geographic expansion together indicate near-term infrastructure needs)
- ${Math.round(w.why_now_triggers * 0.4)}: At least one growth or modernization signal with plausible urgency
- 0: No discernible urgency or timing signals

Evidence to consider: job postings, press releases, funding announcements, leadership changes, compliance initiatives. **Compound signals**: when 3+ signals from different categories all suggest growing infrastructure needs, score at the upper end even if no single signal is definitive.

### 3. Remote Access Pain Likelihood (0–${w.remote_access_pain} points)
- ${w.remote_access_pain}: Confirmed pain with current solution, ${companyName}-relevant use case validated
- ${Math.round(w.remote_access_pain * 0.75)}: Remote/hybrid with BYOC/BYOD policies, contractor-heavy workforce
- ${Math.round(w.remote_access_pain * 0.5)}: Distributed engineering team, likely using legacy solution for resource access
- ${Math.round(w.remote_access_pain * 0.25)}: Some remote workers but pain is speculative
- 0: Office-only or no evidence of remote access needs

Evidence to consider: remote work policies, BYOC/BYOD programs, contractor workforce, developer experience initiatives, geographic distribution.

### 4. Displacement / Competitive Wedge (0–${w.displacement_wedge} points)
- ${w.displacement_wedge}: Using a known competitor with documented dissatisfaction
- ${Math.round(w.displacement_wedge * 0.75)}: Using legacy solution (${topCompetitors}) with scale pain, OR company profile **strongly implies usage** (e.g., distributed engineering teams + compliance requirements + large contractor workforce)
- ${Math.round(w.displacement_wedge * 0.5)}: Likely using a traditional solution based on tech stack signals or industry norms
- ${Math.round(w.displacement_wedge * 0.35)}: Unknown current solution but company characteristics suggest relevant needs
- 0: Recently purchased a competitor or locked into a long contract

Evidence to consider: tech stack signals, G2/TrustRadius reviews, job postings mentioning specific tools, LinkedIn signals. **Important**: Don't require the specific product to be named to score above 50%. Compound evidence from industry, tech stack, and workforce distribution that strongly implies usage should score ${Math.round(w.displacement_wedge * 0.6)}–${Math.round(w.displacement_wedge * 0.75)}.
${productsToReplace.length > 0 ? `\nProducts to replace (displacement targets): ${productsToReplace.join(', ')}` : ''}${platformInitiatives.length > 0 ? `\nPlatform initiatives (buying readiness signals): ${platformInitiatives.join(', ')}` : ''}
${valueProps.length > 0 || differentiators.length > 0 ? `\n${companyName} key advantages to evaluate against prospect needs:${valueProps.length > 0 ? `\n- Value props: ${valueProps.join(', ')}` : ''}${differentiators.length > 0 ? `\n- Differentiators: ${differentiators.join(', ')}` : ''}` : ''}

### 5. Vertical / Playbook Match (0–${w.vertical_playbook} points)
- ${w.vertical_playbook}: Core vertical (${topVerticals}) with strong pattern match to existing wins
- ${Math.round(w.vertical_playbook * 0.8)}: Adjacent vertical with similar access patterns and pain points
- ${Math.round(w.vertical_playbook * 0.53)}: Relevant vertical but less proven playbook
- ${Math.round(w.vertical_playbook * 0.27)}: Tangentially related industry
- 0: Vertical with no clear fit or relevance

Evidence to consider: industry, business model, engineering culture, product type, similar customers.
${Object.keys(successStories).length > 0 ? `\nExisting wins to match against:\n${Object.entries(successStories).map(([vertical, companies]) => `- **${vertical}**: ${(companies as string[]).join(', ')}`).join('\n')}\nCompanies similar to these success stories score higher.` : ''}

### 6. Buyer Access + Org Readiness (0–${w.buyer_access_readiness} points)
- ${w.buyer_access_readiness}: Identifiable champion + economic buyer, security team with budget authority
- ${Math.round(w.buyer_access_readiness * 0.7)}: Clear IT/security org, likely receptive to outbound
- ${Math.round(w.buyer_access_readiness * 0.4)}: Some buyer signals but org structure unclear
- ${Math.round(w.buyer_access_readiness * 0.2)}: Large bureaucratic org or procurement-heavy
- 0: No identifiable path to buyer

Evidence to consider: org structure, security team presence, IT leadership on LinkedIn, procurement processes.
${Object.keys(buyerPersonas).length > 0 ? `\nTarget buyer roles to look for: ${Object.entries(buyerPersonas).map(([key, p]) => `${(p as any).label || key} (${(p as any).titles?.slice(0, 2).join(', ') || 'N/A'})`).join(', ')}` : ''}

### 7. Evidence Density Modifier
Within each category above, adjust your score based on signal depth:
- **Multiple corroborating signals from different sources** → score at the upper end of the tier.
- **Single signal or vague inference** → score at the lower end of the tier.
- **Zero signals for a category** → score 0 or near-0, do not speculate points into existence.

Count the signals and sources provided. A candidate with 8+ specific signals across multiple source types (job postings, tech stack, press, reviews) warrants higher scores than one with 2-3 generic signals from AI knowledge alone. Quantify your evidence: cite the actual number of corroborating data points in each category's evidence array.
${signalWeightsSection}
### 8. Penalties (up to -30 points)
Apply penalties for any of the following:
- Recently recommended and rejected (-5 to -10)
- Known long-term competitor contract (-5 to -10)
- In active litigation or financial distress (-5)
- Negative feedback pattern match (-5 per pattern)
${disqualifiersSection}
## Star Rating Map
- ${scale(85)}–${total} points = 5 stars (Exceptional fit, immediate outreach)
- ${scale(70)}–${scale(84)} points = 4 stars (Strong fit, prioritize)
- ${scale(55)}–${scale(69)} points = 3 stars (Good fit, standard cadence)
- ${scale(35)}–${scale(54)} points = 2 stars (Marginal fit, nurture)
- Below ${scale(35)} points = 1 star (Poor fit, deprioritize)

## Confidence Level
Assign a confidence level based on data quality:
- "high": Multiple corroborating sources, recent data
- "medium": Some signals confirmed, some inferred
- "low": Mostly inferred, limited public data

## Output Format
Return a JSON object with this exact structure:
\`\`\`json
{
  "fit_score": 0,
  "fit_score_label": "X stars",
  "confidence": "low|medium|high",
  "score_breakdown": {
    "segment_scale_fit": { "points": 0, "evidence": ["..."] },
    "why_now_triggers": { "points": 0, "evidence": ["..."] },
    "remote_access_pain": { "points": 0, "evidence": ["..."] },
    "displacement_wedge": { "points": 0, "evidence": ["..."] },
    "vertical_playbook": { "points": 0, "evidence": ["..."] },
    "buyer_access_readiness": { "points": 0, "evidence": ["..."] },
    "penalties": [{ "points": 0, "reason": "..." }],
    "total": 0
  }
}
\`\`\`

Return ONLY the JSON object, no other text.`;
}

export function getFactExtractionPrompt(icpConfig: ExtendedICPConfig): string {
  const companyName = icpConfig.company_context?.company_name || 'the company';
  const oneLiner = icpConfig.company_context?.one_liner || 'a B2B technology solution';
  const competitors = icpConfig.competitors || [];
  const verticals = icpConfig.verticals || [];
  const productsToReplace = icpConfig.products_to_replace || [];
  const successStories = icpConfig.success_stories || {};

  return `You are a fact extraction analyst for ${companyName}, ${oneLiner}. Your job is to extract and classify structured facts from enrichment data about a prospect company.

## CRITICAL RULES
1. Do NOT assign scores or point values. Extract facts only.
2. Classify every fact as one of:
   - "confirmed" — directly evidenced by an enrichment source with a URL or document
   - "inferred" — logically deduced from multiple signals but not directly stated
   - "model_knowledge" — from your training data, not from the provided enrichment
3. Be conservative: if unsure, mark it "model_knowledge".
4. Do NOT fabricate facts. If information is absent, use null or empty arrays.
5. For recency: "recent" = within 90 days, "aged" = older than 90 days, "unknown" = no date available.

## ICP Context (for classifying vertical match and product relevance)
- **Target Verticals:** ${verticals.join(', ') || 'Not specified'}
- **Products to Replace:** ${productsToReplace.join(', ') || 'Legacy VPN solutions'}
- **Competitors:** ${competitors.join(', ') || 'Not specified'}
${Object.keys(successStories).length > 0 ? `- **Success Story Verticals:** ${Object.keys(successStories).join(', ')}\n` : ''}
## Output Format
Return a JSON object with this exact structure (FactSheet):
\`\`\`json
{
  "industry": "string or null",
  "sub_industry": "string or null",
  "employee_count_confirmed": false,
  "employee_count_range": "smb|mm|ent|unknown",
  "engineering_team_evidence": false,
  "contractor_usage_evidence": false,
  "multi_office": false,
  "office_count": null,

  "remote_workforce_evidence": "confirmed|inferred|none",
  "byod_byoc_evidence": false,
  "developer_experience_initiative": false,

  "vpn_products_detected": [{"product": "...", "confidence": "confirmed|inferred|model_knowledge", "source": "..."}],
  "competitor_products_detected": [{"product": "...", "confidence": "confirmed|inferred|model_knowledge", "source": "..."}],
  "legacy_solution_indicators": ["..."],

  "vertical_match": "exact|adjacent|tangential|none",
  "vertical_name": "string or null",
  "success_story_similarity": "strong|moderate|weak|none",

  "funding_events": [{"type": "...", "amount": "...", "date": "...", "recency": "recent|aged|unknown"}],
  "hiring_signals": [{"role": "...", "keywords": ["..."], "date": "...", "recency": "recent|aged|unknown"}],
  "leadership_changes": [{"title": "...", "date": "...", "recency": "recent|aged|unknown"}],
  "compliance_signals": [{"regulation": "...", "evidence": "..."}],
  "active_evaluation_evidence": [{"description": "...", "confidence": "confirmed|inferred|model_knowledge", "source": "..."}],

  "named_contacts": [{"name": "...", "title": "...", "has_linkedin": false, "has_email": false, "role_fit": "champion|economic_buyer|technical|executive|unknown"}],
  "security_team_visible": false,
  "it_org_visible": false,

  "facts_from_enrichment": 0,
  "facts_from_model_knowledge": 0,
  "fact_confidence": "high|medium|low"
}
\`\`\`

Return ONLY the JSON object, no other text.`;
}

export function buildFactExtractionUserMessage(
  candidate: { company_name: string; domain: string; segment: string; employee_count_estimate: number | null; hq_location: string | null; founded_year: number | null; funding_stage: string | null; total_funding: string | null; investors: string | null; signals: string[]; sources: string[]; notes: string; enrichment_source_count?: number; domain_validated?: boolean; linkedin_company_url?: string | null; key_people?: { name: string; title: string; linkedin_url?: string }[] },
): string {
  const enrichmentSourceCount = candidate.enrichment_source_count ?? 0;
  const signalCount = candidate.signals.length;
  const sourceCount = candidate.sources.length;

  const keyPeopleSection = candidate.key_people?.length
    ? `\n## Key People Found (${candidate.key_people.length})\n${candidate.key_people.map(p => `- **${p.name}** — ${p.title}${p.linkedin_url ? ` (LinkedIn: ${p.linkedin_url})` : ''}`).join('\n')}`
    : '';

  return `Extract structured facts from the following prospect data. Do NOT assign scores.

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
- **LinkedIn:** ${candidate.linkedin_company_url ?? 'Not found'}
- **Domain Validated:** ${candidate.domain_validated ? 'Yes (DNS + HTTP)' : 'No'}

## Evidence Summary
- **${signalCount} signal(s)** from **${sourceCount} source(s)**, enriched by **${enrichmentSourceCount} external data source(s)**

## Signals (${signalCount})
${candidate.signals.map(s => `- ${s}`).join('\n') || '- None identified'}

## Sources (${sourceCount})
${candidate.sources.map(s => `- ${s}`).join('\n') || '- None'}

## Research Notes
${candidate.notes}
${keyPeopleSection}

Classify every fact. Mark enrichment-sourced facts as "confirmed" or "inferred". Mark training-data facts as "model_knowledge". Be conservative.`;
}
