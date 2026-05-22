export function getDefaultICP() {
  return {
    version: 0,
    segments: {
      SMB: { vpn_users_min: 100, vpn_users_max: 350 },
      MM: { vpn_users_min: 350, vpn_users_max: 650 },
      ENT: { vpn_users_min: 650, vpn_users_max: 15000 },
    },
    verticals: [] as string[],
    tech_signals: [] as string[],
    competitors: [] as string[],
    success_stories: {} as Record<string, string[]>,
  };
}

export function getDefaultCompanyContext() {
  return {
    company_name: '',
    product_name: '',
    one_liner: '',
    value_props: [] as string[],
    differentiators: [] as string[],
    website: '',
    industry_focus: '',
  };
}

export function getDefaultGeographies() {
  return {
    target_regions: [] as string[],
    target_countries: [] as string[],
    hq_preference: 'any',
    notes: '',
  };
}

export function getDefaultSegmentDetails() {
  return {
    ENT: {
      employee_min: 651,
      employee_max: 15000,
      revenue_min: '',
      revenue_max: '',
      funding_stages: [] as string[],
      notes: '',
    },
    MM: {
      employee_min: 351,
      employee_max: 650,
      revenue_min: '',
      revenue_max: '',
      funding_stages: [] as string[],
      notes: '',
    },
    SMB: {
      employee_min: 30,
      employee_max: 350,
      revenue_min: '',
      revenue_max: '',
      funding_stages: [] as string[],
      notes: '',
    },
  };
}

export function getDefaultDisqualifiers() {
  return [
    { signal: 'Fewer than 20 employees', severity: 'hard' as const, notes: 'Too small for outbound' },
    { signal: 'Company is a direct competitor', severity: 'hard' as const, notes: 'They build the same thing' },
    { signal: 'Government or public sector entity', severity: 'hard' as const, notes: 'No FedRAMP support' },
    { signal: 'Federal contractor (primary revenue)', severity: 'hard' as const, notes: 'Government-dependent revenue' },
    { signal: 'Defense contractor', severity: 'hard' as const, notes: 'ITAR/classified requirements' },
  ];
}

export function getDefaultExcludedDomainPatterns() {
  return ['.gov', '.mil', '.gov.uk', '.gov.au', '.gc.ca'];
}

export function getDefaultSignalWeights() {
  return [] as { signal: string; weight: number; category: string }[];
}

export function getDefaultTechStackCategories() {
  return [
    { id: 'vpn', label: 'VPN / Network Access', examples: ['Cisco AnyConnect', 'Palo Alto GlobalProtect', 'Fortinet FortiClient', 'Zscaler', 'Tailscale'] },
    { id: 'pam', label: 'PAM / Privileged Access', examples: ['CyberArk', 'BeyondTrust', 'Delinea', 'HashiCorp Vault'] },
    { id: 'mdm', label: 'MDM / Endpoint Mgmt', examples: ['Jamf', 'Intune', 'Kandji', 'Mosyle'] },
    { id: 'edr', label: 'EDR / XDR', examples: ['CrowdStrike', 'SentinelOne', 'Microsoft Defender', 'Carbon Black'] },
    { id: 'idp', label: 'Identity Provider', examples: ['Okta', 'Azure AD / Entra', 'Ping Identity', 'OneLogin'] },
    { id: 'cloud', label: 'Cloud Infrastructure', examples: ['AWS', 'Azure', 'GCP', 'Cloudflare'] },
    { id: 'siem', label: 'SIEM / Observability', examples: ['Splunk', 'Datadog', 'Elastic', 'Sumo Logic'] },
    { id: 'devops', label: 'DevOps / GitOps', examples: ['GitHub', 'GitLab', 'ArgoCD', 'Terraform', 'Jenkins'] },
  ];
}

export function getDefaultBuyerPersonas() {
  return {
    technical_champion: {
      label: 'Technical Champion (drives evaluation)',
      priority: 1,
      titles: ['Director of IT', 'Sr. IT Manager', 'Director of Infrastructure', 'Security Manager'] as string[],
      departments: ['IT', 'Infrastructure', 'Security', 'Platform Engineering'] as string[],
      notes: 'Day-to-day evaluator who owns the problem. Should receive the most detailed, personalized outreach.',
    },
    hands_on_keyboard: {
      label: 'Hands-on Keyboard (deploys & operates)',
      priority: 2,
      titles: ['DevOps Engineer', 'Platform Engineer', 'SRE', 'Infrastructure Engineer'] as string[],
      departments: ['Engineering', 'DevOps', 'Platform', 'SRE'] as string[],
      notes: 'Only include when evidence of hands-on technical culture exists. Gets the most technically specific outreach.',
    },
    economic_buyer: {
      label: 'Economic Buyer (signs the PO)',
      priority: 3,
      titles: ['VP of IT', 'VP of Engineering', 'CISO'] as string[],
      departments: ['IT', 'Engineering', 'Security'] as string[],
      notes: 'Controls the budget. For SMB may be the same person as technical champion.',
    },
    executive_sponsor: {
      label: 'Executive Sponsor (blesses initiative)',
      priority: 4,
      titles: ['CTO', 'CIO'] as string[],
      departments: ['Executive'] as string[],
      notes: 'Only include with specific signal justification (conference talk, public statement, org restructure).',
    },
  };
}
