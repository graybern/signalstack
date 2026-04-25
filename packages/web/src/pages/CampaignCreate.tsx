import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { ArrowLeft, Plus, X, Sparkles, ChevronDown, ChevronUp, Layers, Server, Shield, Gamepad2, Search } from 'lucide-react';

interface ExampleCompany {
  name: string;
  domain: string;
  why_they_fit: string;
}

interface SearchPattern {
  name: string;
  description: string;
  examples: string[];
  keywords: string[];
}

interface CampaignForm {
  name: string;
  description: string;
  pattern_thesis: string;
  example_companies: ExampleCompany[];
  target_signals: string[];
  anti_patterns: string[];
  target_categories: string[];
  search_patterns: SearchPattern[];
  value_prop_angle: string;
  target_count: number;
}

const EMPTY_FORM: CampaignForm = {
  name: '',
  description: '',
  pattern_thesis: '',
  example_companies: [],
  target_signals: [],
  anti_patterns: [],
  target_categories: [],
  search_patterns: [],
  value_prop_angle: '',
  target_count: 12,
};

const BYOC_TEMPLATE: CampaignForm = {
  name: 'BYOC Partners',
  description: 'SaaS companies and ISVs that would benefit from network peering, private tunnels, or deploying into customer environments with secure connectivity',
  pattern_thesis: `Companies that build products requiring deployment INTO customer private environments (on-prem, VPC, private cloud), OR SaaS offerings that would benefit from network peering for low latency, high throughput, and high security.

Two core patterns:
1. **ISVs building private tunnels**: Independent software vendors that would benefit from building private tunnels into their platform and offerings to customers. Twingate can be embedded as the connectivity layer.
2. **SaaS requiring network peering**: Offerings that require low latency, high throughput, or high security — such as real-time collaboration tools, streaming platforms, and services that run in customer on-prem/cloud environments.

These companies need secure network connectivity without asking each customer to configure VPN access or expose ports.`,
  example_companies: [
    { name: 'Cyera', domain: 'cyera.io', why_they_fit: 'Deploys data security scanners into customer environments. Uses Twingate for secure connectivity to customer infrastructure, allowing data to reside locally while scans occur in-situ.' },
    { name: 'Tensor9', domain: 'tensor9.com', why_they_fit: 'Platform for deploying software into customer environments. Core product literally solves the "deploy into customer infra" problem — perfect Twingate embedding use case.' },
    { name: 'InterSystems', domain: 'intersystems.com', why_they_fit: 'Healthcare data platform that deploys into hospital/health system private networks. Needs secure access to sensitive patient data environments.' },
  ],
  target_signals: [
    'On-premises or hybrid deployment option',
    'Agent-based or connector-based architecture',
    'Deploys into customer VPC/private cloud',
    'Data residency or data sovereignty requirements',
    'Customer-managed deployment model',
    'Private/air-gapped environment support',
    'Scanning or monitoring customer infrastructure',
    'PrivateLink or VPC peering usage (potential replacement)',
    'Job postings mentioning "on-prem", "hybrid deployment", "customer environment", "low latency"',
    'Network peering or direct connect requirements',
  ],
  anti_patterns: [
    'Purely SaaS with no on-prem or hybrid component',
    'Company only accesses data via customer-pushed APIs (no deployment into customer env)',
    'Hardware appliance vendor (no software deployment)',
    'Consulting/services firm without a product',
    'VoIP platforms (Twingate does not fully support persistent state needed for VoIP)',
    'Consumer-only apps with no B2B enterprise offering',
  ],
  target_categories: [],
  search_patterns: [
    {
      name: 'Real-time Collaboration & Communication Tools',
      description: 'Platforms that benefit from improved reliability, reduced latency, and direct path connectivity. Enterprise collaboration tools that handle real-time data (document editing, whiteboarding, design) where network peering significantly improves user experience.',
      examples: ['Figma', 'Miro', 'Notion'],
      keywords: ['real-time collaboration', 'multiplayer editing', 'low-latency sync', 'WebSocket', 'CRDT'],
    },
    {
      name: 'Content Delivery & Streaming Services',
      description: 'SaaS platforms handling large media files or streaming content that can reduce bandwidth costs and deliver buffer-free content through direct connections. Enterprise video, media asset management, and large file delivery platforms.',
      examples: ['Mux', 'Cloudinary', 'Frame.io'],
      keywords: ['video streaming', 'media delivery', 'CDN', 'large file transfer', 'media pipeline'],
    },
    {
      name: 'Database & Cloud Infrastructure SaaS',
      description: 'Tools requiring robust, secure connections to databases, often using PrivateLink or VPC peering for speed and security. These are prime candidates for PrivateLink replacement with Twingate — simpler setup, zero-trust security, no complex networking.',
      examples: ['MongoDB Atlas', 'Confluent (Kafka)', 'CockroachDB', 'PlanetScale'],
      keywords: ['PrivateLink', 'VPC peering', 'private endpoint', 'database-as-a-service', 'managed database', 'private connectivity'],
    },
    {
      name: 'IoT & Real-time Data Platforms',
      description: 'Industrial IoT, smart building, or real-time data platforms that need rapid data exchanges and low latency to function efficiently. These often deploy agents or gateways in customer environments to collect and process data.',
      examples: ['Samsara', 'PTC ThingWorx', 'Uptake'],
      keywords: ['IoT gateway', 'edge computing', 'industrial IoT', 'real-time telemetry', 'SCADA', 'OT security'],
    },
    {
      name: 'Large File & Update Distribution SaaS',
      description: 'SaaS platforms that frequently distribute large files, software updates, game patches, or creative assets. These benefit from P2P or direct peering to move data efficiently, especially for gaming studios and creative workflows.',
      examples: ['Perforce', 'Incredibuild', 'Unity (Build Server)'],
      keywords: ['large file distribution', 'build distribution', 'patch delivery', 'asset pipeline', 'game build', 'binary artifact'],
    },
    {
      name: 'Financial Technology & Trading Platforms',
      description: 'High-speed trading platforms, financial data services, or fintech infrastructure requiring minimal lag for immediate data transfers. Regulatory requirements (PCI, SOX) often mandate private network connectivity.',
      examples: ['Bloomberg Terminal', 'Refinitiv', 'IEX Cloud'],
      keywords: ['low-latency trading', 'market data', 'financial API', 'PCI compliance', 'private connectivity', 'co-location'],
    },
    {
      name: 'Data Security & Classification',
      description: 'Companies that deploy scanners, agents, or classification tools into customer environments to analyze sensitive data in-situ. These need secure access to customer databases, file systems, and cloud storage without extracting data.',
      examples: ['BigID', 'Securiti', 'Varonis'],
      keywords: ['data classification', 'data discovery', 'DSPM', 'data scanning', 'in-situ analysis', 'data sovereignty'],
    },
    {
      name: 'Observability & Monitoring Agents',
      description: 'Companies that deploy monitoring agents, collectors, or probes into customer infrastructure. These need outbound connectivity from customer environments to their SaaS platform, or direct access to customer systems for deep monitoring.',
      examples: ['Datadog', 'Cribl', 'Chronosphere'],
      keywords: ['monitoring agent', 'log collector', 'observability pipeline', 'APM agent', 'infrastructure monitoring', 'telemetry'],
    },
    {
      name: 'Backup, DR & Compliance Scanning',
      description: 'Backup, disaster recovery, and compliance tools that deploy into customer environments. These need secure network access to customer storage, databases, and infrastructure for data protection and audit purposes.',
      examples: ['Cohesity', 'Rubrik', 'Veeam'],
      keywords: ['backup agent', 'disaster recovery', 'compliance scan', 'data protection', 'air-gapped backup', 'ransomware recovery'],
    },
    {
      name: 'AI/ML Platforms with On-Prem Data Access',
      description: 'AI/ML platforms that need to access customer data where it lives — whether for training, inference, or data preparation. Data gravity and privacy regulations prevent moving data to the cloud, so the compute must go to the data.',
      examples: ['Domino Data Lab', 'Weights & Biases', 'Tecton'],
      keywords: ['on-prem ML', 'federated learning', 'data gravity', 'private AI', 'model training on-prem', 'MLOps'],
    },
  ],
  value_prop_angle: 'Instead of asking each customer to configure VPN access, expose ports, or set up complex PrivateLink/VPC peering, embed Twingate as the connectivity layer. Customers get secure, zero-trust access without VPN complexity. The SaaS vendor can offer "private deployment" or "private connectivity" as a seamless feature rather than a support burden.',
  target_count: 15,
};

