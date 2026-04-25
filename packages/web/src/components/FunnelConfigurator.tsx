import { Search, Filter, Database, BarChart3, FileText, ChevronDown, ChevronUp, Info, Play } from 'lucide-react';
import { useState, useEffect } from 'react';
import { api } from '../api/client';

// ── Types ────────────────────────────────────────────────────────

interface FunnelStepConfig {
  id: 'discover' | 'qualify' | 'enrich' | 'score' | 'brief';
  enabled: boolean;
  model?: string;
  prompt_instructions?: string;
  prompt_mode?: 'append' | 'override';
  max_tokens?: number;
  candidate_limit?: number;
  qualification_criteria?: string[];
  disqualification_criteria?: string[];
  source_overrides?: Record<string, boolean>;
  outreach_tone?: string;
  // Discover levers
  source_strategy?: 'open' | 'guided' | 'restricted' | 'search_augmented';
  research_sources?: { source: string; guidance: string }[];
  search_max_queries?: number;
  search_max_results_per_query?: number;
  target_segments?: { smb: boolean; mm: boolean; ent: boolean };
  lead_count_min?: number;
  lead_count_max?: number;
  // Post-discover filter controls
  filter_existing_leads?: boolean;
  filter_ledger_days?: number;
  filter_min_employees?: number;
  filter_allow_snoozed_retry?: boolean;
  geographic_focus?: string[];
  funding_stage_filter?: string[];
  recency_months?: number;
  verticals_override?: string[];
  use_org_verticals?: boolean;
  technology_categories?: string[];
  sizing_method?: 'employee_count' | 'engineering_headcount' | 'vpn_users' | 'revenue_range';
  sizing_guidance?: string;
  // Domain validation + light enrichment
  validate_domains?: boolean;
  light_enrich?: boolean;
  // Qualify levers
  segment_filter?: { smb: boolean; mm: boolean; ent: boolean };
  employee_range?: { min?: number; max?: number };
  qualify_funding_stages?: string[];
  geo_filter?: { include?: string[]; exclude?: string[] };
  match_mode?: 'any' | 'all';
  min_signal_count?: number;
  // Score levers
  scoring_weights?: {
    segment_scale_fit?: number;
    why_now_triggers?: number;
    remote_access_pain?: number;
    displacement_wedge?: number;
    vertical_playbook?: number;
    buyer_access_readiness?: number;
  };
  min_score_threshold?: number;
  icp_verticals_override?: string[];
  icp_tech_signals_override?: string[];
  icp_competitors_override?: string[];
  use_org_icp?: boolean;
  confidence_filter?: 'all' | 'medium_high' | 'high_only';
  // Brief levers
  persona_types?: ('champion' | 'economic_buyer' | 'executive_sponsor')[];
  brief_depth?: 'quick' | 'standard' | 'comprehensive';
  // Enrich levers
  min_enrichment_sources?: number;
}

interface FunnelConfig {
  version: number;
  steps: FunnelStepConfig[];
}

export interface DataSourceDef {
  id: string;
  label: string;
  description: string;
  free: boolean;
}

export interface GlobalPromptDefaults {
  outreach_tone?: string;
  research_preamble?: string;
}

export interface OrgICP {
  verticals: string[];
  tech_signals: string[];
  competitors: string[];
}

// ── Constants ────────────────────────────────────────────────────

const MODELS = [
  { id: 'claude-haiku-4-5@20251001', label: 'Haiku 4.5', desc: 'Fastest, lowest cost', cost: '$0.25 / $1.25', tier: 'economy' as const },
  { id: 'claude-sonnet-4-6@default', label: 'Sonnet 4.6', desc: 'Balanced speed and quality', cost: '$3 / $15', tier: 'standard' as const },
  { id: 'claude-opus-4-6@default', label: 'Opus 4.6', desc: 'Most capable, highest quality', cost: '$15 / $75', tier: 'premium' as const },
];

const TONES = [
  { id: 'consultative', label: 'Consultative', desc: 'Advisory, insight-led' },
  { id: 'direct', label: 'Direct', desc: 'Clear, to-the-point' },
  { id: 'technical', label: 'Technical', desc: 'Engineering-focused' },
  { id: 'executive', label: 'Executive', desc: 'Business outcome-led' },
  { id: 'casual', label: 'Casual', desc: 'Friendly, conversational' },
];

const STEP_META: Record<string, {
  label: string;
  icon: typeof Search;
  headline: string;
  guide: string;
  color: string;
  bgColor: string;
  iconBg: string;
  iconFg: string;
  borderColor: string;
}> = {
  discover: {
    label: 'Discover',
    icon: Search,
    headline: 'Find companies',
    guide: 'AI searches for companies, validates their domains, and runs light enrichment before passing to qualify.',
    color: 'blue',
    bgColor: 'bg-blue-50/40',
    iconBg: 'bg-blue-100',
    iconFg: 'text-blue-600',
    borderColor: 'border-blue-200',
  },
  qualify: {
    label: 'Qualify',
    icon: Filter,
    headline: 'Filter by rules',
    guide: 'Removes poor fits using keywords and rules — no AI cost. Only companies matching your criteria pass through.',
    color: 'emerald',
    bgColor: 'bg-emerald-50/40',
    iconBg: 'bg-emerald-100',
    iconFg: 'text-emerald-600',
    borderColor: 'border-emerald-200',
  },
  enrich: {
    label: 'Enrich',
    icon: Database,
    headline: 'Gather data',
    guide: 'Pulls deep company data from all configured sources. Companies without sufficient data are filtered out.',
    color: 'purple',
    bgColor: 'bg-purple-50/40',
    iconBg: 'bg-purple-100',
    iconFg: 'text-purple-600',
    borderColor: 'border-purple-200',
  },
  score: {
    label: 'Score',
    icon: BarChart3,
    headline: 'Rate ICP fit',
    guide: 'AI scores each company against your Ideal Customer Profile on a 100-point scale.',
    color: 'amber',
    bgColor: 'bg-amber-50/40',
    iconBg: 'bg-amber-100',
    iconFg: 'text-amber-600',
    borderColor: 'border-amber-200',
  },
  brief: {
    label: 'Brief',
    icon: FileText,
    headline: 'Write outreach briefs',
    guide: 'AI writes personalized outreach briefs for your top-scored companies. Uses the most capable model.',
    color: 'rose',
    bgColor: 'bg-rose-50/40',
    iconBg: 'bg-rose-100',
    iconFg: 'text-rose-600',
    borderColor: 'border-rose-200',
  },
};

