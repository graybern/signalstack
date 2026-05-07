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
      employee_min: 1000,
      employee_max: 50000,
      revenue_min: '',
      revenue_max: '',
      funding_stages: [] as string[],
      notes: '',
    },
    MM: {
      employee_min: 200,
      employee_max: 2000,
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
    champion: {
      label: 'Champion (drives evaluation)',
      priority: 1,
      titles: [] as string[],
      departments: [] as string[],
      notes: '',
    },
    economic_buyer: {
      label: 'Economic Buyer (signs the PO)',
      priority: 2,
      titles: [] as string[],
      departments: [] as string[],
      notes: '',
    },
    executive_sponsor: {
      label: 'Executive Sponsor (blesses initiative)',
      priority: 3,
      titles: [] as string[],
      departments: [] as string[],
      notes: '',
    },
  };
}
