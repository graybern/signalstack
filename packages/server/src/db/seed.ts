import { getDb } from './schema.js';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';

const db = getDb();

// Create default admin user
const adminId = uuid();
db.prepare(
  'INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)'
).run(adminId, 'admin@pipeline-gen.local', bcrypt.hashSync('admin123', 10), 'Admin', 'superadmin');

// Create default ICP config
db.prepare(`
  INSERT OR IGNORE INTO icp_config (id, version, segments, verticals, tech_signals, competitors, success_stories, updated_by)
  VALUES (?, 1, ?, ?, ?, ?, ?, ?)
`).run(
  uuid(),
  JSON.stringify({
    SMB: { vpn_users_min: 100, vpn_users_max: 350 },
    MM: { vpn_users_min: 350, vpn_users_max: 650 },
    ENT: { vpn_users_min: 650, vpn_users_max: 15000 },
  }),
  JSON.stringify(['gaming', 'byoc', 'developer-first', 'cloud-native-saas']),
  JSON.stringify(['VPN replacement', 'ZTNA', 'Kubernetes', 'PAM', 'device posture', 'least privilege', 'IaC', 'platform engineering']),
  JSON.stringify(['Tailscale', 'Netbird', 'Zscaler', 'Cloudflare', 'OpenVPN', 'CloudConnexa']),
  JSON.stringify({
    gaming: ['Epic Games', 'Riot Games', '2K Games', 'Intrepid Studios', 'Bad Robot Games'],
    byoc: ['Cyera', 'Tensor9', 'InterSystems'],
  }),
  adminId
);

// Insert sample pipeline run with leads for demo
const runId = uuid();
db.prepare(
  "INSERT INTO pipeline_runs (id, triggered_by, status, started_at, completed_at, lead_count) VALUES (?,?,?,?,?,?)"
).run(runId, adminId, 'completed', new Date().toISOString(), new Date().toISOString(), 15);