// Estimate cost per step
function estimateCost(step: FunnelStepConfig): string | null {
  if (!step.model || !step.max_tokens || !step.candidate_limit) return null;
  const model = MODELS.find(m => m.id === step.model);
  if (!model) return null;
  const outputPrice = parseFloat(model.cost.split('/')[1].trim().replace('$', ''));
  const cost = (step.candidate_limit * step.max_tokens * outputPrice) / 1_000_000;
  if (cost < 0.01) return '<$0.01';
  return `~$${cost.toFixed(2)}`;
}

const FUNNEL_WIDTHS = ['100%', '93%', '86%', '78%', '70%'];

// ── Main Component ───────────────────────────────────────────────

export function FunnelConfigurator({
  value,
  onChange,
  dataSources = [],
  globalPrompts,
  orgICP,
  onRunStep,
  readOnly = false,
}: {
  value: FunnelConfig;
  onChange: (config: FunnelConfig) => void;
  dataSources?: DataSourceDef[];
  globalPrompts?: GlobalPromptDefaults;
  orgICP?: OrgICP;
  onRunStep?: (stepId: string) => void;
  readOnly?: boolean;
}) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [searchProviderStatus, setSearchProviderStatus] = useState<{
    serper: 'configured' | 'unconfigured';
    brave: 'configured' | 'unconfigured';
    google: 'configured' | 'unconfigured';
    checking: boolean;
  }>({ serper: 'unconfigured', brave: 'unconfigured', google: 'unconfigured', checking: true });
  const [serperKeyInput, setSerperKeyInput] = useState('');
  const [braveKeyInput, setBraveKeyInput] = useState('');
  const [googleKeyInput, setGoogleKeyInput] = useState('');
  const [googleCseInput, setGoogleCseInput] = useState('');

  useEffect(() => {
    api('/data-sources')
      .then((sources: any[]) => {
        const serper = sources.find((s: any) => s.id === 'serper_search');
        const brave = sources.find((s: any) => s.id === 'web_search');
        const google = sources.find((s: any) => s.id === 'google_search');
        setSearchProviderStatus({
          serper: serper?.status === 'active' ? 'configured' : 'unconfigured',
          brave: brave?.status === 'active' ? 'configured' : 'unconfigured',
          google: google?.status === 'active' ? 'configured' : 'unconfigured',
          checking: false,
        });
      })
      .catch(() => setSearchProviderStatus({ serper: 'unconfigured', brave: 'unconfigured', google: 'unconfigured', checking: false }));
  }, []);

  const saveSerperKey = async (key: string) => {
    try {
      await api.put('/data-sources/serper_search', { api_key: key, enabled: true });
      setSearchProviderStatus(prev => ({ ...prev, serper: 'configured' }));
      setSerperKeyInput('');
    } catch {
      // Silently fail — user can retry
    }
  };

  const saveBraveKey = async (key: string) => {
    try {
      await api.put('/data-sources/web_search', { api_key: key, enabled: true });
      setSearchProviderStatus(prev => ({ ...prev, brave: 'configured' }));
      setBraveKeyInput('');
    } catch {
      // Silently fail — user can retry
    }
  };

  const saveGoogleKey = async (key: string, cseId: string) => {
    try {
      await api.put('/data-sources/google_search', { api_key: key, enabled: true, settings: { cse_id: cseId } });
      setSearchProviderStatus(prev => ({ ...prev, google: 'configured' }));
      setGoogleKeyInput('');
      setGoogleCseInput('');
    } catch {
      // Silently fail — user can retry
    }
  };

  const updateStep = (stepId: string, updates: Partial<FunnelStepConfig>) => {
    const newSteps = value.steps.map(s =>
      s.id === stepId ? { ...s, ...updates } : s
    );
    onChange({ ...value, steps: newSteps });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="mb-5">
        <h4 className="text-sm font-semibold text-gray-900">Campaign Pipeline</h4>
        <p className="text-xs text-gray-500 mt-1">
          Each step narrows the pool — spending the least on discovery and the most on your best prospects.
          Configure models, limits, and instructions for each stage.
        </p>
      </div>

      {/* Funnel steps */}
      <div className="flex flex-col items-center gap-1.5">
        {value.steps.map((step, idx) => {
          const meta = STEP_META[step.id];
          if (!meta) return null;
          const Icon = meta.icon;
          const isExpanded = expandedStep === step.id;
          const costEstimate = estimateCost(step);

          return (
            <div
              key={step.id}
              style={{ width: FUNNEL_WIDTHS[idx] || '70%' }}
              className={`border rounded-lg transition-all ${
                step.enabled
                  ? `${meta.borderColor} ${meta.bgColor}`
                  : 'border-gray-200 bg-gray-50 opacity-60'
              }`}
            >
              {/* Step header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer"
                onClick={() => setExpandedStep(isExpanded ? null : step.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    step.enabled ? `${meta.iconBg} ${meta.iconFg}` : 'bg-gray-100 text-gray-400'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{meta.label}</span>
                      <span className="text-xs text-gray-400">—</span>
                      <span className="text-xs text-gray-500">{meta.headline}</span>
                      {step.id === 'qualify' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">FREE</span>
                      )}
                      {step.id === 'enrich' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">NO AI COST</span>
                      )}
                      {costEstimate && step.enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full">{costEstimate}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 max-w-lg leading-relaxed">{meta.guide}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {step.candidate_limit && step.enabled && (
                    <span className="text-xs text-gray-400 tabular-nums">{step.candidate_limit} max</span>
                  )}
                  {onRunStep && step.enabled && isExpanded && (
                    <button
                      onClick={e => { e.stopPropagation(); onRunStep(step.id); }}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-brand-600 bg-brand-50 rounded-md hover:bg-brand-100 transition-colors"
                      title={`Run ${meta.label} step only`}
                    >
                      <Play className="w-3 h-3" /> Run
                    </button>
                  )}
                  {!readOnly && (
                    <label className="relative inline-flex items-center cursor-pointer" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={e => updateStep(step.id, { enabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-brand-600 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                    </label>
                  )}
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </div>

              {/* Expanded config */}
              {isExpanded && step.enabled && (
                <div className={`px-4 pb-4 pt-2 border-t border-gray-100 space-y-4 ${readOnly ? 'pointer-events-none opacity-75' : ''}`}>
                  {readOnly && (
                    <div className="pointer-events-auto flex items-center gap-2 px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-xs text-gray-500">
                      <Info className="w-3.5 h-3.5" />
                      View-only — your role doesn't have permission to edit pipeline settings
                    </div>
                  )}
                  {step.id === 'discover' && (
                    <DiscoverConfig
                      step={step}
                      updateStep={updateStep}
                      globalPrompts={globalPrompts}
                      orgICP={orgICP}
                      searchProviderStatus={searchProviderStatus}
                      serperKeyInput={serperKeyInput}
                      setSerperKeyInput={setSerperKeyInput}
                      onSaveSerperKey={saveSerperKey}
                      braveKeyInput={braveKeyInput}
                      setBraveKeyInput={setBraveKeyInput}
                      onSaveBraveKey={saveBraveKey}
                      googleKeyInput={googleKeyInput}
                      setGoogleKeyInput={setGoogleKeyInput}
                      googleCseInput={googleCseInput}
                      setGoogleCseInput={setGoogleCseInput}
                      onSaveGoogleKey={saveGoogleKey}
                    />
                  )}
                  {step.id === 'qualify' && (
                    <QualifyConfig step={step} updateStep={updateStep} />
                  )}
                  {step.id === 'enrich' && (
                    <EnrichConfig step={step} updateStep={updateStep} dataSources={dataSources} />
                  )}
                  {step.id === 'score' && (
                    <ScoreConfig step={step} updateStep={updateStep} orgICP={orgICP} />
                  )}
                  {step.id === 'brief' && (
                    <BriefConfig step={step} updateStep={updateStep} globalPrompts={globalPrompts} />
                  )}
                </div>
              )}

              {/* Connector */}
              {idx < value.steps.length - 1 && (
                <div className="flex justify-center -mb-1">
                  <div className="w-px h-1.5 bg-gray-300" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary bar */}
      <SummaryBar steps={value.steps} />
    </div>
  );
}

// ── Step Config Components ───────────────────────────────────────

function DiscoverConfig({ step, updateStep, globalPrompts, orgICP, searchProviderStatus, serperKeyInput, setSerperKeyInput, onSaveSerperKey, braveKeyInput, setBraveKeyInput, onSaveBraveKey, googleKeyInput, setGoogleKeyInput, googleCseInput, setGoogleCseInput, onSaveGoogleKey }: {
  step: FunnelStepConfig;
  updateStep: (id: string, u: Partial<FunnelStepConfig>) => void;
  globalPrompts?: GlobalPromptDefaults;
  orgICP?: OrgICP;
  searchProviderStatus: { serper: 'configured' | 'unconfigured'; brave: 'configured' | 'unconfigured'; google: 'configured' | 'unconfigured'; checking: boolean };
  serperKeyInput: string;
  setSerperKeyInput: (v: string) => void;
  onSaveSerperKey?: (key: string) => void;
  braveKeyInput: string;
  setBraveKeyInput: (v: string) => void;
  onSaveBraveKey?: (key: string) => void;
  googleKeyInput: string;
  setGoogleKeyInput: (v: string) => void;
  googleCseInput: string;
  setGoogleCseInput: (v: string) => void;
  onSaveGoogleKey?: (key: string, cseId: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <ModelSelect value={step.model} onChange={v => updateStep(step.id, { model: v })} recommended="claude-haiku-4-5@20251001" />
        <NumberInput label="Max output tokens" value={step.max_tokens} onChange={v => updateStep(step.id, { max_tokens: v })} placeholder="16384" />
        <NumberInput label="Max companies to find" value={step.candidate_limit} onChange={v => updateStep(step.id, { candidate_limit: v })} placeholder="50" />
      </div>

      {/* Source strategy */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-2 block">Research source strategy</label>
        <div className="flex gap-2">
          {([
            { id: 'open', label: 'AI knowledge only', desc: 'Generates from training data' },
            { id: 'search_augmented', label: 'Web search + AI', desc: 'Real web searches feed AI analysis' },
            { id: 'guided', label: 'Guided sources', desc: 'AI starts with your sources list' },
            { id: 'restricted', label: 'Restricted sources', desc: 'AI only uses listed sources' },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => updateStep(step.id, { source_strategy: opt.id })}
              className={`flex-1 px-3 py-2 rounded-lg border text-left transition-colors ${
                (step.source_strategy || 'search_augmented') === opt.id
                  ? 'border-blue-300 bg-blue-50 text-blue-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="text-xs font-medium block">{opt.label}</span>
              <span className="text-[10px] text-gray-400">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search-augmented config */}
      {(step.source_strategy || 'search_augmented') === 'search_augmented' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Search className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-xs font-medium text-blue-800">Web Search Settings</span>
          </div>

          {/* Provider status */}
          {searchProviderStatus.checking ? (
            <div className="flex items-center gap-2 text-[11px] text-gray-400">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
              Checking search providers...
            </div>
          ) : searchProviderStatus.serper === 'configured' || searchProviderStatus.brave === 'configured' || searchProviderStatus.google === 'configured' ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-md">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] text-emerald-700 font-medium">
                {searchProviderStatus.serper === 'configured' ? 'Serper.dev (Google results)'
                  : searchProviderStatus.brave === 'configured' ? 'Brave Search'
                  : 'Google Custom Search'} configured
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-md">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-[11px] text-amber-700 font-medium">No search provider configured — set up one below</span>
              </div>

              {/* Serper.dev (recommended) */}
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700">Serper.dev</span>
                  <div className="flex gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-medium">2,500 FREE queries</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">Recommended</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={serperKeyInput}
                    onChange={e => setSerperKeyInput(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                    placeholder="Serper API key"
                  />
                  <button
                    onClick={() => onSaveSerperKey?.(serperKeyInput)}
                    disabled={!serperKeyInput.trim()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">
                  Get a key at serper.dev — Google search results, simple API
                </p>
              </div>

              {/* Google Custom Search (free tier) */}
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700">Google Custom Search</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-medium">FREE — 100 queries/day</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={googleKeyInput}
                    onChange={e => setGoogleKeyInput(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                    placeholder="Google API key"
                  />
                  <input
                    value={googleCseInput}
                    onChange={e => setGoogleCseInput(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                    placeholder="Custom Search Engine ID"
                  />
                  <button
                    onClick={() => onSaveGoogleKey?.(googleKeyInput, googleCseInput)}
                    disabled={!googleKeyInput.trim() || !googleCseInput.trim()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">
                  Set up at console.cloud.google.com — create API key + Custom Search Engine
                </p>
              </div>

              {/* Brave Search */}
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700">Brave Search</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full">Paid</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={braveKeyInput}
                    onChange={e => setBraveKeyInput(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                    placeholder="Brave Search API key"
                  />
                  <button
                    onClick={() => onSaveBraveKey?.(braveKeyInput)}
                    disabled={!braveKeyInput.trim()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">
                  Get a key at search.brave.com/api
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <NumberInput label="Max search queries" value={step.search_max_queries} onChange={v => updateStep(step.id, { search_max_queries: v })} placeholder="8" />
            <NumberInput label="Results per query" value={step.search_max_results_per_query} onChange={v => updateStep(step.id, { search_max_results_per_query: v })} placeholder="5" />
          </div>
        </div>
      )}

      {/* Research sources (when guided or restricted) */}
      {(step.source_strategy === 'guided' || step.source_strategy === 'restricted') && (
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Research sources</label>
          <p className="text-[11px] text-gray-400 mb-2">
            {step.source_strategy === 'restricted' ? 'AI will ONLY use these sources.' : 'AI will start with these but may explore others.'}
          </p>
          {(step.research_sources || []).map((rs, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                value={rs.source}
                onChange={e => {
                  const sources = [...(step.research_sources || [])];
                  sources[i] = { ...sources[i], source: e.target.value };
                  updateStep(step.id, { research_sources: sources });
                }}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                placeholder="Source name (e.g. Crunchbase)"
              />
              <input
                value={rs.guidance}
                onChange={e => {
                  const sources = [...(step.research_sources || [])];
                  sources[i] = { ...sources[i], guidance: e.target.value };
                  updateStep(step.id, { research_sources: sources });
                }}
                className="flex-[2] text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                placeholder="What to look for (e.g. Series B+ in healthcare)"
              />
              <button
                onClick={() => {
                  const sources = (step.research_sources || []).filter((_, j) => j !== i);
                  updateStep(step.id, { research_sources: sources.length ? sources : undefined });
                }}
                className="text-xs text-red-400 hover:text-red-600 px-1"
              >&times;</button>
            </div>
          ))}
          <button
            onClick={() => updateStep(step.id, { research_sources: [...(step.research_sources || []), { source: '', guidance: '' }] })}
            className="text-xs text-blue-600 hover:text-blue-700"
          >+ Add source</button>
        </div>
      )}

      {/* Target segments */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-1.5 block">Target company sizes</label>
        <SegmentCheckboxes
          value={step.target_segments}
          onChange={v => updateStep(step.id, { target_segments: v })}
        />
      </div>

      {/* Lead count range */}
      <div className="grid grid-cols-2 gap-3">
        <NumberInput label="Minimum companies" value={step.lead_count_min} onChange={v => updateStep(step.id, { lead_count_min: v })} placeholder="12" />
        <NumberInput label="Maximum companies" value={step.lead_count_max} onChange={v => updateStep(step.id, { lead_count_max: v })} placeholder="50" />
      </div>

      {/* Geographic focus */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-1 block">Geographic focus</label>
        <p className="text-[11px] text-gray-400 mb-1.5">Prioritize companies in these regions. Leave empty for worldwide.</p>
        <TagInput
          values={step.geographic_focus || []}
          onChange={v => updateStep(step.id, { geographic_focus: v.length ? v : undefined })}
          placeholder="e.g. United States, Europe, APAC"
        />
      </div>

      {/* Funding stages */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-1 block">Funding stage filter</label>
        <p className="text-[11px] text-gray-400 mb-1.5">Only discover companies at these stages. Leave empty for all.</p>
        <TagInput
          values={step.funding_stage_filter || []}
          onChange={v => updateStep(step.id, { funding_stage_filter: v.length ? v : undefined })}
          placeholder="e.g. Series A, Series B, Growth"
        />
      </div>

      {/* Recency */}
      <NumberInput label="Focus on activity in last N months" value={step.recency_months} onChange={v => updateStep(step.id, { recency_months: v })} placeholder="e.g. 12" />

      {/* Industries (ICP absorbed) */}
      <InheritableField
        label="Industries"
        orgValues={orgICP?.verticals || []}
        overrideValues={step.verticals_override}
        useOrg={step.use_org_verticals !== false}
        onToggle={useOrg => updateStep(step.id, {
          use_org_verticals: useOrg,
          verticals_override: useOrg ? undefined : (step.verticals_override || orgICP?.verticals || []),
        })}
        onChange={vals => updateStep(step.id, { verticals_override: vals.length ? vals : undefined })}
        placeholder="e.g. Gaming, Developer Tools, FinTech"
      />

      {/* Technology categories */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-1 block">Technology categories</label>
        <p className="text-[11px] text-gray-400 mb-1.5">
          Product/platform types to search for — these are what a company <em>builds or operates</em>, not which industry they're in.
          Examples: DSPM, ITSM, observability, SIEM, CI/CD, identity management.
        </p>
        <TagInput
          values={step.technology_categories || []}
          onChange={v => updateStep(step.id, { technology_categories: v.length ? v : undefined })}
          placeholder="e.g. DSPM, ITSM, Observability, DevSecOps"
        />
      </div>

      {/* Company sizing method */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-2 block">How should AI estimate company size?</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: 'employee_count' as const, label: 'Total employees', desc: 'Standard headcount (default)' },
            { id: 'engineering_headcount' as const, label: 'Engineering headcount', desc: 'Technical team size only' },
            { id: 'vpn_users' as const, label: 'VPN / remote users', desc: 'Employees needing remote access' },
            { id: 'revenue_range' as const, label: 'Revenue range', desc: 'Annual revenue as size proxy' },
          ]).map(opt => (
            <button
              key={opt.id}
              onClick={() => updateStep(step.id, { sizing_method: opt.id === 'employee_count' ? undefined : opt.id })}
              className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                (step.sizing_method || 'employee_count') === opt.id
                  ? 'border-blue-300 bg-blue-50 text-blue-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="text-xs font-medium block">{opt.label}</span>
              <span className="text-[10px] text-gray-400">{opt.desc}</span>
            </button>
          ))}
        </div>
        {step.sizing_method && step.sizing_method !== 'employee_count' && (
          <div className="mt-2">
            <label className="text-xs font-medium text-gray-700 mb-1 block">Sizing guidance (optional)</label>
            <textarea
              value={step.sizing_guidance || ''}
              onChange={e => updateStep(step.id, { sizing_guidance: e.target.value || undefined })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 h-12 resize-y"
              placeholder="e.g. For this campaign, a company with 50 engineers is equivalent to a 500-person company in terms of VPN user need..."
            />
          </div>
        )}
      </div>

      {/* Post-discover filters */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-2 block">Post-discover filters</label>
        <p className="text-[11px] text-gray-400 mb-2">
          Programmatic filters applied after AI discovery — removes excluded companies, duplicates, and undersized candidates automatically.
        </p>
        <div className="space-y-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={step.validate_domains !== false}
              onChange={e => updateStep(step.id, { validate_domains: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-xs text-gray-700">Validate domains (DNS + HTTP check)</span>
              <span className="text-[10px] text-gray-400 block">Drops companies with non-existent or parked domains</span>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={step.light_enrich !== false}
              onChange={e => updateStep(step.id, { light_enrich: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-xs text-gray-700">Light enrichment before qualify (website + DNS)</span>
              <span className="text-[10px] text-gray-400 block">Adds firmographic data so qualify has more signal</span>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={step.filter_existing_leads !== false}
              onChange={e => updateStep(step.id, { filter_existing_leads: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-700">Remove companies already in leads across campaigns</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={step.filter_allow_snoozed_retry !== false}
              onChange={e => updateStep(step.id, { filter_allow_snoozed_retry: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-700">Re-include snoozed leads whose retry date has passed</span>
          </label>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <NumberInput
              label="Skip if recommended within N days"
              value={step.filter_ledger_days}
              onChange={v => updateStep(step.id, { filter_ledger_days: v })}
              placeholder="90"
            />
            <NumberInput
              label="Min employee count (hard floor)"
              value={step.filter_min_employees}
              onChange={v => updateStep(step.id, { filter_min_employees: v })}
              placeholder="50"
            />
          </div>
        </div>
      </div>

      <PromptField
        step={step}
        updateStep={updateStep}
        globalDefault={globalPrompts?.research_preamble}
        label="Research guidance"
        placeholder="e.g. Focus on Series B+ companies in healthcare with 200-500 employees deploying on-prem software..."
        helpText="Tell the AI what to prioritize when searching for companies."
      />
    </>
  );
}

function QualifyConfig({ step, updateStep }: {
  step: FunnelStepConfig;
  updateStep: (id: string, u: Partial<FunnelStepConfig>) => void;
}) {
  return (
    <>
      <NumberInput label="Max companies to pass through" value={step.candidate_limit} onChange={v => updateStep(step.id, { candidate_limit: v })} placeholder="20" />

      {/* Segment filter */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-1.5 block">Allowed segments</label>
        <SegmentCheckboxes
          value={step.segment_filter}
          onChange={v => updateStep(step.id, { segment_filter: v })}
        />
      </div>

      {/* Employee range */}
      <div className="grid grid-cols-2 gap-3">
        <NumberInput label="Min employees" value={step.employee_range?.min} onChange={v => {
          const range = { ...(step.employee_range || {}), min: v };
          updateStep(step.id, { employee_range: (range.min || range.max) ? range : undefined });
        }} placeholder="e.g. 50" />
        <NumberInput label="Max employees" value={step.employee_range?.max} onChange={v => {
          const range = { ...(step.employee_range || {}), max: v };
          updateStep(step.id, { employee_range: (range.min || range.max) ? range : undefined });
        }} placeholder="e.g. 5000" />
      </div>

      {/* Funding stages */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-1 block">Funding stage filter</label>
        <TagInput
          values={step.qualify_funding_stages || []}
          onChange={v => updateStep(step.id, { qualify_funding_stages: v.length ? v : undefined })}
          placeholder="e.g. Series B, Series C, Growth"
        />
      </div>

      {/* Geographic filter */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Include regions</label>
          <TagInput
            values={step.geo_filter?.include || []}
            onChange={v => {
              const gf = { ...(step.geo_filter || {}), include: v.length ? v : undefined };
              updateStep(step.id, { geo_filter: (gf.include || gf.exclude) ? gf : undefined });
            }}
            placeholder="e.g. US, UK"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Exclude regions</label>
          <TagInput
            values={step.geo_filter?.exclude || []}
            onChange={v => {
              const gf = { ...(step.geo_filter || {}), exclude: v.length ? v : undefined };
              updateStep(step.id, { geo_filter: (gf.include || gf.exclude) ? gf : undefined });
            }}
            placeholder="e.g. China, Russia"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-700">Must-have keywords</label>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400">Match mode:</span>
            <select
              value={step.match_mode || 'any'}
              onChange={e => updateStep(step.id, { match_mode: e.target.value as 'any' | 'all' })}
              className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded bg-white"
            >
              <option value="any">Match any</option>
              <option value="all">Match all</option>
            </select>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mb-1.5">Companies must mention {step.match_mode === 'all' ? 'ALL' : 'at least one'} of these to pass.</p>
        <TagInput
          values={step.qualification_criteria || []}
          onChange={v => updateStep(step.id, { qualification_criteria: v })}
          placeholder="e.g. kubernetes, remote-first, series-b"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 mb-1 block">Disqualifying keywords</label>
        <p className="text-[11px] text-gray-400 mb-1.5">Companies matching any of these are removed. Combines with your campaign's anti-patterns.</p>
        <TagInput
          values={step.disqualification_criteria || []}
          onChange={v => updateStep(step.id, { disqualification_criteria: v })}
          placeholder="e.g. government, consulting, pre-revenue"
        />
      </div>

      <NumberInput label="Min signals required" value={step.min_signal_count} onChange={v => updateStep(step.id, { min_signal_count: v })} placeholder="e.g. 2" />
    </>
  );
}

function EnrichConfig({ step, updateStep, dataSources }: {
  step: FunnelStepConfig;
  updateStep: (id: string, u: Partial<FunnelStepConfig>) => void;
  dataSources: DataSourceDef[];
}) {
  const overrides = step.source_overrides || {};
  const freeSources = dataSources.filter(s => s.free);
  const paidSources = dataSources.filter(s => !s.free);

  const setSourceOverride = (sourceId: string, value: boolean | undefined) => {
    const updated = { ...overrides };
    if (value === undefined) {
      delete updated[sourceId];
    } else {
      updated[sourceId] = value;
    }
    updateStep(step.id, { source_overrides: Object.keys(updated).length > 0 ? updated : undefined });
  };

  return (
    <>
      <NumberInput label="Max companies to enrich" value={step.candidate_limit} onChange={v => updateStep(step.id, { candidate_limit: v })} placeholder="15" />
      <NumberInput
        label="Min enrichment sources to pass"
        value={step.min_enrichment_sources}
        onChange={v => updateStep(step.id, { min_enrichment_sources: v })}
        placeholder="1"
      />
      <p className="text-[10px] text-gray-400 -mt-2">
        Companies with fewer confirmed data sources are dropped before scoring. Set to 0 to disable.
      </p>

      {dataSources.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs font-medium text-gray-700">Data sources</label>
            {Object.keys(overrides).length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-full">
                {Object.keys(overrides).length} customized
              </span>
            )}
          </div>

          {[
            { label: 'Free', color: 'text-emerald-700 bg-emerald-50', sources: freeSources },
            ...(paidSources.length > 0 ? [{ label: 'Paid', color: 'text-amber-700 bg-amber-50', sources: paidSources }] : []),
          ].map(group => (
            <div key={group.label} className="mb-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${group.color}`}>{group.label}</span>
                <div className="flex-1 border-t border-gray-100" />
              </div>
              <div className="space-y-0.5">
                {group.sources.map(src => {
                  const override = overrides[src.id];
                  const isCustom = override !== undefined;
                  return (
                    <div key={src.id} className={`flex items-center justify-between py-1 px-2.5 rounded ${isCustom ? 'bg-amber-50/50' : 'hover:bg-gray-50'}`}>
                      <div className="min-w-0 mr-3" title={src.description}>
                        <span className="text-xs text-gray-700">{src.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {isCustom && (
                          <button onClick={() => setSourceOverride(src.id, undefined)} className="text-[10px] text-gray-400 hover:text-gray-600">reset</button>
                        )}
                        <select
                          value={isCustom ? (override ? 'on' : 'off') : 'default'}
                          onChange={e => {
                            const v = e.target.value;
                            setSourceOverride(src.id, v === 'default' ? undefined : v === 'on');
                          }}
                          className={`text-[11px] px-1.5 py-0.5 border rounded ${isCustom ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
                        >
                          <option value="default">Org default</option>
                          <option value="on">On</option>
                          <option value="off">Off</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {Object.keys(overrides).length > 0 && (
            <button
              onClick={() => updateStep(step.id, { source_overrides: undefined })}
              className="text-[11px] text-red-500 hover:text-red-600 mt-1"
            >
              Reset all to org defaults
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ScoreConfig({ step, updateStep, orgICP }: {
  step: FunnelStepConfig;
  updateStep: (id: string, u: Partial<FunnelStepConfig>) => void;
  orgICP?: OrgICP;
}) {
  const weights = step.scoring_weights || {};
  const w = {
    segment_scale_fit: weights.segment_scale_fit ?? 20,
    why_now_triggers: weights.why_now_triggers ?? 15,
    remote_access_pain: weights.remote_access_pain ?? 20,
    displacement_wedge: weights.displacement_wedge ?? 20,
    vertical_playbook: weights.vertical_playbook ?? 15,
    buyer_access_readiness: weights.buyer_access_readiness ?? 10,
  };
  const total = Object.values(w).reduce((s, v) => s + v, 0);

  const setWeight = (key: string, val: number | undefined) => {
    const newWeights = { ...weights, [key]: val };
    const hasAny = Object.values(newWeights).some(v => v !== undefined);
    updateStep(step.id, { scoring_weights: hasAny ? newWeights : undefined });
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <ModelSelect value={step.model} onChange={v => updateStep(step.id, { model: v })} recommended="claude-sonnet-4-6@default" />
        <NumberInput label="Max output tokens" value={step.max_tokens} onChange={v => updateStep(step.id, { max_tokens: v })} placeholder="2048" />
        <NumberInput label="Top companies to keep" value={step.candidate_limit} onChange={v => updateStep(step.id, { candidate_limit: v })} placeholder="10" />
      </div>

      {/* Scoring weights */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-700">Scoring weights</label>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            total === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            Total: {total}/100{total !== 100 && ' (recommended: 100)'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            { key: 'segment_scale_fit', label: 'Segment & Scale Fit', default: 20 },
            { key: 'why_now_triggers', label: 'Why Now Triggers', default: 15 },
            { key: 'remote_access_pain', label: 'Remote Access Pain', default: 20 },
            { key: 'displacement_wedge', label: 'Competitive Wedge', default: 20 },
            { key: 'vertical_playbook', label: 'Vertical Match', default: 15 },
            { key: 'buyer_access_readiness', label: 'Buyer Readiness', default: 10 },
          ].map(cat => (
            <div key={cat.key} className="flex items-center gap-2">
              <label className="text-[11px] text-gray-600 flex-1">{cat.label}</label>
              <input
                type="number"
                min={0}
                max={100}
                value={(weights as any)[cat.key] ?? ''}
                onChange={e => setWeight(cat.key, e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-14 text-xs text-center border border-gray-200 rounded px-1.5 py-1"
                placeholder={String(cat.default)}
              />
            </div>
          ))}
        </div>
        {step.scoring_weights && (
          <button onClick={() => updateStep(step.id, { scoring_weights: undefined })} className="text-[11px] text-red-500 hover:text-red-600 mt-1">
            Reset to defaults
          </button>
        )}
      </div>

      {/* Score threshold + confidence */}
      <div className="grid grid-cols-2 gap-3">
        <NumberInput label="Min score to pass to brief" value={step.min_score_threshold} onChange={v => updateStep(step.id, { min_score_threshold: v })} placeholder="e.g. 50" />
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Confidence filter</label>
          <select
            value={step.confidence_filter || 'all'}
            onChange={e => updateStep(step.id, { confidence_filter: e.target.value as any })}
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white"
          >
            <option value="all">All confidence levels</option>
            <option value="medium_high">Medium + High only</option>
            <option value="high_only">High only</option>
          </select>
        </div>
      </div>

      <div className="flex items-start gap-1.5 px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-lg">
        <Info className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Scores auto-adjust confidence based on data quality: candidates with zero enrichment sources are capped at "low" confidence, and candidates with only one source are capped at "medium".
        </p>
      </div>

      {/* ICP overrides */}
      <InheritableField
        label="Target verticals"
        orgValues={orgICP?.verticals || []}
        overrideValues={step.icp_verticals_override}
        useOrg={step.use_org_icp !== false}
        onToggle={useOrg => updateStep(step.id, {
          use_org_icp: useOrg,
          icp_verticals_override: useOrg ? undefined : (step.icp_verticals_override || orgICP?.verticals || []),
        })}
        onChange={vals => updateStep(step.id, { icp_verticals_override: vals.length ? vals : undefined })}
        placeholder="e.g. Gaming, Developer Tools"
      />
      <InheritableField
        label="Tech signals"
        orgValues={orgICP?.tech_signals || []}
        overrideValues={step.icp_tech_signals_override}
        useOrg={step.use_org_icp !== false}
        onToggle={useOrg => updateStep(step.id, {
          use_org_icp: useOrg,
          icp_tech_signals_override: useOrg ? undefined : (step.icp_tech_signals_override || orgICP?.tech_signals || []),
        })}
        onChange={vals => updateStep(step.id, { icp_tech_signals_override: vals.length ? vals : undefined })}
        placeholder="e.g. VPN replacement, Zero trust"
      />
      <InheritableField
        label="Competitors to displace"
        orgValues={orgICP?.competitors || []}
        overrideValues={step.icp_competitors_override}
        useOrg={step.use_org_icp !== false}
        onToggle={useOrg => updateStep(step.id, {
          use_org_icp: useOrg,
          icp_competitors_override: useOrg ? undefined : (step.icp_competitors_override || orgICP?.competitors || []),
        })}
        onChange={vals => updateStep(step.id, { icp_competitors_override: vals.length ? vals : undefined })}
        placeholder="e.g. Zscaler, Cloudflare Access"
      />

      <PromptField
        step={step}
        updateStep={updateStep}
        label="Scoring guidance"
        placeholder="e.g. Weight remote-access pain signals heavily. Companies with existing VPN infrastructure should score higher..."
        helpText="Additional instructions for how the AI should evaluate ICP fit."
      />
    </>
  );
}

function BriefConfig({ step, updateStep, globalPrompts }: {
  step: FunnelStepConfig;
  updateStep: (id: string, u: Partial<FunnelStepConfig>) => void;
  globalPrompts?: GlobalPromptDefaults;
}) {
  const currentTone = step.outreach_tone || '';
  const personaTypes = step.persona_types || [];

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <ModelSelect value={step.model} onChange={v => updateStep(step.id, { model: v })} recommended="claude-opus-4-6@default" />
        <NumberInput label="Max output tokens" value={step.max_tokens} onChange={v => updateStep(step.id, { max_tokens: v })} placeholder="4096" />
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Outreach tone</label>
          <select
            value={currentTone}
            onChange={e => updateStep(step.id, { outreach_tone: e.target.value || undefined })}
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white"
          >
            <option value="">{globalPrompts?.outreach_tone ? `Org default (${globalPrompts.outreach_tone})` : 'Org default'}</option>
            {TONES.map(t => (
              <option key={t.id} value={t.id}>{t.label} — {t.desc}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Persona types */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-1.5 block">Persona types to generate</label>
        <p className="text-[11px] text-gray-400 mb-1.5">Select which roles the AI should find and write outreach for. Leave all checked for the default.</p>
        <div className="flex gap-3">
          {([
            { id: 'champion' as const, label: 'Champion', desc: 'Day-to-day user/evaluator' },
            { id: 'economic_buyer' as const, label: 'Economic Buyer', desc: 'Controls the budget' },
            { id: 'executive_sponsor' as const, label: 'Executive Sponsor', desc: 'Signs off on purchase' },
          ]).map(pt => {
            const isChecked = personaTypes.length === 0 || personaTypes.includes(pt.id);
            return (
              <label key={pt.id} className={`flex-1 flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                isChecked ? 'border-rose-200 bg-rose-50/50' : 'border-gray-200 bg-white'
              }`}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={e => {
                    let types: typeof personaTypes;
                    if (personaTypes.length === 0) {
                      // Currently "all" — deselecting one means selecting the other two
                      types = (['champion', 'economic_buyer', 'executive_sponsor'] as const).filter(t => t !== pt.id);
                    } else if (e.target.checked) {
                      types = [...personaTypes, pt.id];
                      if (types.length === 3) types = []; // All selected = default
                    } else {
                      types = personaTypes.filter(t => t !== pt.id);
                    }
                    updateStep(step.id, { persona_types: types.length ? types : undefined });
                  }}
                  className="mt-0.5 rounded border-gray-300"
                />
                <div>
                  <span className="text-xs font-medium text-gray-700 block">{pt.label}</span>
                  <span className="text-[10px] text-gray-400">{pt.desc}</span>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Brief depth */}
      <div>
        <label className="text-xs font-medium text-gray-700 mb-2 block">Brief depth</label>
        <div className="flex gap-2">
          {([
            { id: 'quick', label: 'Quick', desc: 'Snapshot: overview, 2 pain points, 1 persona' },
            { id: 'standard', label: 'Standard', desc: 'Full brief with all sections' },
            { id: 'comprehensive', label: 'Comprehensive', desc: 'Extended analysis, multiple outreach variants' },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => updateStep(step.id, { brief_depth: opt.id === 'standard' ? undefined : opt.id })}
              className={`flex-1 px-3 py-2 rounded-lg border text-left transition-colors ${
                (step.brief_depth || 'standard') === opt.id
                  ? 'border-rose-300 bg-rose-50 text-rose-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="text-xs font-medium block">{opt.label}</span>
              <span className="text-[10px] text-gray-400">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <PromptField
        step={step}
        updateStep={updateStep}
        label="Brief guidance"
        placeholder="e.g. Emphasize cost savings over security. Lead with the compliance angle for regulated industries..."
        helpText="Tell the AI how to frame the outreach brief for this campaign."
      />
    </>
  );
}

// ── Shared UI Components ─────────────────────────────────────────

function ModelSelect({ value, onChange, recommended }: {
  value?: string;
  onChange: (v: string) => void;
  recommended?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-700 mb-1 block">AI model</label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white"
      >
        {MODELS.map(m => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.cost}/1M){m.id === recommended ? ' *' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberInput({ label, value, onChange, placeholder }: {
  label: string;
  value?: number;
  onChange: (v: number | undefined) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-700 mb-1 block">{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? parseInt(e.target.value) : undefined)}
        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
        placeholder={placeholder}
      />
    </div>
  );
}

function PromptField({ step, updateStep, globalDefault, label, placeholder, helpText }: {
  step: FunnelStepConfig;
  updateStep: (id: string, u: Partial<FunnelStepConfig>) => void;
  globalDefault?: string;
  label: string;
  placeholder: string;
  helpText: string;
}) {
  const mode = step.prompt_mode || 'append';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-700">{label}</label>
        {globalDefault && (
          <div className="flex items-center gap-1.5">
            <select
              value={mode}
              onChange={e => updateStep(step.id, { prompt_mode: e.target.value as 'append' | 'override' })}
              className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded bg-white"
            >
              <option value="append">Add to org defaults</option>
              <option value="override">Replace org defaults</option>
            </select>
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mb-1.5">{helpText}</p>
      {globalDefault && mode === 'append' && (
        <div className="flex items-start gap-1.5 mb-1.5 px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-lg">
          <Info className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-gray-400 leading-relaxed">
            <span className="font-medium text-gray-500">Org default:</span> {globalDefault.length > 120 ? globalDefault.slice(0, 120) + '...' : globalDefault}
          </p>
        </div>
      )}
      <textarea
        value={step.prompt_instructions || ''}
        onChange={e => updateStep(step.id, { prompt_instructions: e.target.value || undefined })}
        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 h-16 resize-y"
        placeholder={placeholder}
      />
    </div>
  );
}

function SegmentCheckboxes({ value, onChange }: {
  value?: { smb: boolean; mm: boolean; ent: boolean };
  onChange: (v: { smb: boolean; mm: boolean; ent: boolean } | undefined) => void;
}) {
  const all = !value || (value.smb && value.mm && value.ent);
  const segments = [
    { key: 'smb' as const, label: 'SMB', desc: '30–199 employees', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    { key: 'mm' as const, label: 'Mid-Market', desc: '200–999 employees', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    { key: 'ent' as const, label: 'Enterprise', desc: '1000+ employees', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  ];

  return (
    <div className="flex gap-2">
      {segments.map(seg => {
        const isChecked = !value || value[seg.key];
        return (
          <label key={seg.key} className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
            isChecked ? seg.color : 'border-gray-200 bg-white text-gray-400'
          }`}>
            <input
              type="checkbox"
              checked={isChecked}
              onChange={e => {
                const v = value || { smb: true, mm: true, ent: true };
                const updated = { ...v, [seg.key]: e.target.checked };
                // If all checked, clear the filter
                if (updated.smb && updated.mm && updated.ent) {
                  onChange(undefined);
                } else {
                  onChange(updated);
                }
              }}
              className="rounded border-gray-300"
            />
            <div>
              <span className="text-xs font-medium block">{seg.label}</span>
              <span className="text-[10px] opacity-70">{seg.desc}</span>
            </div>
          </label>
        );
      })}
      {value && (
        <button onClick={() => onChange(undefined)} className="self-center text-[10px] text-gray-400 hover:text-gray-600">All</button>
      )}
    </div>
  );
}

function InheritableField({ label, orgValues, overrideValues, useOrg, onToggle, onChange, placeholder }: {
  label: string;
  orgValues: string[];
  overrideValues?: string[];
  useOrg: boolean;
  onToggle: (useOrg: boolean) => void;
  onChange: (vals: string[]) => void;
  placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-700">{label}</label>
        <select
          value={useOrg ? 'org' : 'custom'}
          onChange={e => onToggle(e.target.value === 'org')}
          className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded bg-white"
        >
          <option value="org">Use org defaults</option>
          <option value="custom">Customize</option>
        </select>
      </div>
      {useOrg ? (
        <div className="flex flex-wrap gap-1.5 px-2.5 py-2 bg-gray-50 border border-gray-100 rounded-lg min-h-[36px]">
          {orgValues.length > 0 ? orgValues.map(v => (
            <span key={v} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-md">{v}</span>
          )) : (
            <span className="text-[11px] text-gray-400">No org defaults set</span>
          )}
        </div>
      ) : (
        <TagInput
          values={overrideValues || []}
          onChange={onChange}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

function SummaryBar({ steps }: { steps: FunnelStepConfig[] }) {
  const active = steps.filter(s => s.enabled);
  const totalEstimate = active.reduce((sum, s) => {
    const est = estimateCost(s);
    if (!est || est.startsWith('<')) return sum;
    return sum + parseFloat(est.replace(/[~$]/g, ''));
  }, 0);

  return (
    <div className="mt-4 p-3 bg-gray-50 rounded-lg flex items-center justify-between text-xs text-gray-500">
      <div>
        <span className="font-medium text-gray-700">Pipeline: </span>
        {active.map((s, i) => (
          <span key={s.id}>
            {i > 0 && <span className="text-gray-300 mx-1">&rarr;</span>}
            <span className={s.model ? 'text-gray-700' : ''}>{STEP_META[s.id]?.label}</span>
            {s.candidate_limit && <span className="text-gray-400"> ({s.candidate_limit})</span>}
          </span>
        ))}
      </div>
      {totalEstimate > 0 && (
        <span className="text-gray-400">Est. ~${totalEstimate.toFixed(2)} per run</span>
      )}
    </div>
  );
}

// ── Tag Input ────────────────────────────────────────────────────

function TagInput({ values, onChange, placeholder }: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim().toLowerCase();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
  };

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border border-gray-200 rounded-lg bg-white min-h-[36px]">
      {values.map(v => (
        <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-md">
          {v}
          <button onClick={() => onChange(values.filter(x => x !== v))} className="text-gray-400 hover:text-red-500">&times;</button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
        onBlur={addTag}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] text-xs outline-none bg-transparent"
      />
    </div>
  );
}
