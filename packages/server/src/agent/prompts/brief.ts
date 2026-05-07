import type { ExtendedICPConfig, TechStackCategory } from '../../types/index.js';
import { getDefaultTechStackCategories } from '../../config/icpDefaults.js';

export function getBriefPrompt(icpConfig: ExtendedICPConfig, enrichmentSourceCount?: number, signalCount?: number, techCategories?: TechStackCategory[]): string {
  const srcCount = enrichmentSourceCount ?? 0;
  const sigCount = signalCount ?? 0;

  const companyName = icpConfig.company_context?.company_name || 'the company';
  const productName = icpConfig.company_context?.product_name || companyName;
  const oneLiner = icpConfig.company_context?.one_liner || 'a B2B technology solution';
  const buyerPersonas = icpConfig.buyer_personas || {};

  let dataDepthGuidance = '';
  if (srcCount >= 3 && sigCount >= 5) {
    dataDepthGuidance = `\n## Data Depth: Rich
This candidate has strong enrichment data (${srcCount} external sources, ${sigCount} buying signals). Go deep:
- **Personas**: Find specific named individuals if mentioned in sources. Provide detailed LinkedIn-style profiles with tenure estimates, likely priorities based on role, and highly personalized outreach messages referencing specific company events.
- **Pain Hypotheses**: Generate 4 hypotheses, each tied to a specific signal or source. Cross-reference multiple signals to build compound pain narratives.
- **Tech Stack**: Be specific — cite exact products with evidence sources and confidence levels.
- **Competitive Displacement**: Build a detailed displacement narrative with specific proof points.\n`;
  } else if (srcCount >= 1 && sigCount >= 3) {
    dataDepthGuidance = `\n## Data Depth: Moderate
This candidate has moderate enrichment data (${srcCount} external source(s), ${sigCount} buying signals). Standard depth:
- **Personas**: Generate role-based personas with reasonable title assumptions. Personalize outreach to company context.
- **Pain Hypotheses**: Generate 2-3 hypotheses. Be specific where signals support it, flag where you're inferring.
- **Tech Stack**: Note what's confirmed vs. inferred.
- **Gaps**: In the brief_markdown, include a "## Research Gaps" section listing what an AE should verify manually.\n`;
  } else {
    dataDepthGuidance = `\n## Data Depth: Thin
This candidate has limited enrichment data (${srcCount} external source(s), ${sigCount} buying signals). Be conservative:
- **Personas**: Generate generic role-based personas only. Do not fabricate specific names or detailed profiles.
- **Pain Hypotheses**: Generate 2 hypotheses max. Clearly label each as "confirmed" or "inferred".
- **Tech Stack**: Only include what's evidenced. Use "Unknown — needs discovery" for gaps rather than guessing.
- **Gaps**: In the brief_markdown, include a prominent "## Research Gaps" section listing everything the AE needs to manually research before outreach. This is critical — the AE needs to know where the data is thin so they don't walk into a call unprepared.\n`;
  }

  // Build buyer persona guidance from ICP config
  let personaGuidance = '';
  if (Object.keys(buyerPersonas).length > 0) {
    personaGuidance = `\n## Buyer Persona Guidance\n${Object.entries(buyerPersonas).map(([key, p]) =>
      `- **${(p as any).label || key}**: Target titles: ${(p as any).titles?.join(', ') || 'N/A'}. ${(p as any).notes || ''}`
    ).join('\n')}\n`;
  }

  // Build product context from value props and differentiators
  const valueProps = icpConfig.company_context?.value_props || [];
  const differentiators = icpConfig.company_context?.differentiators || [];
  let productContextSection = '';
  if (valueProps.length > 0 || differentiators.length > 0) {
    productContextSection = `\n## Product Context\nReference these when crafting outreach angles and competitive displacement narratives.\n`;
    if (valueProps.length > 0) {
      productContextSection += `**Value Propositions:**\n${valueProps.map(v => `- ${v}`).join('\n')}\n`;
    }
    if (differentiators.length > 0) {
      productContextSection += `**Key Differentiators:**\n${differentiators.map(d => `- ${d}`).join('\n')}\n`;
    }
  }

  return `You are a senior B2B sales strategist for ${companyName}${productName !== companyName ? ` (${productName})` : ''}, ${oneLiner}. Your job is to generate a comprehensive lead brief that equips account executives with everything they need for effective outreach.
${dataDepthGuidance}${personaGuidance}${productContextSection}
## Brief Structure

Generate a full lead brief with the following sections:

### 1. Company Snapshot
A concise summary of the company including:
- What they do (1-2 sentences)
- Key metrics: employee count, HQ, founded year, funding stage, total funding, notable investors
- Recent news or developments relevant to their security/IT posture

### 2. Pain Hypotheses
Identify specific pain points this company likely experiences that ${companyName} can address. Each hypothesis should include:
- A clear claim about the pain point — include inline source references using [N] format where N matches a source_citation id (e.g., "Recently migrated to AWS [3] suggesting cloud-first strategy")
- Why it matters to this specific company (tied to their business context)
- **Evidence strength**: "confirmed" (directly supported by a source/signal) or "inferred" (logical deduction from company profile)

### 3. Target Personas (up to 5, prefer 3)
For each persona, provide:
- **role_type**: One of "champion" (day-to-day user/evaluator), "economic_buyer" (budget holder), or "executive_sponsor" (strategic decision maker)
- **name**: Specific name if found in sources or key_people data (otherwise null — never fabricate names)
- **title**: Likely job title at this company
- **linkedin_url**: URL if found in sources or key_people data (otherwise null — never fabricate URLs)
- **department**: Their department
- **tenure**: Estimated tenure if inferable from sources
- **outreach_angle**: The specific angle to use when reaching out to this persona — tie it to a specific signal or pain point when possible
- **talking_points**: 3-5 bullet points tailored to their role and concerns. Reference specific company signals (e.g., "Your team's recent migration..." not generic "Modern infrastructure needs...")
- **outreach_message**: A complete personalized outreach message (email or LinkedIn) for this persona. Must reference at least one specific company signal. Keep it concise (3-5 sentences) with a clear CTA.
- **social_signals**: Any public activity (blog posts, conference talks, tweets, open source contributions) that could be referenced in outreach
- **buying_signals**: Specific signals that indicate this persona might be receptive — tie to evidence

When key_people data is provided below, use those real names, titles, and LinkedIn URLs for personas. Do not fabricate additional names beyond what's provided — for remaining persona slots, use role-based placeholders with null name.

### 4. Tech Stack Intel
Analyze the company's technology stack for these categories:
${(techCategories || getDefaultTechStackCategories()).map(cat =>
  `- **${cat.id}** (${cat.label}): e.g. ${cat.examples.join(', ')}`
).join('\n')}

For each category where products are identified, provide an array of objects: { "product": "name", "confidence": "high|medium|low", "evidence": "how detected", "source": "detection method" }. Use "high" when directly observed (CDN, script tags, DNS), "medium" for strong indirect evidence (job postings, docs), "low" for inferred.

Also include:
- **recent_purchases**: Recent security/IT tool purchases with evidence
- **notes**: Additional tech stack observations. Flag what's confirmed vs. inferred.

### 5. Competitive Displacement
- **likely_current**: For each product, provide an object: { "product": "name", "confidence": "confirmed|inferred", "evidence": "how you know", "source": "url or detection method" }. Use "confirmed" when directly evidenced, "inferred" when deduced from signals.
- **evidence_sources**: Evidence for each with confidence level and specific source
- **twingate_wedge**: Specific advantages ${companyName} has over their current solution — be precise about *why* ${companyName} wins here
- **proof_points_to_use**: Customer stories or proof points relevant to this prospect's vertical/scale

### 6. Outreach Strategy
A strategic recommendation for how to approach this account:
- Recommended first touch channel and timing
- Multi-threading strategy (which personas to engage simultaneously vs. sequentially)
- Key events or triggers to reference in outreach
- Objection handling notes
- Recommended discovery questions to ask

### 7. Source Citations
List all sources used in researching this brief. Each citation must have:
- **id**: Sequential number (1, 2, 3...) — used for inline references throughout the brief
- Type (e.g., "career_page", "press_release", "crunchbase", "linkedin", "g2_review", "github", "dns_fingerprint")
- URL (if available)
- Label describing what information came from this source
- **confidence**: "confirmed" (you directly observed this data) or "inferred" (deduced from context)

### 8. Why Now
List 2-4 specific reasons why now is the right time to engage this prospect. Each reason should cite a specific signal or data point using [N] inline references, not generic trends.

## Inline Source References
IMPORTANT: Throughout all text fields (company_snapshot, pain hypothesis claims, why_now items, competitive displacement entries), include inline source references using the format [N] where N matches the source_citation id. Every factual claim should be attributed. Example: "Company recently migrated to AWS [3] and posted 5 VPN engineer roles [1], indicating infrastructure modernization."

### 9. Brief Markdown
A complete, formatted markdown version of the brief suitable for display in a dashboard. Include all sections above in readable format.

## Output Format
Return a JSON object with this exact structure:
\`\`\`json
{
  "company_snapshot": "string",
  "pain_hypotheses": [
    { "claim": "string", "why_it_matters": "string" }
  ],
  "personas": [
    {
      "role_type": "champion|economic_buyer|executive_sponsor",
      "name": null,
      "title": "string",
      "linkedin_url": null,
      "department": "string",
      "tenure": null,
      "outreach_angle": "string",
      "talking_points": "JSON string of array",
      "outreach_message": "string",
      "social_signals": null,
      "buying_signals": "string"
    }
  ],
  "tech_stack": {
    "categories": {
      "vpn": [{ "product": "string", "confidence": "high|medium|low", "evidence": "string", "source": "string" }],
      "cloud": [{ "product": "string", "confidence": "high|medium|low", "evidence": "string", "source": "string" }]
    },
    "recent_purchases": [{ "category": "string", "product": "string", "confidence": "string", "evidence": "string", "source": "string" }],
    "notes": "string"
  },
  "competitive_displacement": {
    "likely_current": [{ "product": "string", "confidence": "confirmed|inferred", "evidence": "string", "source": "string" }],
    "evidence_sources": [{ "signal": "string", "url": "string", "confidence": "string" }],
    "twingate_wedge": ["string"],
    "proof_points_to_use": ["string"]
  },
  "outreach_strategy": "string",
  "source_citations": [
    { "id": 1, "type": "string", "url": "string", "label": "string", "confidence": "confirmed|inferred" }
  ],
  "why_now": ["string"],
  "brief_markdown": "string"
}
\`\`\`

Return ONLY the JSON object, no other text.`;
}
