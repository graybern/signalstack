import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { formatDateTime, formatDateTimeWithWeekday, formatTime, formatDate } from '../utils/dates';
import { useAuth } from '../hooks/useAuth';
import {
  Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, Target,
  DollarSign, ChevronDown, ChevronUp, Calendar, Download,
  TrendingUp, Users, Loader2, Activity, Eye, Trash2, AlertTriangle,
  X, PlayCircle, MoreHorizontal, ExternalLink,
} from 'lucide-react';
import { ScoreBadge, SegmentBadge, deriveActionState, ACTION_CONFIG, InlineScoreStrip } from '../components/ScoreBadge';
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

const RUN_TYPE_LABELS: Record<string, string> = {
  campaign: 'Full Run',
  pipeline: 'Full Run',
  stage_rerun: 'Re-score',
  quick_research: 'Quick Research',
  batch_research: 'Batch Research',
  resume: 'Resumed',
  enrichment: 'Enrichment',
  import: 'Import',
};

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

  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single' | 'bulk'; ids: string[]; leadCount: number; chainWarning?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [filterType, setFilterType] = useState('');
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterTriggeredBy, setFilterTriggeredBy] = useState('');
  const [showFilters, setShowFilters] = useState(false);
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

  const filteredFinishedRuns = filterTriggeredBy
    ? finishedRuns.filter(r => (r.triggered_by_name || 'System').toLowerCase().includes(filterTriggeredBy.toLowerCase()))
    : finishedRuns;

  const missedRuns = filteredFinishedRuns.filter(r => r.status === 'missed' || r.status === 'cancelled');
  const visibleRuns = filteredFinishedRuns.filter(r => r.status !== 'missed' && r.status !== 'cancelled');
  const [showMissed, setShowMissed] = useState(false);

  const hasActiveFilters = filterType || filterCampaign || filterStatus || filterDateFrom || filterDateTo || filterTriggeredBy;

  const lastRun = runs.length > 0 ? runs[0] : null;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  const totalColSpan = isSuperAdmin ? 8 : 7;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Run History</h1>
          <p className="text-sm text-gray-500">Pipeline runs and their results</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && selectedRuns.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete {selectedRuns.size}
            </button>
          )}
          <button onClick={loadRuns} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Stats bar — salesperson-relevant */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-indigo-600" />
              <span className="text-xs text-gray-500">Leads Generated</span>
            </div>
            <p className="text-lg font-semibold text-gray-900">{stats.total_leads}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span className="text-xs text-gray-500">Success Rate</span>
            </div>
            <p className="text-lg font-semibold text-gray-900">{stats.success_rate}%</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-sky-600" />
              <span className="text-xs text-gray-500">Last Run</span>
            </div>
            <p className="text-sm font-semibold text-gray-900">
              {lastRun?.started_at ? formatDate(lastRun.started_at) : '—'}
            </p>
            {lastRun && (
              <p className={`text-[10px] font-medium ${lastRun.status === 'completed' ? 'text-emerald-600' : lastRun.status === 'failed' ? 'text-red-600' : 'text-gray-400'}`}>
                {lastRun.status === 'completed' ? 'Completed' : lastRun.status === 'failed' ? 'Failed' : lastRun.status === 'running' ? 'Running...' : lastRun.status}
              </p>
            )}
          </div>
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-gray-500">Total Cost</span>
            </div>
            <p className="text-lg font-semibold text-gray-900">${stats.total_cost.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Filters — single row */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">All Campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">All Types</option>
          <option value="campaign">Full Run</option>
          <option value="stage_rerun">Re-score</option>
          <option value="enrichment">Enrichment</option>
          <option value="resume">Resumed</option>
          <option value="import">Import</option>
        </select>
        <div className="flex-1" />
        {hasActiveFilters && (
          <button
            onClick={() => { setFilterType(''); setFilterCampaign(''); setFilterStatus(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterTriggeredBy(''); }}
            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
            showFilters ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Calendar className="w-3 h-3" /> Date range
        </button>
      </div>

      {showFilters && (
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-white rounded-lg p-3 border border-gray-200">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-gray-500 uppercase">From</label>
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-gray-500 uppercase">To</label>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
          </div>
          <div className="w-px h-5 bg-gray-200" />
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-gray-500 uppercase">By</label>
            <input type="text" placeholder="Name..." value={filterTriggeredBy}
              onChange={e => setFilterTriggeredBy(e.target.value)}
              className="w-28 px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
          </div>
        </div>
      )}

      {/* Upcoming — simplified, no cron expression */}
      {upcoming.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Upcoming</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {upcoming.map(u => (
              <Link
                key={u.campaign_id}
                to={`/campaigns/${u.campaign_id}`}
                className={`bg-white border rounded-lg px-4 py-3 transition-colors ${
                  u.is_overdue || u.missed_count > 0
                    ? 'border-red-200 bg-red-50/30 hover:border-red-300'
                    : 'border-gray-200 hover:border-brand-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {u.is_overdue || u.missed_count > 0 ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  ) : (
                    <Target className="w-3.5 h-3.5 text-brand-500" />
                  )}
                  <span className="text-sm font-medium text-gray-900">{u.campaign_name}</span>
                </div>
                {u.missed_count > 0 && (
                  <p className="text-[10px] text-red-600 font-medium mb-0.5">{u.missed_count} missed</p>
                )}
                {u.next_run_at && (
                  <p className="text-xs text-gray-500">Next: {formatDateTimeWithWeekday(u.next_run_at)}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Active runs */}
      {activeRuns.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" /> Active ({activeRuns.length})
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

      {/* Missed/cancelled runs — collapsed summary */}
      {missedRuns.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowMissed(!showMissed)}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showMissed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {missedRuns.length} missed/cancelled run{missedRuns.length !== 1 ? 's' : ''}
          </button>
          {showMissed && (
            <div className="mt-2 space-y-1">
              {missedRuns.map(run => (
                <div key={run.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-500">
                  {statusIcon(run.status)}
                  <span className="font-medium text-gray-600">{run.campaign_name || '—'}</span>
                  <span>{RUN_TYPE_LABELS[run.run_type || ''] || run.run_type}</span>
                  <span className="text-gray-400">{run.started_at ? formatDateTime(run.started_at) : formatDateTime(run.created_at)}</span>
                  {run.error_message && <span className="text-gray-400 truncate max-w-[200px]">{run.error_message}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Run log table — simplified 7 columns */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Run Log ({visibleRuns.length})
        </h2>

        {visibleRuns.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">{hasActiveFilters ? 'No runs match your filters.' : 'No completed runs yet.'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/80 border-b border-gray-200">
                <tr>
                  {isSuperAdmin && (
                    <th className="pl-3 pr-1 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={selectedRuns.size > 0 && selectedRuns.size === visibleRuns.length}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-brand-600"
                      />
                    </th>
                  )}
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Campaign</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Leads</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Cost</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">When</th>
                  <th className="px-3 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleRuns.map(run => (
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
                          ? 'This run was resumed by another run.'
                          : undefined;
                      setDeleteConfirm({ type: 'single', ids: [run.id], leadCount: run.lead_count || 0, chainWarning });
                    }}
                    colSpan={totalColSpan}
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
            <ul className="text-sm text-gray-600 mb-4 space-y-1 pl-4">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                {deleteConfirm.leadCount} lead{deleteConfirm.leadCount !== 1 ? 's' : ''} and associated data
              </li>
            </ul>
            {deleteConfirm.chainWarning && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">{deleteConfirm.chainWarning}</p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} disabled={deleting}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
              {RUN_TYPE_LABELS[run.run_type || ''] || run.run_type || 'Run'}
            </span>
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
                  <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
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
              <Eye className="w-3 h-3" /> Activity
            </button>
          )}
          {onCancel && (
            <button onClick={onCancel} disabled={isCancelling} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-50 mt-1">
              <X className="w-3 h-3" /> {isCancelling ? 'Cancelling...' : 'Cancel'}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const isFailed = run.status === 'failed';

  let duration = '—';
  if (run.started_at && run.completed_at) {
    const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
    if (ms < 60000) duration = `${Math.round(ms / 1000)}s`;
    else if (ms < 3600000) duration = `${Math.round(ms / 60000)}m`;
    else duration = `${(ms / 3600000).toFixed(1)}h`;
  }

  const typeLabel = RUN_TYPE_LABELS[run.run_type || ''] || run.run_type || 'Run';

  return (
    <>
      <tr className={`hover:bg-gray-50 cursor-pointer ${isFailed ? 'bg-red-50/30' : ''}`} onClick={onToggle}>
        {isSuperAdmin && (
          <td className="pl-3 pr-1 py-2.5" onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={selected} onChange={onSelect} className="rounded border-gray-300 text-brand-600" />
          </td>
        )}
        {/* Status + # + type merged */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            {run.resumed_by_run_id
              ? (run.resumed_by_status === 'completed'
                  ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                  : run.resumed_by_status === 'running'
                    ? <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                    : statusIcon(run.status))
              : statusIcon(run.status)
            }
            <div>
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-medium ${
                  isFailed ? 'text-red-600' :
                  run.status === 'completed' ? 'text-emerald-600' : 'text-gray-600'
                }`}>
                  {run.resumed_by_run_id && run.resumed_by_status === 'completed' ? 'Recovered' :
                   run.status === 'completed' ? 'Completed' :
                   run.status === 'failed' ? 'Failed' : run.status}
                </span>
                <span className="text-[9px] text-gray-400 font-mono">#{run.run_number}</span>
              </div>
              <span className="text-[10px] text-gray-400">{typeLabel}</span>
              {isFailed && run.error_message && (
                <p className="text-[10px] text-red-400 truncate max-w-[180px]">{run.error_message}</p>
              )}
              {run.resumed_from_run_id && (
                <p className="text-[10px] text-gray-400">
                  ↳ continues <Link to={`/runs/${run.resumed_from_run_id}`} onClick={e => e.stopPropagation()} className="text-brand-500 hover:text-brand-700">parent</Link>
                </p>
              )}
            </div>
          </div>
        </td>
        {/* Campaign */}
        <td className="px-3 py-2.5">
          {run.campaign_name ? (
            <Link to={`/campaigns/${run.campaign_id}`} onClick={e => e.stopPropagation()} className="text-brand-600 hover:text-brand-700 font-medium text-xs">
              {run.campaign_name}
            </Link>
          ) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
          {run.triggered_by_name && (
            <p className="text-[10px] text-gray-400">by {run.triggered_by_name}</p>
          )}
        </td>
        {/* Leads */}
        <td className="px-3 py-2.5 text-xs text-gray-700 tabular-nums">{run.lead_count || '—'}</td>
        {/* Cost */}
        <td className="px-3 py-2.5 text-xs text-gray-500 tabular-nums">{run.estimated_cost > 0 ? `$${run.estimated_cost.toFixed(2)}` : '—'}</td>
        {/* Duration */}
        <td className="px-3 py-2.5 text-xs text-gray-500 tabular-nums">{duration}</td>
        {/* When */}
        <td className="px-3 py-2.5 text-[11px] text-gray-400 tabular-nums">{run.started_at ? formatDateTime(run.started_at) : '—'}</td>
        {/* Actions — kebab dropdown + expand chevron */}
        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-0.5">
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  {onViewLog && (
                    <button
                      onClick={() => { setMenuOpen(false); onViewLog(); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Eye className="w-3.5 h-3.5 text-gray-400" />
                      {showingLog ? 'Hide Activity Log' : 'Activity Log'}
                    </button>
                  )}
                  {run.lead_count > 0 && run.status !== 'running' && (
                    <button
                      onClick={() => { setMenuOpen(false); downloadFile(`/runs/${run.id}/chain-export`, `signalstack-run-${new Date().toISOString().split('T')[0]}.csv`); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5 text-gray-400" />
                      Download CSV
                    </button>
                  )}
                  {canRerun && run.campaign_id && isFailed && !run.resumed_by_run_id && (
                    <button
                      onClick={() => { setMenuOpen(false); onResume(); }}
                      disabled={resuming}
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                    >
                      <PlayCircle className="w-3.5 h-3.5 text-gray-400" />
                      {resuming ? 'Resuming...' : 'Resume Run'}
                    </button>
                  )}
                  {canRerun && run.campaign_id && run.status !== 'running' && (
                    <button
                      onClick={() => { setMenuOpen(false); onRerun(); }}
                      disabled={rerunning}
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
                      {rerunning ? 'Rerunning...' : 'Rerun Leads'}
                    </button>
                  )}
                  {isSuperAdmin && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <button
                        onClick={() => { setMenuOpen(false); onDelete(); }}
                        className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <button onClick={onToggle} className="p-1 text-gray-400 hover:text-gray-600">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </td>
      </tr>
      {/* Error detail row */}
      {isFailed && expanded && run.error_message && (() => {
        const errInfo = classifyError(run.error_message, run.status);
        return (
          <tr>
            <td colSpan={colSpan} className="px-4 py-3 bg-red-50">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-red-700">{errInfo?.headline || 'Run Failed'}</p>
                  {errInfo && <p className="text-xs text-gray-500 mt-0.5">{errInfo.advice}</p>}
                  <p className="text-[10px] mt-1 font-mono break-all text-red-400">{run.error_message}</p>
                </div>
              </div>
            </td>
          </tr>
        );
      })()}
      {/* Expanded leads */}
      {expanded && !(isFailed && run.error_message) && (
        <tr>
          <td colSpan={colSpan} className="px-0">
            {loadingLeads ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-brand-500" /></div>
            ) : leads.length === 0 ? (
              <div className="px-6 py-4 text-xs text-gray-400">
                {isFailed ? 'Run failed before generating leads.' : 'No leads in this run.'}
                {isFailed && (
                  <button onClick={e => { e.stopPropagation(); onViewLog?.(); }} className="ml-2 text-brand-600 hover:underline">
                    View activity log
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-gray-50 px-6 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-2">{leads.length} lead{leads.length !== 1 ? 's' : ''}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {leads.slice(0, 12).map((lead: any) => {
                    const action = lead.scoring_version === 2 && lead.potential_score != null
                      ? deriveActionState({
                          potential_score: lead.potential_score,
                          urgency_score: lead.urgency_score ?? 0,
                          evidence_modifier: lead.evidence_modifier ?? 0.5,
                        })
                      : null;
                    const actionCfg = action ? ACTION_CONFIG[action] : null;

                    return (
                      <Link key={lead.id} to={`/runs/${run.id}`} className="bg-white border border-gray-200 rounded-lg p-3 hover:border-brand-200 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 truncate">{lead.company_name}</span>
                          <div className="flex items-center gap-1.5">
                            <InlineScoreStrip
                              score={lead.fit_score}
                              potential={lead.potential_score}
                              urgency={lead.urgency_score}
                              evidenceModifier={lead.evidence_modifier}
                              compositeVersion={lead.scoring_version}
                            />
                            <Link to={`/leads/${lead.id}`} onClick={e => e.stopPropagation()} title="View lead details" className="p-0.5 rounded hover:bg-gray-100 text-gray-300 hover:text-brand-600">
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <SegmentBadge segment={lead.segment} />
                          {actionCfg && (
                            <span className={`text-[10px] font-medium ${
                              action === 'engage' ? 'text-emerald-600' :
                              action === 'watch' ? 'text-amber-600' :
                              action === 'research' ? 'text-sky-600' :
                              'text-gray-400'
                            }`}>
                              {actionCfg.label}
                            </span>
                          )}
                          {lead.why_now && (
                            <span className="text-[10px] text-gray-400 truncate flex-1">{lead.why_now.slice(0, 60)}...</span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
                {leads.length > 12 && (
                  <p className="text-xs text-gray-400 mt-2">+{leads.length - 12} more</p>
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
