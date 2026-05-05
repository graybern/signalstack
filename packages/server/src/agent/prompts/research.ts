import type { Exclusion, ExtendedICPConfig, FeedbackPattern } from '../../types/index.js';
export type { ExtendedICPConfig, FeedbackPattern } from '../../types/index.js';

export function getResearchPrompt(
  segment: 'ENT' | 'MM' | 'SMB',
  icpConfig: ExtendedICPConfig,
  exclusions: Exclusion[],
  feedbackPatterns: FeedbackPattern[]
): string {
  const segmentConfig = icpConfig.segments[segment];
  const segmentDetail = icpConfig.segment_details?.[segment];
  const company = icpConfig.company_context;
  const geo = icpConfig.geographies;
  const disqualifiers = icpConfig.disqualifiers || [];
  const signalWeights = icpConfig.signal_weights || [];
  const buyerPersonas = icpConfig.buyer_personas || {};
  const promptConfig = icpConfig.prompt_config;

  // Company context — configurable, not hardcoded
  const companyName = company?.company_name || 'the company';
  const productName = company?.product_name || 'the company';
  const oneLiner = company?.one_liner || 'a B2B technology solution';

  const companySection = company ? `
## About ${companyName}
${productName}: ${oneLiner}

**Value Propositions:**
${(company.value_props || []).map(v => `- ${v}`).join('\n')}

**Key Differentiators:**
${(company.differentiators || []).map(d => `- ${d}`).join('\n')}

Website: ${company.website || ''}
Industry: ${company.industry_focus || ''}
` : `
## About ${companyName}
${productName} — ${oneLiner}.
`;

  // Segment description
  const segLabel: Record<string, string> = {
    ENT: 'Enterprise',
    MM: 'Mid-Market',
    SMB: 'SMB',
  };

  let segmentDescription = `${segLabel[segment]} (${segmentConfig.vpn_users_min}–${segmentConfig.vpn_users_max} VPN users)`;
  if (segmentDetail) {
    segmentDescription += `\n- Employee range: ${segmentDetail.employee_min}–${segmentDetail.employee_max}`;
    if (segmentDetail.revenue_min || segmentDetail.revenue_max) {
      segmentDescription += `\n- Revenue: ${segmentDetail.revenue_min || '?'}–${segmentDetail.revenue_max || '?'}`;
    }
    if (segmentDetail.funding_stages?.length) {
      segmentDescription += `\n- Typical funding: ${segmentDetail.funding_stages.join(', ')}`;
    }
    if (segmentDetail.notes) {
      segmentDescription += `\n- Notes: ${segmentDetail.notes}`;
    }
  }

  // Geography
  const geoSection = geo ? `
## Target Geography
- Regions: ${geo.target_regions?.join(', ') || 'Any'}
- Countries: ${geo.target_countries?.join(', ') || 'Any'}
${geo.notes ? `- Notes: ${geo.notes}` : ''}
` : '';

  // Segment-specific sources
  const segmentSources: Record<string, string> = {
    ENT: `- Conference sponsor/speaker lists (RSA, KubeCon, GDC, AWS re:Invent, Black Hat)
- Major gaming studios and publishers (500+ engineers)
- Crunchbase: Series C+ companies in target verticals with 1000+ employees
- Fortune 500/1000 career pages mentioning VPN, ZTNA, remote access, zero trust
- G2 / PeerSpot / Gartner Peer Insights — search VPN/ZTNA categories
- SEC EDGAR: 10-K/10-Q filings mentioning VPN, remote access, zero trust
- GitHub orgs with 500+ employees (check repos for infra patterns)`,
    MM: `- Wellfound (AngelList): Series B+ startups in target verticals, 200-2000 employees
- Y Combinator late-stage companies (3+ years post-batch, 200+ employees)
- Crunchbase: $30M-$150M raises in target verticals
- TechCrunch / VentureBeat: recent $30M+ funding rounds
- G2 / TrustRadius reviews of competitor products (look for dissatisfied users)
- Conference mid-tier sponsors at KubeCon, RSA, etc.
- GitHub orgs with active open-source presence`,
    SMB: `- Y Combinator current and recent batches (W26, F25, S25, W25)
- Wellfound seed/Series A companies (50-350 employees) in target verticals
- Crunchbase: recent raises $5M-$30M in target verticals
- ProductHunt: recently launched developer/security/infra tools
- GitHub trending: fast-growing repos → check the company behind them
- HackerNews "Who's Hiring" monthly threads
- TechStars, 500 Global, a16z portfolio companies
- Job boards filtered to 50-300 employees hiring for IT/Security/SRE`,
  };

  // Weighted signals
  const signalSection = signalWeights.length > 0
    ? `## Signal Weights (higher = more important, 1-10 scale)
${signalWeights.sort((a, b) => b.weight - a.weight).map(s => `- [${s.weight}/10] ${s.signal} (${s.category})`).join('\n')}
` : '';

  // Disqualifiers
  const dqSection = disqualifiers.length > 0
    ? `## Disqualification Criteria
${disqualifiers.map(d => `- ${d.severity === 'hard' ? 'HARD DQ' : 'SOFT DQ'}: ${d.signal}${d.notes ? ` (${d.notes})` : ''}`).join('\n')}
` : '';

  // Buyer personas
  const personaSection = Object.keys(buyerPersonas).length > 0
    ? `## Target Buyer Personas
${Object.entries(buyerPersonas).map(([level, p]) => `### ${(p as any).label || level}
- Target titles: ${(p as any).titles?.join(', ') || 'N/A'}
- Departments: ${(p as any).departments?.join(', ') || 'N/A'}
- ${(p as any).notes || ''}`).join('\n\n')}
` : '';

  // Exclusion list
  const exclusionList = exclusions.length > 0
    ? exclusions.map(e => `- ${e.company_name}${e.domain ? ` (${e.domain})` : ''}`).join('\n')
    : '(none)';

  // Feedback patterns
  const feedbackSection = feedbackPatterns.length > 0
    ? feedbackPatterns.map(f => `- ${f.direction === 'positive' ? 'PREFER' : 'AVOID'}: ${f.pattern} (seen ${f.count}x)`).join('\n')
    : '(no feedback patterns yet)';

  // Success stories
  const successSection = Object.keys(icpConfig.success_stories || {}).length > 0
    ? `## Success Story Analogues
${Object.entries(icpConfig.success_stories).map(([vertical, companies]) => `- **${vertical}**: ${(companies as string[]).join(', ')}`).join('\n')}

Use these as reference points when evaluating vertical fit. Companies similar to these success stories score higher.
` : '';

  // Custom preamble
  const preamble = promptConfig?.research_preamble
    ? `## Additional Context\n${promptConfig.research_preamble}\n`
    : '';

  // Custom instructions
  const additionalInstructions = promptConfig?.research_additional_instructions
    ? `\n## Additional Instructions\n${promptConfig.research_additional_instructions}\n`
    : '';

  return `You are a B2B sales intelligence researcher. Your task is to identify high-quality prospect companies for ${companyName}.

${preamble}${companySection}
## Your Target Segment
${segmentDescription}

${geoSection}
## ICP Definition
**Target Verticals:** ${icpConfig.verticals.join(', ')}

**Tech Signals to Look For:**
${icpConfig.tech_signals.map(s => `- ${s}`).join('\n')}

**Known Competitors to Displace:**
${icpConfig.competitors.map(c => `- ${c}`).join('\n')}

${signalSection}${dqSection}${successSection}${personaSection}
## Sources to Check for ${segment} Segment
${segmentSources[segment]}

## Exclusion List (DO NOT recommend these companies)
${exclusionList}

## Feedback Patterns from Previous Runs
${feedbackSection}

## Company Verification Requirements
Only research companies that are verifiably real and currently operating. If you cannot find concrete, specific evidence for a company (real product names, real employee names, real office locations, real funding rounds with named investors), flag it as low_confidence.

## Instructions
1. Research and identify at least 8 prospect companies that match the ${segment} segment ICP
2. For each company, gather:
   - Company name and primary domain
   - Why they fit the segment (employee count, scale signals)
   - Specific signals that indicate they could benefit from ${productName}
   - Sources where you found the information
   - Any relevant notes about timing, competitive situation, or buying signals
3. Prioritize companies with multiple overlapping signals (especially high-weight signals)
4. Exclude companies on the exclusion list
5. Exclude companies matching hard disqualification criteria
6. Penalize (but don't auto-exclude) companies matching soft disqualification criteria
7. Apply feedback patterns: prefer companies matching positive patterns, avoid those matching negative patterns
${additionalInstructions}
## Output Format
Return a JSON array of candidate objects:
\`\`\`json
[
  {
    "company_name": "string",
    "domain": "string",
    "segment": "${segment}",
    "employee_count_estimate": 0,
    "hq_location": "string",
    "founded_year": 0,
    "funding_stage": "string",
    "total_funding": "string",
    "investors": "string",
    "signals": ["signal1", "signal2"],
    "sources": ["source1", "source2"],
    "notes": "string"
  }
]
\`\`\`

Return ONLY the JSON array, no other text.`;
}
