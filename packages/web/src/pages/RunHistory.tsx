import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { formatDateTime, formatDateTimeWithWeekday, formatTime } from '../utils/dates';
import { useAuth } from '../hooks/useAuth';
import {
  Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, Target,
  DollarSign, ChevronDown, ChevronUp, Calendar, Filter, Download,
  TrendingUp, Users, Loader2, Activity, Eye, Trash2, AlertTriangle,
  X, Hash, PlayCircle, ExternalLink,
} from 'lucide-react';
import { ScoreBadge, SegmentBadge } from '../components/ScoreBadge';
import { TokenCounter } from '../components/TokenCounter';
import { useEventStream } from '../hooks/useEventStream';
import { ActivityPanel } from '../components/ActivityPanel';
import { ResumeModal, classifyError } from '../components/ResumeModal';
import type { ResumeAnalysis } from '../components/ResumeModal';

interface RunStats {
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  missed_runs: number;
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
  run_number: number;
  target_lead_ids: string | null;
  steps_run: string | null;
  resumed_from_run_id: string | null;
  resumed_by_run_id: string | null;
  resumed_by_status: string | null;
}

interface UpcomingRun {
  campaign_id: string;
  campaign_name: string;
  schedule_cron: string;
  last_run_status: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_expected_at: string | null;
  is_overdue: boolean;
  missed_count: number;
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
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'superadmin';
  const canRerun = user?.role && ['member', 'operator', 'admin', 'superadmin'].includes(user.role);

  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedLeads, setExpandedLeads] = useState<any[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [liveProgress, setLiveProgress] = useState<Record<string, ProgressData>>({});
  const [activityRunId, setActivityRunId] = useState<string | null>(null);
  const [rerunningRunId, setRerunningRunId] = useState<string | null>(null);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [resumeModal, setResumeModal] = useState<{ run: Run; analysis: ResumeAnalysis } | null>(null);

  // Selection for bulk delete
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single' | 'bulk'; ids: string[]; leadCount: number; chainWarning?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState('');
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterTriggeredBy, setFilterTriggeredBy] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);

  const { subscribe } = useEventStream({
    types: ['pipeline.progress', 'campaign.progress', 'pipeline.completed', 'campaign.completed', 'pipeline.failed', 'campaign.failed', 'pipeline.started', 'campaign.started'],
  });

  const loadRuns = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterType) params.set('type', filterType);
      if (filterCampaign) params.set('campaign_id', filterCampaign);
      if (filterStatus) params.set('status', filterStatus);
      if (filterDateFrom) params.set('date_from', filterDateFrom);
      if (filterDateTo) params.set('date_to', filterDateTo);

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
  }, [filterType, filterCampaign, filterStatus, filterDateFrom, filterDateTo]);

  useEffect(() => {
    api('/campaigns').then(data => setCampaigns(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : [])).catch(() => {});
  }, []);

  const handleResumeFromRun = async (run: Run) => {
    if (!run.campaign_id) return;
    setResumingRunId(run.id);
    try {
      const analysis = await api(`/runs/${run.id}/resume-analysis`) as ResumeAnalysis;
      if (!analysis.resumable) {
        alert(`Cannot resume: ${analysis.reason}`);
        return;
      }
      setResumeModal({ run, analysis });
    } catch (err: any) {
      alert(err.message || 'Failed to analyze run for resume');
    } finally {
      setResumingRunId(null);
    }
  };

  const confirmResume = async () => {
    if (!resumeModal) return;
    setResumingRunId(resumeModal.run.id);
    try {
      await api(`/runs/${resumeModal.run.id}/resume`, { method: 'POST' });
      setResumeModal(null);
      loadRuns();
    } catch (err: any) {
      alert(err.message || 'Failed to resume run');
    } finally {
      setResumingRunId(null);
    }
  };

  const handleRerunFromRun = async (run: Run) => {
    if (!run.campaign_id) return;
    setRerunningRunId(run.id);
    try {
      let leadIds: string[];
      if (run.run_type === 'stage_rerun' && run.target_lead_ids) {
        leadIds = JSON.parse(run.target_lead_ids);
      } else {
        const data = await api(`/leads?campaign_id=${run.campaign_id}&limit=999`) as any;
        leadIds = (data.leads || []).map((l: any) => l.id);
      }
      if (leadIds.length === 0) { alert('No leads to rerun'); return; }
      await api(`/campaigns/${run.campaign_id}/run`, {
        method: 'POST',
        body: JSON.stringify({ steps: ['enrich', 'score', 'brief', 'audit'], lead_ids: leadIds }),
      });
      loadRuns();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRerunningRunId(null);
    }
  };

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 60000);
    return () => clearInterval(interval);
  }, [loadRuns]);

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

  const toggleSelect = (runId: string) => {
    setSelectedRuns(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRuns.size === filteredFinishedRuns.length) {
      setSelectedRuns(new Set());
    } else {
      setSelectedRuns(new Set(filteredFinishedRuns.map(r => r.id)));
    }
  };

  const handleDeleteSelected = () => {
    const ids = Array.from(selectedRuns);
    const totalLeads = runs.filter(r => ids.includes(r.id)).reduce((sum, r) => sum + (r.lead_count || 0), 0);
    setDeleteConfirm({ type: 'bulk', ids, leadCount: totalLeads });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      if (deleteConfirm.type === 'single') {
        await api(`/runs/${deleteConfirm.ids[0]}?force=true`, { method: 'DELETE' });
      } else {
        await api('/runs', { method: 'DELETE', body: JSON.stringify({ ids: deleteConfirm.ids }) });
      }
      setSelectedRuns(new Set());
      setDeleteConfirm(null);
      loadRuns();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const handleCancelRun = async (runId: string) => {
    setCancellingRunId(runId);
    try {
      await api.post(`/runs/${runId}/cancel`);
      loadRuns();
    } catch (err: any) {
      console.error('Cancel failed:', err);
    } finally {
      setCancellingRunId(null);
    }
  };

  const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'pending');
  const finishedRuns = runs.filter(r => r.status !== 'running' && r.status !== 'pending');

  // Client-side triggered_by filter
  const filteredFinishedRuns = filterTriggeredBy
    ? finishedRuns.filter(r => (r.triggered_by_name || 'System').toLowerCase().includes(filterTriggeredBy.toLowerCase()))
    : finishedRuns;

  const hasActiveFilters = filterType || filterCampaign || filterStatus || filterDateFrom || filterDateTo || filterTriggeredBy;

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
        <div className="flex items-center gap-2">
          {isSuperAdmin && selectedRuns.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete {selectedRuns.size} run{selectedRuns.size !== 1 ? 's' : ''}
            </button>
          )}
          <button onClick={loadRuns} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          <StatCard icon={<Activity className="w-4 h-4 text-blue-600" />} label="Total Runs" value={stats.total_runs} />
          <StatCard icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} label="Success Rate" value={`${stats.success_rate}%`} />
          {(stats.failed_runs > 0 || stats.missed_runs > 0) ? (
            <StatCard
              icon={<AlertTriangle className="w-4 h-4 text-red-500" />}
              label="Failed / Missed"
              value={`${stats.failed_runs} / ${stats.missed_runs}`}
              alert
            />
          ) : (
            <StatCard icon={<Users className="w-4 h-4 text-indigo-600" />} label="Avg Leads/Run" value={stats.avg_leads_per_run} />
          )}
          <StatCard icon={<DollarSign className="w-4 h-4 text-amber-600" />} label="Total Cost" value={`$${stats.total_cost.toFixed(2)}`} />
          <StatCard icon={<DollarSign className="w-4 h-4 text-purple-600" />} label="Avg Cost/Run" value={`$${stats.avg_cost_per_run.toFixed(2)}`} />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Filter className="w-4 h-4 text-gray-400" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
          <option value="">All Types</option>
          <option value="campaign">Campaign</option>
          <option value="pipeline">Pipeline</option>
          <option value="import">Import</option>
          <option value="enrichment">Enrichment</option>
          <option value="stage_rerun">Rerun</option>
          <option value="quick_research">Quick Research</option>
        </select>
        <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
          <option value="">All Campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="missed">Missed</option>
          <option value="cancelled">Cancelled</option>
          <option value="running">Running</option>
          <option value="pending">Pending</option>
        </select>
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
            showAdvancedFilters || filterDateFrom || filterDateTo || filterTriggeredBy
              ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          More
          {(filterDateFrom || filterDateTo || filterTriggeredBy) && (
            <span className="ml-1 w-4 h-4 text-[10px] leading-4 text-center rounded-full bg-brand-600 text-white">
              {[filterDateFrom, filterDateTo, filterTriggeredBy].filter(Boolean).length}
            </span>
          )}
        </button>
        {hasActiveFilters && (
          <button
            onClick={() => { setFilterType(''); setFilterCampaign(''); setFilterStatus(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterTriggeredBy(''); }}
            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear all
          </button>
        )}
      </div>

      {/* Advanced filters */}
      {showAdvancedFilters && (
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-gray-50 rounded-lg p-3 border border-gray-200">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 uppercase">Date</label>
            <input
              type="date" value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date" value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
          </div>
          <div className="w-px h-6 bg-gray-300" />
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 uppercase">Triggered By</label>
            <input
              type="text" placeholder="Name..."
              value={filterTriggeredBy}
              onChange={e => setFilterTriggeredBy(e.target.value)}
              className="w-32 px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
          </div>
        </div>
      )}

      {/* Upcoming section */}
      {upcoming.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" /> Upcoming Scheduled Runs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {upcoming.map(u => (
              <Link
                key={u.campaign_id}
                to={`/campaigns/${u.campaign_id}`}
                className={`bg-white border rounded-lg p-4 transition-colors ${
                  u.is_overdue || u.missed_count > 0
                    ? 'border-red-300 hover:border-red-400 bg-red-50/30'
                    : 'border-gray-200 hover:border-brand-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {u.is_overdue || u.missed_count > 0 ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  ) : (
                    <Target className="w-3.5 h-3.5 text-brand-500" />
                  )}
                  <span className="text-sm font-medium text-gray-900">{u.campaign_name}</span>
                </div>
                {u.missed_count > 0 && (
                  <p className="text-xs text-red-600 font-medium mb-1">
                    {u.missed_count} missed run{u.missed_count !== 1 ? 's' : ''} — server was offline
                  </p>
                )}
                {u.is_overdue && u.missed_count === 0 && (
                  <p className="text-xs text-red-600 font-medium mb-1">
                    Overdue — expected {u.last_expected_at ? formatDateTime(u.last_expected_at) : 'earlier'}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 font-mono">{u.schedule_cron}</p>
                  {u.next_run_at && (
                    <p className="text-[10px] text-gray-500">
                      Next: {formatDateTimeWithWeekday(u.next_run_at)}
                    </p>
                  )}
                </div>
                {u.last_run_at && (
                  <p className="text-[10px] text-gray-400 mt-1">Last run: {formatDateTime(u.last_run_at)} ({u.last_run_status})</p>
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
                <ActiveRunCard run={run} liveProgress={liveProgress[run.id]} onViewActivity={() => setActivityRunId(activityRunId === run.id ? null : run.id)} onCancel={() => handleCancelRun(run.id)} isCancelling={cancellingRunId === run.id} />
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

      {/* Completed / Failed runs */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-gray-400" /> Run Log ({filteredFinishedRuns.length})
        </h2>

        {filteredFinishedRuns.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">{hasActiveFilters ? 'No runs match your filters.' : 'No completed runs yet.'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {isSuperAdmin && (
                    <th className="px-3 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={selectedRuns.size > 0 && selectedRuns.size === filteredFinishedRuns.length}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-brand-600"
                      />
                    </th>
                  )}
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">
                    <Hash className="w-3 h-3 inline" />
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Campaign</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Leads</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tokens</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                  <th className="px-3 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredFinishedRuns.map(run => (
                  <CompletedRunRow
                    key={run.id}
                    run={run}
                    expanded={expandedRun === run.id}
                    leads={expandedRun === run.id ? expandedLeads : []}
                    loadingLeads={expandedRun === run.id && loadingLeads}
                    onToggle={() => toggleExpand(run.id)}
                    onViewLog={() => setActivityRunId(activityRunId === run.id ? null : run.id)}
                    showingLog={activityRunId === run.id}
                    isSuperAdmin={isSuperAdmin}
                    selected={selectedRuns.has(run.id)}
                    onSelect={() => toggleSelect(run.id)}
                    onDelete={() => {
                      const chainWarning = run.resumed_from_run_id
                        ? 'This is a resume run. Its leads may belong to the original run and won\'t be affected.'
                        : run.resumed_by_run_id
                          ? 'This run was resumed by another run. Leads processed during the resume are linked to this run\'s chain.'
                          : undefined;
                      setDeleteConfirm({ type: 'single', ids: [run.id], leadCount: run.lead_count || 0, chainWarning });
                    }}
                    colSpan={isSuperAdmin ? 13 : 12}
                    canRerun={!!canRerun}
                    onRerun={() => handleRerunFromRun(run)}
                    rerunning={rerunningRunId === run.id}
                    onResume={() => handleResumeFromRun(run)}
                    resuming={resumingRunId === run.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  Delete {deleteConfirm.ids.length} Run{deleteConfirm.ids.length !== 1 ? 's' : ''}
                </h3>
                <p className="text-sm text-gray-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently delete {deleteConfirm.ids.length === 1 ? 'this run' : `${deleteConfirm.ids.length} runs`} and all associated data:
            </p>
            <ul className="text-sm text-gray-600 mb-4 space-y-1 pl-4">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                {deleteConfirm.leadCount} lead{deleteConfirm.leadCount !== 1 ? 's' : ''} (with personas and feedback)
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                Activity logs and analytics data
              </li>
            </ul>
            {deleteConfirm.chainWarning && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">{deleteConfirm.chainWarning}</p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume Confirmation Modal */}
      {resumeModal && (
        <ResumeModal
          analysis={resumeModal.analysis}
          run={{
            error_message: resumeModal.run.error_message,
            campaign_name: resumeModal.run.campaign_name || undefined,
            steps_run: resumeModal.run.steps_run,
            run_type: resumeModal.run.run_type || undefined,
            status: resumeModal.run.status,
          }}
          onConfirm={confirmResume}
          onCancel={() => setResumeModal(null)}
          resuming={resumingRunId === resumeModal.run.id}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function StatCard({ icon, label, value, alert }: { icon: React.ReactNode; label: string; value: string | number; alert?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${alert ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 mb-1">{icon}<span className={`text-xs ${alert ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{label}</span></div>
      <p className={`text-lg font-semibold ${alert ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
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

function ActiveRunCard({ run, liveProgress, onViewActivity, onCancel, isCancelling }: { run: Run; liveProgress?: ProgressData; onViewActivity?: () => void; onCancel?: () => void; isCancelling?: boolean }) {
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
            {run.run_type === 'resume' ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-50 text-green-700 border border-green-200">
                resuming
              </span>
            ) : (
              <RunTypeBadge type={run.run_type} />
            )}
            <span className="text-[10px] text-gray-400 font-mono">#{run.run_number}</span>
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
            Started {run.started_at ? formatTime(run.started_at) : '—'}
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
          {onCancel && (
            <button onClick={onCancel} disabled={isCancelling} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-50 mt-1">
              <X className="w-3 h-3" /> {isCancelling ? 'Cancelling...' : 'Cancel Run'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CompletedRunRow({ run, expanded, leads, loadingLeads, onToggle, onViewLog, showingLog, isSuperAdmin, selected, onSelect, onDelete, colSpan, canRerun, onRerun, rerunning, onResume, resuming }: {
  run: Run;
  expanded: boolean;
  leads: any[];
  loadingLeads: boolean;
  onToggle: () => void;
  onViewLog?: () => void;
  showingLog?: boolean;
  isSuperAdmin: boolean;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  colSpan: number;
  canRerun: boolean;
  onRerun: () => void;
  rerunning: boolean;
  onResume: () => void;
  resuming: boolean;
}) {
  const totalTokens = (run.input_tokens || 0) + (run.output_tokens || 0);
  const isFailed = run.status === 'failed';
  const isCancelled = run.status === 'cancelled';
  const isMissed = run.status === 'missed';

  let duration = '—';
  if (run.started_at && run.completed_at) {
    const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
    if (ms < 60000) duration = `${Math.round(ms / 1000)}s`;
    else if (ms < 3600000) duration = `${Math.round(ms / 60000)}m`;
    else duration = `${(ms / 3600000).toFixed(1)}h`;
  }

  const statusColor = isFailed ? 'text-red-600' : isMissed ? 'text-orange-600' : isCancelled ? 'text-gray-500' : 'text-emerald-600';
  const statusLabel = run.status === 'completed' ? 'Completed' : run.status === 'failed' ? 'Failed' : run.status === 'missed' ? 'Missed' : run.status === 'cancelled' ? 'Cancelled' : run.status;

  return (
    <>
      <tr className={`hover:bg-gray-50 cursor-pointer ${isFailed ? 'bg-red-50/30' : isMissed ? 'bg-orange-50/30' : isCancelled ? 'bg-gray-50/50' : ''}`} onClick={onToggle}>
        {isSuperAdmin && (
          <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              className="rounded border-gray-300 text-brand-600"
            />
          </td>
        )}
        <td className="px-3 py-3 text-xs text-gray-400 font-mono">#{run.run_number}</td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            {run.resumed_by_run_id
              ? (run.resumed_by_status === 'completed'
                  ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                  : run.resumed_by_status === 'running' || run.resumed_by_status === 'pending'
                    ? <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                    : statusIcon(run.status))
              : statusIcon(run.status)
            }
            <div>
              {run.resumed_by_run_id ? (
                <>
                  <span className={`text-xs font-medium ${
                    run.resumed_by_status === 'completed' ? 'text-emerald-600' :
                    run.resumed_by_status === 'running' || run.resumed_by_status === 'pending' ? 'text-amber-600' :
                    statusColor
                  }`}>
                    {run.resumed_by_status === 'completed' ? 'Recovered' :
                     run.resumed_by_status === 'running' || run.resumed_by_status === 'pending' ? 'Recovering...' :
                     statusLabel}
                  </span>
                  <Link to={`/runs/${run.resumed_by_run_id}`} onClick={e => e.stopPropagation()} className="block text-[10px] text-brand-500 hover:text-brand-700">
                    View resume run →
                  </Link>
                </>
              ) : (
                <>
                  <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
                  {(isFailed || isMissed) && run.error_message && (
                    <p className={`text-[10px] leading-tight mt-0.5 max-w-[200px] truncate ${isFailed ? 'text-red-500' : 'text-orange-500'}`}>
                      {run.error_message}
                    </p>
                  )}
                </>
              )}
              {run.resumed_from_run_id && (
                <p className="text-[10px] text-gray-400">
                  ↳ continues <Link to={`/runs/${run.resumed_from_run_id}`} onClick={e => e.stopPropagation()} className="text-brand-500 hover:text-brand-700">parent run</Link>
                </p>
              )}
            </div>
          </div>
        </td>
        <td className="px-3 py-3"><RunTypeBadge type={run.run_type} /></td>
        <td className="px-3 py-3">
          {run.campaign_name ? (
            <Link to={`/campaigns/${run.campaign_id}`} onClick={e => e.stopPropagation()} className="text-brand-600 hover:text-brand-700 font-medium text-xs">
              {run.campaign_name}
            </Link>
          ) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
        </td>
        <td className="px-3 py-3 text-gray-700 text-xs">{run.lead_count || 0}</td>
        <td className="px-3 py-3 text-gray-500 text-xs font-mono">{totalTokens > 0 ? formatTokens(totalTokens) : '—'}</td>
        <td className="px-3 py-3 text-gray-500 text-xs">{run.estimated_cost > 0 ? `$${run.estimated_cost.toFixed(2)}` : '—'}</td>
        <td className="px-3 py-3 text-gray-500 text-xs">{duration}</td>
        <td className="px-3 py-3 text-gray-500 text-xs">{run.started_at ? formatDateTime(run.started_at) : '—'}</td>
        <td className="px-3 py-3 text-gray-500 text-xs">{run.triggered_by_name || 'System'}</td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1">
            {onViewLog && (
              <button onClick={e => { e.stopPropagation(); onViewLog(); }} className={`p-1 rounded hover:bg-gray-100 ${showingLog ? 'text-brand-600' : 'text-gray-400'}`} title="View Activity Log">
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
            <Link to={`/runs/${run.id}`} onClick={e => e.stopPropagation()} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-brand-600" title="View run details">
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
            {run.lead_count > 0 && run.status !== 'running' && run.status !== 'pending' && (
              <button onClick={e => { e.stopPropagation(); downloadFile(`/runs/${run.id}/chain-export`, `signalstack-run-${new Date().toISOString().split('T')[0]}.csv`); }} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-emerald-600 transition-colors" title="Download results CSV">
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
            {canRerun && run.campaign_id && (run.status === 'failed' || run.status === 'cancelled') && !run.resumed_by_run_id && (
              <button onClick={e => { e.stopPropagation(); onResume(); }} disabled={resuming} className="p-1 rounded hover:bg-green-50 text-gray-400 hover:text-green-600" title="Resume from where it stopped">
                <PlayCircle className={`w-3.5 h-3.5 ${resuming ? 'animate-pulse' : ''}`} />
              </button>
            )}
            {canRerun && run.campaign_id && run.status !== 'running' && run.status !== 'pending' && (
              <button onClick={e => { e.stopPropagation(); onRerun(); }} disabled={rerunning} className="p-1 rounded hover:bg-amber-50 text-gray-400 hover:text-amber-600" title="Rerun leads">
                <RefreshCw className={`w-3.5 h-3.5 ${rerunning ? 'animate-spin' : ''}`} />
              </button>
            )}
            {isSuperAdmin && (
              <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500" title="Delete run">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </td>
      </tr>
      {(isFailed || isMissed || isCancelled) && expanded && run.error_message && (() => {
        const errInfo = isMissed ? null : classifyError(run.error_message, run.status);
        return (
          <tr>
            <td colSpan={colSpan} className={`px-4 py-3 ${isFailed ? 'bg-red-50' : isMissed ? 'bg-orange-50' : 'bg-gray-50'}`}>
              <div className="flex items-start gap-2">
                <AlertCircle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isFailed ? 'text-red-500' : isMissed ? 'text-orange-500' : 'text-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium ${isFailed ? 'text-red-700' : isMissed ? 'text-orange-700' : 'text-gray-600'}`}>
                    {isMissed ? 'Scheduled Run Missed' : errInfo?.headline || 'Run Failed'}
                  </p>
                  {errInfo && (
                    <p className="text-xs text-gray-500 mt-0.5">{errInfo.advice}</p>
                  )}
                  <p className={`text-[10px] mt-1 font-mono break-all ${isFailed ? 'text-red-400' : isMissed ? 'text-orange-400' : 'text-gray-400'}`}>
                    {run.error_message}
                  </p>
                </div>
              </div>
            </td>
          </tr>
        );
      })()}
      {expanded && !((isFailed || isMissed) && run.error_message) && (
        <tr>
          <td colSpan={colSpan} className="px-0">
            {loadingLeads ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-brand-500" /></div>
            ) : leads.length === 0 ? (
              <div className="px-6 py-4 text-xs text-gray-400">
                {isFailed ? 'Run failed before generating leads.' : isMissed ? 'Scheduled run was missed — server was offline.' : isCancelled ? 'Run was cancelled.' : 'No leads in this run.'}
                {(isFailed || isCancelled) && (
                  <button onClick={e => { e.stopPropagation(); onViewLog?.(); }} className="ml-2 text-brand-600 hover:underline">
                    View activity log
                  </button>
                )}
              </div>
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
          <td colSpan={colSpan} className="px-4 py-3 bg-gray-50">
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
    stage_rerun: 'bg-amber-50 text-amber-700',
    quick_research: 'bg-emerald-50 text-emerald-700',
    batch_research: 'bg-purple-50 text-purple-700',
    resume: 'bg-green-50 text-green-700',
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
    case 'missed': return <AlertTriangle className="w-4 h-4 text-orange-500" />;
    case 'cancelled': return <AlertCircle className="w-4 h-4 text-gray-400" />;
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