const DSPM_TEMPLATE: CampaignForm = {
  name: 'DSPM & Data Security',
  description: 'Data security posture management companies that scan, classify, and protect sensitive data across customer environments',
  pattern_thesis: `Companies in the Data Security Posture Management (DSPM) space that need to deploy scanners, agents, or classification tools into customer environments to analyze sensitive data in-situ.

These companies cannot extract customer data to their own cloud — the compute must go to the data due to compliance, privacy, and data sovereignty requirements. They need secure, private connectivity to customer databases, file systems, cloud storage, and SaaS applications.`,
  example_companies: [
    { name: 'BigID', domain: 'bigid.com', why_they_fit: 'Deploys data discovery and classification scanners into customer environments across cloud and on-prem.' },
    { name: 'Securiti', domain: 'securiti.ai', why_they_fit: 'AI-powered data security platform that scans customer data stores in-situ for privacy compliance.' },
    { name: 'Cyera', domain: 'cyera.io', why_they_fit: 'Cloud data security platform deploying into customer cloud environments for real-time data classification.' },
  ],
  target_signals: [
    'Deploys scanners into customer environments',
    'Data classification or discovery product',
    'DSPM or data security posture management',
    'Data sovereignty or residency requirements',
    'Agent-based data scanning',
    'In-situ data analysis',
    'SOC 2, HIPAA, GDPR compliance scanning',
  ],
  anti_patterns: [
    'SaaS-only analytics with no customer env deployment',
    'Network security without data scanning',
    'Consumer privacy tools',
  ],
  target_categories: ['DSPM', 'Data Security', 'Data Classification', 'Privacy Compliance'],
  search_patterns: [
    {
      name: 'DSPM Platforms',
      description: 'Core DSPM vendors that discover, classify, and secure sensitive data across multi-cloud and hybrid environments.',
      examples: ['Normalyze', 'Laminar', 'Dig Security'],
      keywords: ['DSPM', 'data security posture', 'data discovery', 'data classification', 'sensitive data'],
    },
    {
      name: 'Data Loss Prevention',
      description: 'DLP solutions that deploy agents or inline proxies to monitor and prevent data exfiltration.',
      examples: ['Nightfall AI', 'Code42', 'Digital Guardian'],
      keywords: ['DLP', 'data loss prevention', 'data exfiltration', 'content inspection', 'endpoint DLP'],
    },
  ],
  value_prop_angle: 'Replace VPN-based access to customer environments with zero-trust connectivity. DSPM scanners get secure, least-privilege access to customer data stores without exposing the entire network.',
  target_count: 12,
};

