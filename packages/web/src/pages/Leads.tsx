import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { formatDate, formatTime } from '../utils/dates';
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ExternalLink,
  Download,
  Users,
  TrendingUp,
  RotateCcw,
  BarChart3,
  RefreshCw,
  SlidersHorizontal,
  Calendar,
  X,
  Trash2,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { ScoreBadge, SegmentBadge } from '../components/ScoreBadge';

interface Lead {
  id: string;
  company_name: string;
  domain: string;
  segment: string;
  fit_score: number;
  fit_score_label: string;
  confidence: string;
  campaign_id: string | null;
  campaign_name?: string;
  source_type: string;
  lead_status: string;
  current_feedback: string | null;
  next_outreach_date: string | null;
  created_at: string;
  updated_at?: string;
  signal_count?: number;
  feedback?: { id: string; verdict: string; reason: string | null; retry_date?: string; created_at?: string }[];
}

interface Stats {
  total: number;
  avg_score: number | null;
  needs_reoutreach: number;
  feedback_rate: number;
  with_feedback: number;
}

interface CampaignOption {
  id: string;
  name: string;
}

interface RunOption {
  id: string;
  label: string;
  lead_count: number;
  status: string;
}

const SEGMENTS = ['', 'ENT', 'MM', 'SMB'];
const PAGE_SIZE = 25;

const FEEDBACK_OPTIONS = [
  { value: '', label: 'All Feedback' },
  { value: 'bad_fit', label: 'Bad Fit' },
  { value: 'good_fit_response', label: 'Response' },
  { value: 'good_fit_booked', label: 'Booked' },
  { value: 'good_fit_try_again', label: 'Try Again' },
  { value: 'good_fit_no_response', label: 'No Response' },
  { value: 'closed_won', label: 'Closed Won' },
  { value: 'closed_lost', label: 'Closed Lost' },
  { value: 'existing_customer', label: 'Existing Customer' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'nurture', label: 'Nurture' },
  { value: 'none', label: 'No Feedback' },
];

const FEEDBACK_COLORS: Record<string, string> = {
  bad_fit: 'bg-red-50 text-red-700 border-red-200',
  good_fit_response: 'bg-green-50 text-green-700 border-green-200',
  good_fit_booked: 'bg-blue-50 text-blue-700 border-blue-200',
  good_fit_try_again: 'bg-amber-50 text-amber-700 border-amber-200',
  good_fit_no_response: 'bg-gray-100 text-gray-600 border-gray-200',
  closed_won: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed_lost: 'bg-rose-50 text-rose-700 border-rose-200',
  existing_customer: 'bg-purple-50 text-purple-700 border-purple-200',
  stalled: 'bg-slate-50 text-slate-600 border-slate-200',
  nurture: 'bg-sky-50 text-sky-700 border-sky-200',
  good_fit: 'bg-green-50 text-green-700 border-green-200',
  not_fit: 'bg-red-50 text-red-700 border-red-200',
};

const FEEDBACK_LABELS: Record<string, string> = {
  bad_fit: 'Bad Fit',
  good_fit_response: 'Response',
  good_fit_booked: 'Booked',
  good_fit_try_again: 'Try Again',
  good_fit_no_response: 'No Response',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  existing_customer: 'Customer',
  stalled: 'Stalled',
  nurture: 'Nurture',
  good_fit: 'Good Fit',
  not_fit: 'Bad Fit',
};

const EXPORT_FIELD_OPTIONS = [
  { key: 'company_name', label: 'Company Name' },
  { key: 'domain', label: 'Domain' },
  { key: 'segment', label: 'Segment' },
  { key: 'fit_score', label: 'Fit Score' },
  { key: 'fit_score_label', label: 'Score Label' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'hq_location', label: 'HQ Location' },
  { key: 'employee_count', label: 'Employee Count' },
  { key: 'founded_year', label: 'Founded Year' },
  { key: 'funding_stage', label: 'Funding Stage' },
  { key: 'total_funding', label: 'Total Funding' },
  { key: 'current_feedback', label: 'Feedback' },
  { key: 'next_outreach_date', label: 'Next Outreach' },
  { key: 'campaign_name', label: 'Campaign' },
  { key: 'created_at', label: 'Created At' },
];

