import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireOperator, AuthRequest } from '../auth/middleware.js';
import { logActivity } from '../services/activityLog.js';

const router = Router();

// ── ICP Config (versioned) ──────────────────────────────────────────

router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const config = db.prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 1').get();
  if (!config) return res.json(getDefaultICP());

  res.json(parseICPRow(config));
});

router.put('/', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const body = req.body;
  const db = getDb();

  const latest = db.prepare('SELECT version FROM icp_config ORDER BY version DESC LIMIT 1').get() as any;
  const version = latest ? latest.version + 1 : 1;

  const id = uuid();
  db.prepare(
    'INSERT INTO icp_config (id, version, segments, verticals, tech_signals, competitors, success_stories, updated_by) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    id, version,
    JSON.stringify(body.segments),
    JSON.stringify(body.verticals),
    JSON.stringify(body.tech_signals),
    JSON.stringify(body.competitors),
    JSON.stringify(body.success_stories || {}),
    req.user!.id
  );

  // Also save extended ICP fields to app_settings
  const extendedFields = ['company_context', 'geographies', 'segment_details', 'disqualifiers', 'signal_weights', 'buyer_personas'];
  for (const key of extendedFields) {
    if (body[key] !== undefined) {
      saveSetting(`icp.${key}`, body[key], req.user!.id);
    }
  }

  logActivity({
    userId: req.user!.id,
    entityType: 'icp_config',
    entityId: id,
    entityTitle: `ICP v${version}`,
    action: 'created',
    snapshot: body,
  });

  res.json({ success: true, version });
});

router.get('/full', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const config = db.prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 1').get();
  const base = config ? parseICPRow(config) : getDefaultICP();

  // Merge extended fields from app_settings
  const extended = {
    company_context: getSetting('icp.company_context', getDefaultCompanyContext()),
    geographies: getSetting('icp.geographies', getDefaultGeographies()),
    segment_details: getSetting('icp.segment_details', getDefaultSegmentDetails()),
    disqualifiers: getSetting('icp.disqualifiers', getDefaultDisqualifiers()),
    signal_weights: getSetting('icp.signal_weights', getDefaultSignalWeights()),
    buyer_personas: getSetting('icp.buyer_personas', getDefaultBuyerPersonas()),
  };

  res.json({ ...base, ...extended });
});

router.get('/history', authenticate, (_req: AuthRequest, res: Response) => {
  const configs = getDb().prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 20').all();
  res.json(configs.map(parseICPRow));
});

// ── Pipeline Run Config ─────────────────────────────────────────────

router.get('/pipeline', authenticate, (_req: AuthRequest, res: Response) => {
  res.json(getSetting('pipeline', getDefaultPipelineConfig()));
});

router.put('/pipeline', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const before = getSetting('pipeline', getDefaultPipelineConfig());
  saveSetting('pipeline', req.body, req.user!.id);

  logActivity({
    userId: req.user!.id,
    entityType: 'setting',
    entityId: 'pipeline',
    entityTitle: 'Pipeline Config',
    action: 'updated',
    snapshot: before,
  });

  res.json({ success: true });
});

// ── Prompt Config ───────────────────────────────────────────────────

router.get('/prompts', authenticate, (_req: AuthRequest, res: Response) => {
  res.json(getSetting('prompts', getDefaultPromptConfig()));
});

router.put('/prompts', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const before = getSetting('prompts', getDefaultPromptConfig());
  saveSetting('prompts', req.body, req.user!.id);

  logActivity({
    userId: req.user!.id,
    entityType: 'setting',
    entityId: 'prompts',
    entityTitle: 'Prompt Config',
    action: 'updated',
    snapshot: before,
  });

  res.json({ success: true });
});

// ── Helpers ─────────────────────────────────────────────────────────

function saveSetting(key: string, value: any, userId: string) {
  getDb().prepare(
    'INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?,?,?,datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime(\'now\')'
  ).run(key, JSON.stringify(value), userId);
}

function getSetting(key: string, defaultValue: any): any {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  if (!row) return defaultValue;
  try { return JSON.parse(row.value); } catch { return defaultValue; }
}

function parseICPRow(row: any) {
  return {
    ...row,
    segments: JSON.parse(row.segments),
    verticals: JSON.parse(row.verticals),
    tech_signals: JSON.parse(row.tech_signals),
    competitors: JSON.parse(row.competitors),
    success_stories: JSON.parse(row.success_stories || '{}'),
  };
}

