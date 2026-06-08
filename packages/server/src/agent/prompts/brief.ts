import type { ExtendedICPConfig, TechStackCategory, ScoringDimensions } from '../../types/index.js';
import { getDefaultTechStackCategories } from '../../config/icpDefaults.js';

export function getBriefPrompt(icpConfig: ExtendedICPConfig, enrichmentSourceCount?: number, signalCount?: number, techCategories?: TechStackCategory[], outreachTone?: string, dimensions?: ScoringDimensions): string {
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
- **Personas**: Find specific named individuals if mentioned in sources. Provide detailed profiles with tenure estimates and highly personalized outreach messages referencing specific company events. Set persona confidence to "high" when names come from enrichment sources.
- **Pain Hypotheses**: Generate 4 hypotheses, each tied to a specific signal or source. Cross-reference multiple signals to build compound pain narratives. Set evidence_strength to "high" when directly supported by a source.
- **Tech Stack**: Be specific — cite exact products with evidence sources. Use "high" confidence when directly observed, "medium" for strong indirect evidence.
- **Competitive Displacement**: Build a detailed displacement narrative with specific proof points.\n`;
  } else if (srcCount >= 1 && sigCount >= 3) {
    dataDepthGuidance = `\n## Data Depth: Moderate
This candidate has moderate enrichment data (${srcCount} external source(s), ${sigCount} buying signals). Standard depth:
- **Personas**: Generate role-based personas with reasonable title assumptions. Personalize outreach to company context. Set persona confidence to "medium" for role-based assumptions.
- **Pain Hypotheses**: Generate 2-3 hypotheses. Be specific where signals support it, flag where you're inferring. Use "high" for source-backed claims, "medium" for multi-signal inferences, "low" for industry-pattern assumptions.
- **Tech Stack**: Note confidence levels: "high" for directly observed, "medium" for inferred, "low" for assumed.
- **Gaps**: In the brief_markdown, include a "## Research Gaps" section listing what an AE should verify manually.\n`;
  } else {
    dataDepthGuidance = `\n## Data Depth: Thin
This candidate has limited enrichment data (${srcCount} external source(s), ${sigCount} buying signals). STRICT RULES:
- **NO specific "Why Now" claims** without [N] source references. Every trigger must cite an enrichment source.
- **NO named personas** — role-based only, confidence: "low"
- **NO competitive displacement narratives** — use "Unknown — needs discovery"
- **NO case study references or customer name-drops**
- **MUST include a prominent "## Research Gaps" section FIRST** in the brief_markdown, listing everything the AE needs to research before outreach
- **Pain Hypotheses**: Generate 2 max. evidence_strength MUST be "low". Frame as hypotheses, not assertions.
- **Tech Stack**: Only include what's directly evidenced. Use "Unknown — needs discovery" for gaps.
- **PROHIBITED language** (without a confirming source): "actively evaluating", "currently exploring", "planning to replace", "recently adopted", "known to use"
- **REQUIRED language** for unconfirmed claims: "may be experiencing", "industry patterns suggest", "company profile is consistent with"\n`;
  }

  // ── FactSheet-Gated Content Rules ──
  let factsheetGating = '';
  if (dimensions) {
    const gates: string[] = [];
    if (dimensions.timing < 25) {
      gates.push('- **TIMING GATE**: Timing score is below 25. You MUST NOT generate timing-based "Why Now" claims. If you include Why Now items, frame them as "Potential trigger (needs verification): ..." and limit to 1.');
    }
    if (dimensions.reachability < 20) {
      gates.push('- **REACHABILITY GATE**: Reachability score is below 20. All personas MUST be marked as "generic — no contacts found". Do NOT fabricate names or LinkedIn URLs.');
    }
    if (dimensions.data_confidence === 'D' || dimensions.data_confidence === 'F') {
      gates.push('- **DATA CONFIDENCE GATE**: Data confidence is ' + dimensions.data_confidence + '. The brief MUST lead with a "## Research Gaps" section before any analysis. Flag all claims as requiring verification.');
    }
    if (dimensions.icp_fit < 40) {
      gates.push('- **FIT GATE**: ICP fit score is below 40. Shift tone to "exploratory" — frame this as a prospect worth monitoring, not ready for aggressive outreach. Use cautious language throughout.');
    }
    if (gates.length > 0) {
      factsheetGating = `\n## Scoring Dimension Gates\nThe deterministic scoring engine has flagged the following constraints. These OVERRIDE any other instructions:\n${gates.join('\n')}\n`;
    }
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

  // Build consultative advisor section from ICP config (no hardcoded product language)
  let toneSection = '';
  if (outreachTone === 'consultative') {
    const verticals = icpConfig.verticals || [];
    const valueProps = icpConfig.company_context?.value_props || [];
    const differentiators = icpConfig.company_context?.differentiators || [];
    const industryFocus = icpConfig.company_context?.industry_focus || '';

    toneSection = `\n## Outreach Tone: Consultative Advisor Mode
All outreach messages, talking points, and outreach angles must follow these rules:
1. **No name-dropping**: Do not mention specific customers, case studies, or competitors by name in outreach messages. Position insights as patterns observed across similar organizations.
2. **Industry-pattern framing**: Lead with "We've seen organizations in [their vertical/industry] face [specific pattern]..." rather than product pitches. Reference the prospect's actual vertical, not generic B2B language.${verticals.length > 0 ? `\n   Known verticals to reference when relevant: ${verticals.join(', ')}` : ''}${industryFocus ? `\n   Industry focus: ${industryFocus}` : ''}
3. **Value-led messaging**: Frame outreach around business and technical outcomes, not product features.${valueProps.length > 0 ? `\n   Value propositions to weave in naturally: ${valueProps.join('; ')}` : ''}${differentiators.length > 0 ? `\n   Key differentiators: ${differentiators.join('; ')}` : ''}
4. **Discovery-first CTA**: End outreach with a question or insight-sharing offer, not a demo request. E.g., "Would it be useful to share how similar teams have approached this?" rather than "Can I show you a demo?"
5. **Technical credibility**: Reference specific architectural patterns and technical concepts relevant to the prospect's stack, not marketing buzzwords.\n`;
  } else if (outreachTone) {
    toneSection = `\n## Outreach Tone\nWrite all outreach messaging in a ${outreachTone} tone.\n`;
  }

  const antiHallucination = `\n## Anti-Hallucination Rules (GLOBAL — apply to ALL data depths)
1. **Source-gated Why Now**: Every "Why Now" reason MUST include a [N] source citation. Claims without a source MUST be prefixed with "[INFERRED]" and framed as a hypothesis, not an assertion.
2. **No customer name-drops**: Do NOT reference specific customer names, case studies, or named deployments in outreach messages, talking points, or proof points. Reference patterns, outcomes, and categories instead (e.g., "organizations in the gaming vertical" not "Epic Games uses...").
3. **No fabricated contacts**: If a person's name is not in the provided data (sources, key_people, research notes), do NOT invent one. Use role-based personas with name: null.
4. **Confidence calibration**: "high" confidence requires a direct enrichment source. "medium" requires multiple corroborating signals. "low" for anything inferred from industry patterns or model knowledge.\n`;

  return `You are a senior B2B sales strategist for ${companyName}${productName !== companyName ? ` (${productName})` : ''}, ${oneLiner}. Your job is to generate a comprehensive lead brief that equips account executives with everything they need for effective outreach.
${dataDepthGuidance}${factsheetGating}${antiHallucination}${personaGuidance}${productContextSection}${toneSection}
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
- **Evidence strength**: "high" (directly supported by a primary source), "medium" (inferred from multiple signals or secondary evidence), or "low" (industry-pattern assumption without direct evidence)

### 3. Target Personas (STRICT: generate 2-4, quality over quantity)
Follow the Persona Pyramid exactly:

**REQUIRED — always include:**
1. **Technical Champion** (role_type: "technical_champion") — EXACTLY 1. Day-to-day evaluator who owns the problem and drives the evaluation.
   - Target titles: Director, Sr. Manager, Team Lead in IT/Infrastructure/Security/Platform Engineering
   - This persona must have the most detailed, personalized outreach message

2. **Economic Buyer** (role_type: "economic_buyer") — EXACTLY 1 for ENT/MM segments.
   - Target titles: VP of IT, VP of Engineering, CISO
   - For SMB: may be the same person as technical_champion — if so, generate just 1 technical_champion

**OPTIONAL — only with evidence:**
3. **Hands-on Keyboard** (role_type: "hands_on_keyboard") — AT MOST 1. The engineer who will actually deploy, configure, and operate the solution day-to-day.
   - Target titles: DevOps Engineer/Manager, Platform Engineer, SRE, Infrastructure Engineer, Cloud Engineer
   - ONLY include when there is evidence of a hands-on technical culture (DevOps job postings, open-source contributions, IaC usage, engineering blog, or technical team structure visible in sources)
   - This persona gets the most technically specific outreach

4. **Executive Sponsor** (role_type: "executive_sponsor") — AT MOST 1. Blesses the initiative at the org level.
   - Target titles: CTO, CIO
   - ONLY include if there is a specific signal (conference talk, public statement, org restructure, or named in sources) justifying their inclusion

**HARD RULES:**
- Generate 2-4 personas total. Never 5+.
- Do NOT fill slots with C-suite. Ideal card: 1 Director technical_champion + 1 VP economic_buyer.
- Do NOT include an executive_sponsor without citing a specific signal.
- Do NOT include a hands_on_keyboard without evidence of technical culture.
- Quality matters more than quantity — 2 well-researched personas beat 4 generic ones.

For each persona, provide:
- **role_type**: "technical_champion", "hands_on_keyboard", "economic_buyer", or "executive_sponsor"
- **confidence**: "high" (named individual verified from enrichment data or multiple sources), "medium" (role-based persona with title inferred from company profile), "low" (generic role-based persona with no company-specific evidence)
- **name**: Real name from sources or key_people data (null if not found — never fabricate)
- **title**: Job title at this company
- **linkedin_url**: URL from sources or key_people data (null if not found — never fabricate)
- **department**, **tenure**: If inferable from sources
- **outreach_angle**: Specific angle tied to a signal or pain point
- **talking_points**: 3-5 bullet points referencing specific company signals
- **outreach_message**: Personalized message (3-5 sentences) referencing at least one company signal, with a clear CTA
- **social_signals**: Public activity useful for outreach
- **buying_signals**: Specific signals indicating receptiveness

When key_people data is provided below, use those real names, titles, and LinkedIn URLs. Do not fabricate names beyond what's provided.

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
- **displacement_narrative**: 2-3 sentences connecting this specific company's current solution to why ${companyName} wins. Reference at least one concrete signal about THIS company. The AE will lead with this narrative — make it specific, not generic.
- **likely_current**: MAX 2 products. Only include products where you have actual evidence. { "product": "name", "confidence": "high|medium|low", "evidence": "how you know", "source": "url or detection method" }
- **evidence_sources**: MAX 3 entries. Only real evidence you found, not hypothetical.
- **twingate_wedge**: MAX 3 specific advantages ${companyName} has over their SPECIFIC current solution. Each must reference THIS company's situation (e.g., "Their 3 offices across US/EU make ${companyName}'s mesh architecture faster than site-to-site VPN"). Generic advantages like "easier to deploy" will fail audit.
- **proof_points_to_use**: MAX 2 customer stories relevant to this prospect's vertical/scale.

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
- **confidence**: "high" (you directly observed this data from a primary source), "medium" (inferred from secondary or indirect evidence), or "low" (assumed based on industry patterns)

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
      "role_type": "technical_champion|hands_on_keyboard|economic_buyer|executive_sponsor",
      "confidence": "high|medium|low",
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
    "displacement_narrative": "string (2-3 sentences, personalized to this company)",
    "likely_current": [{ "product": "string", "confidence": "high|medium|low", "evidence": "string", "source": "string" }],
    "evidence_sources": [{ "signal": "string", "url": "string", "confidence": "string" }],
    "twingate_wedge": ["string"],
    "proof_points_to_use": ["string"]
  },
  "outreach_strategy": "string",
  "source_citations": [
    { "id": 1, "type": "string", "url": "string", "label": "string", "confidence": "high|medium|low" }
  ],
  "why_now": ["string"],
  "brief_markdown": "string"
}
\`\`\`

Return ONLY the JSON object, no other text.`;
}