const MAX_RERUN_SELECTION = 15;

export function Leads() {
  const { user } = useAuth();
  const canDelete = user?.role === 'superadmin' || user?.role === 'admin' || user?.role === 'operator';
  const canRerun = user?.role && ['member', 'operator', 'admin', 'superadmin'].includes(user.role);
  const showCheckboxes = canDelete || canRerun;
  const briefPickerRef = useRef<HTMLDivElement>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [segment, setSegment] = useState('');
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [runId, setRunId] = useState('');
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [sort, setSort] = useState('fit_score');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [stats, setStats] = useState<Stats | null>(null);
  const [needsReoutreach, setNeedsReoutreach] = useState(false);
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minSignals, setMinSignals] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [exportFields, setExportFields] = useState<Set<string>>(new Set(EXPORT_FIELD_OPTIONS.map(f => f.key)));
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'single' | 'bulk' | 'all'; ids?: string[]; name?: string; count?: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkRerunning, setBulkRerunning] = useState(false);
  const [briefStatus, setBriefStatus] = useState<{ phase: string; count?: number } | null>(null);
  const [showBriefPicker, setShowBriefPicker] = useState(false);

  const handleDownloadBriefs = async (format: 'markdown' | 'pdf') => {
    setShowBriefPicker(false);
    setBriefStatus({ phase: 'Fetching briefs...' });
    try {
      const params = new URLSearchParams();
      if (segment) params.set('segment', segment);
      if (campaignId) params.set('campaign_id', campaignId);
      if (runId) params.set('run_id', runId);
      if (feedbackFilter && feedbackFilter !== 'none') params.set('feedback', feedbackFilter);
      if (minScore) params.set('min_score', minScore);
      if (maxScore) params.set('max_score', maxScore);
      const data = await api(`/leads/export/briefs?${params}`) as any;
      if (!data.briefs || data.briefs.length === 0) {
        setBriefStatus({ phase: 'No briefs found', count: 0 });
        setTimeout(() => setBriefStatus(null), 3000);
        return;
      }
      const count = data.briefs.length;

      if (format === 'markdown') {
        if (count === 1) {
          setBriefStatus({ phase: 'Downloading brief...', count: 1 });
          const b = data.briefs[0];
          const blob = new Blob([b.markdown], { type: 'text/markdown' });
          downloadBlob(blob, `${b.filename}.md`);
        } else {
          setBriefStatus({ phase: `Packaging ${count} briefs...`, count });
          const { default: JSZip } = await import('jszip');
          const zip = new JSZip();
          for (const b of data.briefs) {
            zip.file(`${b.filename}.md`, b.markdown);
          }
          const blob = await zip.generateAsync({ type: 'blob' });
          downloadBlob(blob, `briefs-markdown-${new Date().toISOString().slice(0, 10)}.zip`);
        }
      } else {
        const { openBriefPrintWindow } = await import('../utils/markdownToPdf');
        openBriefPrintWindow(data.briefs.map((b: any) => ({
          markdown: b.markdown,
          company_name: b.company_name,
          fit_score: b.fit_score,
          segment: b.segment,
        })));
      }
      setBriefStatus({ phase: format === 'pdf' ? `Opened ${count} briefs for printing` : `Downloaded ${count} brief${count === 1 ? '' : 's'}`, count });
      setTimeout(() => setBriefStatus(null), 3000);
    } catch (err: any) {
      const message = err?.message || 'Something went wrong';
      setBriefStatus({ phase: `Export failed: ${message}`, count: 0 });
      setTimeout(() => setBriefStatus(null), 5000);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else if (next.size < MAX_RERUN_SELECTION) { next.add(id); }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedLeads.size > 0) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(leads.slice(0, MAX_RERUN_SELECTION).map(l => l.id)));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'single' && deleteTarget.ids?.[0]) {
        await api(`/leads/${deleteTarget.ids[0]}`, { method: 'DELETE' });
      } else if (deleteTarget.type === 'bulk' && deleteTarget.ids) {
        await api('/leads', { method: 'DELETE', body: JSON.stringify({ ids: deleteTarget.ids }) });
      } else {
        await api('/leads', { method: 'DELETE' });
      }
      setSelectedLeads(new Set());
      setDeleteTarget(null);
      fetchLeads();
      api('/leads/stats').then((data: any) => setStats(data)).catch(() => {});
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkRerun = async () => {
    const selected = leads.filter(l => selectedLeads.has(l.id));
    const byCampaign = new Map<string, string[]>();
    const orphans: string[] = [];
    for (const lead of selected) {
      if (lead.campaign_id) {
        const list = byCampaign.get(lead.campaign_id) || [];
        list.push(lead.id);
        byCampaign.set(lead.campaign_id, list);
      } else {
        orphans.push(lead.company_name);
      }
    }
    if (orphans.length > 0) {
      alert(`${orphans.length} lead(s) have no campaign and cannot be rerun: ${orphans.join(', ')}`);
    }
    if (byCampaign.size === 0) return;
    setBulkRerunning(true);
    try {
      await Promise.all(
        Array.from(byCampaign.entries()).map(([campaignId, leadIds]) =>
          api(`/campaigns/${campaignId}/run`, {
            method: 'POST',
            body: JSON.stringify({ steps: ['enrich', 'score', 'brief', 'audit'], lead_ids: leadIds }),
          })
        )
      );
      setSelectedLeads(new Set());
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBulkRerunning(false);
    }
  };

  useEffect(() => {
    api('/campaigns').then((data: any) => {
      setCampaigns((data || []).map((c: any) => ({ id: c.id, name: c.name })));
    }).catch(() => {});
    api('/leads/stats').then((data: any) => setStats(data)).catch(() => {});
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (briefPickerRef.current && !briefPickerRef.current.contains(e.target as Node)) {
        setShowBriefPicker(false);
      }
    }
    if (showBriefPicker) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBriefPicker]);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (campaignId) params.set('campaign_id', campaignId);
    api(`/runs?${params}`).then((data: any) => {
      const runOptions: RunOption[] = (data.runs || [])
        .filter((r: any) => r.lead_count > 0)
        .map((r: any) => ({
          id: r.id,
          label: `${formatDate(r.created_at)} ${formatTime(r.created_at)} — ${r.lead_count} leads`,
          lead_count: r.lead_count,
          status: r.status,
        }));
      setRuns(runOptions);
      if (runId && !runOptions.some((r: RunOption) => r.id === runId)) setRunId('');
    }).catch(() => {});
  }, [campaignId]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setSelectedLeads(new Set());
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort, order });
      if (segment) params.set('segment', segment);
      if (campaignId) params.set('campaign_id', campaignId);
      if (runId) params.set('run_id', runId);
      if (needsReoutreach) {
        params.set('needs_reoutreach', 'true');
      } else if (feedbackFilter && feedbackFilter !== 'none') {
        params.set('feedback', feedbackFilter);
      }
      if (minScore) params.set('min_score', minScore);
      if (maxScore) params.set('max_score', maxScore);
      if (minSignals) params.set('min_signals', minSignals);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const data = await api(`/leads?${params}`);
      setLeads((data as any).leads);
      setTotal((data as any).total);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  }, [page, segment, feedbackFilter, campaignId, runId, sort, order, needsReoutreach, minScore, maxScore, minSignals, dateFrom, dateTo, debouncedSearch]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const toggleSort = (col: string) => {
    if (sort === col) {
      setOrder(order === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(col);
      setOrder('desc');
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    setShowExportPicker(false);
    try {
      const params = new URLSearchParams({ format });
      if (segment) params.set('segment', segment);
      if (campaignId) params.set('campaign_id', campaignId);
      if (feedbackFilter && feedbackFilter !== 'none') params.set('feedback', feedbackFilter);
      if (minScore) params.set('min_score', minScore);
      if (maxScore) params.set('max_score', maxScore);
      if (exportFields.size > 0 && exportFields.size < EXPORT_FIELD_OPTIONS.length) {
        params.set('fields', Array.from(exportFields).join(','));
      }

      const csvText = await api(`/leads/export?${params}`);
      if (format === 'json') {
        const blob = new Blob([JSON.stringify(csvText, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `leads-export-${new Date().toISOString().slice(0, 10)}.json`);
      } else {
        const blob = new Blob([csvText as string], { type: 'text/csv' });
        downloadBlob(blob, `leads-export-${new Date().toISOString().slice(0, 10)}.csv`);
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const getFeedback = (lead: Lead) => {
    // Prefer denormalized current_feedback, fallback to feedback array
    if (lead.current_feedback) return lead.current_feedback;
    if (lead.feedback && lead.feedback.length > 0) return lead.feedback[0]?.verdict || null;
    return null;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-1">{total} total leads across all campaigns</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={briefPickerRef}>
            <button
              onClick={() => !briefStatus && setShowBriefPicker(!showBriefPicker)}
              disabled={!!briefStatus}
              className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm disabled:opacity-70 transition-colors ${
                briefStatus?.count === 0
                  ? 'border-amber-300 text-amber-700 bg-amber-50'
                  : briefStatus
                  ? 'border-brand-300 text-brand-700 bg-brand-50'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-4 h-4" />
              {briefStatus ? briefStatus.phase : 'Download Briefs'}
              {!briefStatus && <ChevronDown className="w-3.5 h-3.5 -mr-1" />}
            </button>
            {showBriefPicker && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                <button
                  onClick={() => handleDownloadBriefs('markdown')}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                >
                  <FileText className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="font-medium">Markdown</p>
                    <p className="text-xs text-gray-400">.md files</p>
                  </div>
                </button>
                <button
                  onClick={() => handleDownloadBriefs('pdf')}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 border-t border-gray-100"
                >
                  <Download className="w-4 h-4 text-brand-500" />
                  <div>
                    <p className="font-medium">PDF</p>
                    <p className="text-xs text-gray-400">Styled briefs</p>
                  </div>
                </button>
              </div>
            )}
          </div>
          <div className="relative">
          <button
            onClick={() => setShowExportPicker(!showExportPicker)}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export Report'}
          </button>
          {showExportPicker && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-900">Select Fields</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setExportFields(new Set(EXPORT_FIELD_OPTIONS.map(f => f.key)))} className="text-xs text-brand-600 hover:underline">All</button>
                  <button onClick={() => setExportFields(new Set())} className="text-xs text-gray-500 hover:underline">None</button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1 mb-3">
                {EXPORT_FIELD_OPTIONS.map(f => (
                  <label key={f.key} className="flex items-center gap-2 py-0.5 text-sm text-gray-700 cursor-pointer hover:text-gray-900">
                    <input
                      type="checkbox"
                      checked={exportFields.has(f.key)}
                      onChange={() => {
                        const next = new Set(exportFields);
                        next.has(f.key) ? next.delete(f.key) : next.add(f.key);
                        setExportFields(next);
                      }}
                      className="rounded border-gray-300 text-brand-600"
                    />
                    {f.label}
                  </label>
                ))}
              </div>
              <div className="flex gap-2 border-t border-gray-100 pt-3">
                <button
                  onClick={() => handleExport('csv')}
                  disabled={exportFields.size === 0}
                  className="flex-1 px-3 py-1.5 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
                >
                  CSV
                </button>
                <button
                  onClick={() => handleExport('json')}
                  disabled={exportFields.size === 0}
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  JSON
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Users className="w-4 h-4" />
              Total Leads
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <TrendingUp className="w-4 h-4" />
              Avg Score
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.avg_score || '—'}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <RotateCcw className="w-4 h-4" />
              Needs Re-outreach
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.needs_reoutreach}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <BarChart3 className="w-4 h-4" />
              Feedback Rate
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.feedback_rate}%</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by company or domain..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <select value={segment} onChange={e => { setSegment(e.target.value); setPage(1); }} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
          <option value="">All Segments</option>
          {SEGMENTS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={campaignId} onChange={e => { setCampaignId(e.target.value); setRunId(''); setPage(1); }} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
          <option value="">All Campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {runs.length > 0 && (
          <select value={runId} onChange={e => { setRunId(e.target.value); setPage(1); }} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white max-w-[220px]">
            <option value="">All Runs</option>
            {runs.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        )}
        <select value={feedbackFilter} onChange={e => { setFeedbackFilter(e.target.value); setNeedsReoutreach(false); setPage(1); }} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
          {FEEDBACK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          onClick={() => { setNeedsReoutreach(!needsReoutreach); setFeedbackFilter(''); setPage(1); }}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
            needsReoutreach
              ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-outreach
        </button>
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
            showAdvancedFilters || minScore || maxScore || dateFrom || dateTo || minSignals
              ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {(minScore || maxScore || dateFrom || dateTo || minSignals) && (
            <span className="ml-1 w-4 h-4 text-[10px] leading-4 text-center rounded-full bg-brand-600 text-white">
              {[minScore, maxScore, dateFrom, dateTo, minSignals].filter(Boolean).length}
            </span>
          )}
        </button>
      </div>

      {/* Advanced Filters */}
      {showAdvancedFilters && (
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-gray-50 rounded-lg p-3 border border-gray-200">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 uppercase">Score</label>
            <input
              type="number" min="0" max="100" placeholder="Min"
              value={minScore} onChange={e => { setMinScore(e.target.value); setPage(1); }}
              className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
            <span className="text-gray-400">–</span>
            <input
              type="number" min="0" max="100" placeholder="Max"
              value={maxScore} onChange={e => { setMaxScore(e.target.value); setPage(1); }}
              className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
          </div>
          <div className="w-px h-6 bg-gray-300" />
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 uppercase">
              <Calendar className="w-3.5 h-3.5 inline mr-1" />Date
            </label>
            <input
              type="date" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date" value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
          </div>
          <div className="w-px h-6 bg-gray-300" />
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 uppercase">Signals &ge;</label>
            <input
              type="number" min="0" placeholder="0"
              value={minSignals} onChange={e => { setMinSignals(e.target.value); setPage(1); }}
              className="w-14 px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
          </div>
          {(minScore || maxScore || dateFrom || dateTo || minSignals) && (
            <>
              <div className="w-px h-6 bg-gray-300" />
              <button
                onClick={() => { setMinScore(''); setMaxScore(''); setDateFrom(''); setDateTo(''); setMinSignals(''); setPage(1); }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {showCheckboxes && (
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedLeads.size > 0 && (selectedLeads.size === leads.length || selectedLeads.size >= MAX_RERUN_SELECTION)}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-brand-600"
                  />
                </th>
              )}
              {[
                { key: 'company_name', label: 'Company' },
                { key: 'fit_score', label: 'Score' },
                { key: 'segment', label: 'Segment' },
                { key: '', label: 'Campaign' },
                { key: '', label: 'Signals' },
                { key: 'current_feedback', label: 'Feedback' },
                { key: 'created_at', label: 'Date' },
              ].map(col => (
                <th key={col.label} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {col.key ? (
                    <button onClick={() => toggleSort(col.key)} className="flex items-center gap-1 hover:text-gray-700">
                      {col.label}
                      {sort === col.key && <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  ) : col.label}
                </th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={showCheckboxes ? 9 : 8} className="px-4 py-12 text-center text-gray-500">Loading leads...</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={showCheckboxes ? 9 : 8} className="px-4 py-12 text-center text-gray-500">{search ? 'No leads match your search' : 'No leads found'}</td></tr>
            ) : (
              leads.map(lead => {
                const feedback = getFeedback(lead);
                const signalCount = lead.signal_count || 0;
                return (
                  <tr key={lead.id} className={`hover:bg-gray-50 transition-colors ${selectedLeads.has(lead.id) ? 'bg-brand-50/30' : ''}`}>
                    {showCheckboxes && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedLeads.has(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                          className="rounded border-gray-300 text-brand-600"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Link to={`/leads/${lead.id}`} className="font-medium text-gray-900 hover:text-brand-600">
                        {lead.company_name}
                      </Link>
                      {lead.domain && <p className="text-xs text-gray-500">{lead.domain}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBadge score={lead.fit_score} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      <SegmentBadge segment={lead.segment} />
                    </td>
                    <td className="px-4 py-3">
                      {lead.campaign_name ? (
                        <Link to={`/campaigns/${lead.campaign_id}`} className="text-xs text-brand-600 hover:text-brand-700 truncate max-w-[120px] block">
                          {lead.campaign_name}
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {signalCount > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                          {signalCount}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {feedback && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${FEEDBACK_COLORS[feedback] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {FEEDBACK_LABELS[feedback] || feedback}
                        </span>
                      )}
                      {feedback === 'good_fit_try_again' && lead.next_outreach_date && (
                        <p className="text-xs text-amber-600 mt-0.5">{formatDate(lead.next_outreach_date)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(lead.updated_at || lead.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Link to={`/leads/${lead.id}`} className="text-gray-400 hover:text-brand-600">
                          <ExternalLink className="w-4 h-4" />
                        </Link>
                        {canDelete && (
                          <button
                            onClick={() => setDeleteTarget({ type: 'single', ids: [lead.id], name: lead.company_name })}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                            title="Delete lead"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = page <= 3 ? i + 1 : page + i - 2;
                if (p < 1 || p > totalPages) return null;
                return (
                  <button key={p} onClick={() => setPage(p)} className={`px-2.5 py-1 text-xs rounded ${p === page ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>
                    {p}
                  </button>
                );
              })}
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating bulk action bar */}
      {showCheckboxes && selectedLeads.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-5 py-3 bg-gray-900 text-white rounded-xl shadow-2xl z-50">
          <span className="text-sm font-medium">
            {selectedLeads.size} lead{selectedLeads.size > 1 ? 's' : ''} selected
            {selectedLeads.size >= MAX_RERUN_SELECTION && <span className="text-amber-400 ml-1">(max {MAX_RERUN_SELECTION})</span>}
          </span>
          <div className="w-px h-5 bg-gray-700" />
          {canRerun && (
            <button
              onClick={handleBulkRerun}
              disabled={bulkRerunning}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${bulkRerunning ? 'animate-spin' : ''}`} />
              {bulkRerunning ? 'Rerunning...' : 'Rerun'}
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteTarget({ type: 'bulk', ids: Array.from(selectedLeads), count: selectedLeads.size })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-red-400 hover:text-red-300 text-sm"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
          <button onClick={() => setSelectedLeads(new Set())} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {deleteTarget.type === 'single' ? 'Delete Lead' : deleteTarget.type === 'bulk' ? `Delete ${deleteTarget.count} Lead${(deleteTarget.count || 0) !== 1 ? 's' : ''}` : 'Clear All Leads'}
                </h3>
                <p className="text-sm text-gray-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {deleteTarget.type === 'single'
                ? `Are you sure you want to delete "${deleteTarget.name}"?`
                : deleteTarget.type === 'bulk'
                ? `This will permanently delete ${deleteTarget.count} selected lead${(deleteTarget.count || 0) !== 1 ? 's' : ''}.`
                : `This will permanently delete all ${total} leads from the entire app.`
              }
            </p>
            <ul className="text-sm text-gray-600 mb-6 space-y-1 pl-4">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                All associated personas and feedback will be removed
              </li>
            </ul>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
