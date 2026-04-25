function safeParse(json: string | null | undefined): any {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function fitLabel(score: number): string {
  if (score >= 90) return 'Extremely High';
  if (score >= 75) return 'High';
  if (score >= 60) return 'Medium';
  if (score >= 40) return 'Low';
  return 'Very Low';
}

function stars(score: number): string {
  if (score >= 90) return '⭐5';
  if (score >= 75) return '⭐4';
  if (score >= 60) return '⭐3';
  if (score >= 40) return '⭐2';
  return '⭐1';
}

export function generateSegmentMarkdown(segment: string, leads: any[], date: string): string {
  const lines: string[] = [];

  lines.push(`# SignalStack Prospect Intelligence — ${segment} Segment`);
  lines.push(`## Week of ${date}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  leads.forEach((lead, index) => {
    const personas = safeParse(lead.personas_json) || [];
    const whyNow = safeParse(lead.why_now) || [];
    const painHypotheses = safeParse(lead.pain_hypotheses) || [];
    const techStack = safeParse(lead.tech_stack) || [];
    const displacement = safeParse(lead.competitive_displacement) || {};
    const sources = safeParse(lead.source_citations) || [];
    const scoreBreakdown = safeParse(lead.score_breakdown) || {};

    const champion = personas.find((p: any) => p.role_type === 'champion') || personas[0] || {};

    const label = fitLabel(lead.fit_score);
    const starStr = stars(lead.fit_score);

    lines.push(`### ${index + 1}. ${lead.company_name} — ${starStr} ${label} (${lead.fit_score}/100) · confidence: ${lead.confidence || 'medium'}`);
    lines.push('');

    // Why now
    if (Array.isArray(whyNow) && whyNow.length > 0) {
      lines.push('**Why now:**');
      whyNow.forEach((trigger: any) => {
        const text = typeof trigger === 'string' ? trigger : (trigger.trigger || trigger.reason || JSON.stringify(trigger));
        lines.push(`- ${text}`);
      });
      lines.push('');
    }

    // Company info
    const companyParts: string[] = [];
    if (lead.hq_location) companyParts.push(lead.hq_location);
    if (lead.employee_count) companyParts.push(`~${lead.employee_count} employees`);
    if (lead.founded_year) companyParts.push(`Founded ${lead.founded_year}`);
    if (lead.funding_stage || lead.total_funding) {
      const fundingStr = [lead.funding_stage, lead.total_funding].filter(Boolean).join(' (') + (lead.total_funding ? ')' : '');
      companyParts.push(fundingStr);
    }
    if (companyParts.length > 0) {
      lines.push(`**Company:** ${companyParts.join(' · ')}`);
      lines.push('');
    }

    // Pain hypotheses
    if (Array.isArray(painHypotheses) && painHypotheses.length > 0) {
      lines.push('**Pain hypotheses:**');
      painHypotheses.forEach((pain: any) => {
        if (typeof pain === 'string') {
          lines.push(`- ${pain}`);
        } else {
          const claim = pain.claim || pain.hypothesis || '';
          const why = pain.why_it_matters || pain.impact || '';
          lines.push(`- ${claim}${why ? ' → ' + why : ''}`);
        }
      });
      lines.push('');
    }

    // Tech signals
    if (Array.isArray(techStack) && techStack.length > 0) {
      lines.push('**Tech signals:**');
      techStack.forEach((tech: any) => {
        if (typeof tech === 'string') {
          lines.push(`- ${tech}`);
        } else {
          const name = tech.name || tech.product || '';
          const confidence = tech.confidence ? ` (${tech.confidence})` : '';
          const source = tech.source ? ` [${tech.source}]` : '';
          lines.push(`- ${name}${confidence}${source}`);
        }
      });
      lines.push('');
    } else if (typeof techStack === 'object' && techStack !== null && !Array.isArray(techStack)) {
      lines.push('**Tech signals:**');
      for (const [category, tools] of Object.entries(techStack)) {
        const toolStr = Array.isArray(tools) ? (tools as string[]).join(', ') : String(tools);
        lines.push(`- ${category}: ${toolStr}`);
      }
      lines.push('');
    }

    // Competitive displacement
    if (displacement && (displacement.likely_current || displacement.current_products || displacement.twingate_wedge || displacement.advantages)) {
      lines.push('**Competitive displacement:**');
      const current = displacement.likely_current || displacement.current_products || '';
      const wedge = displacement.twingate_wedge || displacement.advantages || '';
      if (current) lines.push(`- Likely current: ${Array.isArray(current) ? current.join(', ') : current}`);
      if (wedge) lines.push(`- Twingate wedge: ${Array.isArray(wedge) ? wedge.join(', ') : wedge}`);
      lines.push('');
    }

    // Target buyer
    if (champion.name || champion.title) {
      const outreachAngle = champion.outreach_angle ? ` — ${champion.outreach_angle}` : '';
      lines.push(`**Target buyer:** ${champion.name || 'Unknown'} — ${champion.title || 'Unknown title'}${outreachAngle}`);
      lines.push('');
    }

    // Outreach
    const talkingPoints = safeParse(champion.talking_points) || (typeof champion.talking_points === 'string' ? [champion.talking_points] : []);
    const outreachMessage = champion.outreach_message || '';
    if ((Array.isArray(talkingPoints) && talkingPoints.length > 0) || outreachMessage || champion.linkedin_url) {
      lines.push('**Outreach:**');
      if (Array.isArray(talkingPoints) && talkingPoints.length > 0) {
        lines.push('> Talking points:');
        talkingPoints.forEach((point: string) => {
          lines.push(`> - ${point}`);
        });
        lines.push('>');
      }
      if (outreachMessage) {
        lines.push(`> Draft message: "${outreachMessage}"`);
        lines.push('>');
      }
      if (champion.linkedin_url) {
        lines.push(`> LinkedIn: [${champion.name || 'profile'}](${champion.linkedin_url})`);
      }
      lines.push('');
    }

    // Score breakdown
    if (typeof scoreBreakdown === 'object' && scoreBreakdown !== null && Object.keys(scoreBreakdown).length > 0) {
      lines.push('**Score breakdown:**');
      lines.push('| Category | Points |');
      lines.push('|----------|--------|');
      for (const [category, points] of Object.entries(scoreBreakdown)) {
        lines.push(`| ${category} | ${points} |`);
      }
      lines.push('');
    }

    // Sources
    if (Array.isArray(sources) && sources.length > 0) {
      const sourceStrs = sources.map((s: any, i: number) => {
        const url = typeof s === 'string' ? s : (s.url || '');
        return `[${i + 1}] ${url}`;
      });
      lines.push(`**Sources:** ${sourceStrs.join(', ')}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}
