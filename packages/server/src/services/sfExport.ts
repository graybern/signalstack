function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

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

export function generateSummaryCSV(leads: any[]): string {
  const BOM = '\xEF\xBB\xBF';
  const headers = [
    'Account Name', 'Segment', 'Fit Score', 'Fit Label', 'Confidence',
    'Why Now', 'Target Buyer', 'Title', 'Pain Hypothesis',
    'Competitive Displacement', 'Source Count',
  ];

  const rows = leads.map((lead) => {
    const personas = safeParse(lead.personas_json) || [];
    const champion = personas.find((p: any) => p.role_type === 'champion') || personas[0] || {};
    const whyNow = safeParse(lead.why_now);
    const whyNowStr = Array.isArray(whyNow) ? whyNow.join('; ') : (whyNow || '');
    const painHypotheses = safeParse(lead.pain_hypotheses);
    const painStr = Array.isArray(painHypotheses)
      ? painHypotheses.map((p: any) => (typeof p === 'string' ? p : p.claim || p.hypothesis || '')).join('; ')
      : '';
    const displacement = safeParse(lead.competitive_displacement);
    const displacementStr = displacement
      ? (displacement.likely_current || displacement.current_products || '')
      : '';
    const sources = safeParse(lead.source_citations);
    const sourceCount = Array.isArray(sources) ? sources.length : 0;

    return [
      lead.company_name,
      lead.segment,
      lead.fit_score,
      fitLabel(lead.fit_score),
      lead.confidence,
      whyNowStr,
      champion.name || '',
      champion.title || '',
      painStr,
      displacementStr,
      sourceCount,
    ].map(escapeCSV).join(',');
  });

  return BOM + headers.join(',') + '\n' + rows.join('\n') + '\n';
}

export function generateDetailedCSV(leads: any[]): string {
  const BOM = '\xEF\xBB\xBF';
  const headers = [
    'FirstName', 'LastName', 'Company', 'Title', 'Email', 'Phone', 'Website',
    'LeadSource', 'Status', 'Rating', 'Industry', 'NumberOfEmployees',
    'City', 'State', 'Country', 'Description', 'Campaign',
    'Fit_Score__c', 'Segment__c', 'Pain_Hypothesis__c', 'Displacement_Target__c',
    'Champion_Name__c', 'Champion_Title__c', 'Champion_LinkedIn__c',
    'Why_Now_1', 'Why_Now_2', 'Why_Now_3',
    'VPN_Product', 'Cloud_Infra', 'Dev_Tools',
    'Score_Breakdown', 'Source_URLs',
  ];

  const now = new Date();
  const week = getISOWeek(now);
  const year = now.getFullYear();
  const campaign = `Pipeline_Gen_WK${week}_${year}`;

  const rows = leads.map((lead) => {
    const personas = safeParse(lead.personas_json) || [];
    const champion = personas.find((p: any) => p.role_type === 'champion') || personas[0] || {};
    const whyNow = safeParse(lead.why_now) || [];
    const painHypotheses = safeParse(lead.pain_hypotheses) || [];
    const techStack = safeParse(lead.tech_stack) || {};
    const displacement = safeParse(lead.competitive_displacement) || {};
    const sources = safeParse(lead.source_citations) || [];
    const scoreBreakdown = safeParse(lead.score_breakdown) || {};

    const nameParts = (champion.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const rating = lead.fit_score >= 80 ? 'Hot' : lead.fit_score >= 60 ? 'Warm' : 'Cold';

    const hqParts = (lead.hq_location || '').split(',').map((s: string) => s.trim());
    const city = hqParts[0] || '';
    const state = hqParts[1] || '';
    const country = hqParts[2] || hqParts[1] || '';

    const painStr = Array.isArray(painHypotheses)
      ? painHypotheses.map((p: any) => (typeof p === 'string' ? p : p.claim || p.hypothesis || '')).join('; ')
      : '';

    const displacementTarget = displacement.likely_current || displacement.current_products || '';

    const vpnProduct = extractTechCategory(techStack, 'vpn');
    const cloudInfra = extractTechCategory(techStack, 'cloud');
    const devTools = extractTechCategory(techStack, 'dev');

    const breakdownStr = typeof scoreBreakdown === 'object'
      ? Object.entries(scoreBreakdown).map(([k, v]) => `${k}: ${v}`).join('; ')
      : String(scoreBreakdown || '');

    const sourceURLs = Array.isArray(sources)
      ? sources.map((s: any) => (typeof s === 'string' ? s : s.url || '')).join('; ')
      : '';

    return [
      firstName, lastName, lead.company_name, champion.title || '',
      '', '', lead.website || '',
      'SignalStack AI', 'Open - Not Contacted', rating,
      '', lead.employee_count || '',
      city, state, country,
      '', campaign,
      lead.fit_score, lead.segment, painStr, displacementTarget,
      champion.name || '', champion.title || '', champion.linkedin_url || '',
      whyNow[0] || '', whyNow[1] || '', whyNow[2] || '',
      vpnProduct, cloudInfra, devTools,
      breakdownStr, sourceURLs,
    ].map(escapeCSV).join(',');
  });

  return BOM + headers.join(',') + '\n' + rows.join('\n') + '\n';
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function extractTechCategory(techStack: any, category: string): string {
  if (Array.isArray(techStack)) {
    const match = techStack.filter((t: any) =>
      (typeof t === 'string' ? t : (t.category || t.name || '')).toLowerCase().includes(category)
    );
    return match.map((t: any) => (typeof t === 'string' ? t : t.name || t.product || '')).join(', ');
  }
  if (typeof techStack === 'object' && techStack !== null) {
    for (const key of Object.keys(techStack)) {
      if (key.toLowerCase().includes(category)) {
        const val = techStack[key];
        return Array.isArray(val) ? val.join(', ') : String(val || '');
      }
    }
  }
  return '';
}