const GAMING_TEMPLATE: CampaignForm = {
  name: 'Gaming Verticals',
  description: 'Game studios and gaming infrastructure companies with remote teams, distributed builds, and secure access needs',
  pattern_thesis: `Gaming companies — studios, publishers, and infrastructure providers — that have distributed teams accessing sensitive game assets, build systems, and development infrastructure.

Key patterns:
1. **Remote game development**: Studios with globally distributed teams needing secure access to source code, art assets, and build systems
2. **Live services infrastructure**: Companies running multiplayer backends, matchmaking, and game services that need secure internal access
3. **Build & CI/CD pipelines**: Studios with large binary assets, build farms, and distributed compilation that need low-latency secure access`,
  example_companies: [
    { name: 'Riot Games', domain: 'riotgames.com', why_they_fit: 'Global game studio with thousands of remote developers accessing sensitive game code and assets.' },
    { name: 'Epic Games', domain: 'epicgames.com', why_they_fit: 'Massive distributed game development with Unreal Engine + Fortnite live services infrastructure.' },
    { name: 'Unity', domain: 'unity.com', why_they_fit: 'Game engine company with distributed build systems and cloud services requiring secure developer access.' },
  ],
  target_signals: [
    'Remote game development team',
    'Distributed build systems (Incredibuild, Perforce)',
    'Large binary asset management',
    'Multiplayer backend infrastructure',
    'Game live services platform',
    'VPN usage for developer access',
    'Job postings mentioning remote game dev or secure access',
  ],
  anti_patterns: [
    'Mobile-only casual game studios under 50 employees',
    'Game marketing or publishing without development',
    'Esports organizations without infrastructure',
  ],
  target_categories: ['Game Studios', 'Gaming Infrastructure', 'Game Development Tools'],
  search_patterns: [
    {
      name: 'AAA & Mid-Size Game Studios',
      description: 'Game development studios with 100+ employees and distributed teams working on PC/console titles.',
      examples: ['Respawn', 'Naughty Dog', 'Bungie'],
      keywords: ['game studio', 'AAA games', 'game development', 'Unreal Engine', 'remote game dev'],
    },
    {
      name: 'Gaming Infrastructure & Tools',
      description: 'Companies building backend infrastructure, multiplayer services, or development tools for game studios.',
      examples: ['Pragma', 'AccelByte', 'Heroic Labs'],
      keywords: ['game backend', 'multiplayer infrastructure', 'game services', 'matchmaking', 'game server'],
    },
  ],
  value_prop_angle: 'Replace gaming VPNs with zero-trust access. Developers get fast, secure access to Perforce, build systems, and internal tools from anywhere — without the latency and complexity of traditional VPN.',
  target_count: 12,
};