const sampleLeads = [
  // ENT
  { name: 'Riot Games', segment: 'ENT', hq: 'Los Angeles, CA', emp: 5000, founded: 2006, funding: 'Acquired', total: '$400M', score: 92, confidence: 'high',
    why_now: ['Expanding remote dev studios globally', 'Hiring 12 network security engineers', 'GDC 2026 presentation on secure dev pipelines'],
    pain: [{ claim: 'Massive distributed dev workforce needs low-latency access to Perforce', why_it_matters: 'Game build assets are 100GB+; VPN tunnels create 200ms+ latency for remote studios' }],
    tech: { vpn_product: { product: 'Cisco AnyConnect', confidence: 'medium', evidence: 'Job posting mentions AnyConnect', source: 'https://careers.riotgames.com' }, cloud_infra: ['AWS', 'GCP'], dev_tools: ['Perforce', 'Jenkins', 'Kubernetes'] },
    competitive: { likely_current: ['Cisco AnyConnect', 'SSL VPN'], twingate_wedge: ['Low-latency UDP tunnel', 'Perforce-optimized routing', 'IaC-first deployment'] },
  },
  { name: 'Epic Games', segment: 'ENT', hq: 'Cary, NC', emp: 3500, founded: 1991, funding: 'Private', total: '$3B+', score: 88, confidence: 'high',
    why_now: ['Unreal Engine 6 launch driving expanded dev partnerships', 'New remote collaboration tools for MetaHuman'],
    pain: [{ claim: 'Global partner studios need secure access to Unreal source', why_it_matters: 'Source code access requires network-level controls beyond VPN' }],
    tech: { cloud_infra: ['AWS'], dev_tools: ['Perforce', 'Unreal Build System'] },
    competitive: { likely_current: ['IPSec VPN', 'Custom tunnel'], twingate_wedge: ['Zero trust for partner access', 'Device posture checks'] },
  },
  { name: 'Datadog', segment: 'ENT', hq: 'New York, NY', emp: 6000, founded: 2010, funding: 'Public (DDOG)', total: '$2.4B', score: 85, confidence: 'high',
    why_now: ['SEC 10-K mentions "zero trust network architecture" in IT roadmap', 'Hiring VP of Infrastructure Security'],
    pain: [{ claim: 'Engineering teams across 10 offices need seamless access to internal staging', why_it_matters: 'Observability platform requires low-latency access to thousands of internal services' }],
    tech: { vpn_product: { product: 'Zscaler ZPA', confidence: 'medium', evidence: 'LinkedIn profiles mention Zscaler cert', source: '' }, cloud_infra: ['AWS', 'GCP', 'Azure'], dev_tools: ['GitHub', 'Kubernetes', 'Terraform'] },
    competitive: { likely_current: ['Zscaler ZPA'], twingate_wedge: ['Developer-friendly UX', 'IaC-native', 'Better Kubernetes integration'] },
  },
  { name: 'Cloudflare', segment: 'ENT', hq: 'San Francisco, CA', emp: 4000, founded: 2009, funding: 'Public (NET)', total: '$680M', score: 78, confidence: 'medium',
    why_now: ['Rapid team growth in APAC region', 'Platform engineering team hiring surge'],
    pain: [{ claim: 'Internal tool access for distributed engineering', why_it_matters: 'Ironically may use competitor solutions internally for ZTNA' }],
    tech: { cloud_infra: ['Own infrastructure', 'GCP'], dev_tools: ['GitHub', 'Go toolchain'] },
    competitive: { likely_current: ['Cloudflare Access (own product)'], twingate_wedge: ['Competitive displacement unlikely — watchlist only'] },
  },
  { name: 'CrowdStrike', segment: 'ENT', hq: 'Austin, TX', emp: 8500, founded: 2011, funding: 'Public (CRWD)', total: '$2B', score: 82, confidence: 'high',
    why_now: ['Post-incident security review driving vendor stack evaluation', 'Hiring Director of IT Infrastructure'],
    pain: [{ claim: 'Security company with massive remote workforce needs best-in-class access controls', why_it_matters: 'Reputational risk if their own network security is breached' }],
    tech: { vpn_product: { product: 'Palo Alto GlobalProtect', confidence: 'low', evidence: 'Industry norm for security companies', source: '' }, cloud_infra: ['AWS'], dev_tools: ['GitHub', 'Jenkins'] },
    competitive: { likely_current: ['Palo Alto GlobalProtect'], twingate_wedge: ['Zero trust posture', 'Agent-based device trust'] },
  },
  // MM
  { name: 'Snyk', segment: 'MM', hq: 'Boston, MA', emp: 1000, founded: 2015, funding: 'Series G', total: '$849M', score: 86, confidence: 'high',
    why_now: ['Series G at $7.4B valuation', 'Expanding platform engineering team', 'DevSecOps positioning aligns with ZTNA story'],
    pain: [{ claim: 'Developer security platform needs secure internal API access', why_it_matters: 'Customer demos require access to internal environments' }],
    tech: { cloud_infra: ['AWS', 'GCP'], dev_tools: ['GitHub', 'Docker', 'Kubernetes'] },
    competitive: { likely_current: ['Tailscale'], twingate_wedge: ['Enterprise-grade policy engine', 'Salesforce integration'] },
  },
  { name: 'Wiz', segment: 'MM', hq: 'New York, NY', emp: 1500, founded: 2020, funding: 'Series E', total: '$1.9B', score: 84, confidence: 'high',
    why_now: ['Hyper-growth adding 50+ engineers/month', 'Multi-cloud security focus', 'New R&D center in Tel Aviv'],
    pain: [{ claim: 'Rapid scaling creates access management complexity', why_it_matters: 'New hires need Day 1 access to internal tools across regions' }],
    tech: { cloud_infra: ['AWS', 'Azure', 'GCP'], dev_tools: ['GitHub', 'Terraform', 'Kubernetes'] },
    competitive: { likely_current: ['Zscaler ZPA'], twingate_wedge: ['Faster deployment', 'Better developer UX'] },
  },
  { name: 'Figma', segment: 'MM', hq: 'San Francisco, CA', emp: 1500, founded: 2012, funding: 'Acquired (Adobe)', total: '$20B', score: 80, confidence: 'medium',
    why_now: ['Post-acquisition integration with Adobe infrastructure', 'Platform team scaling'],
    pain: [{ claim: 'Design platform needs secure collaboration infrastructure', why_it_matters: 'Adobe integration requires cross-org network access' }],
    tech: { cloud_infra: ['AWS'], dev_tools: ['GitHub', 'Kubernetes'] },
    competitive: { likely_current: ['Corporate VPN (Adobe)'], twingate_wedge: ['ZTNA for post-acquisition integration'] },
  },
  { name: 'HashiCorp', segment: 'MM', hq: 'San Francisco, CA', emp: 2200, founded: 2012, funding: 'Acquired (IBM)', total: '$6.4B', score: 77, confidence: 'medium',
    why_now: ['IBM acquisition creating infrastructure consolidation', 'IaC expertise makes them ideal Twingate adopter'],
    pain: [{ claim: 'Terraform/Vault company needs modern network access', why_it_matters: 'Dog-fooding pressure — their own tools should integrate with their access layer' }],
    tech: { cloud_infra: ['AWS', 'GCP', 'Azure'], dev_tools: ['GitHub', 'Terraform', 'Vault', 'Nomad'] },
    competitive: { likely_current: ['Own Boundary product'], twingate_wedge: ['Displacement unlikely — watchlist'] },
  },
  { name: 'Grafana Labs', segment: 'MM', hq: 'New York, NY', emp: 1000, founded: 2014, funding: 'Series D', total: '$394M', score: 75, confidence: 'medium',
    why_now: ['Remote-first company with fully distributed team', 'Hiring infrastructure security lead'],
    pain: [{ claim: 'Fully remote workforce needs seamless access to internal Grafana stacks', why_it_matters: 'Observability company with complex internal monitoring infrastructure' }],
    tech: { cloud_infra: ['AWS', 'GCP'], dev_tools: ['GitHub', 'Go', 'Kubernetes'] },
    competitive: { likely_current: ['Tailscale', 'WireGuard'], twingate_wedge: ['Enterprise policy', 'SSO integration', 'Audit logging'] },
  },
  // SMB
  { name: 'Rivet (YC W24)', segment: 'SMB', hq: 'San Francisco, CA', emp: 25, founded: 2023, funding: 'Seed', total: '$4M', score: 72, confidence: 'medium',
    why_now: ['YC batch company scaling infrastructure', 'Building developer-facing platform'],
    pain: [{ claim: 'Early-stage infra needs right patterns from day one', why_it_matters: 'Choosing VPN/access now sets foundation for growth' }],
    tech: { cloud_infra: ['AWS'], dev_tools: ['GitHub', 'Kubernetes'] },
    competitive: { likely_current: ['No VPN (greenfield)'], twingate_wedge: ['Greenfield opportunity', 'Developer-first UX'] },
  },
  { name: 'Teleport', segment: 'SMB', hq: 'Oakland, CA', emp: 200, founded: 2015, funding: 'Series C', total: '$169M', score: 68, confidence: 'medium',
    why_now: ['Infrastructure access company — deep domain alignment', 'Hiring SRE team lead'],
    pain: [{ claim: 'Access management company still needs network-level ZTNA', why_it_matters: 'Their product handles SSH/K8s access but not network-layer connectivity' }],
    tech: { cloud_infra: ['AWS', 'GCP'], dev_tools: ['GitHub', 'Go', 'Kubernetes'] },
    competitive: { likely_current: ['Own product (partial)'], twingate_wedge: ['Network-layer complement to their app-layer access'] },
  },
  { name: 'Depot', segment: 'SMB', hq: 'Remote', emp: 15, founded: 2022, funding: 'Seed', total: '$2.5M', score: 66, confidence: 'low',
    why_now: ['Fast-growing CI/CD platform', 'Remote team needs internal tool access'],
    pain: [{ claim: 'CI infrastructure requires secure network access', why_it_matters: 'Build systems need access to private registries and repos' }],
    tech: { cloud_infra: ['AWS'], dev_tools: ['GitHub', 'Docker', 'BuildKit'] },
    competitive: { likely_current: ['No VPN'], twingate_wedge: ['Greenfield', 'CI/CD integration story'] },
  },
  { name: 'Render', segment: 'SMB', hq: 'San Francisco, CA', emp: 150, founded: 2018, funding: 'Series B', total: '$80M', score: 70, confidence: 'medium',
    why_now: ['Cloud platform scaling rapidly', 'Hiring security engineers', 'SOC 2 compliance push'],
    pain: [{ claim: 'Platform company needs zero trust for internal services', why_it_matters: 'Customer-facing cloud infra requires strict access controls' }],
    tech: { cloud_infra: ['AWS', 'GCP'], dev_tools: ['GitHub', 'Kubernetes', 'Terraform'] },
    competitive: { likely_current: ['Tailscale'], twingate_wedge: ['Enterprise compliance features', 'Better audit trail'] },
  },
  { name: 'Railway', segment: 'SMB', hq: 'San Francisco, CA', emp: 50, founded: 2020, funding: 'Series A', total: '$45M', score: 65, confidence: 'medium',
    why_now: ['Deployment platform growth', 'Moving upmarket to enterprise customers'],
    pain: [{ claim: 'Internal platform access for growing team', why_it_matters: 'Moving upmarket requires enterprise-grade security posture' }],
    tech: { cloud_infra: ['GCP'], dev_tools: ['GitHub', 'Kubernetes', 'Nix'] },
    competitive: { likely_current: ['No formal VPN'], twingate_wedge: ['Enterprise credibility for upmarket move'] },
  },
];

