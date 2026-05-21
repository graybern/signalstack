import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthContext } from '../App';
import { formatDate, formatDateTime, formatDateShort } from '../utils/dates';
import {
  ArrowLeft, Play, Edit, Users, TrendingUp, Target, ChevronDown, ChevronUp, ChevronRight,
  Layers, Settings, Clock, Shield, Rss, Copy, Check, Calendar,
  Search, Send, Globe, Hash, Plus, Trash2, Power, Crosshair,
  BarChart3, DollarSign, Activity, Eye, ExternalLink,
  ArrowUpDown, ArrowUp, ArrowDown, Filter, X, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import { ScoreBadge, SegmentBadge } from '../components/ScoreBadge';
import { ActivityPanel } from '../components/ActivityPanel';
import { AILogPanel } from '../components/AILogPanel';
import { FunnelConfigurator } from '../components/FunnelConfigurator';
import { useEventStream } from '../hooks/useEventStream';
import { permissions } from '../utils/permissions';
import { useToast } from '../components/Toast';

interface SearchPattern {
  name: string;
  description: string;
  examples: string[];
  keywords: string[];
}

interface CampaignFull {
  id: string;
  name: string;
  description: string | null;
  pattern_thesis: string;
  example_companies: { name: string; domain: string; why_they_fit: string }[];
  target_signals: string[];
  anti_patterns: string[];
  target_categories: string[];
  search_patterns: SearchPattern[];
  value_prop_angle: string | null;
  target_count: number;
  status: string;
  lead_count: number;
  avg_score: number | null;
  runs: any[];
  leads: any[];
  schedule_cron: string | null;
  schedule_enabled: number;
  schedule_timezone: string | null;
  exclusion_config: { additions: any[]; exemptions: string[] } | null;
  rss_enabled: number;
  funnel_config: {
    version: number;
    steps: Record<string, any>[];
  } | null;
}


const DATA_SOURCES: { id: string; label: string; description: string; free: boolean }[] = [
  { id: 'website_analysis', label: 'Website Analysis', description: 'Scrapes company homepage for product, team, and tech stack signals', free: true },
  { id: 'github_presence', label: 'GitHub Presence', description: 'Checks public repos for language usage, activity, and open-source engagement', free: true },
  { id: 'job_postings', label: 'Job Postings', description: 'Scans job boards for hiring patterns, tech requirements, and growth signals', free: true },
  { id: 'dns_fingerprint', label: 'DNS Fingerprint', description: 'Analyzes DNS records to detect infrastructure and vendor usage', free: true },
  { id: 'wikipedia', label: 'Wikipedia', description: 'Pulls company overview, founding date, funding, and key milestones', free: true },
  { id: 'google_news', label: 'Google News RSS', description: 'Fetches recent news mentions for funding rounds, launches, and partnerships', free: true },
  { id: 'hacker_news', label: 'Hacker News', description: 'Searches HN for community discussions, product launches, and sentiment', free: true },
  { id: 'tech_fingerprint', label: 'Tech Fingerprint', description: 'Detects frontend frameworks, CDNs, analytics, and infrastructure via headers', free: true },
  { id: 'web_search', label: 'Web Search API', description: 'Broader web search for press coverage, analyst reports, and market context', free: false },
  { id: 'crunchbase', label: 'Crunchbase', description: 'Funding history, investors, acquisitions, and company financials', free: false },
  { id: 'apollo', label: 'Apollo', description: 'Contact data, org charts, direct emails, and phone numbers for outreach', free: false },
];

type TabId = 'overview' | 'leads' | 'runs' | 'analytics' | 'configure';

const TABS: { id: TabId; label: string; icon: typeof Target }[] = [
  { id: 'overview', label: 'Overview', icon: Target },
  { id: 'leads', label: 'Leads', icon: Users },
  { id: 'runs', label: 'Runs', icon: Activity },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'configure', label: 'Configure', icon: Settings },
];

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthContext();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaign, setCampaign] = useState<CampaignFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') return 'configure';
    return (tab as TabId) || 'overview';
  });
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [viewLogRunId, setViewLogRunId] = useState<string | null>(null);

  // Leads state
  const [leadRunFilter, setLeadRunFilter] = useState<string>('');
  const [leadSearch, setLeadSearch] = useState('');
  const [leadSort, setLeadSort] = useState<'fit_score' | 'company_name' | 'created_at' | 'segment'>('fit_score');
  const [leadSortDir, setLeadSortDir] = useState<'asc' | 'desc'>('desc');
  const [leadSegmentFilter, setLeadSegmentFilter] = useState<string>('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [rerunningRunId, setRerunningRunId] = useState<string | null>(null);

  // Configure state
  const [configTab, setConfigTab] = useState<'definition' | 'funnel' | 'schedule' | 'exclusions' | 'feed'>('definition');
  const [configDirty, setConfigDirty] = useState(false);
  const [editConfig, setEditConfig] = useState<{
    schedule_cron: string;
    schedule_enabled: boolean;
    schedule_timezone: string;
    exclusion_config: { additions: any[]; exemptions: string[] } | null;
    rss_enabled: boolean;
    funnel_config: any | null;
    notification_destinations: any[];
    notification_base_url: string;
    icp_overrides: Record<string, any> | null;
  }>({
    schedule_cron: '', schedule_enabled: false, schedule_timezone: '', exclusion_config: null, rss_enabled: false,
    funnel_config: null, notification_destinations: [], notification_base_url: '', icp_overrides: null,
  });
  const [globalExclusions, setGlobalExclusions] = useState<{ id: string; company_name: string; domain: string | null }[]>([]);

  // Server timezone + timezone list for schedule display
  const [serverTzAbbr, setServerTzAbbr] = useState('');
  const [serverTzName, setServerTzName] = useState('');
  const [timezoneList, setTimezoneList] = useState<{ zone: string; abbreviation: string; utc_offset: string }[]>([]);
  useEffect(() => {
    api('/settings/timezone').then((data: any) => {
      setServerTzAbbr(data.abbreviation || '');
      setServerTzName(data.timezone || '');
      setTimezoneList(data.timezones || []);
    }).catch(() => {});
  }, []);

  // Analytics
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Insights
  const [insights, setInsights] = useState<any[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Sync tab to URL
  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  useEffect(() => {
    if (id) {
      api<CampaignFull>(`/campaigns/${id}`).then(data => {
        setCampaign(data);
        setEditConfig({
          schedule_cron: data.schedule_cron || '',
          schedule_enabled: !!data.schedule_enabled,
          schedule_timezone: data.schedule_timezone || '',
          exclusion_config: data.exclusion_config,
          rss_enabled: !!data.rss_enabled,
          funnel_config: data.funnel_config || null,
          notification_destinations: (data as any).notification_destinations || [],
          notification_base_url: (data as any).notification_base_url || '',
          icp_overrides: (data as any).icp_overrides || null,
        });
      }).finally(() => setLoading(false));
      api('/exclusions?limit=10000').then((data: any) => {
        setGlobalExclusions((data.exclusions || []).map((e: any) => ({ id: e.id, company_name: e.company_name, domain: e.domain })));
      }).catch(() => {});
    }
  }, [id]);

  // Eagerly fetch insights on campaign load for badge count
  useEffect(() => {
    if (id && insights.length === 0 && !insightsLoading) {
      setInsightsLoading(true);
      api(`/campaigns/${id}/insights`).then((data: any) => setInsights(Array.isArray(data) ? data : [])).catch(() => {}).finally(() => setInsightsLoading(false));
    }
  }, [id]);

  // Auto-load analytics when tab opens
  useEffect(() => {
    if (activeTab === 'analytics' && !analytics && !analyticsLoading && id) {
      setAnalyticsLoading(true);
      api(`/campaigns/${id}/analytics`).then(setAnalytics).catch(() => {}).finally(() => setAnalyticsLoading(false));
    }
  }, [activeTab, analytics, analyticsLoading, id]);

  const [showRunMenu, setShowRunMenu] = useState(false);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const [orgICP, setOrgICP] = useState<{ verticals: string[]; tech_signals: string[]; competitors: string[]; company_context?: any; disqualifiers?: any[]; signal_weights?: any[]; buyer_personas?: any; geographies?: any; segment_details?: any } | undefined>(undefined);

  // Close run dropdown on click-away
  useEffect(() => {
    if (!showRunMenu) return;
    const handler = (e: MouseEvent) => {
      if (runMenuRef.current && !runMenuRef.current.contains(e.target as Node)) {
        setShowRunMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRunMenu]);

  // Fetch org ICP for FunnelConfigurator
  useEffect(() => {
    api('/icp/full').then((data: any) => {
      if (data) {
        setOrgICP({
          verticals: data.verticals || [],
          tech_signals: data.tech_signals || [],
          competitors: data.competitors || [],
          company_context: data.company_context,
          disqualifiers: data.disqualifiers,
          signal_weights: data.signal_weights,
          buyer_personas: data.buyer_personas,
          geographies: data.geographies,
          segment_details: data.segment_details,
        });
      }
    }).catch(() => {});
  }, []);

  const triggerRun = async (steps?: string[]) => {
    if (!id) return;
    setShowRunMenu(false);
    try {
      const result = await api<{ run_id: string }>(`/campaigns/${id}/run`, {
        method: 'POST',
        body: JSON.stringify(steps ? { steps } : {}),
      });
      if (result.run_id) {
        setActiveRunId(result.run_id);
        switchTab('runs');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const triggerBulkRerun = async (leadIds: string[]) => {
    if (!id || leadIds.length === 0) return;
    setBulkRunning(true);
    try {
      const result = await api<{ run_id: string }>(`/campaigns/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ steps: ['enrich', 'score', 'brief', 'audit'], lead_ids: leadIds }),
      });
      if (result.run_id) {
        setActiveRunId(result.run_id);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBulkRunning(false);
      setSelectedLeadIds(new Set());
    }
  };

  const triggerRerunFromRun = async (run: any) => {
    if (!id || !campaign) return;
    setRerunningRunId(run.id);
    try {
      let leadIds: string[];
      if (run.run_type === 'stage_rerun' && run.target_lead_ids) {
        leadIds = JSON.parse(run.target_lead_ids);
      } else {
        leadIds = campaign.leads.map((l: any) => l.id);
      }
      if (leadIds.length === 0) { alert('No leads to rerun'); return; }
      const result = await api<{ run_id: string }>(`/campaigns/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ steps: ['enrich', 'score', 'brief', 'audit'], lead_ids: leadIds }),
      });
      if (result.run_id) setActiveRunId(result.run_id);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRerunningRunId(null);
    }
  };

  // Detect active run from campaign data on load
  useEffect(() => {
    if (campaign && !activeRunId) {
      const running = campaign.runs?.find((r: any) => r.status === 'running');
      if (running) setActiveRunId(running.id);
    }
  }, [campaign, activeRunId]);

  // Subscribe to completion/cancel/progress events
  const { subscribe } = useEventStream({
    types: ['campaign.completed', 'campaign.failed', 'campaign.cancelled', 'campaign.progress'],
    enabled: true,
  });

  const [activeRunProgress, setActiveRunProgress] = useState<{
    phase?: string;
    step_number?: number;
    total_steps?: number;
    tokens?: { estimated_cost: number };
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    const unsub = subscribe('*', (event) => {
      const data = event.data as any;
      // Only handle events for this campaign
      if (data.campaign_id !== id) return;

      if (event.type === 'campaign.completed' || event.type === 'campaign.failed' || event.type === 'campaign.cancelled') {
        setActiveRunId(null);
        setActiveRunProgress(null);
        setStopping(false);
        api<CampaignFull>(`/campaigns/${id}`).then(setCampaign);
      }

      if (event.type === 'campaign.progress' && data.run_id === activeRunId) {
        setActiveRunProgress({
          phase: data.phase,
          step_number: data.step_number,
          total_steps: data.total_steps,
          tokens: data.tokens,
        });
      }
    });
    return unsub;
  }, [activeRunId, id, subscribe]);

  const [stopping, setStopping] = useState(false);

  const stopRun = async () => {
    if (!activeRunId) return;
    setStopping(true);
    try {
      await api(`/runs/${activeRunId}/cancel`, { method: 'POST' });
    } catch (err: any) {
      alert(err.message);
      setStopping(false);
    }
  };

  const isRunning = !!activeRunId;

  const saveConfig = async () => {
    if (!id) return;
    try {
      await api(`/campaigns/${id}/config`, {
        method: 'PUT',
        body: JSON.stringify({
          schedule_cron: editConfig.schedule_cron || null,
          schedule_enabled: editConfig.schedule_enabled,
          schedule_timezone: editConfig.schedule_timezone || null,
          exclusion_config: editConfig.exclusion_config,
          rss_enabled: editConfig.rss_enabled,
          funnel_config: editConfig.funnel_config,
          notification_destinations: editConfig.notification_destinations,
          notification_base_url: editConfig.notification_base_url || null,
          icp_overrides: editConfig.icp_overrides,
        }),
      });
      setConfigDirty(false);
      const data = await api<CampaignFull>(`/campaigns/${id}`);
      setCampaign(data);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Filtered and sorted leads
  const filteredLeads = useMemo(() => {
    if (!campaign) return [];
    let filtered = [...campaign.leads];
    if (leadRunFilter) filtered = filtered.filter((l: any) => l.run_id === leadRunFilter);
    if (leadSegmentFilter) filtered = filtered.filter((l: any) => l.segment === leadSegmentFilter);
    if (leadSearch) {
      const q = leadSearch.toLowerCase();
      filtered = filtered.filter((l: any) =>
        l.company_name.toLowerCase().includes(q) ||
        l.hq_location?.toLowerCase().includes(q) ||
        l.segment?.toLowerCase().includes(q)
      );
    }
    filtered.sort((a: any, b: any) => {
      const av = a[leadSort], bv = b[leadSort];
      const cmp = typeof av === 'number' ? av - bv : String(av || '').localeCompare(String(bv || ''));
      return leadSortDir === 'desc' ? -cmp : cmp;
    });
    return filtered;
  }, [campaign, leadRunFilter, leadSegmentFilter, leadSearch, leadSort, leadSortDir]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  if (!campaign) {
    return <div className="text-center py-20 text-gray-500">Campaign not found</div>;
  }

  const lastRun = campaign.runs[0];
  const segments = [...new Set(campaign.leads.map((l: any) => l.segment))].filter(Boolean);

  return (
    <div>
      {/* Header */}
      <Link to="/campaigns" className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Campaigns
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-brand-50 flex items-center justify-center">
            <Target className="w-6 h-6 text-brand-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
            {campaign.description && <p className="text-sm text-gray-500 mt-0.5 max-w-xl">{campaign.description}</p>}
          </div>
        </div>

        {permissions.canRunCampaign(user?.role) && (
          <div className="flex items-center gap-2">
            {isRunning ? (
              <>
                {activeRunProgress && (
                  <div className="flex items-center gap-2 text-xs text-gray-600 mr-1">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="capitalize">{activeRunProgress.phase || 'Processing'}...</span>
                    {activeRunProgress.step_number != null && activeRunProgress.total_steps != null && (
                      <span className="text-gray-400">
                        {Math.round((activeRunProgress.step_number / activeRunProgress.total_steps) * 100)}%
                      </span>
                    )}
                    {activeRunProgress.tokens?.estimated_cost != null && (
                      <span className="text-gray-400">${activeRunProgress.tokens.estimated_cost.toFixed(3)}</span>
                    )}
                  </div>
                )}
                <button onClick={stopRun} disabled={stopping} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${stopping ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}>
                  <X className="w-4 h-4" /> {stopping ? 'Stopping...' : 'Stop Run'}
                </button>
              </>
            ) : (
              <div className="relative" ref={runMenuRef}>
                <div className="flex">
                  <button onClick={() => triggerRun()} className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-l-lg hover:bg-brand-700 text-sm font-medium">
                    <Play className="w-4 h-4" /> Run All
                  </button>
                  <button onClick={() => setShowRunMenu(!showRunMenu)} className="px-2 py-2 bg-brand-600 text-white rounded-r-lg hover:bg-brand-700 border-l border-brand-500">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
                {showRunMenu && (
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                    <button onClick={() => triggerRun()} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 font-medium">
                      Run All Steps
                    </button>
                    <div className="border-t border-gray-100 my-1" />
                    {(campaign.funnel_config?.steps || []).filter((s: any) => s.enabled).map((s: any) => (
                      <button
                        key={s.id}
                        onClick={() => triggerRun([s.id])}
                        className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 capitalize"
                      >
                        {s.id} only
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Users} label="Total Leads" value={campaign.lead_count} />
        <StatCard icon={TrendingUp} label="Avg Score" value={campaign.avg_score || '—'} />
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Last Run</div>
          <p className="text-sm font-medium text-gray-900">
            {lastRun ? (
              <>
                <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${lastRun.status === 'completed' ? 'bg-green-500' : lastRun.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                {lastRun.status === 'completed' ? `${lastRun.lead_count} leads` : lastRun.status}
                <span className="text-xs text-gray-400 ml-1">{lastRun.completed_at ? formatDate(lastRun.completed_at) : ''}</span>
              </>
            ) : '—'}
          </p>
        </div>
        <StatCard icon={Calendar} label="Schedule" value={campaign.schedule_enabled && campaign.schedule_cron ? `${describeCron(campaign.schedule_cron)} ${tzAbbrFor(campaign.schedule_timezone, timezoneList, serverTzAbbr)}` : 'Not scheduled'} small />
      </div>

      {/* AI Output Console — live streaming */}
      {activeRunId && (
        <div className="mb-4">
          <AILogPanel runId={activeRunId} campaignId={id} />
        </div>
      )}

      {/* Active Run Activity Panel */}
      {activeRunId && (
        <div className="mb-6">
          <ActivityPanel runId={activeRunId} campaignId={id} onClose={() => setActiveRunId(null)} />
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.id === 'leads' && campaign.leads.length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'}`}>
                  {campaign.leads.length}
                </span>
              )}
              {tab.id === 'runs' && campaign.runs.length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'}`}>
                  {campaign.runs.length}
                </span>
              )}
              {tab.id === 'analytics' && insights.filter(i => i.status === 'active').length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  {insights.filter(i => i.status === 'active').length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab
          campaign={campaign}
          orgICP={orgICP}
          icpOverrides={editConfig.icp_overrides}
        />
      )}

      {activeTab === 'leads' && (
        <LeadsTab
          campaign={campaign}
          filteredLeads={filteredLeads}
          leadSearch={leadSearch}
          setLeadSearch={setLeadSearch}
          leadRunFilter={leadRunFilter}
          setLeadRunFilter={setLeadRunFilter}
          leadSegmentFilter={leadSegmentFilter}
          setLeadSegmentFilter={setLeadSegmentFilter}
          leadSort={leadSort}
          setLeadSort={setLeadSort}
          leadSortDir={leadSortDir}
          setLeadSortDir={setLeadSortDir}
          segments={segments}
          selectedLeadIds={selectedLeadIds}
          setSelectedLeadIds={setSelectedLeadIds}
          bulkRunning={bulkRunning}
          onBulkRerun={triggerBulkRerun}
          canRerun={permissions.canRunCampaign(user?.role)}
        />
      )}

      {activeTab === 'runs' && (
        <RunsTab
          campaign={campaign}
          campaignId={id!}
          activeRunId={activeRunId}
          setActiveRunId={setActiveRunId}
          viewLogRunId={viewLogRunId}
          setViewLogRunId={setViewLogRunId}
          canRerun={permissions.canRunCampaign(user?.role)}
          onRerunFromRun={triggerRerunFromRun}
          rerunningRunId={rerunningRunId}
        />
      )}

      {activeTab === 'analytics' && (
        <AnalyticsTab
          analytics={analytics}
          loading={analyticsLoading}
          insights={insights}
          insightsLoading={insightsLoading}
          analyzing={analyzing}
          onAnalyze={async () => {
            if (!id) return;
            setAnalyzing(true);
            try {
              const data = await api(`/campaigns/${id}/analyze`, { method: 'POST' }) as any;
              setInsights(data.insights || []);
              showToast('success', `${(data.insights || []).length} insights generated`);
            } catch (err: any) {
              showToast('error', 'Analysis failed', err?.message);
            }
            setAnalyzing(false);
          }}
          onInsightAction={async (insightId: string, action: 'applied' | 'dismissed') => {
            if (!id) return;
            try {
              await api(`/campaigns/${id}/insights/${insightId}`, { method: 'PATCH', body: JSON.stringify({ status: action }), headers: { 'Content-Type': 'application/json' } });
              setInsights(prev => prev.map(i => i.id === insightId ? { ...i, status: action, applied_at: action === 'applied' ? new Date().toISOString() : i.applied_at } : i));
              showToast('success', action === 'applied' ? 'Insight applied' : 'Insight dismissed');
            } catch (err: any) {
              showToast('error', 'Failed to update insight', err?.message);
            }
          }}
          canEdit={permissions.canEditCampaign(user?.role)}
        />
      )}

      {activeTab === 'configure' && (
        <ConfigureTab
          campaign={campaign}
          setCampaign={setCampaign}
          editConfig={editConfig}
          setEditConfig={setEditConfig}
          configTab={configTab}
          setConfigTab={setConfigTab}
          configDirty={configDirty}
          setConfigDirty={setConfigDirty}
          saveConfig={saveConfig}
          globalExclusions={globalExclusions}
          campaignId={id!}
          canEdit={permissions.canEditCampaign(user?.role)}
          canEditPipeline={permissions.canEditFunnelConfig(user?.role)}
          canEditSchedule={permissions.canEditSchedule(user?.role)}
          canEditExclusions={permissions.canEditExclusions(user?.role)}
          orgICP={orgICP}
          onRunStep={(stepId) => triggerRun([stepId])}
          serverTzAbbr={serverTzAbbr}
          serverTzName={serverTzName}
          timezoneList={timezoneList}
        />
      )}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, small }: { icon: typeof Target; label: string; value: string | number; small?: boolean }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <p className={`font-bold text-gray-900 ${small ? 'text-sm' : 'text-2xl'}`}>{value}</p>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────

type OrgICP = {
  verticals: string[]; tech_signals: string[]; competitors: string[];
  company_context?: any; disqualifiers?: any[]; signal_weights?: any[];
  buyer_personas?: any; geographies?: any; segment_details?: any;
};

function OverviewTab({ campaign, orgICP, icpOverrides }: {
  campaign: CampaignFull;
  orgICP?: OrgICP;
  icpOverrides: Record<string, any> | null;
}) {
  const effectiveICP = (field: string) => icpOverrides?.[field] !== undefined ? icpOverrides[field] : orgICP ? (orgICP as any)[field] : undefined;
  const icpSource = (field: string): 'campaign' | 'global' => icpOverrides?.[field] !== undefined ? 'campaign' : 'global';

  const company = effectiveICP('company_context') || {};
  const verticals: string[] = effectiveICP('verticals') || [];
  const techSignals: string[] = effectiveICP('tech_signals') || [];
  const competitors: string[] = effectiveICP('competitors') || [];
  const disqualifiers: any[] = effectiveICP('disqualifiers') || [];
  const signalWeights: any[] = effectiveICP('signal_weights') || [];

  return (
    <div className="space-y-6">
      {/* Pattern Thesis */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-5 h-5 text-brand-600" />
          <h3 className="font-semibold text-gray-900">Pattern Thesis</h3>
        </div>
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{campaign.pattern_thesis}</p>

        {campaign.value_prop_angle && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Value Prop Angle</h4>
            <p className="text-sm text-gray-700">{campaign.value_prop_angle}</p>
          </div>
        )}
      </div>

      {/* Signals & Anti-patterns | Example Companies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {campaign.target_signals.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Target Signals</h4>
              <div className="flex flex-wrap gap-1.5">
                {campaign.target_signals.map(s => (
                  <span key={s} className="text-xs px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100">{s}</span>
                ))}
              </div>
            </div>
          )}
          {campaign.anti_patterns.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Anti-Patterns</h4>
              <div className="flex flex-wrap gap-1.5">
                {campaign.anti_patterns.map(a => (
                  <span key={a} className="text-xs px-2.5 py-1 bg-red-50 text-red-700 rounded-full border border-red-100">{a}</span>
                ))}
              </div>
            </div>
          )}
          {campaign.target_signals.length === 0 && campaign.anti_patterns.length === 0 && (
            <p className="text-sm text-gray-400">No signals or anti-patterns defined.</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Example Companies ({campaign.example_companies.length})
          </h4>
          {campaign.example_companies.length > 0 ? (
            <div className="space-y-2">
              {campaign.example_companies.map(ex => (
                <div key={ex.domain} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm text-gray-900">{ex.name}</span>
                    <span className="text-xs text-gray-400">{ex.domain}</span>
                  </div>
                  <p className="text-xs text-gray-600">{ex.why_they_fit}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No example companies defined.</p>
          )}
        </div>
      </div>

      {/* Search Patterns */}
      {campaign.search_patterns.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-brand-600" />
            <h4 className="text-xs font-semibold text-gray-500 uppercase">
              Search Patterns ({campaign.search_patterns.length})
            </h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {campaign.search_patterns.map((sp, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                <h5 className="text-sm font-medium text-gray-900 mb-1">{sp.name}</h5>
                <p className="text-xs text-gray-600 mb-3">{sp.description}</p>
                {sp.examples?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    <span className="text-xs text-gray-400 mr-1">Examples:</span>
                    {sp.examples.map((ex, j) => (
                      <span key={j} className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-100">{ex}</span>
                    ))}
                  </div>
                )}
                {sp.keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-gray-400 mr-1">Keywords:</span>
                    {sp.keywords.map((kw, j) => (
                      <span key={j} className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-100">{kw}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ICP Configuration (read-only) */}
      {orgICP && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Crosshair className="w-5 h-5 text-brand-600" />
            <h3 className="font-semibold text-gray-900">ICP Configuration</h3>
            <span className="text-xs text-gray-400 ml-auto">Read-only — edit in Configure tab</span>
          </div>

          {/* Company Context */}
          {(company.company_name || company.product_name) && (
            <div className="mb-4 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-xs font-semibold text-gray-500 uppercase">Company Context</h4>
                <SourceBadge source={icpSource('company_context')} />
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                {company.company_name && <p><span className="text-gray-400 w-24 inline-block">Company:</span> {company.company_name}</p>}
                {company.product_name && <p><span className="text-gray-400 w-24 inline-block">Product:</span> {company.product_name}</p>}
                {company.one_liner && <p><span className="text-gray-400 w-24 inline-block">One-liner:</span> {company.one_liner}</p>}
              </div>
              {(company.value_props?.length > 0 || company.differentiators?.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  {company.value_props?.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400 block mb-1">Value Propositions</span>
                      <ICPTagList items={company.value_props} colorClass="bg-brand-50 text-brand-700" />
                    </div>
                  )}
                  {company.differentiators?.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400 block mb-1">Differentiators</span>
                      <ICPTagList items={company.differentiators} colorClass="bg-violet-50 text-violet-700" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Verticals, Signals, Competitors */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 pb-4 border-b border-gray-100">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Verticals</span>
                <SourceBadge source={icpSource('verticals')} />
              </div>
              <ICPTagList items={verticals} colorClass="bg-brand-50 text-brand-700" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Tech Signals</span>
                <SourceBadge source={icpSource('tech_signals')} />
              </div>
              <ICPTagList items={techSignals} colorClass="bg-emerald-50 text-emerald-700" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Competitors</span>
                <SourceBadge source={icpSource('competitors')} />
              </div>
              <ICPTagList items={competitors} colorClass="bg-red-50 text-red-700" />
            </div>
          </div>

          {/* Disqualifiers */}
          {disqualifiers.length > 0 && (
            <div className="mb-4 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Disqualifiers</span>
                <SourceBadge source={icpSource('disqualifiers')} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {disqualifiers.map((dq: any, i: number) => (
                  <span key={i} className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                    dq.severity === 'hard' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'
                  }`}>
                    <span className="opacity-60">{dq.severity}</span> {dq.signal}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Signal Weights */}
          {signalWeights.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Signal Weights</span>
                <SourceBadge source={icpSource('signal_weights')} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {signalWeights.map((sw: any, i: number) => (
                  <span key={i} className="text-xs px-2.5 py-1 bg-gray-50 text-gray-700 rounded-full border border-gray-200">
                    <span className="font-bold mr-1">{sw.weight}</span>{sw.signal}
                    <span className="text-gray-400 ml-1">{sw.category}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MAX_RERUN_SELECTION = 15;

// ── Leads Tab ─────────────────────────────────────────────────────

function LeadsTab({
  campaign, filteredLeads, leadSearch, setLeadSearch,
  leadRunFilter, setLeadRunFilter, leadSegmentFilter, setLeadSegmentFilter,
  leadSort, setLeadSort, leadSortDir, setLeadSortDir, segments,
  selectedLeadIds, setSelectedLeadIds, bulkRunning, onBulkRerun, canRerun,
}: {
  campaign: CampaignFull;
  filteredLeads: any[];
  leadSearch: string;
  setLeadSearch: (s: string) => void;
  leadRunFilter: string;
  setLeadRunFilter: (s: string) => void;
  leadSegmentFilter: string;
  setLeadSegmentFilter: (s: string) => void;
  leadSort: string;
  setLeadSort: (s: any) => void;
  leadSortDir: 'asc' | 'desc';
  setLeadSortDir: (d: 'asc' | 'desc') => void;
  segments: string[];
  selectedLeadIds: Set<string>;
  setSelectedLeadIds: (ids: Set<string>) => void;
  bulkRunning: boolean;
  onBulkRerun: (leadIds: string[]) => void;
  canRerun: boolean;
}) {
  if (campaign.leads.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
        <Target className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No leads yet. Run the campaign to find prospects.</p>
      </div>
    );
  }

  const hasActiveFilters = leadSearch || leadRunFilter || leadSegmentFilter;
  const clearFilters = () => { setLeadSearch(''); setLeadRunFilter(''); setLeadSegmentFilter(''); };

  const handleSort = (key: string) => {
    if (leadSort === key) setLeadSortDir(leadSortDir === 'desc' ? 'asc' : 'desc');
    else { setLeadSort(key); setLeadSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (leadSort !== col) return <ArrowUpDown className="w-3 h-3 text-gray-300" />;
    return leadSortDir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />;
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search companies, locations..."
            value={leadSearch}
            onChange={e => setLeadSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
        {segments.length > 1 && (
          <select
            value={leadSegmentFilter}
            onChange={e => setLeadSegmentFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
          >
            <option value="">All Segments</option>
            {segments.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {campaign.runs.length > 1 && (
          <select
            value={leadRunFilter}
            onChange={e => setLeadRunFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
          >
            <option value="">All Runs ({campaign.runs.length})</option>
            {campaign.runs.map((r: any, i: number) => (
              <option key={r.id} value={r.id}>
                Run {campaign.runs.length - i} - {r.lead_count} leads
              </option>
            ))}
          </select>
        )}
        {hasActiveFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 bg-gray-100 rounded-lg">
            <X className="w-3 h-3" /> Clear filters
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {filteredLeads.length} of {campaign.leads.length} leads
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {canRerun && (
                <th className="pl-4 pr-2 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.size > 0 && (selectedLeadIds.size === filteredLeads.length || selectedLeadIds.size >= MAX_RERUN_SELECTION)}
                    onChange={() => {
                      if (selectedLeadIds.size > 0) {
                        setSelectedLeadIds(new Set());
                      } else {
                        setSelectedLeadIds(new Set(filteredLeads.slice(0, MAX_RERUN_SELECTION).map((l: any) => l.id)));
                      }
                    }}
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left">
                <button onClick={() => handleSort('company_name')} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase hover:text-gray-700">
                  Company <SortIcon col="company_name" />
                </button>
              </th>
              <th className="px-4 py-3 text-left">
                <button onClick={() => handleSort('segment')} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase hover:text-gray-700">
                  Segment <SortIcon col="segment" />
                </button>
              </th>
              <th className="px-4 py-3 text-left">
                <button onClick={() => handleSort('fit_score')} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase hover:text-gray-700">
                  Score <SortIcon col="fit_score" />
                </button>
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Run</th>
              <th className="px-4 py-3 text-left">
                <button onClick={() => handleSort('created_at')} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase hover:text-gray-700">
                  Added <SortIcon col="created_at" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredLeads.length === 0 ? (
              <tr><td colSpan={canRerun ? 6 : 5} className="px-4 py-8 text-center text-gray-500">No leads match filters</td></tr>
            ) : filteredLeads.map((lead: any) => {
              const runIndex = campaign.runs.findIndex((r: any) => r.id === lead.run_id);
              const runLabel = runIndex >= 0 ? `Run ${campaign.runs.length - runIndex}` : '';
              return (
                <tr key={lead.id} className={`hover:bg-gray-50 transition-colors ${selectedLeadIds.has(lead.id) ? 'bg-brand-50/40' : ''}`}>
                  {canRerun && (
                    <td className="pl-4 pr-2 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={() => {
                          const next = new Set(selectedLeadIds);
                          if (next.has(lead.id)) { next.delete(lead.id); }
                          else if (next.size < MAX_RERUN_SELECTION) { next.add(lead.id); }
                          setSelectedLeadIds(next);
                        }}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link to={`/leads/${lead.id}`} className="font-medium text-gray-900 hover:text-brand-600">
                      {lead.company_name}
                    </Link>
                    {lead.hq_location && <p className="text-xs text-gray-400 mt-0.5">{lead.hq_location}</p>}
                  </td>
                  <td className="px-4 py-3"><SegmentBadge segment={lead.segment} /></td>
                  <td className="px-4 py-3"><ScoreBadge score={lead.fit_score} size="sm" /></td>
                  <td className="px-4 py-3">
                    {runLabel && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${runIndex === 0 ? 'bg-brand-50 text-brand-700 font-medium' : 'bg-gray-100 text-gray-500'}`}>
                        {runLabel}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(lead.updated_at || lead.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bulk action bar */}
      {canRerun && selectedLeadIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-5 py-3 bg-gray-900 text-white rounded-xl shadow-2xl z-50">
          <span className="text-sm font-medium">
            {selectedLeadIds.size} lead{selectedLeadIds.size > 1 ? 's' : ''} selected
            {selectedLeadIds.size >= MAX_RERUN_SELECTION && <span className="text-amber-400 ml-1">(max {MAX_RERUN_SELECTION})</span>}
          </span>
          <div className="w-px h-5 bg-gray-700" />
          <button
            onClick={() => onBulkRerun(Array.from(selectedLeadIds))}
            disabled={bulkRunning}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${bulkRunning ? 'animate-spin' : ''}`} />
            {bulkRunning ? 'Rerunning...' : 'Rerun'}
          </button>
          <button
            onClick={() => setSelectedLeadIds(new Set())}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Runs Tab ──────────────────────────────────────────────────────

function RunsTab({
  campaign, campaignId, activeRunId, setActiveRunId, viewLogRunId, setViewLogRunId,
  canRerun, onRerunFromRun, rerunningRunId,
}: {
  campaign: CampaignFull;
  campaignId: string;
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;
  viewLogRunId: string | null;
  setViewLogRunId: (id: string | null) => void;
  canRerun: boolean;
  onRerunFromRun: (run: any) => void;
  rerunningRunId: string | null;
}) {
  if (campaign.runs.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
        <Activity className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No runs yet. Click "Run Now" to start a campaign run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {campaign.runs.map((run: any, i: number) => {
        const runNumber = campaign.runs.length - i;
        const isViewing = viewLogRunId === run.id;
        const isActive = activeRunId === run.id;
        const isRerun = run.run_type === 'stage_rerun';
        let rerunLeadCount = 0;
        if (isRerun && run.target_lead_ids) {
          try { rerunLeadCount = JSON.parse(run.target_lead_ids).length; } catch {}
        }
        let stepsLabel = '';
        if (isRerun && run.steps_run) {
          try {
            const steps = JSON.parse(run.steps_run) as string[];
            stepsLabel = steps.map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' → ');
          } catch {}
        }

        return (
          <div key={run.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  run.status === 'completed' ? 'bg-green-500' :
                  run.status === 'failed' ? 'bg-red-500' :
                  run.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'
                }`} />
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {isRerun
                      ? `Rerun${rerunLeadCount ? ` (${rerunLeadCount} lead${rerunLeadCount > 1 ? 's' : ''})` : ''}`
                      : `Run ${runNumber}`}
                  </span>
                  {isRerun && stepsLabel && (
                    <span className="ml-2 text-xs text-gray-400">{stepsLabel}</span>
                  )}
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                    run.status === 'completed' ? 'bg-green-50 text-green-700' :
                    run.status === 'failed' ? 'bg-red-50 text-red-700' :
                    run.status === 'running' ? 'bg-blue-50 text-blue-700' : 'bg-yellow-50 text-yellow-700'
                  }`}>{run.status}</span>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-500">
                {run.lead_count > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> {run.lead_count} leads
                  </span>
                )}
                {run.estimated_cost > 0 && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" /> ${run.estimated_cost.toFixed(2)}
                  </span>
                )}
                <span>
                  {run.completed_at ? formatDateTime(run.completed_at) : run.started_at ? formatDateTime(run.started_at) : ''}
                </span>
                <div className="flex items-center gap-1">
                  {run.status === 'running' ? (
                    <button onClick={() => setActiveRunId(run.id)} className="flex items-center gap-1 px-2 py-1 text-blue-600 hover:bg-blue-50 rounded font-medium">
                      <Activity className="w-3.5 h-3.5 animate-pulse" /> Watch Live
                    </button>
                  ) : (
                    <button
                      onClick={() => setViewLogRunId(isViewing ? null : run.id)}
                      className={`flex items-center gap-1 px-2 py-1 rounded ${isViewing ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                      <Eye className="w-3.5 h-3.5" /> {isViewing ? 'Hide Log' : 'View Log'}
                    </button>
                  )}
                  <Link to={`/runs/${run.id}`} className="flex items-center gap-1 px-2 py-1 text-brand-600 hover:bg-brand-50 rounded">
                    <ExternalLink className="w-3.5 h-3.5" /> Detail
                  </Link>
                  {canRerun && run.status !== 'running' && run.status !== 'pending' && (
                    <button
                      onClick={() => onRerunFromRun(run)}
                      disabled={rerunningRunId === run.id}
                      className="flex items-center gap-1 px-2 py-1 text-amber-600 hover:bg-amber-50 rounded"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${rerunningRunId === run.id ? 'animate-spin' : ''}`} />
                      Rerun
                    </button>
                  )}
                </div>
              </div>
            </div>

            {run.error_message && (
              <div className="px-4 pb-3">
                <div className="text-xs text-red-600 bg-red-50 rounded p-2">{run.error_message}</div>
              </div>
            )}

            {isViewing && !isActive && (
              <div className="border-t border-gray-200">
                <ActivityPanel
                  runId={run.id}
                  campaignId={campaignId}
                  onClose={() => setViewLogRunId(null)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────

function AnalyticsTab({ analytics, loading, insights, insightsLoading, analyzing, onAnalyze, onInsightAction, canEdit }: {
  analytics: any; loading: boolean;
  insights: any[]; insightsLoading: boolean; analyzing: boolean;
  onAnalyze: () => void;
  onInsightAction: (insightId: string, action: 'applied' | 'dismissed') => void;
  canEdit: boolean;
}) {
  const feedbackCount = analytics?.feedback?.with_feedback || 0;
  const threshold = 10;

  return (
    <div className="space-y-6">
      {/* Feedback progress toward AI insights */}
      {feedbackCount < threshold && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Feedback Progress</span>
            <span className="text-xs text-gray-500">{feedbackCount} / {threshold}</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all"
              style={{ width: `${Math.min((feedbackCount / threshold) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {threshold - feedbackCount} more feedback {threshold - feedbackCount === 1 ? 'entry' : 'entries'} needed to unlock AI insights
          </p>
        </div>
      )}
      {feedbackCount >= threshold && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="text-sm text-indigo-700">AI insights available &mdash; {feedbackCount} feedback entries collected</span>
        </div>
      )}
      <InsightsPanel
        insights={insights}
        loading={insightsLoading}
        analyzing={analyzing}
        onAnalyze={onAnalyze}
        onAction={onInsightAction}
        canEdit={canEdit}
      />
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
        </div>
      ) : !analytics ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Failed to load analytics or no data available.</p>
        </div>
      ) : (
        <CampaignAnalytics data={analytics} />
      )}
    </div>
  );
}

const INSIGHT_TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  scoring_accuracy: { label: 'Scoring', color: 'bg-blue-100 text-blue-700', icon: 'T' },
  persona_effectiveness: { label: 'Personas', color: 'bg-purple-100 text-purple-700', icon: 'P' },
  vertical_performance: { label: 'Verticals', color: 'bg-green-100 text-green-700', icon: 'V' },
  messaging_patterns: { label: 'Messaging', color: 'bg-amber-100 text-amber-700', icon: 'M' },
  timing_patterns: { label: 'Timing', color: 'bg-cyan-100 text-cyan-700', icon: 'C' },
  competitive_intel: { label: 'Competitive', color: 'bg-rose-100 text-rose-700', icon: 'W' },
  composite: { label: 'Composite', color: 'bg-gray-100 text-gray-700', icon: 'A' },
};

const CONFIDENCE_BADGE: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-500',
};

function InsightsPanel({ insights, loading, analyzing, onAnalyze, onAction, canEdit }: {
  insights: any[]; loading: boolean; analyzing: boolean;
  onAnalyze: () => void;
  onAction: (id: string, action: 'applied' | 'dismissed') => void;
  canEdit: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const activeInsights = insights.filter(i => i.status === 'active');
  const pastInsights = insights.filter(i => i.status !== 'active');

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-brand-600" />
          <h3 className="font-semibold text-gray-900">Campaign Insights</h3>
          {activeInsights.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-100 text-brand-700">{activeInsights.length}</span>
          )}
        </div>
        <button
          onClick={onAnalyze}
          disabled={analyzing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
          {analyzing ? 'Analyzing...' : 'Analyze Feedback'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-500" />
        </div>
      ) : insights.length === 0 ? (
        <div className="text-center py-8">
          <TrendingUp className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No insights yet. Submit feedback on at least 5 leads, then click &ldquo;Analyze Feedback&rdquo; to generate insights.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeInsights.map(insight => (
            <InsightCard
              key={insight.id}
              insight={insight}
              expanded={expandedId === insight.id}
              onToggle={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
              onAction={onAction}
              canEdit={canEdit}
            />
          ))}
          {pastInsights.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">{pastInsights.length} past insight{pastInsights.length !== 1 ? 's' : ''} (applied/dismissed)</summary>
              <div className="space-y-2 mt-2">
                {pastInsights.map(insight => (
                  <InsightCard
                    key={insight.id}
                    insight={insight}
                    expanded={expandedId === insight.id}
                    onToggle={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
                    onAction={onAction}
                    canEdit={false}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight, expanded, onToggle, onAction, canEdit }: {
  insight: any; expanded: boolean;
  onToggle: () => void;
  onAction: (id: string, action: 'applied' | 'dismissed') => void;
  canEdit: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(confirmTimerRef.current), []);
  const typeConfig = INSIGHT_TYPE_CONFIG[insight.insight_type] || INSIGHT_TYPE_CONFIG.composite;
  const confidenceClass = CONFIDENCE_BADGE[insight.confidence] || CONFIDENCE_BADGE.medium;
  const isActive = insight.status === 'active';
  const recommendations: any[] = insight.recommendations || [];

  return (
    <div className={`border rounded-lg ${isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-gray-50 transition-colors">
        <span className={`mt-0.5 flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold ${typeConfig.color}`}>
          {typeConfig.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm text-gray-900 truncate">{insight.title}</span>
            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${confidenceClass}`}>{insight.confidence}</span>
            {insight.status === 'applied' && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-green-100 text-green-700">Applied</span>}
            {insight.status === 'dismissed' && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-500">Dismissed</span>}
          </div>
          <p className="text-xs text-gray-500 line-clamp-2">{insight.summary}</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="mt-3 space-y-3">
            {insight.details && typeof insight.details === 'object' && Object.keys(insight.details).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Analysis</h4>
                <div className="text-sm text-gray-700 space-y-1">
                  {Object.entries(insight.details).map(([key, val]) => (
                    <p key={key}><span className="font-medium">{key.replace(/_/g, ' ')}:</span> {typeof val === 'string' ? val : JSON.stringify(val)}</p>
                  ))}
                </div>
              </div>
            )}

            {recommendations.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Recommendations</h4>
                <ul className="space-y-1.5">
                  {recommendations.map((rec: any, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
                      <div>
                        <span className="text-gray-700">{rec.action}</span>
                        {rec.field && <span className="ml-1 text-xs text-gray-400">({rec.field})</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] text-gray-400">
                Based on {insight.feedback_count} feedback entries &middot; {new Date(insight.created_at).toLocaleDateString()}
              </span>
              {isActive && canEdit && (
                <div className="flex items-center gap-2">
                  {confirming === 'dismiss' ? (
                    <button
                      onClick={() => { onAction(insight.id, 'dismissed'); setConfirming(null); }}
                      className="px-2.5 py-1 text-xs font-medium rounded-md bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                    >
                      Confirm Dismiss?
                    </button>
                  ) : (
                    <button
                      onClick={() => { setConfirming('dismiss'); confirmTimerRef.current = setTimeout(() => setConfirming(c => c === 'dismiss' ? null : c), 3000); }}
                      className="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      Dismiss
                    </button>
                  )}
                  {recommendations.some((r: any) => r.field && r.value !== undefined) && (
                    confirming === 'apply' ? (
                      <button
                        onClick={() => { onAction(insight.id, 'applied'); setConfirming(null); }}
                        className="px-2.5 py-1 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                      >
                        Confirm Apply?
                      </button>
                    ) : (
                      <button
                        onClick={() => { setConfirming('apply'); confirmTimerRef.current = setTimeout(() => setConfirming(c => c === 'apply' ? null : c), 3000); }}
                        className="px-2.5 py-1 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors"
                      >
                        Apply
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Campaign ICP Configuration ───────────────────────────────────

function SourceBadge({ source }: { source: 'global' | 'campaign' }) {
  return source === 'campaign'
    ? <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-100 text-blue-700 uppercase">Campaign Override</span>
    : <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-500 uppercase">Global Default</span>;
}

function ICPTagList({ items, colorClass }: { items: string[]; colorClass: string }) {
  if (!items.length) return <span className="text-xs text-gray-400 italic">None configured</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((v, i) => (
        <span key={i} className={`px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>{v}</span>
      ))}
    </div>
  );
}

function ICPTagEditor({ items, onAdd, onRemove, placeholder, colorClass }: {
  items: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void;
  placeholder: string; colorClass: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((v, i) => (
        <span key={i} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>
          {v}
          <button onClick={() => onRemove(i)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
        </span>
      ))}
      <input type="text" placeholder={placeholder}
        className="px-2.5 py-1 text-xs border border-dashed border-gray-300 rounded-full w-36"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
            onAdd((e.target as HTMLInputElement).value.trim());
            (e.target as HTMLInputElement).value = '';
          }
        }} />
    </div>
  );
}

function CampaignICPSection({ orgICP, overrides, onChange, readOnly }: {
  orgICP: OrgICP;
  overrides: Record<string, any> | null;
  onChange: (overrides: Record<string, any> | null) => void;
  readOnly: boolean;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['company', 'signals']));

  const toggleSection = (key: string) => setExpandedSections(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const isOverridden = (field: string) => overrides?.[field] !== undefined;

  const toggleOverride = (field: string) => {
    if (readOnly) return;
    if (isOverridden(field)) {
      const next = { ...overrides };
      delete next[field];
      onChange(Object.keys(next).length ? next : null);
    } else {
      const globalVal = (orgICP as any)[field];
      const val = Array.isArray(globalVal) ? [...globalVal]
        : typeof globalVal === 'object' && globalVal ? { ...globalVal }
        : globalVal;
      onChange({ ...overrides, [field]: val });
    }
  };

  const updateOverride = (field: string, value: any) => {
    onChange({ ...overrides, [field]: value });
  };

  const effectiveVal = (field: string) => isOverridden(field) ? overrides![field] : (orgICP as any)[field];

  const company = effectiveVal('company_context') || {};
  const disqualifiers: any[] = effectiveVal('disqualifiers') || [];
  const signalWeights: any[] = effectiveVal('signal_weights') || [];

  const SectionHeader = ({ id, title, subtitle, field }: { id: string; title: string; subtitle?: string; field: string }) => (
    <div className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
      <button onClick={() => toggleSection(id)} className="flex items-center gap-2 text-left flex-1 min-w-0">
        {expandedSections.has(id) ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <SourceBadge source={isOverridden(field) ? 'campaign' : 'global'} />
        {!readOnly && (
          <button
            onClick={() => toggleOverride(field)}
            className={`px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
              isOverridden(field)
                ? 'border-gray-300 text-gray-500 hover:bg-gray-50'
                : 'border-blue-300 text-blue-600 hover:bg-blue-50'
            }`}
          >
            {isOverridden(field) ? 'Reset to Global' : 'Customize'}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-sm text-blue-700">
          Campaign-level ICP overrides. Sections using <strong>Global Default</strong> inherit from Settings. Click <strong>Customize</strong> to override for this campaign only.
        </p>
      </div>

      {/* Company Context */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <SectionHeader id="company" title="Company Context" subtitle="Identity used in prompts and outreach" field="company_context" />
        {expandedSections.has('company') && (
          <div className="px-5 pb-5 space-y-3 border-t border-gray-100 pt-4">
            {isOverridden('company_context') && !readOnly ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Company Name</label>
                    <input type="text" value={company.company_name || ''} onChange={e => updateOverride('company_context', { ...company, company_name: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Product Name</label>
                    <input type="text" value={company.product_name || ''} onChange={e => updateOverride('company_context', { ...company, product_name: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">One-Liner</label>
                  <input type="text" value={company.one_liner || ''} onChange={e => updateOverride('company_context', { ...company, one_liner: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Value Propositions</label>
                  <ICPTagEditor items={company.value_props || []}
                    onAdd={v => updateOverride('company_context', { ...company, value_props: [...(company.value_props || []), v] })}
                    onRemove={i => updateOverride('company_context', { ...company, value_props: (company.value_props || []).filter((_: any, j: number) => j !== i) })}
                    placeholder="Add value prop..." colorClass="bg-brand-50 text-brand-700" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Key Differentiators</label>
                  <ICPTagEditor items={company.differentiators || []}
                    onAdd={v => updateOverride('company_context', { ...company, differentiators: [...(company.differentiators || []), v] })}
                    onRemove={i => updateOverride('company_context', { ...company, differentiators: (company.differentiators || []).filter((_: any, j: number) => j !== i) })}
                    placeholder="Add differentiator..." colorClass="bg-violet-50 text-violet-700" />
                </div>
              </>
            ) : (
              <div className="space-y-2 text-sm text-gray-600">
                {company.company_name && <p><span className="text-gray-400 w-28 inline-block">Company:</span> {company.company_name}</p>}
                {company.product_name && <p><span className="text-gray-400 w-28 inline-block">Product:</span> {company.product_name}</p>}
                {company.one_liner && <p><span className="text-gray-400 w-28 inline-block">One-liner:</span> {company.one_liner}</p>}
                {(company.value_props || []).length > 0 && (
                  <div><span className="text-gray-400 text-xs block mb-1">Value Propositions</span><ICPTagList items={company.value_props} colorClass="bg-brand-50 text-brand-700" /></div>
                )}
                {(company.differentiators || []).length > 0 && (
                  <div><span className="text-gray-400 text-xs block mb-1">Differentiators</span><ICPTagList items={company.differentiators} colorClass="bg-violet-50 text-violet-700" /></div>
                )}
                {!company.company_name && !company.product_name && <p className="text-gray-400 italic text-xs">No company context configured in global settings.</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Verticals, Signals & Competitors */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <SectionHeader id="signals" title="Verticals, Signals & Competitors" subtitle="Target industries, tech signals, and competitors" field="verticals" />
        {expandedSections.has('signals') && (
          <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs font-medium text-gray-600">Target Verticals</label>
                <SourceBadge source={isOverridden('verticals') ? 'campaign' : 'global'} />
                {!readOnly && !isOverridden('verticals') && (
                  <button onClick={() => toggleOverride('verticals')} className="text-[10px] text-blue-600 hover:underline">Customize</button>
                )}
                {!readOnly && isOverridden('verticals') && (
                  <button onClick={() => toggleOverride('verticals')} className="text-[10px] text-gray-500 hover:underline">Reset</button>
                )}
              </div>
              {isOverridden('verticals') && !readOnly ? (
                <ICPTagEditor items={overrides!.verticals || []}
                  onAdd={v => updateOverride('verticals', [...(overrides!.verticals || []), v])}
                  onRemove={i => updateOverride('verticals', (overrides!.verticals || []).filter((_: any, j: number) => j !== i))}
                  placeholder="Add vertical..." colorClass="bg-brand-50 text-brand-700" />
              ) : (
                <ICPTagList items={effectiveVal('verticals') || []} colorClass="bg-brand-50 text-brand-700" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs font-medium text-gray-600">Tech Signals</label>
                <SourceBadge source={isOverridden('tech_signals') ? 'campaign' : 'global'} />
                {!readOnly && !isOverridden('tech_signals') && (
                  <button onClick={() => toggleOverride('tech_signals')} className="text-[10px] text-blue-600 hover:underline">Customize</button>
                )}
                {!readOnly && isOverridden('tech_signals') && (
                  <button onClick={() => toggleOverride('tech_signals')} className="text-[10px] text-gray-500 hover:underline">Reset</button>
                )}
              </div>
              {isOverridden('tech_signals') && !readOnly ? (
                <ICPTagEditor items={overrides!.tech_signals || []}
                  onAdd={v => updateOverride('tech_signals', [...(overrides!.tech_signals || []), v])}
                  onRemove={i => updateOverride('tech_signals', (overrides!.tech_signals || []).filter((_: any, j: number) => j !== i))}
                  placeholder="Add signal..." colorClass="bg-emerald-50 text-emerald-700" />
              ) : (
                <ICPTagList items={effectiveVal('tech_signals') || []} colorClass="bg-emerald-50 text-emerald-700" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs font-medium text-gray-600">Competitors</label>
                <SourceBadge source={isOverridden('competitors') ? 'campaign' : 'global'} />
                {!readOnly && !isOverridden('competitors') && (
                  <button onClick={() => toggleOverride('competitors')} className="text-[10px] text-blue-600 hover:underline">Customize</button>
                )}
                {!readOnly && isOverridden('competitors') && (
                  <button onClick={() => toggleOverride('competitors')} className="text-[10px] text-gray-500 hover:underline">Reset</button>
                )}
              </div>
              {isOverridden('competitors') && !readOnly ? (
                <ICPTagEditor items={overrides!.competitors || []}
                  onAdd={v => updateOverride('competitors', [...(overrides!.competitors || []), v])}
                  onRemove={i => updateOverride('competitors', (overrides!.competitors || []).filter((_: any, j: number) => j !== i))}
                  placeholder="Add competitor..." colorClass="bg-red-50 text-red-700" />
              ) : (
                <ICPTagList items={effectiveVal('competitors') || []} colorClass="bg-red-50 text-red-700" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Disqualifiers */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <SectionHeader id="disqualifiers" title="Disqualifiers" subtitle="Hard DQs filter in qualify step, soft ones penalize scoring" field="disqualifiers" />
        {expandedSections.has('disqualifiers') && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-2">
            {isOverridden('disqualifiers') && !readOnly ? (
              <>
                {disqualifiers.map((dq: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg">
                    <select value={dq.severity || 'soft'}
                      onChange={e => {
                        const updated = [...disqualifiers];
                        updated[i] = { ...dq, severity: e.target.value };
                        updateOverride('disqualifiers', updated);
                      }}
                      className={`px-2 py-1 text-xs font-medium rounded border shrink-0 ${
                        dq.severity === 'hard' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'
                      }`}>
                      <option value="hard">Hard</option>
                      <option value="soft">Soft</option>
                    </select>
                    <input type="text" value={dq.signal || ''} placeholder="Signal pattern..."
                      onChange={e => {
                        const updated = [...disqualifiers];
                        updated[i] = { ...dq, signal: e.target.value };
                        updateOverride('disqualifiers', updated);
                      }}
                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded" />
                    <button onClick={() => updateOverride('disqualifiers', disqualifiers.filter((_: any, j: number) => j !== i))}
                      className="p-1 text-gray-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <button onClick={() => updateOverride('disqualifiers', [...disqualifiers, { signal: '', severity: 'soft', notes: '' }])}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-600 border border-dashed border-brand-300 rounded-lg hover:bg-brand-50">
                  <Plus className="w-3 h-3" /> Add Disqualifier
                </button>
              </>
            ) : (
              <div className="space-y-1.5">
                {disqualifiers.length === 0 && <p className="text-xs text-gray-400 italic">No disqualifiers configured.</p>}
                {disqualifiers.map((dq: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 rounded">
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                      dq.severity === 'hard' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>{dq.severity}</span>
                    <span className="text-sm text-gray-700">{dq.signal}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Signal Weights */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <SectionHeader id="signal_weights" title="Signal Weights" subtitle="Prioritize buying signals for scoring (1-10)" field="signal_weights" />
        {expandedSections.has('signal_weights') && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-2">
            {isOverridden('signal_weights') && !readOnly ? (
              <>
                {signalWeights.map((sw: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg">
                    <input type="number" min={1} max={10} value={sw.weight || 5}
                      onChange={e => {
                        const updated = [...signalWeights];
                        updated[i] = { ...sw, weight: parseInt(e.target.value) || 5 };
                        updateOverride('signal_weights', updated);
                      }}
                      className="w-12 px-2 py-1 text-sm font-medium text-center border border-gray-300 rounded shrink-0" />
                    <input type="text" value={sw.signal || ''} placeholder="Signal..."
                      onChange={e => {
                        const updated = [...signalWeights];
                        updated[i] = { ...sw, signal: e.target.value };
                        updateOverride('signal_weights', updated);
                      }}
                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded" />
                    <select value={sw.category || 'buying_intent'}
                      onChange={e => {
                        const updated = [...signalWeights];
                        updated[i] = { ...sw, category: e.target.value };
                        updateOverride('signal_weights', updated);
                      }}
                      className="px-2 py-1 text-xs border border-gray-300 rounded bg-white shrink-0">
                      <option value="buying_intent">Buying Intent</option>
                      <option value="pain_indicator">Pain Indicator</option>
                      <option value="tech_fit">Tech Fit</option>
                      <option value="displacement">Displacement</option>
                      <option value="urgency">Urgency</option>
                      <option value="vertical_fit">Vertical Fit</option>
                    </select>
                    <button onClick={() => updateOverride('signal_weights', signalWeights.filter((_: any, j: number) => j !== i))}
                      className="p-1 text-gray-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <button onClick={() => updateOverride('signal_weights', [...signalWeights, { signal: '', weight: 5, category: 'buying_intent' }])}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-600 border border-dashed border-brand-300 rounded-lg hover:bg-brand-50">
                  <Plus className="w-3 h-3" /> Add Signal Weight
                </button>
              </>
            ) : (
              <div className="space-y-1.5">
                {signalWeights.length === 0 && <p className="text-xs text-gray-400 italic">No signal weights configured.</p>}
                {signalWeights.map((sw: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 rounded">
                    <span className="w-7 text-center text-sm font-bold text-gray-700">{sw.weight}</span>
                    <span className="text-sm text-gray-700 flex-1">{sw.signal}</span>
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{sw.category}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────

function ConfigureTab({
  campaign, setCampaign, editConfig, setEditConfig, configTab, setConfigTab,
  configDirty, setConfigDirty, saveConfig, globalExclusions,
  campaignId, canEdit, canEditPipeline, canEditSchedule, canEditExclusions,
  orgICP, onRunStep, serverTzAbbr, serverTzName, timezoneList,
}: {
  campaign: CampaignFull;
  setCampaign: (c: CampaignFull) => void;
  editConfig: any;
  setEditConfig: (c: any) => void;
  configTab: string;
  setConfigTab: (t: any) => void;
  configDirty: boolean;
  setConfigDirty: (d: boolean) => void;
  saveConfig: () => void;
  globalExclusions: any[];
  campaignId: string;
  canEdit: boolean;
  canEditPipeline: boolean;
  canEditSchedule: boolean;
  canEditExclusions: boolean;
  orgICP?: OrgICP;
  onRunStep?: (stepId: string) => void;
  serverTzAbbr: string;
  serverTzName: string;
  timezoneList: { zone: string; abbreviation: string; utc_offset: string }[];
}) {
  const configTabs = [
    { key: 'definition' as const, label: 'Definition', icon: Target },
    { key: 'funnel' as const, label: 'Pipeline', icon: Layers },
    { key: 'schedule' as const, label: 'Schedule', icon: Clock },
    { key: 'exclusions' as const, label: 'Exclusions', icon: Shield },
    { key: 'feed' as const, label: 'Feed', icon: Rss },
  ];

  return (
    <div className="space-y-4">
      {/* Config summary card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <span className="text-xs text-gray-500">Steps</span>
            <p className="font-medium text-gray-900">
              {(editConfig.funnel_config?.steps || campaign.funnel_config?.steps || []).filter((s: any) => s.enabled).length} active
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Signals</span>
            <p className="font-medium text-gray-900">{campaign.target_signals.length} defined</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Patterns</span>
            <p className="font-medium text-gray-900">{campaign.search_patterns.length} verticals</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Schedule</span>
            <p className="font-medium text-gray-900">{campaign.schedule_enabled && campaign.schedule_cron ? `${describeCron(campaign.schedule_cron)} ${tzAbbrFor(campaign.schedule_timezone, timezoneList, serverTzAbbr)}` : 'Off'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Exclusions</span>
            <p className="font-medium text-gray-900">{globalExclusions.length} global{campaign.exclusion_config?.additions?.length ? ` + ${campaign.exclusion_config.additions.length}` : ''}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {/* Config tabs */}
        <div className="flex items-center border-b border-gray-200 px-4 gap-0.5 overflow-x-auto">
          {configTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setConfigTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
                configTab === tab.key
                  ? 'border-brand-600 text-brand-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* Definition + ICP */}
          {configTab === 'definition' && (
            <div className="space-y-8">
              <DefinitionEditor
                campaign={campaign}
                campaignId={campaignId}
                canEdit={canEdit}
                onSaved={setCampaign}
              />

              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Crosshair className="w-5 h-5 text-brand-600" />
                  <h3 className="font-semibold text-gray-900">ICP Configuration</h3>
                  {configDirty && (
                    <button
                      onClick={saveConfig}
                      className="ml-auto px-4 py-1.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors"
                    >
                      Save ICP Changes
                    </button>
                  )}
                </div>
                {orgICP ? (
                  <CampaignICPSection
                    orgICP={orgICP}
                    overrides={editConfig.icp_overrides}
                    onChange={(overrides) => {
                      setEditConfig({ ...editConfig, icp_overrides: overrides });
                      setConfigDirty(true);
                    }}
                    readOnly={!canEdit}
                  />
                ) : (
                  <div className="text-center py-8 text-sm text-gray-400">Loading ICP configuration...</div>
                )}
              </div>
            </div>
          )}

          {/* Pipeline Funnel */}
          {configTab === 'funnel' && (
            <FunnelConfigurator
              value={editConfig.funnel_config || {
                version: 1,
                steps: [
                  { id: 'discover', enabled: true, model: 'claude-haiku-4-5@20251001', max_tokens: 16384, candidate_limit: 50, source_strategy: 'search_augmented' as const, search_max_queries: 8, search_max_results_per_query: 5 },
                  { id: 'qualify', enabled: true, candidate_limit: 20, qualification_criteria: [], disqualification_criteria: [] },
                  { id: 'enrich', enabled: true, candidate_limit: 15 },
                  { id: 'score', enabled: true, model: 'claude-sonnet-4-6', max_tokens: 2048, candidate_limit: 10 },
                  { id: 'brief', enabled: true, model: 'claude-opus-4-6', max_tokens: 16384, candidate_limit: 10 },
                  { id: 'audit', enabled: true, audit_quality_threshold: 60 },
                ],
              }}
              onChange={(config) => {
                setEditConfig({ ...editConfig, funnel_config: config });
                setConfigDirty(true);
              }}
              dataSources={DATA_SOURCES}
              orgICP={orgICP}
              onRunStep={canEditPipeline ? onRunStep : undefined}
              readOnly={!canEditPipeline}
            />
          )}

          {/* Schedule */}
          {configTab === 'schedule' && (
            canEditSchedule ? (
              <ScheduleTab editConfig={editConfig} setEditConfig={setEditConfig} setConfigDirty={setConfigDirty} serverTzAbbr={serverTzAbbr} serverTzName={serverTzName} timezoneList={timezoneList} />
            ) : (
              <div className="text-center py-8 text-sm text-gray-400">You don't have permission to edit the schedule.</div>
            )
          )}

          {/* Exclusions */}
          {configTab === 'exclusions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-900">Campaign Exclusions</h4>
                {campaign.exclusion_config ? (
                  <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">
                    {(campaign.exclusion_config.additions?.length || 0)} additions, {(campaign.exclusion_config.exemptions?.length || 0)} exemptions
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">Using global exclusions only</span>
                )}
              </div>
              <p className="text-xs text-gray-500">This campaign inherits all global exclusions. You can add campaign-specific exclusions or exempt specific global entries.</p>
              {globalExclusions.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                    Global Exclusions ({globalExclusions.length})
                    {(editConfig.exclusion_config?.exemptions || []).length > 0 && (
                      <span className="text-amber-600 ml-1">- {editConfig.exclusion_config!.exemptions.length} exempted</span>
                    )}
                  </h5>
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {globalExclusions.map(exc => {
                      const isExempt = (editConfig.exclusion_config?.exemptions || []).includes(exc.id);
                      return (
                        <div key={exc.id} className={`flex items-center justify-between px-3 py-2 text-sm ${isExempt ? 'bg-amber-50' : ''}`}>
                          <div className="flex items-center gap-2">
                            <span className={isExempt ? 'text-gray-400 line-through' : 'text-gray-700'}>{exc.company_name}</span>
                            {exc.domain && <span className="text-xs text-gray-400">{exc.domain}</span>}
                          </div>
                          {canEditExclusions && (
                            <button
                              onClick={() => {
                                const current = editConfig.exclusion_config || { additions: [], exemptions: [] };
                                const exemptions = isExempt
                                  ? current.exemptions.filter((id: string) => id !== exc.id)
                                  : [...(current.exemptions || []), exc.id];
                                setEditConfig({ ...editConfig, exclusion_config: { ...current, exemptions } });
                                setConfigDirty(true);
                              }}
                              className={`text-xs px-2 py-0.5 rounded ${isExempt ? 'bg-amber-200 text-amber-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            >
                              {isExempt ? 'Exempted' : 'Exempt'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {canEditExclusions && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Campaign-Specific Additions</h5>
                  {(editConfig.exclusion_config?.additions || []).map((a: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 mb-2">
                      <span className="text-sm text-gray-700">{a.company_name}</span>
                      {a.domain && <span className="text-xs text-gray-400">{a.domain}</span>}
                      {a.category && <ExclusionCategoryBadge category={a.category} />}
                      <button
                        onClick={() => {
                          const additions = [...(editConfig.exclusion_config?.additions || [])];
                          additions.splice(i, 1);
                          setEditConfig({ ...editConfig, exclusion_config: { ...editConfig.exclusion_config!, additions, exemptions: editConfig.exclusion_config?.exemptions || [] } });
                          setConfigDirty(true);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 ml-auto"
                      >Remove</button>
                    </div>
                  ))}
                  <AddExclusionInline onAdd={(company_name, domain, category) => {
                    const current = editConfig.exclusion_config || { additions: [], exemptions: [] };
                    setEditConfig({
                      ...editConfig,
                      exclusion_config: { ...current, additions: [...(current.additions || []), { company_name, domain, category }] },
                    });
                    setConfigDirty(true);
                  }} />
                </div>
              )}
            </div>
          )}

          {/* Notifications (Slack + RSS) */}
          {configTab === 'feed' && (
            <FeedTab
              editConfig={editConfig}
              setEditConfig={setEditConfig}
              setConfigDirty={setConfigDirty}
              campaignId={campaignId}
            />
          )}

          {/* Save button (for pipeline/schedule/exclusions/feed changes) */}
          {configDirty && configTab !== 'definition' && (canEditPipeline || canEditSchedule || canEditExclusions) && (
            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
              <button onClick={saveConfig} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-sm font-medium">
                Save Configuration
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Feed Tab (Notification Destinations + RSS) ───────────────────

const DEST_TYPES = [
  { type: 'webhook' as const, label: 'Webhook', icon: Globe, description: 'Push notifications via HTTP webhook (Slack, Teams, or JSON)', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { type: 'rss' as const, label: 'RSS Feed', icon: Rss, description: 'Pull-based feed for RSS readers and Slack /feed', color: 'bg-orange-50 text-orange-700 border-orange-200' },
];

const FORMAT_OPTIONS = [
  { value: 'slack', label: 'Slack', description: 'Rich cards via incoming webhook' },
  { value: 'teams', label: 'Teams', description: 'Adaptive Card via incoming webhook' },
  { value: 'json', label: 'JSON', description: 'Structured JSON for generic endpoints' },
  { value: 'generic', label: 'Generic', description: 'Flat key-value pairs for any webhook' },
];

function destTypeConfig(type: string) {
  return DEST_TYPES.find(d => d.type === type) || DEST_TYPES[0];
}

function FeedTab({
  editConfig, setEditConfig, setConfigDirty, campaignId,
}: {
  editConfig: any;
  setEditConfig: (c: any) => void;
  setConfigDirty: (d: boolean) => void;
  campaignId: string;
}) {
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});

  const destinations: any[] = editConfig.notification_destinations || [];

  const updateDestinations = (updated: any[]) => {
    setEditConfig({ ...editConfig, notification_destinations: updated });
    setConfigDirty(true);
  };

  const addDestination = (type: 'webhook' | 'rss') => {
    if (type === 'rss' && destinations.some((d: any) => d.type === 'rss')) return;
    const id = crypto.randomUUID();
    const tc = destTypeConfig(type);
    let config: any;
    if (type === 'webhook') config = { url: '', format: 'slack', method: 'POST', headers: {}, secret: '' };
    else config = {};
    const dest: any = {
      id, type, label: tc.label, enabled: true,
      created_at: new Date().toISOString(), config,
    };
    updateDestinations([...destinations, dest]);
    setEditingId(id);
    setShowAddPicker(false);
  };

  const updateDest = (id: string, patch: any) => {
    updateDestinations(destinations.map(d => d.id === id ? { ...d, ...patch } : d));
  };

  const removeDest = (id: string) => {
    updateDestinations(destinations.filter(d => d.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const toggleEnabled = (id: string) => {
    updateDestinations(destinations.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d));
  };

  const testDest = async (id: string) => {
    setTestingId(id);
    setTestResults(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const result = await api<{ ok: boolean; error?: string }>(`/campaigns/${campaignId}/test-notification`, {
        method: 'POST',
        body: JSON.stringify({ destination_id: id }),
      });
      setTestResults(prev => ({ ...prev, [id]: result }));
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, error: err.message } }));
    } finally {
      setTestingId(null);
    }
  };

  const baseUrl = editConfig.notification_base_url || '';
  const effectiveBaseUrl = baseUrl || window.location.origin;

  return (
    <div className="space-y-6">
      {/* Campaign Base URL */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <label className="block text-sm font-medium text-gray-900">Dashboard Base URL</label>
        <input
          type="url"
          value={baseUrl}
          onChange={e => { setEditConfig({ ...editConfig, notification_base_url: e.target.value }); setConfigDirty(true); }}
          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-mono"
          placeholder="https://your-server.example.com"
        />
        <p className="text-xs text-gray-400">
          Used for links in webhook payloads and RSS feeds. Set to your server's public URL or IP. Leave blank to auto-detect.
        </p>
      </div>

      {/* Notification Destinations */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-gray-900">Notification Destinations</h4>
            <p className="text-xs text-gray-500 mt-0.5">Get notified when campaign runs complete, fail, or are cancelled.</p>
          </div>
          <button
            onClick={() => setShowAddPicker(!showAddPicker)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-brand-600 border border-brand-300 rounded-lg hover:bg-brand-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {/* Type picker */}
        {showAddPicker && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {DEST_TYPES.filter(dt => dt.type !== 'rss' || !destinations.some((d: any) => d.type === 'rss')).map(dt => (
              <button
                key={dt.type}
                onClick={() => addDestination(dt.type)}
                className="flex items-start gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-brand-300 hover:shadow-sm transition-all text-left"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${dt.color}`}>
                  <dt.icon className="w-4.5 h-4.5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{dt.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{dt.description}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Destination cards */}
        {destinations.length === 0 && !showAddPicker && (
          <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <Send className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No destinations configured.</p>
            <p className="text-xs text-gray-400 mt-1">Add webhook or RSS destinations to get notified.</p>
          </div>
        )}

        <div className="space-y-3">
          {destinations.map((dest: any) => {
            const tc = destTypeConfig(dest.type);
            const TypeIcon = tc.icon;
            const isEditing = editingId === dest.id;
            const isTesting = testingId === dest.id;
            const testResult = testResults[dest.id];
            const isRss = dest.type === 'rss';
            const hasUrl = isRss || dest.config?.url;
            const rssUrl = isRss ? `${effectiveBaseUrl}/api/campaigns/${campaignId}/rss` : '';
            const formatLabel = !isRss && dest.config?.format ? FORMAT_OPTIONS.find(f => f.value === dest.config.format)?.label || dest.config.format : '';
            const displayUrl = isRss
              ? rssUrl
              : (dest.config?.url || '').replace(/^(https?:\/\/[^\/]+).*/, '$1/...');

            return (
              <div key={dest.id} className={`bg-white border rounded-xl overflow-hidden ${isEditing ? 'border-brand-300 shadow-sm' : 'border-gray-200'}`}>
                {/* Card header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tc.color}`}>
                    <TypeIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{dest.label}</span>
                      {formatLabel && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">{formatLabel}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tc.color}`}>{tc.label}</span>
                    </div>
                    {displayUrl && (
                      <p className="text-xs text-gray-400 truncate mt-0.5 font-mono">{displayUrl}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {testResult && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {testResult.ok ? 'Sent!' : testResult.error || 'Failed'}
                      </span>
                    )}
                    {isRss ? (
                      <button
                        onClick={() => { navigator.clipboard.writeText(rssUrl); setTestResults(prev => ({ ...prev, [dest.id]: { ok: true, error: undefined } })); setTimeout(() => setTestResults(prev => { const n = { ...prev }; delete n[dest.id]; return n; }), 2000); }}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                        title="Copy feed URL"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => testDest(dest.id)}
                        disabled={isTesting || !hasUrl}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30"
                        title="Send test"
                      >
                        <Send className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse' : ''}`} />
                      </button>
                    )}
                    <button
                      onClick={() => toggleEnabled(dest.id)}
                      className={`p-1.5 rounded ${dest.enabled ? 'text-green-600 hover:bg-green-50' : 'text-gray-300 hover:bg-gray-100'}`}
                      title={dest.enabled ? 'Enabled' : 'Disabled'}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingId(isEditing ? null : dest.id)}
                      className={`p-1.5 rounded ${isEditing ? 'text-brand-600 bg-brand-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                      title="Edit"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => removeDest(dest.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Inline editor */}
                {isEditing && (
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Label</label>
                      <input
                        value={dest.label}
                        onChange={e => updateDest(dest.id, { label: e.target.value })}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        placeholder="e.g. #sales-alerts"
                      />
                    </div>

                    {dest.type === 'webhook' && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Payload Format</label>
                          <div className="grid grid-cols-2 gap-2">
                            {FORMAT_OPTIONS.map(f => (
                              <button
                                key={f.value}
                                onClick={() => updateDest(dest.id, { config: { ...dest.config, format: f.value } })}
                                className={`px-3 py-2 rounded-lg border text-sm text-left transition-all ${
                                  dest.config?.format === f.value
                                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                                }`}
                              >
                                <p className="font-medium text-xs">{f.label}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">{f.description}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Webhook URL</label>
                          <input
                            type="url"
                            value={dest.config?.url || ''}
                            onChange={e => updateDest(dest.id, { config: { ...dest.config, url: e.target.value } })}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-mono"
                            placeholder={dest.config?.format === 'slack' ? 'https://hooks.slack.com/services/T.../B.../...' : dest.config?.format === 'teams' ? 'https://outlook.office.com/webhook/...' : 'https://your-endpoint.com/webhook'}
                          />
                          {dest.config?.format === 'slack' && (
                            <p className="text-xs text-gray-400 mt-1">
                              Create an <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:text-brand-700 underline">incoming webhook</a> in your Slack workspace. Notifications appear as color-coded attachment cards.
                            </p>
                          )}
                          {dest.config?.format === 'generic' && (
                            <p className="text-xs text-gray-400 mt-1">
                              Flat key-value payload compatible with Slack <a href="https://slack.com/help/articles/360041352714" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:text-brand-700 underline">Workflow Builder</a> and similar tools. Keys: <code className="bg-gray-100 px-1 rounded">campaign</code>, <code className="bg-gray-100 px-1 rounded">status</code>, <code className="bg-gray-100 px-1 rounded">headline</code>, <code className="bg-gray-100 px-1 rounded">summary</code>, <code className="bg-gray-100 px-1 rounded">lead_count</code>, <code className="bg-gray-100 px-1 rounded">top_leads</code>, <code className="bg-gray-100 px-1 rounded">link</code>
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Method</label>
                            <select
                              value={dest.config?.method || 'POST'}
                              onChange={e => updateDest(dest.id, { config: { ...dest.config, method: e.target.value } })}
                              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                            >
                              <option value="POST">POST</option>
                              <option value="PUT">PUT</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">HMAC Secret</label>
                            <input
                              type="password"
                              value={dest.config?.secret || ''}
                              onChange={e => updateDest(dest.id, { config: { ...dest.config, secret: e.target.value } })}
                              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-mono"
                              placeholder="Optional signing key"
                            />
                          </div>
                        </div>
                        <details className="text-xs">
                          <summary className="text-gray-400 cursor-pointer hover:text-gray-600">Custom Headers</summary>
                          <WebhookHeadersEditor
                            headers={dest.config?.headers || {}}
                            onChange={headers => updateDest(dest.id, { config: { ...dest.config, headers } })}
                          />
                        </details>
                      </>
                    )}

                    {isRss && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <label className="block text-xs text-gray-500 mb-1">Feed URL</label>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-xs bg-white border border-gray-200 rounded px-3 py-2 text-gray-700 truncate">
                            {effectiveBaseUrl}/api/campaigns/{campaignId}/rss
                          </code>
                          <button
                            onClick={() => navigator.clipboard.writeText(`${effectiveBaseUrl}/api/campaigns/${campaignId}/rss`)}
                            className="flex items-center gap-1 px-3 py-2 text-xs border border-gray-200 rounded hover:bg-white transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" /> Copy
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">Uses the Dashboard Base URL configured above for link generation.</p>
                      </div>
                    )}

                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs text-brand-600 hover:text-brand-700"
                    >
                      Done editing
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

function WebhookHeadersEditor({ headers, onChange }: { headers: Record<string, string>; onChange: (h: Record<string, string>) => void }) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const entries = Object.entries(headers);

  const addHeader = () => {
    if (!newKey.trim()) return;
    onChange({ ...headers, [newKey.trim()]: newVal });
    setNewKey('');
    setNewVal('');
  };

  return (
    <div className="mt-2 space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1.5">
          <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{k}</code>
          <code className="text-xs text-gray-500 flex-1 truncate">{v}</code>
          <button onClick={() => { const h = { ...headers }; delete h[k]; onChange(h); }} className="text-xs text-red-400 hover:text-red-600">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input value={newKey} onChange={e => setNewKey(e.target.value)} className="w-36 px-2 py-1 border border-gray-300 rounded text-xs" placeholder="Header name" />
        <input value={newVal} onChange={e => setNewVal(e.target.value)} className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" placeholder="Value" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHeader(); } }} />
        <button onClick={addHeader} className="px-2 py-1 text-xs text-brand-600 border border-brand-300 rounded hover:bg-brand-50">Add</button>
      </div>
    </div>
  );
}

// ── Definition Editor (inline campaign editing) ──────────────────

interface DefinitionForm {
  name: string;
  description: string;
  pattern_thesis: string;
  example_companies: { name: string; domain: string; why_they_fit: string }[];
  target_signals: string[];
  anti_patterns: string[];
  search_patterns: SearchPattern[];
  value_prop_angle: string;
  target_count: number;
}

function DefinitionEditor({ campaign, campaignId, canEdit, onSaved }: {
  campaign: CampaignFull;
  campaignId: string;
  canEdit: boolean;
  onSaved: (c: CampaignFull) => void;
}) {
  const [form, setForm] = useState<DefinitionForm>({
    name: campaign.name,
    description: campaign.description || '',
    pattern_thesis: campaign.pattern_thesis,
    example_companies: campaign.example_companies || [],
    target_signals: campaign.target_signals || [],
    anti_patterns: campaign.anti_patterns || [],
    search_patterns: campaign.search_patterns || [],
    value_prop_angle: campaign.value_prop_angle || '',
    target_count: campaign.target_count,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [expandedPattern, setExpandedPattern] = useState<number | null>(null);

  const update = (patch: Partial<DefinitionForm>) => {
    setForm(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const addTag = (field: 'target_signals' | 'anti_patterns') => {
    const val = (tagInput[field] || '').trim();
    if (!val) return;
    update({ [field]: [...form[field], val] });
    setTagInput({ ...tagInput, [field]: '' });
  };

  const removeTag = (field: 'target_signals' | 'anti_patterns', idx: number) => {
    update({ [field]: form[field].filter((_, i) => i !== idx) });
  };

  const handleSave = async () => {
    if (!form.name || !form.pattern_thesis) {
      alert('Name and pattern thesis are required.');
      return;
    }
    setSaving(true);
    try {
      await api(`/campaigns/${campaignId}`, { method: 'PUT', body: JSON.stringify(form) });
      const refreshed = await api<CampaignFull>(`/campaigns/${campaignId}`);
      onSaved(refreshed);
      setDirty(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          You don't have permission to edit the campaign definition.
        </div>
        <InlineOverview campaign={campaign} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Basics */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Campaign Name *</label>
          <input
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            rows={2}
          />
        </div>
      </div>

      {/* Pattern */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Pattern Thesis *</label>
          <textarea
            value={form.pattern_thesis}
            onChange={(e) => update({ pattern_thesis: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            rows={4}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Value Prop Angle</label>
          <textarea
            value={form.value_prop_angle}
            onChange={(e) => update({ value_prop_angle: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            rows={2}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Target Candidate Count</label>
          <input
            type="number"
            value={form.target_count}
            onChange={(e) => update({ target_count: parseInt(e.target.value) || 12 })}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            min={5} max={50}
          />
        </div>
      </div>

      {/* Target Signals */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Target Signals</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {form.target_signals.map((s, i) => (
            <span key={i} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
              {s}
              <button onClick={() => removeTag('target_signals', i)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={tagInput.target_signals || ''}
            onChange={(e) => setTagInput({ ...tagInput, target_signals: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag('target_signals'); } }}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm"
            placeholder="Add signal..."
          />
          <button onClick={() => addTag('target_signals')} className="px-3 py-1.5 text-sm text-brand-600 border border-brand-300 rounded hover:bg-brand-50">Add</button>
        </div>
      </div>

      {/* Anti-Patterns */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Anti-Patterns</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {form.anti_patterns.map((a, i) => (
            <span key={i} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">
              {a}
              <button onClick={() => removeTag('anti_patterns', i)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={tagInput.anti_patterns || ''}
            onChange={(e) => setTagInput({ ...tagInput, anti_patterns: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag('anti_patterns'); } }}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm"
            placeholder="Add anti-pattern..."
          />
          <button onClick={() => addTag('anti_patterns')} className="px-3 py-1.5 text-sm text-brand-600 border border-brand-300 rounded hover:bg-brand-50">Add</button>
        </div>
      </div>

      {/* Example Companies */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-500 uppercase">Example Companies</label>
          <button onClick={() => update({ example_companies: [...form.example_companies, { name: '', domain: '', why_they_fit: '' }] })} className="text-xs text-brand-600 hover:text-brand-700">+ Add</button>
        </div>
        {form.example_companies.map((ex, idx) => (
          <div key={idx} className="relative bg-gray-50 rounded-lg p-3 mb-2">
            <button onClick={() => update({ example_companies: form.example_companies.filter((_, i) => i !== idx) })} className="absolute top-2 right-2 text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={ex.name} onChange={e => { const u = [...form.example_companies]; u[idx] = { ...u[idx], name: e.target.value }; update({ example_companies: u }); }} className="px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Company" />
              <input value={ex.domain} onChange={e => { const u = [...form.example_companies]; u[idx] = { ...u[idx], domain: e.target.value }; update({ example_companies: u }); }} className="px-2 py-1 border border-gray-300 rounded text-sm" placeholder="domain.com" />
            </div>
            <textarea value={ex.why_they_fit} onChange={e => { const u = [...form.example_companies]; u[idx] = { ...u[idx], why_they_fit: e.target.value }; update({ example_companies: u }); }} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" rows={2} placeholder="Why they fit" />
          </div>
        ))}
      </div>

      {/* Search Patterns (collapsed summary) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-brand-600" />
            <label className="text-xs font-semibold text-gray-500 uppercase">Search Patterns ({form.search_patterns.length})</label>
          </div>
          <button onClick={() => { update({ search_patterns: [...form.search_patterns, { name: '', description: '', examples: [], keywords: [] }] }); setExpandedPattern(form.search_patterns.length); }} className="text-xs text-brand-600 hover:text-brand-700">+ Add Pattern</button>
        </div>
        {form.search_patterns.map((sp, idx) => (
          <div key={idx} className={`border rounded-lg mb-2 overflow-hidden ${expandedPattern === idx ? 'border-brand-200' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2 px-3 py-2 bg-white cursor-pointer" onClick={() => setExpandedPattern(expandedPattern === idx ? null : idx)}>
              <span className="text-xs text-gray-400 font-mono w-4">{idx + 1}.</span>
              <span className="flex-1 text-sm font-medium text-gray-900">{sp.name || 'Untitled'}</span>
              <span className="text-xs text-gray-400">{sp.examples.length} ex, {sp.keywords.length} kw</span>
              <button onClick={e => { e.stopPropagation(); update({ search_patterns: form.search_patterns.filter((_, i) => i !== idx) }); }} className="text-gray-400 hover:text-red-500 p-0.5"><X className="w-3 h-3" /></button>
              {expandedPattern === idx ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
            </div>
            {expandedPattern === idx && (
              <div className="px-3 pb-3 pt-2 space-y-3 border-t border-gray-100">
                <input value={sp.name} onChange={e => { const u = [...form.search_patterns]; u[idx] = { ...u[idx], name: e.target.value }; update({ search_patterns: u }); }} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Pattern name" />
                <textarea value={sp.description} onChange={e => { const u = [...form.search_patterns]; u[idx] = { ...u[idx], description: e.target.value }; update({ search_patterns: u }); }} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" rows={2} placeholder="Description" />
                <InlineTagList label="Examples" tags={sp.examples} color="indigo" onUpdate={tags => { const u = [...form.search_patterns]; u[idx] = { ...u[idx], examples: tags }; update({ search_patterns: u }); }} />
                <InlineTagList label="Keywords" tags={sp.keywords} color="amber" onUpdate={tags => { const u = [...form.search_patterns]; u[idx] = { ...u[idx], keywords: tags }; update({ search_patterns: u }); }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Save */}
      {dirty && (
        <div className="pt-4 border-t border-gray-100 flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Definition'}
          </button>
          <button onClick={() => { setForm({ name: campaign.name, description: campaign.description || '', pattern_thesis: campaign.pattern_thesis, example_companies: campaign.example_companies || [], target_signals: campaign.target_signals || [], anti_patterns: campaign.anti_patterns || [], search_patterns: campaign.search_patterns || [], value_prop_angle: campaign.value_prop_angle || '', target_count: campaign.target_count }); setDirty(false); }} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

function InlineTagList({ label, tags, color, onUpdate }: { label: string; tags: string[]; color: string; onUpdate: (tags: string[]) => void }) {
  const [input, setInput] = useState('');
  const colorMap: Record<string, string> = { indigo: 'bg-indigo-50 text-indigo-700', amber: 'bg-amber-50 text-amber-700', emerald: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-700' };
  const add = () => { const v = input.trim(); if (v && !tags.includes(v)) { onUpdate([...tags, v]); setInput(''); } };
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {tags.map((t, i) => (
          <span key={i} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${colorMap[color] || 'bg-gray-100 text-gray-700'}`}>
            {t}
            <button onClick={() => onUpdate(tags.filter((_, j) => j !== i))} className="hover:opacity-70"><X className="w-2.5 h-2.5" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" placeholder={`Add ${label.toLowerCase()}...`} />
        <button onClick={add} className="px-2 py-1 text-xs text-brand-600 border border-brand-300 rounded hover:bg-brand-50">Add</button>
      </div>
    </div>
  );
}

function InlineOverview({ campaign }: { campaign: CampaignFull }) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Pattern Thesis</h4>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{campaign.pattern_thesis}</p>
      </div>
      {campaign.target_signals.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Target Signals</h4>
          <div className="flex flex-wrap gap-1.5">
            {campaign.target_signals.map(s => <span key={s} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full">{s}</span>)}
          </div>
        </div>
      )}
      {campaign.anti_patterns.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Anti-Patterns</h4>
          <div className="flex flex-wrap gap-1.5">
            {campaign.anti_patterns.map(a => <span key={a} className="text-xs px-2 py-0.5 bg-red-50 text-red-700 rounded-full">{a}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

const EXCLUSION_CATEGORIES = [
  { value: '', label: 'No category', color: '', bg: '' },
  { value: 'existing_customers', label: 'Existing Customer', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  { value: 'competitors', label: 'Competitor', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  { value: 'disqualifying_criteria', label: 'Non-ICP', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  { value: 'previous_rejections', label: 'Previous Rejection', color: 'text-gray-700', bg: 'bg-gray-100 border-gray-300' },
  { value: 'custom', label: 'Custom', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
];

function ExclusionCategoryBadge({ category }: { category: string }) {
  const cat = EXCLUSION_CATEGORIES.find(c => c.value === category);
  if (!cat || !cat.value) return null;
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cat.color} ${cat.bg}`}>{cat.label}</span>;
}

const DAYS_OF_WEEK = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
  { value: '0', label: 'Sun' },
];

function tzAbbrFor(campaignTz: string | null | undefined, timezoneList: { zone: string; abbreviation: string; utc_offset: string }[], serverTzAbbr: string): string {
  if (!campaignTz) return serverTzAbbr;
  const match = timezoneList.find(t => t.zone === campaignTz);
  return match ? match.abbreviation : campaignTz;
}

function ScheduleTab({ editConfig, setEditConfig, setConfigDirty, serverTzAbbr, serverTzName, timezoneList }: { editConfig: any; setEditConfig: (c: any) => void; setConfigDirty: (d: boolean) => void; serverTzAbbr: string; serverTzName: string; timezoneList: { zone: string; abbreviation: string; utc_offset: string }[] }) {
  const parseCronParts = (cron: string) => {
    const parts = cron.split(/\s+/);
    if (parts.length < 5) return { minute: '0', hour: '9', days: [] as string[] };
    const [min, hour, , , dow] = parts;
    let days: string[] = [];
    if (dow === '*') days = ['0', '1', '2', '3', '4', '5', '6'];
    else if (dow === '1-5') days = ['1', '2', '3', '4', '5'];
    else days = dow.split(',');
    return { minute: min, hour, days };
  };

  const { minute, hour, days } = parseCronParts(editConfig.schedule_cron || '0 9 * * 1');

  const buildCron = (newHour: string, newMinute: string, newDays: string[]) => {
    if (newDays.length === 0) return '';
    const sorted = [...newDays].sort((a, b) => parseInt(a) - parseInt(b));
    let dowStr: string;
    if (sorted.length === 7) dowStr = '*';
    else if (sorted.join(',') === '1,2,3,4,5') dowStr = '1-5';
    else dowStr = sorted.join(',');
    return `${newMinute} ${newHour} * * ${dowStr}`;
  };

  const toggleDay = (day: string) => {
    const newDays = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
    const cron = buildCron(hour, minute, newDays);
    setEditConfig({ ...editConfig, schedule_cron: cron, schedule_enabled: cron ? true : editConfig.schedule_enabled });
    setConfigDirty(true);
  };

  const setTime = (h: string, m: string) => {
    setEditConfig({ ...editConfig, schedule_cron: buildCron(h, m, days) });
    setConfigDirty(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-900">Campaign Schedule</h4>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={editConfig.schedule_enabled}
            onChange={e => { setEditConfig({ ...editConfig, schedule_enabled: e.target.checked }); setConfigDirty(true); }}
            className="rounded border-gray-300"
          />
          Enabled
        </label>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-2">Run on days</label>
        <div className="flex gap-1.5">
          {DAYS_OF_WEEK.map(d => (
            <button key={d.value} onClick={() => toggleDay(d.value)}
              className={`w-10 h-10 rounded-lg text-xs font-medium border transition-colors ${days.includes(d.value) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
            >{d.label}</button>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={() => { setEditConfig({ ...editConfig, schedule_cron: buildCron(hour, minute, ['1','2','3','4','5']) }); setConfigDirty(true); }} className="text-xs text-brand-600 hover:text-brand-700">Weekdays</button>
          <span className="text-gray-300">|</span>
          <button onClick={() => { setEditConfig({ ...editConfig, schedule_cron: buildCron(hour, minute, ['0','1','2','3','4','5','6']) }); setConfigDirty(true); }} className="text-xs text-brand-600 hover:text-brand-700">Every day</button>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-2">Run at time</label>
        <div className="flex items-center gap-2">
          <select value={hour} onChange={e => setTime(e.target.value, minute)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            {Array.from({ length: 24 }, (_, i) => {
              const ampm = i >= 12 ? 'PM' : 'AM';
              const h12 = i % 12 || 12;
              return <option key={i} value={String(i)}>{h12}:00 {ampm}</option>;
            })}
          </select>
          <span className="text-gray-400">:</span>
          <select value={minute} onChange={e => setTime(hour, e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            {['0', '15', '30', '45'].map(m => <option key={m} value={m}>{m.padStart(2, '0')}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-2">Timezone</label>
        <select
          value={editConfig.schedule_timezone || ''}
          onChange={e => { setEditConfig({ ...editConfig, schedule_timezone: e.target.value }); setConfigDirty(true); }}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">Server default ({serverTzAbbr || serverTzName})</option>
          {timezoneList.map(tz => (
            <option key={tz.zone} value={tz.zone}>{tz.zone.replace(/_/g, ' ')} ({tz.abbreviation}, {tz.utc_offset})</option>
          ))}
        </select>
      </div>
      {editConfig.schedule_cron && (
        <div className="bg-brand-50 border border-brand-100 rounded-lg p-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-brand-600 flex-shrink-0" />
          <span className="text-sm text-brand-800 font-medium">
            {describeCron(editConfig.schedule_cron)}
            <span className="text-brand-500 font-normal"> ({tzAbbrFor(editConfig.schedule_timezone, timezoneList, serverTzAbbr)})</span>
          </span>
        </div>
      )}
      <details className="text-xs">
        <summary className="text-gray-400 cursor-pointer hover:text-gray-600">Advanced: edit cron expression directly</summary>
        <div className="mt-2">
          <input value={editConfig.schedule_cron} onChange={e => { setEditConfig({ ...editConfig, schedule_cron: e.target.value }); setConfigDirty(true); }}
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm font-mono" placeholder="0 14 * * 1" />
          <p className="text-xs text-gray-400 mt-1">Format: minute hour day-of-month month day-of-week</p>
        </div>
      </details>
    </div>
  );
}

function AddExclusionInline({ onAdd }: { onAdd: (name: string, domain: string, category: string) => void }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [category, setCategory] = useState('');

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), domain.trim(), category);
    setName(''); setDomain(''); setCategory('');
  };

  return (
    <div className="flex items-center gap-2">
      <input value={name} onChange={e => setName(e.target.value)} className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm" placeholder="Company name" onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} />
      <input value={domain} onChange={e => setDomain(e.target.value)} className="w-32 px-3 py-1.5 border border-gray-300 rounded text-sm" placeholder="domain.com" onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} />
      <select value={category} onChange={e => setCategory(e.target.value)} className="w-40 px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
        {EXCLUSION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <button onClick={handleAdd} className="px-3 py-1.5 text-sm text-brand-600 border border-brand-300 rounded hover:bg-brand-50">Add</button>
    </div>
  );
}

// ── Campaign Analytics ────────────────────────────────────────────

function HealthBadge({ health }: { health: string }) {
  const config: Record<string, { label: string; color: string }> = {
    trending_up: { label: 'Trending Up', color: 'bg-emerald-50 text-emerald-700' },
    trending_down: { label: 'Trending Down', color: 'bg-red-50 text-red-700' },
    stable: { label: 'Stable', color: 'bg-blue-50 text-blue-700' },
  };
  const c = config[health] || { label: health, color: 'bg-gray-50 text-gray-600' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.color}`}>{c.label}</span>;
}

function CampaignAnalytics({ data }: { data: any }) {
  const { score_trends, feedback, cost, score_distribution, health } = data;

  return (
    <div className="space-y-6">
      {/* Health + summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Activity className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-xs text-gray-500">Health</span>
          </div>
          <HealthBadge health={health} />
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-xs text-gray-500">Feedback Rate</span>
          </div>
          <p className="text-lg font-semibold text-gray-900">{feedback.feedback_rate}%</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Check className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs text-gray-500">Conversion Rate</span>
          </div>
          <p className="text-lg font-semibold text-gray-900">{feedback.conversion_rate}%</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <DollarSign className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs text-gray-500">Cost/Lead</span>
          </div>
          <p className="text-lg font-semibold text-gray-900">${cost.cost_per_lead.toFixed(2)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Score Trend (per run)</h4>
          {score_trends.length < 2 ? (
            <p className="text-xs text-gray-400 py-8 text-center">Need at least 2 completed runs for trend data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={score_trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={(d: string) => formatDateShort(d)} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d: any) => formatDate(d)} formatter={(v: any, name: any) => [v, name === 'avg_score' ? 'Avg Score' : name]} />
                <Line type="monotone" dataKey="avg_score" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="max_score" stroke="#10b981" strokeWidth={1} strokeDasharray="4 2" dot={false} />
                <Line type="monotone" dataKey="min_score" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Lead Volume (per run)</h4>
          {score_trends.length < 1 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No completed runs yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={score_trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={(d: string) => formatDateShort(d)} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d: any) => formatDate(d)} />
                <Bar dataKey="lead_count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Feedback Breakdown</h4>
          <div className="space-y-2">
            <FeedbackBar label="Booked" count={feedback.booked} total={feedback.with_feedback} color="bg-emerald-500" />
            <FeedbackBar label="Positive Response" count={feedback.positive_outcomes - feedback.booked} total={feedback.with_feedback} color="bg-blue-500" />
            <FeedbackBar label="Bad Fit" count={feedback.bad_fit} total={feedback.with_feedback} color="bg-red-400" />
            <FeedbackBar label="No Feedback" count={feedback.total_leads - feedback.with_feedback} total={feedback.total_leads} color="bg-gray-300" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="text-gray-500">Avg score (positive): <span className="font-medium text-gray-900">{feedback.avg_score_positive || '--'}</span></div>
            <div className="text-gray-500">Avg score (bad fit): <span className="font-medium text-gray-900">{feedback.avg_score_bad || '--'}</span></div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Cost per Run</h4>
          {score_trends.length < 1 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No cost data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={score_trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={(d: string) => formatDateShort(d)} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(d: any) => formatDate(d)} formatter={(v: any) => [`$${(v as number).toFixed(2)}`, 'Cost']} />
                <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Score distribution */}
      {score_distribution.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Score Distribution</h4>
          <div className="flex items-end gap-1 h-24">
            {score_distribution.map((b: any) => {
              const maxCount = Math.max(...score_distribution.map((d: any) => d.count));
              const height = maxCount > 0 ? (b.count / maxCount) * 100 : 0;
              return (
                <div key={b.bucket} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-gray-500">{b.count}</span>
                  <div className="w-full bg-indigo-400 rounded-t" style={{ height: `${height}%`, minHeight: b.count > 0 ? 4 : 0 }} />
                  <span className="text-[10px] text-gray-400">{b.bucket}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cost summary */}
      <div className="bg-gray-50 rounded-xl p-5 grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-xs text-gray-500">Total Cost</span>
          <p className="font-semibold text-gray-900">${cost.total_cost.toFixed(2)}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Total Leads</span>
          <p className="font-semibold text-gray-900">{cost.total_leads}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Total Tokens</span>
          <p className="font-semibold text-gray-900">{cost.total_tokens.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

function FeedbackBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-600 w-32 truncate">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-16 text-right">{count} ({pct}%)</span>
    </div>
  );
}

function describeCron(expr: string): string {
  const parts = expr.split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, , , dow] = parts;
  const dayNames: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };
  let timeStr = '';
  const h = parseInt(hour);
  if (!isNaN(h)) {
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    timeStr = `${h12}:${min.padStart(2, '0')}${ampm}`;
  } else {
    timeStr = `${hour}:${min}`;
  }
  if (dow === '*') return `Daily at ${timeStr}`;
  if (dow === '1-5') return `Weekdays at ${timeStr}`;
  const days = dow.split(',').map(d => dayNames[d] || d).join(', ');
  return `${days} at ${timeStr}`;
}