const TEMPLATES: { id: string; name: string; icon: typeof Server; description: string; form: CampaignForm | null }[] = [
  { id: 'byoc', name: 'BYOC Partners', icon: Server, description: 'SaaS companies deploying into customer environments', form: BYOC_TEMPLATE },
  { id: 'dspm', name: 'DSPM & Data Security', icon: Shield, description: 'Data security and posture management companies', form: DSPM_TEMPLATE },
  { id: 'gaming', name: 'Gaming Verticals', icon: Gamepad2, description: 'Game studios and gaming infrastructure', form: GAMING_TEMPLATE },
  { id: 'general', name: 'Blank Campaign', icon: Search, description: 'Start from scratch with custom criteria', form: null },
];

export function CampaignCreate() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [expandedPattern, setExpandedPattern] = useState<number | null>(null);

  useEffect(() => {
    if (isEdit && id) {
      api(`/campaigns/${id}`).then((data: any) => {
        setForm({
          name: data.name,
          description: data.description || '',
          pattern_thesis: data.pattern_thesis,
          example_companies: data.example_companies || [],
          target_signals: data.target_signals || [],
          anti_patterns: data.anti_patterns || [],
          target_categories: data.target_categories || [],
          search_patterns: data.search_patterns || [],
          value_prop_angle: data.value_prop_angle || '',
          target_count: data.target_count || 12,
        });
      });
    }
  }, [id, isEdit]);

  const handleSave = async () => {
    if (!form.name || !form.pattern_thesis) {
      alert('Name and pattern thesis are required.');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(form) });
        navigate(`/campaigns/${id}`);
      } else {
        const created = await api('/campaigns', { method: 'POST', body: JSON.stringify(form) });
        navigate(`/campaigns/${created.id}`);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addTag = (field: 'target_signals' | 'anti_patterns' | 'target_categories') => {
    const val = (tagInput[field] || '').trim();
    if (!val) return;
    setForm({ ...form, [field]: [...form[field], val] });
    setTagInput({ ...tagInput, [field]: '' });
  };

  const removeTag = (field: 'target_signals' | 'anti_patterns' | 'target_categories', idx: number) => {
    setForm({ ...form, [field]: form[field].filter((_, i) => i !== idx) });
  };

  const addExample = () => {
    setForm({
      ...form,
      example_companies: [...form.example_companies, { name: '', domain: '', why_they_fit: '' }],
    });
  };

  const updateExample = (idx: number, field: keyof ExampleCompany, value: string) => {
    const updated = [...form.example_companies];
    updated[idx] = { ...updated[idx], [field]: value };
    setForm({ ...form, example_companies: updated });
  };

  const removeExample = (idx: number) => {
    setForm({ ...form, example_companies: form.example_companies.filter((_, i) => i !== idx) });
  };

  // Search pattern CRUD
  const addSearchPattern = () => {
    const newPattern: SearchPattern = { name: '', description: '', examples: [], keywords: [] };
    setForm({ ...form, search_patterns: [...form.search_patterns, newPattern] });
    setExpandedPattern(form.search_patterns.length);
  };

  const updateSearchPattern = (idx: number, updates: Partial<SearchPattern>) => {
    const updated = [...form.search_patterns];
    updated[idx] = { ...updated[idx], ...updates };
    setForm({ ...form, search_patterns: updated });
  };

  const removeSearchPattern = (idx: number) => {
    setForm({ ...form, search_patterns: form.search_patterns.filter((_, i) => i !== idx) });
    if (expandedPattern === idx) setExpandedPattern(null);
  };

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const applyTemplate = (templateId: string) => {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (!template) return;
    if (form.name && !confirm('This will overwrite your current form. Continue?')) return;
    if (template.form) {
      setForm(template.form);
    } else {
      setForm(EMPTY_FORM);
    }
    setSelectedTemplate(templateId);
  };

  return (
    <div className="max-w-3xl">
      <Link to={isEdit ? `/campaigns/${id}` : '/campaigns'} className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 mb-4">
        <ArrowLeft className="w-4 h-4" />
        {isEdit ? 'Back to Campaign' : 'Back to Campaigns'}
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {isEdit ? 'Edit Campaign' : 'New Research Campaign'}
      </h1>

      {/* Template Selector */}
      {!isEdit && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Start from a template</h2>
          <div className="grid grid-cols-4 gap-3">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => applyTemplate(t.id)}
                className={`text-left p-4 rounded-xl border-2 transition-all hover:shadow-sm ${
                  selectedTemplate === t.id
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <t.icon className={`w-5 h-5 mb-2 ${selectedTemplate === t.id ? 'text-brand-600' : 'text-gray-400'}`} />
                <h3 className="text-sm font-medium text-gray-900">{t.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Basics */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Basics</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Campaign Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="e.g., BYOC Partners"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={2}
                placeholder="Short summary of what this campaign targets"
              />
            </div>
          </div>
        </section>

        {/* Pattern Definition */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Pattern Definition</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Pattern Thesis *</label>
              <textarea
                value={form.pattern_thesis}
                onChange={(e) => setForm({ ...form, pattern_thesis: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={5}
                placeholder="Describe the core pattern — what makes a company a good prospect for this campaign..."
              />
              <p className="text-xs text-gray-400 mt-1">The core description of what makes a company match this campaign. Be specific about deployment models, connectivity needs, and use cases.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Value Prop Angle</label>
              <textarea
                value={form.value_prop_angle}
                onChange={(e) => setForm({ ...form, value_prop_angle: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={3}
                placeholder="How does your product fit this pattern? Why should these companies care?"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Target Candidate Count</label>
              <input
                type="number"
                value={form.target_count}
                onChange={(e) => setForm({ ...form, target_count: parseInt(e.target.value) || 12 })}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                min={5}
                max={30}
              />
            </div>
          </div>
        </section>

        {/* Example Companies */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Example Companies</h2>
            <button onClick={addExample} className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
              <Plus className="w-4 h-4" /> Add Example
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-4">Known companies that fit this pattern. The AI uses these as anchors to understand what you're looking for.</p>

          {form.example_companies.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No examples added yet.</p>
          ) : (
            <div className="space-y-3">
              {form.example_companies.map((ex, idx) => (
                <div key={idx} className="relative bg-gray-50 rounded-lg p-4">
                  <button
                    onClick={() => removeExample(idx)}
                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <input
                      value={ex.name}
                      onChange={(e) => updateExample(idx, 'name', e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded text-sm"
                      placeholder="Company name"
                    />
                    <input
                      value={ex.domain}
                      onChange={(e) => updateExample(idx, 'domain', e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded text-sm"
                      placeholder="domain.com"
                    />
                  </div>
                  <textarea
                    value={ex.why_they_fit}
                    onChange={(e) => updateExample(idx, 'why_they_fit', e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                    rows={2}
                    placeholder="Why does this company fit the pattern?"
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Search Patterns — Rich Vertical Definitions */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-brand-600" />
              <h2 className="font-semibold text-gray-900">Search Patterns</h2>
            </div>
            <button onClick={addSearchPattern} className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
              <Plus className="w-4 h-4" /> Add Pattern
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Define specific verticals and use cases to search. Each pattern gives the AI detailed context about what to look for,
            example companies in that space, and keywords to guide research. The more detail you provide, the more accurate the results.
          </p>

          {form.search_patterns.length === 0 ? (
            <div className="text-center py-6 bg-gray-50 rounded-lg">
              <Layers className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No search patterns defined yet.</p>
              <p className="text-xs text-gray-400 mt-1">Add patterns to guide the AI's research across specific verticals and use cases.</p>
              <button onClick={addSearchPattern} className="mt-3 text-sm text-brand-600 hover:text-brand-700">
                + Add your first pattern
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {form.search_patterns.map((sp, idx) => (
                <SearchPatternEditor
                  key={idx}
                  index={idx}
                  pattern={sp}
                  expanded={expandedPattern === idx}
                  onToggle={() => setExpandedPattern(expandedPattern === idx ? null : idx)}
                  onChange={(updates) => updateSearchPattern(idx, updates)}
                  onRemove={() => removeSearchPattern(idx)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Target Signals & Anti-Patterns */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Search Criteria</h2>

          <TagEditor
            label="Target Signals"
            sublabel="What to look for in prospect companies — these apply across all search patterns"
            tags={form.target_signals}
            color="emerald"
            inputValue={tagInput.target_signals || ''}
            onInputChange={(v) => setTagInput({ ...tagInput, target_signals: v })}
            onAdd={() => addTag('target_signals')}
            onRemove={(idx) => removeTag('target_signals', idx)}
          />

          <TagEditor
            label="Anti-Patterns"
            sublabel="What does NOT fit — the AI will exclude companies matching these"
            tags={form.anti_patterns}
            color="red"
            inputValue={tagInput.anti_patterns || ''}
            onInputChange={(v) => setTagInput({ ...tagInput, anti_patterns: v })}
            onAdd={() => addTag('anti_patterns')}
            onRemove={(idx) => removeTag('anti_patterns', idx)}
          />

          {form.search_patterns.length === 0 && (
            <TagEditor
              label="Target Categories"
              sublabel="Industries and product categories to search (used when no search patterns are defined)"
              tags={form.target_categories}
              color="blue"
              inputValue={tagInput.target_categories || ''}
              onInputChange={(v) => setTagInput({ ...tagInput, target_categories: v })}
              onAdd={() => addTag('target_categories')}
              onRemove={(idx) => removeTag('target_categories', idx)}
            />
          )}
        </section>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Campaign'}
          </button>
          <Link
            to={isEdit ? `/campaigns/${id}` : '/campaigns'}
            className="px-4 py-2.5 text-gray-600 hover:text-gray-900 text-sm"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Search Pattern Editor
// ═══════════════════════════════════════════════════════════════════

function SearchPatternEditor({
  index,
  pattern,
  expanded,
  onToggle,
  onChange,
  onRemove,
}: {
  index: number;
  pattern: SearchPattern;
  expanded: boolean;
  onToggle: () => void;
  onChange: (updates: Partial<SearchPattern>) => void;
  onRemove: () => void;
}) {
  const [exampleInput, setExampleInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  const addExample = () => {
    const val = exampleInput.trim();
    if (val && !pattern.examples.includes(val)) {
      onChange({ examples: [...pattern.examples, val] });
      setExampleInput('');
    }
  };

  const addKeyword = () => {
    const val = keywordInput.trim();
    if (val && !pattern.keywords.includes(val)) {
      onChange({ keywords: [...pattern.keywords, val] });
      setKeywordInput('');
    }
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${expanded ? 'border-brand-200 bg-brand-50/30' : 'border-gray-200'}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-white">
        <span className="text-xs text-gray-400 font-mono w-5">{index + 1}.</span>
        <button onClick={onToggle} className="flex-1 text-left flex items-center gap-2">
          <span className={`text-sm ${pattern.name ? 'font-medium text-gray-900' : 'text-gray-400 italic'}`}>
            {pattern.name || 'Untitled Pattern'}
          </span>
          {pattern.examples.length > 0 && (
            <span className="text-xs text-gray-400">({pattern.examples.length} examples)</span>
          )}
        </button>
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500 p-1">
          <X className="w-3.5 h-3.5" />
        </button>
        <button onClick={onToggle} className="text-gray-400 p-1">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {/* Pattern Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Vertical / Pattern Name</label>
            <input
              value={pattern.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              placeholder="e.g., Database & Cloud Infrastructure SaaS"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Description</label>
            <textarea
              value={pattern.description}
              onChange={(e) => onChange({ description: e.target.value })}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              rows={3}
              placeholder="Describe what this vertical looks like, why these companies need your product, what pain points they have..."
            />
            <p className="text-xs text-gray-400 mt-1">Be specific — this directly feeds into the AI's research prompt.</p>
          </div>

          {/* Examples */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Example Companies</label>
            <p className="text-xs text-gray-400 mb-2">Well-known companies in this vertical (the AI won't recommend these — they're just for context)</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {pattern.examples.map((ex, i) => (
                <span key={i} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                  {ex}
                  <button onClick={() => onChange({ examples: pattern.examples.filter((_, j) => j !== i) })} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={exampleInput}
                onChange={(e) => setExampleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExample(); } }}
                className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm"
                placeholder="e.g., MongoDB Atlas, Confluent..."
              />
              <button onClick={addExample} className="px-3 py-1 text-sm text-brand-600 border border-brand-300 rounded hover:bg-brand-50">Add</button>
            </div>
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Search Keywords</label>
            <p className="text-xs text-gray-400 mb-2">Keywords the AI should search for when looking for companies in this vertical</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {pattern.keywords.map((kw, i) => (
                <span key={i} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                  {kw}
                  <button onClick={() => onChange({ keywords: pattern.keywords.filter((_, j) => j !== i) })} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm"
                placeholder="e.g., PrivateLink, VPC peering, low-latency..."
              />
              <button onClick={addKeyword} className="px-3 py-1 text-sm text-brand-600 border border-brand-300 rounded hover:bg-brand-50">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tag Editor
// ═══════════════════════════════════════════════════════════════════

function TagEditor({
  label,
  sublabel,
  tags,
  color,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
}: {
  label: string;
  sublabel: string;
  tags: string[];
  color: string;
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{label}</label>
      <p className="text-xs text-gray-400 mb-2">{sublabel}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag, idx) => (
          <span key={idx} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${colorMap[color]}`}>
            {tag}
            <button onClick={() => onRemove(idx)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm"
          placeholder={`Add ${label.toLowerCase()}...`}
        />
        <button onClick={onAdd} className="px-3 py-1.5 text-sm text-brand-600 border border-brand-300 rounded hover:bg-brand-50">
          Add
        </button>
      </div>
    </div>
  );
}
