import type { CampaignParsed, Exclusion, FunnelStepConfig } from '../../types/index.js';
import type { ExtendedICPConfig } from './research.js';

export function getCampaignResearchPrompt(
  campaign: CampaignParsed,
  icpConfig: ExtendedICPConfig,
  exclusions: Exclusion[],
  promptInstructions?: string,
  discoverConfig?: Partial<FunnelStepConfig>,
  searchContext?: string
): string {
  const company = icpConfig.company_context;
  const companyName = company?.company_name || 'Twingate';
  const productName = company?.product_name || 'Twingate';

  const companySection = company ? `
## About ${companyName}
${productName}: ${company.one_liner}

**Value Propositions:**
${(company.value_props || []).map(v => `- ${v}`).join('\n')}

**Key Differentiators:**
${(company.differentiators || []).map(d => `- ${d}`).join('\n')}

Website: ${company.website || ''}
` : `
## About ${companyName}
${productName} provides a modern Zero Trust Network Access (ZTNA) solution that replaces legacy VPNs.
`;

  // Example companies
  const exampleSection = campaign.example_companies.length > 0
    ? `## Example Companies That Fit This Pattern
${campaign.example_companies.map(ex => `### ${ex.name} (${ex.domain})
${ex.why_they_fit}`).join('\n\n')}

Use these as reference anchors. Find companies with similar characteristics, deployment models, and customer-access patterns.
` : '';

  // Target signals
  const signalSection = campaign.target_signals.length > 0
    ? `## Signals to Look For
${campaign.target_signals.map(s => `- ${s}`).join('\n')}
` : '';

  // Anti-patterns
  const antiPatternSection = campaign.anti_patterns.length > 0
    ? `## What Does NOT Fit (Anti-Patterns)
${campaign.anti_patterns.map(a => `- ${a}`).join('\n')}
` : '';

  // Search Patterns (rich vertical definitions) — NEW
  const searchPatternsSection = (campaign.search_patterns || []).length > 0
    ? `## Vertical Search Patterns
These are specific verticals and use cases to explore. Each has a detailed description, example companies, and keywords to help focus your research.

${campaign.search_patterns.map((sp, i) => {
  let section = `### ${i + 1}. ${sp.name}
${sp.description}`;
  if (sp.examples?.length > 0) {
    section += `\n\n**Examples:** ${sp.examples.join(', ')}`;
  }
  if (sp.keywords?.length > 0) {
    section += `\n**Keywords to search:** ${sp.keywords.join(', ')}`;
  }
  return section;
}).join('\n\n')}

Use these verticals as search vectors — look for companies in EACH of these areas. Don't cluster all results in one vertical; spread across multiple patterns.
` : '';

  // Target categories (fallback when search_patterns is empty)
  const categorySection = (campaign.search_patterns || []).length === 0 && campaign.target_categories.length > 0
    ? `## Categories to Search
${campaign.target_categories.map(c => `- ${c}`).join('\n')}

Search across these categories for companies matching the pattern.
` : '';

  // Value prop angle
  const valuePropSection = campaign.value_prop_angle
    ? `## Why This Pattern Matters for ${companyName}
${campaign.value_prop_angle}
` : '';

  // Exclusions
  const exclusionList = exclusions.length > 0
    ? exclusions.map(e => `- ${e.company_name}${e.domain ? ` (${e.domain})` : ''}`).join('\n')
    : '(none)';

  // Also exclude example companies — we already know about them
  const exampleExclusions = campaign.example_companies.map(e => `- ${e.name} (${e.domain})`).join('\n');

  // Also exclude companies mentioned as examples in search patterns
  const patternExampleExclusions = (campaign.search_patterns || [])
    .flatMap(sp => sp.examples || [])
    .filter(Boolean)
    .map(e => `- ${e}`)
    .join('\n');

  // ── Discover levers ──
  const verticals = (discoverConfig?.verticals_override && !discoverConfig?.use_org_verticals)
    ? discoverConfig.verticals_override
    : icpConfig.verticals;

  // Source strategy
  const strategy = discoverConfig?.source_strategy || 'open';
  const customSources = discoverConfig?.research_sources || [];
  let sourcesSection: string;
  if (strategy === 'restricted' && customSources.length > 0) {
    sourcesSection = `## Research Sources (RESTRICTED — ONLY use these)
${customSources.map(s => `- **${s.source}**: ${s.guidance}`).join('\n')}

Do NOT search sources outside this list.`;
  } else if (strategy === 'guided' && customSources.length > 0) {
    sourcesSection = `## Preferred Research Sources
These are preferred — start here, but you may also explore other sources:
${customSources.map(s => `- **${s.source}**: ${s.guidance}`).join('\n')}`;
  } else {
    sourcesSection = `## Research Sources to Check
- Crunchbase: search by category, funding stage, employee count
- G2 / TrustRadius: product categories that match the pattern
- LinkedIn: companies in relevant industries
- Job postings: keywords like "on-prem deployment", "customer environment", "hybrid cloud"
- Conference speaker/sponsor lists in relevant verticals
- Competitor product pages: "deployment options", "on-premises", "self-hosted"
- GitHub: open-source projects with enterprise/self-hosted versions
- Industry analyst reports (Gartner, Forrester) in relevant categories
- VC portfolio pages: look for companies in matching categories
- ProductHunt / HackerNews: recently launched products with on-prem options`;
  }

  // Target segments
  const segFilter = discoverConfig?.target_segments;
  const segmentSection = segFilter && !(segFilter.smb && segFilter.mm && segFilter.ent)
    ? `## Target Segments
Focus on these company sizes: ${[segFilter.smb && 'SMB (30-199 employees)', segFilter.mm && 'Mid-Market (200-999 employees)', segFilter.ent && 'Enterprise (1000+ employees)'].filter(Boolean).join(', ')}`
    : '';

  // Lead count range
  const countMin = discoverConfig?.lead_count_min || campaign.target_count;
  const countMax = discoverConfig?.lead_count_max;
  const countInstruction = countMax
    ? `between ${countMin} and ${countMax}`
    : `at least ${countMin}`;

  // Geographic focus
  const geoSection = discoverConfig?.geographic_focus?.length
    ? `## Geographic Focus
Prioritize companies in: ${discoverConfig.geographic_focus.join(', ')}`
    : '';

  // Funding stage filter
  const fundingSection = discoverConfig?.funding_stage_filter?.length
    ? `## Funding Stage Filter
Only include companies at these stages: ${discoverConfig.funding_stage_filter.join(', ')}`
    : '';

  // Recency
  const recencySection = discoverConfig?.recency_months
    ? `## Recency
Focus on companies with significant activity in the last ${discoverConfig.recency_months} months (funding, hiring, product launches, news).`
    : '';

  // Technology categories (DSPM, ITSM, Observability, etc.)
  const techCategoriesSection = discoverConfig?.technology_categories?.length
    ? `## Technology Categories
Look for companies that build or operate in these technology areas:
${discoverConfig.technology_categories.map(t => `- ${t}`).join('\n')}

These are product/platform categories — not industries. For example, a "DSPM" company could be in any industry but builds Data Security Posture Management tools.`
    : '';

  // Company sizing method
  const sizingMethodMap: Record<string, string> = {
    employee_count: 'total employee headcount (default)',
    engineering_headcount: 'engineering/technical headcount specifically — many companies have large non-technical teams but a small engineering org',
    vpn_users: 'estimated VPN/remote access user count — the number of employees who access internal resources remotely',
    revenue_range: 'estimated annual revenue range as a proxy for company size',
  };
  const sizingSection = discoverConfig?.sizing_method && discoverConfig.sizing_method !== 'employee_count'
    ? `## Company Size Identification
When estimating company size for segment assignment, use **${sizingMethodMap[discoverConfig.sizing_method] || discoverConfig.sizing_method}** as the primary metric instead of total employee count.${discoverConfig.sizing_guidance ? `\n\n${discoverConfig.sizing_guidance}` : ''}`
    : (discoverConfig?.sizing_guidance
      ? `## Company Size Identification\n${discoverConfig.sizing_guidance}`
      : '');

  // Verticals in prompt
  const verticalsSection = verticals.length > 0
    ? `## Target Industries
${verticals.map(v => `- ${v}`).join('\n')}`
    : '';

  return `You are a B2B sales intelligence researcher specializing in pattern-based prospect identification for ${companyName}.

Your task is to find companies that match a specific success pattern — companies similar to known successful customers or partners.

${companySection}
## Research Pattern: ${campaign.name}
${campaign.pattern_thesis}

${valuePropSection}${exampleSection}${searchPatternsSection}${signalSection}${categorySection}${antiPatternSection}
## Exclusion List (DO NOT recommend these)
${exclusionList}

## Already-Known Examples (DO NOT include — find NEW companies)
${exampleExclusions || '(none)'}
${patternExampleExclusions ? `\n## Companies Mentioned in Pattern Examples (DO NOT include — find NEW ones)\n${patternExampleExclusions}` : ''}

${sourcesSection}
${segmentSection}
${geoSection}
${fundingSection}
${recencySection}
${verticalsSection}
${techCategoriesSection}
${sizingSection}
${searchContext ? `
## Web Search Results (Real-Time Data)
The following companies and information were found via live web searches. These are real, current results.

${searchContext}

**Important:** The search results above represent verified, current data. When recommending companies:
- **Prioritize companies found in search results** — they represent current, verified entities
- You may supplement with additional companies from your knowledge, but clearly indicate source
- For search-sourced companies, use the data found (employee counts, funding, etc.) rather than your training data
- Mark any company NOT found in search results with source: "AI knowledge"
- When drawing from AI knowledge (not search results), ONLY include companies that are widely known — publicly traded, unicorn-status, or frequently covered in industry press. Do not include obscure or uncertain companies from memory alone.
` : ''}
## Company Verification Requirements
CRITICAL: Only include companies that you are confident actually exist as active, operating businesses. Every company you return will be validated against real-world data sources. Including non-existent or defunct companies wastes pipeline resources.

Each company MUST have a verifiable web presence — an active website, LinkedIn page, Crunchbase profile, or recent news coverage. Do not invent or extrapolate company names.

For each company, provide the most accurate domain you know. If you are uncertain about a company's domain, note domain_confidence: "low". Do not guess or construct domains.

## Instructions
1. Research and identify ${countInstruction} prospect companies matching this pattern
2. For each company, gather:
   - Company name and primary domain
   - Why they match the pattern (specific evidence)
   - Which vertical/search pattern they match (if applicable)
   - Employee count estimate (to determine segment)
   - HQ location, founding year, funding stage
   - Specific signals found that indicate pattern fit
   - Sources where you found the information
   - Segment assignment: ENT (1000+ employees), MM (200-999), SMB (30-199)
3. Prioritize companies with strong, clear pattern matches
4. Exclude companies on the exclusion list and already-known examples
5. **Spread results across multiple verticals/patterns** — don't cluster in one area
6. Prefer companies with publicly visible evidence of the pattern (deployment docs, product pages, case studies)

## Output Format
Return a JSON array of candidate objects:
\`\`\`json
[
  {
    "company_name": "string",
    "domain": "string",
    "domain_confidence": "high|low",
    "segment": "ENT|MM|SMB",
    "employee_count_estimate": 0,
    "hq_location": "string",
    "founded_year": 0,
    "funding_stage": "string",
    "total_funding": "string",
    "investors": "string",
    "signals": ["signal1", "signal2"],
    "sources": ["source1", "source2"],
    "source": "search_results|AI knowledge",
    "notes": "Why this company matches the pattern and which vertical it fits"
  }
]
\`\`\`

${promptInstructions ? `## Additional Instructions\n${promptInstructions}\n\n` : ''}Return ONLY the JSON array, no other text.`;
}