const insertLead = db.prepare(`
  INSERT INTO leads (id, run_id, company_name, segment, hq_location, employee_count, founded_year, funding_stage, total_funding, fit_score, fit_score_label, confidence, why_now, score_breakdown, pain_hypotheses, tech_stack, competitive_displacement, outreach_strategy, source_citations)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const insertPersona = db.prepare(`
  INSERT INTO personas (id, lead_id, role_type, name, title, linkedin_url, department, outreach_angle, talking_points, outreach_message)
  VALUES (?,?,?,?,?,?,?,?,?,?)
`);

const insertLedger = db.prepare(`
  INSERT OR REPLACE INTO recommendations_ledger (id, company_name, domain, first_recommended_at, last_recommended_at, times_recommended)
  VALUES (?,?,?,?,?,?)
`);

const tx = db.transaction(() => {
  for (const l of sampleLeads) {
    const leadId = uuid();
    const label = l.score >= 90 ? 'Extremely High' : l.score >= 75 ? 'High' : l.score >= 60 ? 'Medium' : l.score >= 40 ? 'Low' : 'Very Low';

    const scoreBreakdown = {
      segment_scale_fit: { points: Math.min(20, Math.round(l.score * 0.2)), evidence: [] },
      why_now_triggers: { points: Math.min(15, Math.round(l.score * 0.15)), evidence: [] },
      remote_access_pain: { points: Math.min(20, Math.round(l.score * 0.2)), evidence: [] },
      displacement_wedge: { points: Math.min(20, Math.round(l.score * 0.2)), evidence: [] },
      vertical_playbook: { points: Math.min(15, Math.round(l.score * 0.15)), evidence: [] },
      buyer_access_readiness: { points: Math.min(10, Math.round(l.score * 0.1)), evidence: [] },
      penalties: [],
      total: l.score,
    };

    const outreach = {
      sequence: ['LinkedIn connection to champion', 'Follow-up email with pain hypothesis', 'Executive sponsor outreach with case study'],
      one_line_pitch: `${l.name} is scaling fast with distributed teams — Twingate replaces VPN complexity with zero-trust access in minutes.`,
    };

    insertLead.run(
      leadId, runId, l.name, l.segment, l.hq, l.emp, l.founded, l.funding, l.total,
      l.score, label, l.confidence,
      JSON.stringify(l.why_now),
      JSON.stringify(scoreBreakdown),
      JSON.stringify(l.pain),
      JSON.stringify(l.tech),
      JSON.stringify(l.competitive),
      JSON.stringify(outreach),
      JSON.stringify([{ type: 'company_website', url: `https://${l.name.toLowerCase().replace(/\s+/g, '')}.com`, label: 'Company website' }])
    );

    // Add personas
    const personas = [
      { role: 'champion' as const, name: 'Director of IT', title: 'Director of IT Infrastructure', dept: 'it' },
      { role: 'economic_buyer' as const, name: 'VP Engineering', title: 'VP of Engineering', dept: 'engineering' },
    ];
    for (const p of personas) {
      insertPersona.run(
        uuid(), leadId, p.role, p.name, p.title, null, p.dept,
        `${l.name}'s ${p.title} owns the network access decision`,
        JSON.stringify([`${l.name}'s growth trajectory suggests VPN scaling issues`, `${l.competitive.likely_current[0] || 'Legacy VPN'} replacement timing is right`, 'ZTNA aligns with their platform engineering direction']),
        `Hi — noticed ${l.name} is scaling the engineering org fast. We work with similar teams hitting VPN bottlenecks at scale. Open to a quick chat about what we've seen work?`
      );
    }

    // Add to ledger
    const now = new Date().toISOString();
    insertLedger.run(uuid(), l.name, `${l.name.toLowerCase().replace(/\s+/g, '')}.com`, now, now, 1);
  }
});

