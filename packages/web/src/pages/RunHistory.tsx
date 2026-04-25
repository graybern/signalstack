import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, Target,
  DollarSign, ChevronDown, ChevronUp, Calendar, Filter,
  TrendingUp, Users, Loader2, Activity, Eye,
} from 'lucide-react';
import { ScoreBadge, SegmentBadge } from '../components/ScoreBadge';
import { TokenCounter } from '../components/TokenCounter';
import { useEventStream } from '../hooks/useEventStream';
import { ActivityPanel } from '../components/ActivityPanel';

interface RunStats {
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  success_rate: number;
  total_leads: number;
  avg_leads_per_run: number;
  total_cost: number;
  avg_cost_per_run: number;
}

interface Run {
  id: string;
  status: string;
  run_type: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  triggered_by_name: string | null;
  lead_count: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  model_used: string | null;
  progress_json: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface UpcomingRun {
  campaign_id: string;
  campaign_name: string;
  schedule_cron: string;
  last_run_status: string | null;
  last_run_at: string | null;
}

interface ProgressData {
  phase: string;
  current_company?: string;
  step_number: number;
  total_steps: number;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost: number;
  };
}

export function RunHistory() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedLeads, setExpandedLeads] = useState<any[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [liveProgress, setLiveProgress] = useState<Record<string, ProgressData>>({});
  const [activityRunId, setActivityRunId] = useState<string | null>(null);

  // Filters
  const [filterType, setFilterType] = useState('');
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);

  // SSE for live progress
  const { subscribe } = useEventStream({
    types: ['pipeline.progress', 'campaign.progress', 'pipeline.completed', 'campaign.completed', 'pipeline.failed', 'campaign.failed', 'pipeline.started', 'campaign.started'],
  });

  const loadRuns = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterType) params.set('type', filterType);
      if (filterCampaign) params.set('campaign_id', filterCampaign);
      if (filterStatus) params.set('status', filterStatus);

      const [data, upcomingData] = await Promise.all([
        api(`/runs?${params}`),
        api('/runs/upcoming'),
      ]);
      setRuns(data.runs || []);
      setStats(data.stats || null);
      setUpcoming(upcomingData || []);
    } catch (err) {
      console.error('Failed to load runs:', err);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterCampaign, filterStatus]);

  useEffect(() => {
    api('/campaigns').then(data => setCampaigns(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadRuns();
    // Slower polling when SSE is active (SSE handles real-time, poll is fallback)
    const interval = setInterval(loadRuns, 60000);
    return () => clearInterval(interval);
  }, [loadRuns]);

  // Subscribe to progress events
  useEffect(() => {
    const unsubProgress = subscribe('*', (event) => {
      const { type, data } = event;
      if (type === 'pipeline.progress' || type === 'campaign.progress') {
        setLiveProgress(prev => ({
          ...prev,
          [data.run_id]: {
            phase: data.phase,
            current_company: data.current_company,
            step_number: data.step_number,
            total_steps: data.total_steps,
            tokens: data.tokens,
          },
        }));
      }
      if (type.endsWith('.completed') || type.endsWith('.failed') || type.endsWith('.started')) {
        // Refresh runs list on state changes
        loadRuns();
        if (type.endsWith('.completed') || type.endsWith('.failed')) {
          setLiveProgress(prev => {
            const next = { ...prev };
            delete next[data.run_id];
            return next;
          });
        }
      }
    });
    return unsubProgress;
  }, [subscribe, loadRuns]);

  const toggleExpand = async (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
      setExpandedLeads([]);
      return;
    }
    setExpandedRun(runId);
    setLoadingLeads(true);
    try {
      const data = await api(`/runs/${runId}`);
      setExpandedLeads(data.leads || []);
    } catch { setExpandedLeads([]); }
    finally { setLoadingLeads(false); }
  };

  const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'pending');
  const completedRuns = runs.filter(r => r.status === 'completed' || r.status === 'failed');

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Run History</h1>
          <p className="text-sm text-gray-500">Operations log — scheduled runs, campaign executions, and import processing.</p>
        </div>
        <button onClick={loadRuns} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          <StatCard icon={<Activity className="w-4 h-4 text-blue-600" />} label="Total Runs" value={stats.total_runs} />
          <StatCard icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} label="Success Rate" value={`${stats.success_rate}%`} />
          <StatCard icon={<Users className="w-4 h-4 text-indigo-600" />} label="Avg Leads/Run" value={stats.avg_leads_per_run} />
          <StatCard icon={<DollarSign className="w-4 h-4 text-amber-600" />} label="Total Cost" value={`$${stats.total_cost.toFixed(2)}`} />
          <StatCard icon={<DollarSign className="w-4 h-4 text-purple-600" />} label="Avg Cost/Run" value={`$${stats.avg_cost_per_run.toFixed(2)}`} />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <Filter className="w-4 h-4 text-gray-400" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
          <option value="">All Types</option>
          <option value="campaign">Campaign</option>
          <option value="pipeline">Pipeline</option>
          <option value="import">Import</option>
          <option value="enrichment">Enrichment</option>
        </select>
        <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
          <option value="">All Campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        {(filterType || filterCampaign || filterStatus) && (
          <button onClick={() => { setFilterType(''); setFilterCampaign(''); setFilterStatus(''); }} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
        )}
      </div>

      {/* Upcoming section */}
      {upcoming.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" /> Upcoming Scheduled Runs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {upcoming.map(u => (
              <Link key={u.campaign_id} to={`/campaigns/${u.campaign_id}`} className="bg-white border border-gray-200 rounded-lg p-4 hover:border-brand-200 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-3.5 h-3.5 text-brand-500" />
                  <span className="text-sm font-medium text-gray-900">{u.campaign_name}</span>
                </div>
                <p className="text-xs text-gray-500 font-mono mb-1">{u.schedule_cron}</p>
                {u.last_run_at && (
                  <p className="text-[10px] text-gray-400">Last run: {new Date(u.last_run_at).toLocaleDateString()} ({u.last_run_status})</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Active runs */}
      {activeRuns.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" /> Active Runs ({activeRuns.length})
          </h2>
          <div className="space-y-2">
            {activeRuns.map(run => (
              <div key={run.id}>
                <ActiveRunCard run={run} liveProgress={liveProgress[run.id]} onViewActivity={() => setActivityRunId(activityRunId === run.id ? null : run.id)} />
                {activityRunId === run.id && (
                  <div className="mt-2">
                    <ActivityPanel runId={run.id} onClose={() => setActivityRunId(null)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed runs */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-gray-400" /> Completed ({completedRuns.length})
        </h2>

        {completedRuns.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No completed runs yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Campaign</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Leads</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tokens</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {completedRuns.map(run => (
                  <CompletedRunRow
                    key={run.id}
                    run={run}
                    expanded={expandedRun === run.id}
                    leads={expandedRun === run.id ? expandedLeads : []}
                    loadingLeads={expandedRun === run.id && loadingLeads}
                    onToggle={() => toggleExpand(run.id)}
                    onViewLog={() => setActivityRunId(activityRunId === run.id ? null : run.id)}
                    showingLog={activityRunId === run.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-gray-500">{label}</span></div>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

const PHASE_LABELS: Record<string, string> = {
  research: 'Researching',
  enrichment: 'Enriching',
  scoring: 'Scoring',
  brief_generation: 'Generating Briefs',
  processing: 'Processing',
};

function ActiveRunCard({ run, liveProgress, onViewActivity }: { run: Run; liveProgress?: ProgressData; onViewActivity?: () => void }) {
  // Prefer live SSE progress over polled progress_json
  const fallbackProgress = run.progress_json ? JSON.parse(run.progress_json) : null;
  const progress = liveProgress || fallbackProgress;

  const stepNumber = progress?.step_number || 0;
  const totalSteps = progress?.total_steps || 1;
  const pct = Math.min(Math.round((stepNumber / totalSteps) * 100), 100);

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-center gap-4">
        <Loader2 className="w-5 h-5 text-amber-600 animate-spin shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-900">
              {run.campaign_name || run.run_type || 'Pipeline Run'}
            </span>
            <RunTypeBadge type={run.run_type} />
          </div>
          {progress && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-amber-700">
                  {PHASE_LABELS[progress.phase] || progress.phase}
                </span>
                {progress.current_company && (
                  <span className="text-xs text-gray-600">{progress.current_company}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 max-w-48 h-1.5 bg-amber-200 rounded-full">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-500">{stepNumber}/{totalSteps}</span>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-1">
            Started {run.started_at ? new Date(run.started_at).toLocaleTimeString() : '—'}
            {run.triggered_by_name && ` by ${run.triggered_by_name}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {run.lead_count > 0 && (
            <span className="text-sm font-medium text-gray-700">{run.lead_count} leads</span>
          )}
          {progress?.tokens && progress.tokens.total_tokens > 0 && (
            <TokenCounter
              input_tokens={progress.tokens.input_tokens}
              output_tokens={progress.tokens.output_tokens}
              estimated_cost={progress.tokens.estimated_cost}
            />
          )}
          {onViewActivity && (
            <button onClick={onViewActivity} className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800 mt-1">
              <Eye className="w-3 h-3" /> View Activity
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CompletedRunRow({ run, expanded, leads, loadingLeads, onToggle, onViewLog, showingLog }: {
  run: Run;
  expanded: boolean;
  leads: any[];
  loadingLeads: boolean;
  onToggle: () => void;
  onViewLog?: () => void;
  showingLog?: boolean;
}) {
  const totalTokens = (run.input_tokens || 0) + (run.output_tokens || 0);

  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3">{statusIcon(run.status)}</td>
        <td className="px-4 py-3"><RunTypeBadge type={run.run_type} /></td>
        <td className="px-4 py-3">
          {run.campaign_name ? (
            <Link to={`/campaigns/${run.campaign_id}`} onClick={e => e.stopPropagation()} className="text-brand-600 hover:text-brand-700 font-medium">
              {run.campaign_name}
            </Link>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-700">{run.lead_count || 0}</td>
        <td className="px-4 py-3 text-gray-500 text-xs font-mono">{totalTokens > 0 ? formatTokens(totalTokens) : '—'}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">{run.estimated_cost > 0 ? `$${run.estimated_cost.toFixed(2)}` : '—'}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">{run.started_at ? new Date(run.started_at).toLocaleString() : '—'}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">{run.triggered_by_name || 'System'}</td>
        <td className="px-4 py-3 flex items-center gap-1">
          {onViewLog && (
            <button onClick={e => { e.stopPropagation(); onViewLog(); }} className={`p-1 rounded hover:bg-gray-100 ${showingLog ? 'text-brand-600' : 'text-gray-400'}`} title="View Activity Log">
              <Eye className="w-3.5 h-3.5" />
            </button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </td>
      </tr>
      {run.error_message && expanded && (
        <tr>
          <td colSpan={9} className="px-4 py-2 bg-red-50">
            <p className="text-xs text-red-600"><AlertCircle className="w-3 h-3 inline mr-1" />{run.error_message}</p>
          </td>
        </tr>
      )}
      {expanded && !run.error_message && (
        <tr>
          <td colSpan={9} className="px-0">
            {loadingLeads ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-brand-500" /></div>
            ) : leads.length === 0 ? (
              <div className="px-6 py-4 text-xs text-gray-400">No leads in this run.</div>
            ) : (
              <div className="bg-gray-50 px-6 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-2">{leads.length} leads</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {leads.slice(0, 12).map((lead: any) => (
                    <Link key={lead.id} to={`/leads/${lead.id}`} className="bg-white border border-gray-200 rounded-lg p-3 hover:border-brand-200 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900 truncate">{lead.company_name}</span>
                        <ScoreBadge score={lead.fit_score} />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <SegmentBadge segment={lead.segment} />
                        {lead.hq_location && <span className="truncate">{lead.hq_location}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
                {leads.length > 12 && (
                  <p className="text-xs text-gray-400 mt-2">+{leads.length - 12} more leads</p>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
      {showingLog && (
        <tr>
          <td colSpan={9} className="px-4 py-3 bg-gray-50">
            <ActivityPanel runId={run.id} onClose={onViewLog} />
          </td>
        </tr>
      )}
    </>
  );
}

function RunTypeBadge({ type }: { type: string | null }) {
  const styles: Record<string, string> = {
    campaign: 'bg-brand-50 text-brand-700',
    pipeline: 'bg-blue-50 text-blue-700',
    import: 'bg-indigo-50 text-indigo-700',
    enrichment: 'bg-purple-50 text-purple-700',
  };
  const label = type || 'pipeline';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${styles[label] || 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
    case 'running': return <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />;
    case 'pending': return <Clock className="w-4 h-4 text-gray-400" />;
    default: return <AlertCircle className="w-4 h-4 text-gray-300" />;
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
