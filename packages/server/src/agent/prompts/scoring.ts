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

export function getScoringPrompt(scoringWeights?: ScoringWeights, enrichmentSourceCount?: number): string {
  const w = { ...DEFAULT_WEIGHTS, ...scoringWeights };
  const total = w.segment_scale_fit + w.why_now_triggers + w.remote_access_pain + w.displacement_wedge + w.vertical_playbook + w.buyer_access_readiness;

  // Scale tier breakpoints proportionally (default total = 100)
  const scale = (pct: number) => Math.round(pct * total / 100);

  const srcCount = enrichmentSourceCount ?? 0;
  let dataQualitySection = `\n## Data Quality Context\nThis candidate was enriched by ${srcCount} external data source(s).\n`;
  if (srcCount === 0) {
    dataQualitySection += 'WARNING: No external data sources confirmed this company. All information comes from AI research only. Score conservatively and set confidence to "low".\n';
  } else if (srcCount === 1) {
    dataQualitySection += 'Note: Limited external validation. Consider setting confidence to "medium" unless evidence is very strong.\n';
  } else if (srcCount >= 3) {
    dataQualitySection += 'Multiple data sources corroborate this company\'s information. High-confidence scoring is appropriate if evidence supports it.\n';
  }

  return `You are an expert B2B sales scoring analyst for Twingate, a Zero Trust Network Access (ZTNA) solution. Your job is to evaluate a prospect company against Twingate's Ideal Customer Profile and assign a fit score using a precise ${total}-point rubric.
${dataQualitySection}
## Scoring Rubric (${total} points total)

### 1. Segment + Scale Fit (0–${w.segment_scale_fit} points)
- ${w.segment_scale_fit}: Perfect segment match with confirmed VPN user count in range
- ${Math.round(w.segment_scale_fit * 0.75)}: Strong match — employee count and tech footprint clearly indicate segment fit
- ${Math.round(w.segment_scale_fit * 0.5)}: Likely fit based on available signals, but some data gaps
- ${Math.round(w.segment_scale_fit * 0.25)}: Marginal fit — on the edge of segment boundaries
- 0: Poor fit — clearly outside segment parameters

Evidence to consider: employee count, engineering team size, office locations, contractor usage, VPN user estimates.

### 2. Why Now Triggers (0–${w.why_now_triggers} points)
- ${w.why_now_triggers}: Active VPN replacement project or ZTNA evaluation confirmed
- ${Math.round(w.why_now_triggers * 0.8)}: Recent trigger event (security incident, compliance mandate, new CTO/CISO, IPO prep)
- ${Math.round(w.why_now_triggers * 0.6)}: Relevant job postings, RFP signals, or **multiple compounding growth signals** (e.g., recent funding + hiring surge + geographic expansion together indicate near-term infrastructure needs)
- ${Math.round(w.why_now_triggers * 0.4)}: At least one growth or modernization signal with plausible urgency
- 0: No discernible urgency or timing signals

Evidence to consider: job postings, press releases, funding announcements, leadership changes, compliance initiatives. **Compound signals**: when 3+ signals from different categories all suggest growing infrastructure needs, score at the upper end even if no single signal is definitive.

### 3. Remote Access Pain Likelihood (0–${w.remote_access_pain} points)
- ${w.remote_access_pain}: Confirmed VPN complaints, remote-first with known VPN issues
- ${Math.round(w.remote_access_pain * 0.75)}: Remote/hybrid with BYOC/BYOD policies, contractor-heavy workforce
- ${Math.round(w.remote_access_pain * 0.5)}: Distributed engineering team, likely using VPN for resource access
- ${Math.round(w.remote_access_pain * 0.25)}: Some remote workers but pain is speculative
- 0: Office-only or no evidence of remote access needs

Evidence to consider: remote work policies, BYOC/BYOD programs, contractor workforce, developer experience initiatives, geographic distribution.

### 4. Displacement / Competitive Wedge (0–${w.displacement_wedge} points)
- ${w.displacement_wedge}: Using a known competitor with documented dissatisfaction
- ${Math.round(w.displacement_wedge * 0.75)}: Using legacy VPN (Cisco AnyConnect, GlobalProtect, Pulse) with scale pain, OR company profile **strongly implies VPN usage** (e.g., distributed engineering teams + compliance requirements + large contractor workforce — VPN is near-certain even without naming the product)
- ${Math.round(w.displacement_wedge * 0.5)}: Likely using a traditional solution based on tech stack signals or industry norms (e.g., gaming studios with Perforce and multi-site builds almost always use VPN for asset access)
- ${Math.round(w.displacement_wedge * 0.35)}: Unknown current solution but company characteristics suggest remote access needs
- 0: Recently purchased a competitor or locked into a long contract

Evidence to consider: tech stack signals, G2/TrustRadius reviews, job postings mentioning specific tools, LinkedIn signals. **Important**: Don't require the specific VPN product to be named to score above 50%. Compound evidence from industry, tech stack, and workforce distribution that strongly implies VPN usage should score ${Math.round(w.displacement_wedge * 0.6)}–${Math.round(w.displacement_wedge * 0.75)}.

### 5. Vertical / Playbook Match (0–${w.vertical_playbook} points)
- ${w.vertical_playbook}: Core vertical (gaming, developer tools, cloud-native SaaS) with strong pattern match to existing wins
- ${Math.round(w.vertical_playbook * 0.8)}: Adjacent vertical with similar access patterns and pain points
- ${Math.round(w.vertical_playbook * 0.53)}: Relevant vertical but less proven playbook
- ${Math.round(w.vertical_playbook * 0.27)}: Tangentially related industry
- 0: Vertical with no clear fit or relevance

Evidence to consider: industry, business model, engineering culture, product type, similar customers.

### 6. Buyer Access + Org Readiness (0–${w.buyer_access_readiness} points)
- ${w.buyer_access_readiness}: Identifiable champion + economic buyer, security team with budget authority
- ${Math.round(w.buyer_access_readiness * 0.7)}: Clear IT/security org, likely receptive to outbound
- ${Math.round(w.buyer_access_readiness * 0.4)}: Some buyer signals but org structure unclear
- ${Math.round(w.buyer_access_readiness * 0.2)}: Large bureaucratic org or procurement-heavy
- 0: No identifiable path to buyer

Evidence to consider: org structure, security team presence, IT leadership on LinkedIn, procurement processes.

### 7. Evidence Density Modifier
Within each category above, adjust your score based on signal depth:
- **Multiple corroborating signals from different sources** → score at the upper end of the tier. Example: job postings + press release + G2 review all confirming VPN pain = top of the Remote Access Pain tier.
- **Single signal or vague inference** → score at the lower end of the tier. Example: "they probably use VPN because they're remote" with no concrete evidence = bottom of the tier.
- **Zero signals for a category** → score 0 or near-0, do not speculate points into existence.

Count the signals and sources provided. A candidate with 8+ specific signals across multiple source types (job postings, tech stack, press, reviews) warrants higher scores than one with 2-3 generic signals from AI knowledge alone. Quantify your evidence: cite the actual number of corroborating data points in each category's evidence array.

### 8. Penalties (up to -20 points)
Apply penalties for any of the following:
- Recently recommended and rejected (-5 to -10)
- Known long-term competitor contract (-5 to -10)
- In active litigation or financial distress (-5)
- Government/regulated with long procurement cycles (-3 to -5)
- Negative feedback pattern match (-5 per pattern)

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