tx();

// ── BYOC Campaign + Sample Campaign Leads ────────────────────────────

const campaignId = uuid();
db.prepare(`
  INSERT INTO campaigns (id, name, description, pattern_thesis, example_companies, target_signals, anti_patterns, target_categories, search_patterns, value_prop_angle, target_count, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  campaignId,
  'BYOC Partners',
  'SaaS companies and ISVs that would benefit from network peering, private tunnels, or deploying into customer environments with secure connectivity',
  `Companies that build products requiring deployment INTO customer private environments (on-prem, VPC, private cloud), OR SaaS offerings that would benefit from network peering for low latency, high throughput, and high security.

Two core patterns:
1. ISVs building private tunnels: Independent software vendors that would benefit from building private tunnels into their platform and offerings to customers.
2. SaaS requiring network peering: Offerings that require low latency, high throughput, or high security — such as real-time collaboration tools, streaming platforms, and services that run in customer on-prem/cloud environments.`,
  JSON.stringify([
    { name: 'Cyera', domain: 'cyera.io', why_they_fit: 'Deploys data security scanners into customer environments. Uses Twingate for secure connectivity to customer infrastructure, allowing data to reside locally while scans occur in-situ.' },
    { name: 'Tensor9', domain: 'tensor9.com', why_they_fit: 'Platform for deploying software into customer environments. Core product literally solves the "deploy into customer infra" problem — perfect Twingate embedding use case.' },
    { name: 'InterSystems', domain: 'intersystems.com', why_they_fit: 'Healthcare data platform that deploys into hospital/health system private networks. Needs secure access to sensitive patient data environments.' },
  ]),
  JSON.stringify([
    'On-premises or hybrid deployment option',
    'Agent-based or connector-based architecture',
    'Deploys into customer VPC/private cloud',
    'Data residency or data sovereignty requirements',
    'Customer-managed deployment model',
    'Private/air-gapped environment support',
    'Scanning or monitoring customer infrastructure',
    'PrivateLink or VPC peering usage (potential replacement)',
    'Network peering or direct connect requirements',
    'Job postings mentioning on-prem, hybrid deployment, customer environment, low latency',
  ]),
  JSON.stringify([
    'Purely SaaS with no on-prem or hybrid component',
    'Company only accesses data via customer-pushed APIs (no deployment into customer env)',
    'Hardware appliance vendor (no software deployment)',
    'Consulting/services firm without a product',
    'VoIP platforms (Twingate does not fully support persistent state needed for VoIP)',
    'Consumer-only apps with no B2B enterprise offering',
  ]),
  JSON.stringify([]),  // target_categories empty when search_patterns are used
  JSON.stringify([
    { name: 'Real-time Collaboration & Communication Tools', description: 'Platforms that benefit from improved reliability, reduced latency, and direct path connectivity for real-time document editing, whiteboarding, and design collaboration.', examples: ['Figma', 'Miro', 'Notion'], keywords: ['real-time collaboration', 'multiplayer editing', 'low-latency sync', 'WebSocket'] },
    { name: 'Content Delivery & Streaming Services', description: 'SaaS platforms handling large media files or streaming content that reduce bandwidth costs and deliver buffer-free content through direct connections.', examples: ['Mux', 'Cloudinary', 'Frame.io'], keywords: ['video streaming', 'media delivery', 'CDN', 'large file transfer'] },
    { name: 'Database & Cloud Infrastructure SaaS', description: 'Tools requiring robust, secure connections to databases, often using PrivateLink or VPC peering. Prime candidates for PrivateLink replacement with Twingate.', examples: ['MongoDB Atlas', 'Confluent', 'CockroachDB', 'PlanetScale'], keywords: ['PrivateLink', 'VPC peering', 'private endpoint', 'database-as-a-service'] },
    { name: 'IoT & Real-time Data Platforms', description: 'Industrial IoT or smart building platforms needing rapid data exchanges and low latency. Often deploy agents or gateways in customer environments.', examples: ['Samsara', 'PTC ThingWorx', 'Uptake'], keywords: ['IoT gateway', 'edge computing', 'industrial IoT', 'real-time telemetry'] },
    { name: 'Large File & Update Distribution SaaS', description: 'Platforms distributing large files, software updates, game patches, or creative assets. Benefit from direct peering for efficient data movement.', examples: ['Perforce', 'Incredibuild', 'Unity Build Server'], keywords: ['large file distribution', 'build distribution', 'patch delivery', 'asset pipeline'] },
    { name: 'Financial Technology & Trading Platforms', description: 'High-speed trading platforms and fintech infrastructure requiring minimal lag. Regulatory requirements (PCI, SOX) often mandate private network connectivity.', examples: ['Bloomberg Terminal', 'Refinitiv', 'IEX Cloud'], keywords: ['low-latency trading', 'market data', 'financial API', 'PCI compliance'] },
    { name: 'Data Security & Classification', description: 'Companies deploying scanners or classification tools into customer environments to analyze sensitive data in-situ without extracting it.', examples: ['BigID', 'Securiti', 'Varonis'], keywords: ['data classification', 'DSPM', 'data scanning', 'in-situ analysis'] },
    { name: 'Observability & Monitoring Agents', description: 'Companies deploying monitoring agents or collectors into customer infrastructure for deep observability.', examples: ['Datadog', 'Cribl', 'Chronosphere'], keywords: ['monitoring agent', 'log collector', 'observability pipeline', 'APM agent'] },
    { name: 'Backup, DR & Compliance Scanning', description: 'Backup, disaster recovery, and compliance tools deploying into customer environments for data protection and audit.', examples: ['Cohesity', 'Rubrik', 'Veeam'], keywords: ['backup agent', 'disaster recovery', 'compliance scan', 'data protection'] },
    { name: 'AI/ML Platforms with On-Prem Data Access', description: 'AI/ML platforms needing to access customer data where it lives. Data gravity and privacy prevent moving data to the cloud.', examples: ['Domino Data Lab', 'Weights & Biases', 'Tecton'], keywords: ['on-prem ML', 'federated learning', 'data gravity', 'private AI'] },
  ]),
  'Instead of asking each customer to configure VPN access, expose ports, or set up complex PrivateLink/VPC peering, embed Twingate as the connectivity layer. Customers get secure, zero-trust access without VPN complexity. The SaaS vendor can offer "private deployment" or "private connectivity" as a seamless feature rather than a support burden.',
  15,
  adminId,
);

// Campaign pipeline run with sample BYOC leads
const campaignRunId = uuid();
db.prepare(
  "INSERT INTO pipeline_runs (id, triggered_by, campaign_id, status, started_at, completed_at, lead_count) VALUES (?,?,?,?,?,?,?)"
).run(campaignRunId, adminId, campaignId, 'completed', new Date().toISOString(), new Date().toISOString(), 8);

const campaignLeads = [
  { name: 'BigID', segment: 'ENT', hq: 'New York, NY', emp: 800, founded: 2016, funding: 'Series D', total: '$246M', score: 88, confidence: 'high',
    why_now: ['Expanding on-prem scanning for data privacy compliance', 'GDPR and CCPA enforcement driving demand for local data classification'],
    pain: [{ claim: 'Data discovery scanners need access to customer databases, file shares, and cloud storage across private networks', why_it_matters: 'Each enterprise deployment requires custom VPN tunnels — scaling nightmare for BigID operations team' }],
    tech: { cloud_infra: ['AWS', 'Azure'], dev_tools: ['Kubernetes', 'Docker', 'Python'] },
    competitive: { likely_current: ['Customer-managed VPN per deployment'], twingate_wedge: ['Embedded ZTNA connector eliminates per-customer VPN setup', 'Zero-trust access to data sources'] },
  },
  { name: 'Securiti', segment: 'ENT', hq: 'San Jose, CA', emp: 900, founded: 2018, funding: 'Series C', total: '$281M', score: 85, confidence: 'high',
    why_now: ['AI-powered data security platform with hybrid deployment model', 'Customers demanding data residency controls'],
    pain: [{ claim: 'Privacy automation scanners deploy into customer clouds to find sensitive data', why_it_matters: 'Enterprise customers refuse to send data to external scanners — must scan in-place' }],
    tech: { cloud_infra: ['AWS', 'GCP', 'Azure'], dev_tools: ['Kubernetes', 'Terraform'] },
    competitive: { likely_current: ['Site-to-site VPN', 'Customer-provisioned tunnels'], twingate_wedge: ['Connector-based deployment scales across customers', 'Data stays in-place'] },
  },
  { name: 'Cribl', segment: 'MM', hq: 'San Francisco, CA', emp: 700, founded: 2017, funding: 'Series D', total: '$400M', score: 83, confidence: 'high',
    why_now: ['Observability pipeline product has on-prem and hybrid deployment', 'Edge processing nodes deploy into customer networks'],
    pain: [{ claim: 'Cribl Stream and Edge nodes need to reach customer log sources in private networks', why_it_matters: 'Customers have security tools generating logs behind firewalls — need private access for collection' }],
    tech: { cloud_infra: ['AWS', 'GCP'], dev_tools: ['Docker', 'Kubernetes'] },
    competitive: { likely_current: ['Customer-managed networking'], twingate_wedge: ['Embedded zero-trust connector for edge node deployment'] },
  },
  { name: 'Vanta', segment: 'MM', hq: 'San Francisco, CA', emp: 500, founded: 2018, funding: 'Series C', total: '$203M', score: 81, confidence: 'medium',
    why_now: ['Compliance automation platform expanding to scan customer infrastructure directly', 'SOC 2 continuous monitoring requires agent-based architecture'],
    pain: [{ claim: 'Compliance agents need to reach customer cloud accounts and on-prem servers', why_it_matters: 'Continuous compliance monitoring requires persistent, secure connections' }],
    tech: { cloud_infra: ['AWS'], dev_tools: ['GitHub', 'Kubernetes', 'Terraform'] },
    competitive: { likely_current: ['API-based access (partial)', 'Customer VPN tunnels for on-prem'], twingate_wedge: ['Embedded connector for hybrid compliance scanning'] },
  },
  { name: 'Cohesity', segment: 'ENT', hq: 'San Jose, CA', emp: 3000, founded: 2013, funding: 'Series F', total: '$810M', score: 79, confidence: 'high',
    why_now: ['Backup and data management product deploys into customer data centers', 'Launching SaaS management plane for on-prem clusters'],
    pain: [{ claim: 'SaaS management console needs secure connectivity to on-prem backup clusters', why_it_matters: 'Customers want cloud management but data stays on-prem — need persistent tunnel' }],
    tech: { cloud_infra: ['AWS', 'Azure'], dev_tools: ['Kubernetes'] },
    competitive: { likely_current: ['Site-to-site IPSec VPN'], twingate_wedge: ['Cloud-to-on-prem connector replaces complex VPN configs'] },
  },
  { name: 'Rubrik', segment: 'ENT', hq: 'Palo Alto, CA', emp: 3500, founded: 2014, funding: 'Public (RBRK)', total: '$553M', score: 77, confidence: 'high',
    why_now: ['Recently IPO-ed, expanding cloud data management', 'Polaris SaaS platform needs connectivity to on-prem Rubrik clusters'],
    pain: [{ claim: 'Hybrid backup architecture needs secure cloud-to-edge connectivity', why_it_matters: 'Customers want unified management but backup appliances are on-prem' }],
    tech: { cloud_infra: ['AWS', 'Azure', 'GCP'], dev_tools: ['Go', 'Kubernetes'] },
    competitive: { likely_current: ['VPN tunnels per customer'], twingate_wedge: ['Embedded ZTNA for SaaS-to-on-prem management channel'] },
  },
  { name: 'Lacework', segment: 'MM', hq: 'San Jose, CA', emp: 400, founded: 2015, funding: 'Series D', total: '$599M', score: 74, confidence: 'medium',
    why_now: ['Cloud security platform deploying agents into customer environments', 'Runtime security scanning requires deep network access'],
    pain: [{ claim: 'Security agents need to scan customer workloads from inside their networks', why_it_matters: 'Runtime threat detection requires low-latency access to container orchestration layers' }],
    tech: { cloud_infra: ['AWS', 'GCP', 'Azure'], dev_tools: ['Kubernetes', 'Docker'] },
    competitive: { likely_current: ['Agent uses customer IAM + cloud networking'], twingate_wedge: ['Embedded ZTNA for hybrid cloud security scanning'] },
  },
  { name: 'Drata', segment: 'MM', hq: 'San Diego, CA', emp: 400, founded: 2020, funding: 'Series C', total: '$328M', score: 72, confidence: 'medium',
    why_now: ['Compliance automation expanding agent-based monitoring', 'On-prem scanning capabilities in roadmap'],
    pain: [{ claim: 'Compliance automation agents need to reach customer on-prem servers and databases', why_it_matters: 'Enterprise compliance requires scanning systems behind firewalls' }],
    tech: { cloud_infra: ['AWS'], dev_tools: ['Kubernetes', 'Terraform'] },
    competitive: { likely_current: ['API-only today, planning agent deployment'], twingate_wedge: ['Embedded connectivity for agent-based compliance scanning'] },
  },
];

const insertCampaignLead = db.prepare(`
  INSERT INTO leads (id, run_id, campaign_id, company_name, segment, hq_location, employee_count, founded_year, funding_stage, total_funding, fit_score, fit_score_label, confidence, why_now, score_breakdown, pain_hypotheses, tech_stack, competitive_displacement, outreach_strategy, source_citations)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const campaignTx = db.transaction(() => {
  for (const l of campaignLeads) {
    const leadId = uuid();
    const label = l.score >= 90 ? 'Extremely High' : l.score >= 75 ? 'High' : l.score >= 60 ? 'Medium' : l.score >= 40 ? 'Low' : 'Very Low';

    const scoreBreakdown = {
      segment_scale_fit: { points: Math.min(20, Math.round(l.score * 0.2)), evidence: [] },
      why_now_triggers: { points: Math.min(15, Math.round(l.score * 0.15)), evidence: [] },
      remote_access_pain: { points: Math.min(20, Math.round(l.score * 0.2)), evidence: [] },
      displacement_wedge: { points: Math.min(20, Math.round(l.score * 0.2)), evidence: [] },
      vertical_playbook: { points: Math.min(15, Math.round(l.score * 0.15)), evidence: [] },
      buyer_access_readiness: { points: Math.min(10, Math.round(l.score * 0.1)), evidence: [] },
      penalties: [],
      total: l.score,
    };

    const outreach = {
      sequence: ['BYOC partnership outreach — technical integration angle', 'Follow-up with embedding case study', 'Executive sponsor outreach with partnership ROI'],
      one_line_pitch: `${l.name} deploys into customer environments — Twingate can be the embedded connectivity layer that makes private deployments seamless.`,
    };

    insertCampaignLead.run(
      leadId, campaignRunId, campaignId, l.name, l.segment, l.hq, l.emp, l.founded, l.funding, l.total,
      l.score, label, l.confidence,
      JSON.stringify(l.why_now),
      JSON.stringify(scoreBreakdown),
      JSON.stringify(l.pain),
      JSON.stringify(l.tech),
      JSON.stringify(l.competitive),
      JSON.stringify(outreach),
      JSON.stringify([{ type: 'company_website', url: `https://${l.name.toLowerCase().replace(/\s+/g, '')}.com`, label: 'Company website' }])
    );

    // Add BYOC-specific personas
    const personas = [
      { role: 'champion' as const, name: 'Head of Platform', title: 'Head of Platform Engineering', dept: 'engineering' },
      { role: 'economic_buyer' as const, name: 'VP Product', title: 'VP of Product', dept: 'product' },
    ];
    for (const p of personas) {
      insertPersona.run(
        uuid(), leadId, p.role, p.name, p.title, null, p.dept,
        `BYOC integration — embed Twingate as ${l.name}'s connectivity layer for customer deployments`,
        JSON.stringify([`${l.name}'s deployment model requires private access to each customer environment`, 'Embedding Twingate eliminates per-customer VPN configuration', 'Reference Cyera partnership as proof point']),
        `Hi — ${l.name}'s deployment model looks similar to other companies we've partnered with for embedded private access. Cyera embeds Twingate to give their scanners secure access to customer environments without VPN complexity. Would love to share how it works — open to a quick chat?`
      );
    }

    const now = new Date().toISOString();
    insertLedger.run(uuid(), l.name, `${l.name.toLowerCase().replace(/\s+/g, '')}.com`, now, now, 1);
  }
});

campaignTx();
console.log(`Seeded: 1 admin user, 1 ICP config, 1 pipeline run with ${sampleLeads.length} leads, 1 BYOC campaign with ${campaignLeads.length} leads`);
console.log('Login: admin@pipeline-gen.local / admin123');