function getDefaultICP() {
  return {
    version: 0,
    segments: {
      SMB: { vpn_users_min: 100, vpn_users_max: 350 },
      MM: { vpn_users_min: 350, vpn_users_max: 650 },
      ENT: { vpn_users_min: 650, vpn_users_max: 15000 },
    },
    verticals: ['gaming', 'byoc', 'developer-first', 'cloud-native-saas'],
    tech_signals: ['VPN replacement', 'ZTNA', 'Kubernetes', 'PAM', 'device posture', 'least privilege', 'IaC', 'platform engineering'],
    competitors: ['Tailscale', 'Netbird', 'Zscaler', 'Cloudflare', 'OpenVPN', 'CloudConnexa'],
    success_stories: {
      gaming: ['Epic Games', 'Riot Games', '2K Games', 'Intrepid Studios', 'Bad Robot Games'],
      byoc: ['Cyera', 'Tensor9', 'InterSystems'],
    },
  };
}

function getDefaultCompanyContext() {
  return {
    company_name: 'Twingate',
    product_name: 'Twingate',
    one_liner: 'Modern Zero Trust Network Access (ZTNA) that replaces legacy VPNs',
    value_props: [
      'Replaces clunky, slow corporate VPNs with seamless, developer-friendly experience',
      'Zero trust architecture: verify every request, least-privilege access',
      'Works great for BYOC, contractor, and distributed teams',
      'Cloud-native deployment, no hardware appliances',
      'IaC-first: Terraform provider, API-driven configuration',
      'Low-latency UDP tunnels for performance-sensitive workloads',
    ],
    differentiators: [
      'Developer UX (fastest time-to-value in ZTNA space)',
      'IaC-native (Terraform, Pulumi, API-first)',
      'Low-latency performance for gaming and media workloads',
      'Device posture checks without separate MDM',
      'BYOC/builder pattern support (customer-managed deployments)',
    ],
    website: 'https://www.twingate.com',
    industry_focus: 'Cybersecurity / Zero Trust Network Access',
  };
}

function getDefaultGeographies() {
  return {
    target_regions: ['North America', 'Europe', 'APAC'],
    target_countries: ['United States', 'Canada', 'United Kingdom', 'Germany', 'Australia'],
    hq_preference: 'any',
    notes: 'Prioritize US-headquartered companies. Include international if strong ICP fit.',
  };
}

function getDefaultSegmentDetails() {
  return {
    ENT: {
      employee_min: 1000,
      employee_max: 50000,
      revenue_min: '$100M',
      revenue_max: '',
      funding_stages: ['Series C+', 'Public', 'Private (large)'],
      notes: 'Look for F500/F1000, large gaming studios, established security companies',
    },
    MM: {
      employee_min: 200,
      employee_max: 2000,
      revenue_min: '$20M',
      revenue_max: '$500M',
      funding_stages: ['Series B', 'Series C', 'Series D'],
      notes: 'Sweet spot: fast-growing companies with 300-1500 employees making vendor decisions',
    },
    SMB: {
      employee_min: 30,
      employee_max: 350,
      revenue_min: '',
      revenue_max: '$50M',
      funding_stages: ['Seed', 'Series A', 'Series B'],
      notes: 'YC companies, developer-tool startups, early-stage security companies',
    },
  };
}

function getDefaultDisqualifiers() {
  return [
    { signal: 'Government / public sector (FedRAMP required)', severity: 'hard', notes: 'Unless FedRAMP is in roadmap' },
    { signal: 'Fewer than 20 employees', severity: 'hard', notes: 'Too small for outbound' },
    { signal: 'Company is a direct ZTNA competitor', severity: 'hard', notes: 'They build the same thing' },
    { signal: 'No remote or distributed workforce', severity: 'soft', notes: 'Low VPN user count likely' },
    { signal: 'Recently signed multi-year VPN contract', severity: 'soft', notes: 'Timing is wrong' },
    { signal: 'Acquired in last 6 months (integration freeze)', severity: 'soft', notes: 'Usually locked into acquirer\'s stack' },
  ];
}

function getDefaultSignalWeights() {
  return [
    { signal: 'VPN replacement / ZTNA evaluation', weight: 10, category: 'buying_intent' },
    { signal: 'Hiring security/IT/platform engineers', weight: 8, category: 'buying_intent' },
    { signal: 'Remote-first or distributed team', weight: 7, category: 'pain_indicator' },
    { signal: 'Kubernetes / container orchestration', weight: 6, category: 'tech_fit' },
    { signal: 'SEC filing mentions zero trust', weight: 9, category: 'buying_intent' },
    { signal: 'VPN vulnerability / security incident', weight: 10, category: 'urgency' },
    { signal: 'Rapid headcount growth (>30% YoY)', weight: 7, category: 'pain_indicator' },
    { signal: 'Multi-cloud infrastructure', weight: 5, category: 'tech_fit' },
    { signal: 'Competitor product mentioned in job posts', weight: 8, category: 'displacement' },
    { signal: 'Conference speaker/sponsor (KubeCon, RSA, GDC)', weight: 5, category: 'tech_fit' },
    { signal: 'SOC 2 / compliance initiative', weight: 6, category: 'buying_intent' },
    { signal: 'BYOC / contractor access needs', weight: 7, category: 'pain_indicator' },
    { signal: 'Perforce / large asset pipelines', weight: 8, category: 'vertical_fit' },
    { signal: 'PAM evaluation or adoption', weight: 6, category: 'tech_fit' },
  ];
}

function getDefaultBuyerPersonas() {
  return {
    champion: {
      label: 'Champion (drives evaluation)',
      priority: 1,
      titles: [
        'Director of IT', 'Director of Infrastructure', 'Director of Security Engineering',
        'Sr. Security Engineer', 'Platform Engineering Manager', 'Head of IT Operations',
        'Network Security Manager', 'IT Infrastructure Lead',
      ],
      departments: ['IT', 'Infrastructure', 'Security', 'Platform Engineering', 'SRE'],
      notes: 'These people feel VPN pain daily and drive vendor evaluations. Primary outreach target.',
    },
    economic_buyer: {
      label: 'Economic Buyer (signs the PO)',
      priority: 2,
      titles: [
        'VP of IT', 'VP of Infrastructure', 'VP of Engineering', 'CISO', 'VP of Security',
      ],
      departments: ['IT', 'Engineering', 'Security'],
      notes: 'Budget authority. Target with ROI and risk reduction angles.',
    },
    executive_sponsor: {
      label: 'Executive Sponsor (blesses initiative)',
      priority: 3,
      titles: ['CTO', 'CIO', 'CSO'],
      departments: ['C-Suite'],
      notes: 'Only include if specific signal exists (spoke about zero trust, posted about infra modernization).',
    },
  };
}

function getDefaultPipelineConfig() {
  return {
    leads_per_segment: 5,
    min_candidates_per_segment: 8,
    min_score_threshold: 40,
    prefer_score_threshold: 60,
    cooldown_days: 180,
    model: 'claude-opus-4-6@default',
    max_tokens_research: 16384,
    max_tokens_scoring: 2048,
    max_tokens_brief: 4096,
    concurrent_api_calls: 5,
    schedule_cron: '0 14 * * 1',
    schedule_description: 'Mondays at 7am MST (14:00 UTC)',
  };
}

function getDefaultPromptConfig() {
  return {
    research_preamble: '',
    research_additional_instructions: '',
    scoring_weight_overrides: '',
    outreach_tone: 'consultative',
    outreach_tone_description: 'Peer-to-peer, consultative, not salesy. Like a fellow engineer reaching out.',
    outreach_tones_available: ['consultative', 'direct', 'technical', 'executive', 'casual'],
    custom_scoring_criteria: '',
    brief_additional_sections: '',
  };
}

function getDefaultFunnelConfig() {
  return {
    version: 1,
    steps: [
      { id: 'discover', enabled: true, model: 'claude-haiku-4-5@20251001', max_tokens: 16384, candidate_limit: 50, source_strategy: 'search_augmented' as const, search_max_queries: 8, search_max_results_per_query: 5 },
      { id: 'qualify', enabled: true, candidate_limit: 20, qualification_criteria: [] as string[], disqualification_criteria: [] as string[] },
      { id: 'enrich', enabled: true, candidate_limit: 15 },
      { id: 'score', enabled: true, model: 'claude-opus-4-6@default', max_tokens: 2048, candidate_limit: 10 },
      { id: 'brief', enabled: true, model: 'claude-opus-4-6@default', max_tokens: 16384 },
    ],
  };
}

export { getDefaultICP, getDefaultPipelineConfig, getDefaultPromptConfig, getDefaultFunnelConfig, getSetting, saveSetting };
export default router;
