import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { formatDate, formatTime } from '../utils/dates';
import {
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Download,
  Users,
  TrendingUp,
  RotateCcw,
  BarChart3,
  RefreshCw,
  Calendar,
  X,
  Trash2,
  AlertTriangle,
  FileText,
  Bookmark,
  Eye,
  MessageSquare,
  Clock,
  Filter,
  Columns3,
} from 'lucide-react';
import { ScoreBadge, SegmentBadge, InlineScoreStrip, GradeBadge, deriveActionState, ACTION_CONFIG } from '../components/ScoreBadge';
import type { ActionState } from '../components/ScoreBadge';
import { useToast } from '../components/Toast';

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
  scoring_version?: number;
  composite_version?: number;
  potential_score?: number | null;
  urgency_score?: number | null;
  icp_fit_score?: number | null;
  reachability_score?: number | null;
  signal_quality_score?: number | null;
  evidence_modifier?: number | null;
  data_confidence?: string | null;
  data_confidence_score?: number | null;
  dimensions_parsed?: Record<string, any> | null;
}

interface SavedFilter {
  id: string;
  name: string;
  filter_config: Record<string, any>;
  is_default: boolean;
  created_at: string;
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
const STORAGE_KEY = 'signalstack:leads:lastFilters';

const DIMENSION_FILTERS = [
  { key: 'potential', label: 'Potential', friendly: 'Would they buy?', color: 'sky' },
  { key: 'urgency', label: 'Urgency', friendly: 'Want to buy now?', color: 'amber' },
  { key: 'icp_fit', label: 'ICP Fit', friendly: 'How well do they fit?', color: 'sky' },
  { key: 'signal_quality', label: 'Signal Quality', friendly: 'Are they looking?', color: 'amber' },
  { key: 'reachability', label: 'Reachability', friendly: 'Can we reach them?', color: 'sky' },
] as const;

const GRADE_OPTIONS = ['A', 'B', 'C', 'D', 'F'] as const;

const GRADE_DESCRIPTIONS: Record<string, string> = {
  A: 'Excellent. Multiple sources confirm key facts.',
  B: 'Good. Strong enrichment coverage.',
  C: 'Moderate. Key fields unconfirmed.',
  D: 'Limited. Few sources or sparse data.',
  F: "Insufficient. Can't verify basics.",
};

const SYSTEM_PRESETS: Array<{
  id: string; name: string; actionState: ActionState;
  filter_config: Record<string, string>;
}> = [
  { id: 'preset:engage', name: 'Engage', actionState: 'engage',
    filter_config: { min_potential: '60', min_urgency: '35', composite_version: '2' } },
  { id: 'preset:watch', name: 'Watch', actionState: 'watch',
    filter_config: { min_potential: '60', max_urgency: '34', composite_version: '2' } },
  { id: 'preset:research', name: 'Research', actionState: 'research',
    filter_config: { max_signal_quality: '29', min_icp_fit: '50', composite_version: '2' } },
  { id: 'preset:pass', name: 'Pass', actionState: 'pass',
    filter_config: { max_potential: '39', composite_version: '2' } },
];

function getInitialFilter(key: string, defaultValue = ''): string {
  const urlValue = new URLSearchParams(window.location.search).get(key);
  if (urlValue !== null) return urlValue;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (stored[key] !== undefined) return String(stored[key]);
  } catch {}
  return defaultValue;
}

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
const MAX_BULK_SELECTION = 100;

const BULK_SNOOZE_PRESETS = [
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
];

const BULK_WATCH_CATEGORIES = [
  { id: 'timing_watch', label: 'Timing', desc: 'Waiting for buying signals' },
  { id: 'data_needs', label: 'Data', desc: 'Needs more enrichment' },
  { id: 'nurture', label: 'Nurture', desc: 'Long-term monitoring' },
  { id: 'manual', label: 'Manual', desc: 'Custom watch' },
];

const ACTION_COLOR_MAP: Record<string, string> = {
  engage: '#10b981', watch: '#f59e0b', research: '#38bdf8', pass: '#d1d5db',
};

function scoreCellColor(val: number): string {
  if (val >= 60) return 'text-emerald-700 bg-emerald-50';
  if (val >= 35) return 'text-amber-700 bg-amber-50';
  return 'text-gray-500 bg-gray-50';
}

interface ColumnDef {
  id: string;
  label: string;
  sortKey?: string;
  width?: string;
  alwaysVisible?: boolean;
  defaultVisible?: boolean;
  group: 'core' | 'dimensions' | 'meta';
}

const COLUMNS: ColumnDef[] = [
  { id: 'company',          label: 'Company',          sortKey: 'company_name',       alwaysVisible: true, group: 'core' },
  { id: 'score',            label: 'Score',            sortKey: 'fit_score',          defaultVisible: true, group: 'core',       width: 'w-[160px]' },
  { id: 'campaign',         label: 'Campaign',                                        defaultVisible: true, group: 'core',       width: 'w-[160px]' },
  { id: 'status',           label: 'Status',           sortKey: 'current_feedback',   defaultVisible: true, group: 'core',       width: 'w-[100px]' },
  { id: 'updated',          label: 'Updated',          sortKey: 'created_at',         defaultVisible: true, group: 'core',       width: 'w-[90px]' },
  { id: 'potential',        label: 'Potential',        sortKey: 'potential_score',     group: 'dimensions', width: 'w-[80px]' },
  { id: 'urgency',          label: 'Urgency',          sortKey: 'urgency_score',       group: 'dimensions', width: 'w-[80px]' },
  { id: 'icp_fit',          label: 'ICP Fit',          sortKey: 'icp_fit_score',       group: 'dimensions', width: 'w-[80px]' },
  { id: 'signal_quality',   label: 'Signal Quality',   sortKey: 'signal_quality_score', group: 'dimensions', width: 'w-[80px]' },
  { id: 'reachability',     label: 'Reachability',     sortKey: 'reachability_score',  group: 'dimensions', width: 'w-[80px]' },
  { id: 'data_confidence',  label: 'Confidence',       sortKey: 'data_confidence_score', group: 'dimensions', width: 'w-[80px]' },
  { id: 'segment',          label: 'Segment',                                          group: 'meta',       width: 'w-[70px]' },
  { id: 'signals',          label: 'Signals',                                          group: 'meta',       width: 'w-[70px]' },
];

const COLUMNS_STORAGE_KEY = 'signalstack:leads:columns';
const DEFAULT_VISIBLE = new Set(COLUMNS.filter(c => c.alwaysVisible || c.defaultVisible).map(c => c.id));

const FEEDBACK_DOT_COLORS: Record<string, string> = {
  bad_fit: 'bg-red-500',
  good_fit_response: 'bg-green-500',
  good_fit_booked: 'bg-blue-500',
  good_fit_try_again: 'bg-amber-500',
  good_fit_no_response: 'bg-gray-400',
  closed_won: 'bg-emerald-500',
  closed_lost: 'bg-rose-500',
  existing_customer: 'bg-purple-500',
  stalled: 'bg-slate-400',
  nurture: 'bg-sky-500',
};

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

  // Bulk action state
  const { showToast } = useToast();
  const feedbackDropdownRef = useRef<HTMLDivElement>(null);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [watchSnooze, setWatchSnooze] = useState('');
  const [watchCategory, setWatchCategory] = useState('timing_watch');
  const [watchNotes, setWatchNotes] = useState('');
  const [watchReenrich, setWatchReenrich] = useState(true);
  const [bulkWatching, setBulkWatching] = useState(false);
  const [showFeedbackDropdown, setShowFeedbackDropdown] = useState(false);
  const [bulkFeedbacking, setBulkFeedbacking] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    return new Set(DEFAULT_VISIBLE);
  });
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const activeColumns = COLUMNS.filter(c => c.alwaysVisible || visibleColumns.has(c.id));
  const colSpan = activeColumns.length + (showCheckboxes ? 1 : 0);

  const toggleColumn = (id: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const showAllColumns = () => setVisibleColumns(new Set(COLUMNS.map(c => c.id)));
  const resetColumns = () => setVisibleColumns(new Set(DEFAULT_VISIBLE));

  // Dimension filter state
  const [minPotential, setMinPotential] = useState(() => getInitialFilter('min_potential'));
  const [maxPotential, setMaxPotential] = useState(() => getInitialFilter('max_potential'));
  const [minUrgency, setMinUrgency] = useState(() => getInitialFilter('min_urgency'));
  const [maxUrgency, setMaxUrgency] = useState(() => getInitialFilter('max_urgency'));
  const [minIcpFit, setMinIcpFit] = useState(() => getInitialFilter('min_icp_fit'));
  const [maxIcpFit, setMaxIcpFit] = useState(() => getInitialFilter('max_icp_fit'));
  const [minReachability, setMinReachability] = useState(() => getInitialFilter('min_reachability'));
  const [maxReachability, setMaxReachability] = useState(() => getInitialFilter('max_reachability'));
  const [minSignalQuality, setMinSignalQuality] = useState(() => getInitialFilter('min_signal_quality'));
  const [maxSignalQuality, setMaxSignalQuality] = useState(() => getInitialFilter('max_signal_quality'));
  const [dataConfidenceGrades, setDataConfidenceGrades] = useState<Set<string>>(() => {
    const val = getInitialFilter('data_confidence');
    return val ? new Set(val.split(',').filter(Boolean)) : new Set();
  });
  const [compositeVersion, setCompositeVersion] = useState(() => getInitialFilter('composite_version'));

  // Saved filters + presets
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState('');
  const [savingFilter, setSavingFilter] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Count preview
  const [matchCount, setMatchCount] = useState<{ count: number; v2_count: number } | null>(null);

  const DIMENSION_STATE: Record<string, { min: string; max: string; setMin: (v: string) => void; setMax: (v: string) => void }> = {
    potential:      { min: minPotential, max: maxPotential, setMin: setMinPotential, setMax: setMaxPotential },
    urgency:        { min: minUrgency, max: maxUrgency, setMin: setMinUrgency, setMax: setMaxUrgency },
    icp_fit:        { min: minIcpFit, max: maxIcpFit, setMin: setMinIcpFit, setMax: setMaxIcpFit },
    signal_quality: { min: minSignalQuality, max: maxSignalQuality, setMin: setMinSignalQuality, setMax: setMaxSignalQuality },
    reachability:   { min: minReachability, max: maxReachability, setMin: setMinReachability, setMax: setMaxReachability },
  };

  const hasDimensionFilters = !!(minPotential || maxPotential || minUrgency || maxUrgency || minIcpFit || maxIcpFit ||
    minReachability || maxReachability || minSignalQuality || maxSignalQuality || dataConfidenceGrades.size > 0 || compositeVersion);

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
      else if (next.size < MAX_BULK_SELECTION) { next.add(id); }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedLeads.size > 0) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(leads.slice(0, MAX_BULK_SELECTION).map(l => l.id)));
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
      showToast('success',
        deleteTarget.type === 'single' ? `Deleted "${deleteTarget.name}"` : `Deleted ${deleteTarget.count} leads`
      );
      clearBulkSelection();
      setDeleteTarget(null);
      fetchLeads();
      api('/leads/stats').then((data: any) => setStats(data)).catch(() => {});
    } catch (err: any) {
      showToast('error', 'Delete failed', err?.message);
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
      showToast('info', `${orphans.length} lead(s) have no campaign`, 'Leads without campaigns cannot be rerun');
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
      showToast('success', `Rerun started for ${selected.length} leads`);
      clearBulkSelection();
    } catch (err: any) {
      showToast('error', 'Rerun failed', err.message);
    } finally {
      setBulkRerunning(false);
    }
  };

  const bulkTarget = (): { lead_ids?: string[]; filter?: Record<string, string> } =>
    selectAllMatching ? { filter: getFullFilterConfig() } : { lead_ids: Array.from(selectedLeads) };

  const bulkCount = selectAllMatching ? (matchCount?.count ?? total) : selectedLeads.size;

  const clearBulkSelection = () => {
    setSelectedLeads(new Set());
    setSelectAllMatching(false);
  };

  const handleBulkWatch = async () => {
    if (!watchSnooze) return;
    setBulkWatching(true);
    try {
      const result = await api('/leads/bulk-action', {
        method: 'POST',
        body: JSON.stringify({
          ...bulkTarget(),
          action: 'add_to_watchlist',
          params: {
            snooze_until: watchSnooze,
            category: watchCategory,
            rerun_on_wake: watchReenrich,
            notes: watchNotes || undefined,
          },
        }),
      }) as any;
      showToast('success',
        `Added ${result.added} lead${result.added !== 1 ? 's' : ''} to watch list`,
        result.skipped > 0 ? `${result.skipped} already watching or missing campaign` : undefined
      );
      setShowWatchModal(false);
      clearBulkSelection();
      setWatchSnooze('');
      setWatchCategory('timing_watch');
      setWatchNotes('');
      setWatchReenrich(true);
      fetchLeads();
    } catch (err: any) {
      showToast('error', 'Failed to add to watch list', err.message);
    } finally {
      setBulkWatching(false);
    }
  };

  const handleBulkFeedback = async (verdict: string) => {
    setShowFeedbackDropdown(false);
    setBulkFeedbacking(true);
    try {
      const result = await api('/leads/bulk-action', {
        method: 'POST',
        body: JSON.stringify({
          ...bulkTarget(),
          action: 'update_feedback',
          params: { verdict },
        }),
      }) as any;
      showToast('success',
        `Updated feedback on ${result.updated} lead${result.updated !== 1 ? 's' : ''}`,
        `Set to "${FEEDBACK_LABELS[verdict] || verdict}"`
      );
      clearBulkSelection();
      fetchLeads();
      api('/leads/stats').then((data: any) => setStats(data)).catch(() => {});
    } catch (err: any) {
      showToast('error', 'Failed to update feedback', err.message);
    } finally {
      setBulkFeedbacking(false);
    }
  };

  const handleBulkExport = async () => {
    setBulkExporting(true);
    try {
      const csvText = await api('/leads/bulk-action', {
        method: 'POST',
        body: JSON.stringify({
          ...bulkTarget(),
          action: 'export',
        }),
      });
      const blob = new Blob([csvText as string], { type: 'text/csv' });
      const count = selectAllMatching ? 'all' : selectedLeads.size;
      downloadBlob(blob, `leads-selected-${count}-${new Date().toISOString().slice(0, 10)}.csv`);
      showToast('success', `Exported ${bulkCount} lead${bulkCount !== 1 ? 's' : ''}`);
    } catch (err: any) {
      showToast('error', 'Export failed', err.message);
    } finally {
      setBulkExporting(false);
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
    function handleClickOutside(e: MouseEvent) {
      if (feedbackDropdownRef.current && !feedbackDropdownRef.current.contains(e.target as Node)) {
        setShowFeedbackDropdown(false);
      }
    }
    if (showFeedbackDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFeedbackDropdown]);

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
      if (minPotential) params.set('min_potential', minPotential);
      if (maxPotential) params.set('max_potential', maxPotential);
      if (minUrgency) params.set('min_urgency', minUrgency);
      if (maxUrgency) params.set('max_urgency', maxUrgency);
      if (minIcpFit) params.set('min_icp_fit', minIcpFit);
      if (maxIcpFit) params.set('max_icp_fit', maxIcpFit);
      if (minReachability) params.set('min_reachability', minReachability);
      if (maxReachability) params.set('max_reachability', maxReachability);
      if (minSignalQuality) params.set('min_signal_quality', minSignalQuality);
      if (maxSignalQuality) params.set('max_signal_quality', maxSignalQuality);
      if (dataConfidenceGrades.size > 0) params.set('data_confidence', Array.from(dataConfidenceGrades).join(','));
      if (compositeVersion) params.set('composite_version', compositeVersion);
      const data = await api(`/leads?${params}`);
      setLeads((data as any).leads);
      setTotal((data as any).total);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  }, [page, segment, feedbackFilter, campaignId, runId, sort, order, needsReoutreach, minScore, maxScore, minSignals, dateFrom, dateTo, debouncedSearch,
      minPotential, maxPotential, minUrgency, maxUrgency, minIcpFit, maxIcpFit, minReachability, maxReachability, minSignalQuality, maxSignalQuality,
      dataConfidenceGrades.size, compositeVersion]);

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

  // Computed values
  const activeFilterCount = [
    minScore, maxScore, dateFrom, dateTo, minSignals,
    minPotential, maxPotential, minUrgency, maxUrgency,
    minIcpFit, maxIcpFit, minReachability, maxReachability,
    minSignalQuality, maxSignalQuality, compositeVersion,
  ].filter(Boolean).length + (dataConfidenceGrades.size > 0 ? 1 : 0);

  const v2LeadCount = leads.filter(l => l.composite_version === 2).length;
  const v2Ratio = leads.length > 0 ? v2LeadCount / leads.length : 0;

  const clearDimensionFilters = () => {
    setMinPotential(''); setMaxPotential('');
    setMinUrgency(''); setMaxUrgency('');
    setMinIcpFit(''); setMaxIcpFit('');
    setMinReachability(''); setMaxReachability('');
    setMinSignalQuality(''); setMaxSignalQuality('');
    setDataConfidenceGrades(new Set());
    setCompositeVersion('');
  };

  const clearAllFilters = () => {
    setMinScore(''); setMaxScore('');
    setDateFrom(''); setDateTo('');
    setMinSignals('');
    clearDimensionFilters();
    setActivePreset(null);
    setPage(1);
    localStorage.removeItem(STORAGE_KEY);
  };

  const getCurrentFilterConfig = (): Record<string, string> => {
    const config: Record<string, string> = {};
    if (minScore) config.min_score = minScore;
    if (maxScore) config.max_score = maxScore;
    if (dateFrom) config.date_from = dateFrom;
    if (dateTo) config.date_to = dateTo;
    if (minSignals) config.min_signals = minSignals;
    if (minPotential) config.min_potential = minPotential;
    if (maxPotential) config.max_potential = maxPotential;
    if (minUrgency) config.min_urgency = minUrgency;
    if (maxUrgency) config.max_urgency = maxUrgency;
    if (minIcpFit) config.min_icp_fit = minIcpFit;
    if (maxIcpFit) config.max_icp_fit = maxIcpFit;
    if (minReachability) config.min_reachability = minReachability;
    if (maxReachability) config.max_reachability = maxReachability;
    if (minSignalQuality) config.min_signal_quality = minSignalQuality;
    if (maxSignalQuality) config.max_signal_quality = maxSignalQuality;
    if (dataConfidenceGrades.size > 0) config.data_confidence = Array.from(dataConfidenceGrades).join(',');
    if (compositeVersion) config.composite_version = compositeVersion;
    return config;
  };

  const getFullFilterConfig = (): Record<string, string> => {
    const config = getCurrentFilterConfig();
    if (segment) config.segment = segment;
    if (campaignId) config.campaign_id = campaignId;
    if (runId) config.run_id = runId;
    if (feedbackFilter && feedbackFilter !== 'none') config.feedback = feedbackFilter;
    if (debouncedSearch) config.search = debouncedSearch;
    return config;
  };

  const applyPreset = (preset: typeof SYSTEM_PRESETS[0]) => {
    if (activePreset === preset.id) {
      clearDimensionFilters();
      setActivePreset(null);
      setPage(1);
      return;
    }
    clearDimensionFilters();
    const c = preset.filter_config;
    if (c.min_potential) setMinPotential(c.min_potential);
    if (c.max_potential) setMaxPotential(c.max_potential);
    if (c.min_urgency) setMinUrgency(c.min_urgency);
    if (c.max_urgency) setMaxUrgency(c.max_urgency);
    if (c.min_icp_fit) setMinIcpFit(c.min_icp_fit);
    if (c.max_icp_fit) setMaxIcpFit(c.max_icp_fit);
    if (c.min_signal_quality) setMinSignalQuality(c.min_signal_quality);
    if (c.max_signal_quality) setMaxSignalQuality(c.max_signal_quality);
    if (c.composite_version) setCompositeVersion(c.composite_version);
    setActivePreset(preset.id);
    setShowAdvancedFilters(true);
    setPage(1);
  };

  const applySavedFilter = (sf: SavedFilter) => {
    clearAllFilters();
    const c: Record<string, string> = {};
    for (const [k, v] of Object.entries(sf.filter_config)) c[k] = String(v);
    if (c.min_score) setMinScore(c.min_score);
    if (c.max_score) setMaxScore(c.max_score);
    if (c.date_from) setDateFrom(c.date_from);
    if (c.date_to) setDateTo(c.date_to);
    if (c.min_signals) setMinSignals(c.min_signals);
    if (c.min_potential) setMinPotential(c.min_potential);
    if (c.max_potential) setMaxPotential(c.max_potential);
    if (c.min_urgency) setMinUrgency(c.min_urgency);
    if (c.max_urgency) setMaxUrgency(c.max_urgency);
    if (c.min_icp_fit) setMinIcpFit(c.min_icp_fit);
    if (c.max_icp_fit) setMaxIcpFit(c.max_icp_fit);
    if (c.min_reachability) setMinReachability(c.min_reachability);
    if (c.max_reachability) setMaxReachability(c.max_reachability);
    if (c.min_signal_quality) setMinSignalQuality(c.min_signal_quality);
    if (c.max_signal_quality) setMaxSignalQuality(c.max_signal_quality);
    if (c.data_confidence) setDataConfidenceGrades(new Set(c.data_confidence.split(',')));
    if (c.composite_version) setCompositeVersion(c.composite_version);
    setActivePreset(sf.id);
    setShowAdvancedFilters(true);
    setPage(1);
  };

  const handleSaveFilter = async () => {
    if (!saveFilterName.trim()) return;
    setSavingFilter(true);
    try {
      const result = await api('/leads/saved-filters', {
        method: 'POST',
        body: JSON.stringify({ name: saveFilterName.trim(), filter_config: getCurrentFilterConfig() }),
      }) as any;
      setSavedFilters(prev => [...prev, result]);
      setShowSaveModal(false);
      setSaveFilterName('');
    } catch (err) {
      console.error('Failed to save filter:', err);
    } finally {
      setSavingFilter(false);
    }
  };

  const handleDeleteFilter = async (filterId: string) => {
    try {
      await api(`/leads/saved-filters/${filterId}`, { method: 'DELETE' });
      setSavedFilters(prev => prev.filter(f => f.id !== filterId));
      if (activePreset === filterId) setActivePreset(null);
    } catch (err) {
      console.error('Failed to delete filter:', err);
    }
  };

  useEffect(() => {
    api('/leads/saved-filters').then((data: any) => {
      setSavedFilters(data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasDimensionFilters) { setMatchCount(null); return; }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (segment) params.set('segment', segment);
        if (campaignId) params.set('campaign_id', campaignId);
        if (minScore) params.set('min_score', minScore);
        if (maxScore) params.set('max_score', maxScore);
        if (minPotential) params.set('min_potential', minPotential);
        if (maxPotential) params.set('max_potential', maxPotential);
        if (minUrgency) params.set('min_urgency', minUrgency);
        if (maxUrgency) params.set('max_urgency', maxUrgency);
        if (minIcpFit) params.set('min_icp_fit', minIcpFit);
        if (maxIcpFit) params.set('max_icp_fit', maxIcpFit);
        if (minReachability) params.set('min_reachability', minReachability);
        if (maxReachability) params.set('max_reachability', maxReachability);
        if (minSignalQuality) params.set('min_signal_quality', minSignalQuality);
        if (maxSignalQuality) params.set('max_signal_quality', maxSignalQuality);
        if (dataConfidenceGrades.size > 0) params.set('data_confidence', Array.from(dataConfidenceGrades).join(','));
        if (compositeVersion) params.set('composite_version', compositeVersion);
        const data = await api(`/leads/count?${params}`) as any;
        setMatchCount(data);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, campaignId, minScore, maxScore, minPotential, maxPotential, minUrgency, maxUrgency,
      minIcpFit, maxIcpFit, minReachability, maxReachability, minSignalQuality, maxSignalQuality,
      dataConfidenceGrades.size, compositeVersion]);

  useEffect(() => {
    const config = getCurrentFilterConfig();
    if (Object.keys(config).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minScore, maxScore, dateFrom, dateTo, minSignals, minPotential, maxPotential,
      minUrgency, maxUrgency, minIcpFit, maxIcpFit, minReachability, maxReachability,
      minSignalQuality, maxSignalQuality, dataConfidenceGrades.size, compositeVersion]);

  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...visibleColumns]));
  }, [visibleColumns]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    }
    if (showColumnPicker) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColumnPicker]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasDimensionFilters) setShowAdvancedFilters(true); }, []);

  const renderCell = (colId: string, lead: Lead, feedback: string | null, action: ActionState | null, actionCfg: typeof ACTION_CONFIG[ActionState] | null) => {
    switch (colId) {
      case 'company':
        return (
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <Link to={`/leads/${lead.id}`} className="font-medium text-gray-900 hover:text-brand-600 block truncate">
                {lead.company_name}
              </Link>
              <div className="flex items-center gap-1.5 mt-0.5">
                {lead.domain && <span className="text-[11px] text-gray-400 truncate">{lead.domain}</span>}
                {lead.segment && (
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0 rounded ${
                    lead.segment === 'ENT' ? 'text-purple-600 bg-purple-50' :
                    lead.segment === 'MM' ? 'text-blue-600 bg-blue-50' :
                    'text-teal-600 bg-teal-50'
                  }`}>{lead.segment}</span>
                )}
              </div>
            </div>
          </div>
        );
      case 'score':
        return (
          <InlineScoreStrip
            score={lead.fit_score}
            potential={lead.potential_score}
            urgency={lead.urgency_score}
            evidenceModifier={lead.evidence_modifier}
            compositeVersion={lead.composite_version}
          />
        );
      case 'campaign':
        return lead.campaign_name ? (
          <Link to={`/campaigns/${lead.campaign_id}`} className="text-xs text-brand-600 hover:text-brand-700 truncate max-w-[200px] block">
            {lead.campaign_name}
          </Link>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        );
      case 'status':
        return feedback ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${FEEDBACK_COLORS[feedback] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {FEEDBACK_LABELS[feedback] || feedback}
          </span>
        ) : action && actionCfg ? (
          <span className={`text-[10px] font-medium ${
            action === 'engage' ? 'text-emerald-600' :
            action === 'watch' ? 'text-amber-600' :
            action === 'research' ? 'text-sky-600' :
            'text-gray-400'
          }`}>
            {actionCfg.label}
          </span>
        ) : null;
      case 'updated':
        return <span className="text-[11px] text-gray-400 tabular-nums">{formatDate(lead.updated_at || lead.created_at)}</span>;
      case 'potential': {
        const val = lead.potential_score;
        return val != null ? (
          <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${scoreCellColor(val)}`}>{val}</span>
        ) : <span className="text-xs text-gray-300">—</span>;
      }
      case 'urgency': {
        const val = lead.urgency_score;
        return val != null ? (
          <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${scoreCellColor(val)}`}>{val}</span>
        ) : <span className="text-xs text-gray-300">—</span>;
      }
      case 'icp_fit': {
        const val = lead.icp_fit_score;
        return val != null ? (
          <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${scoreCellColor(val)}`}>{val}</span>
        ) : <span className="text-xs text-gray-300">—</span>;
      }
      case 'signal_quality': {
        const val = lead.signal_quality_score;
        return val != null ? (
          <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${scoreCellColor(val)}`}>{val}</span>
        ) : <span className="text-xs text-gray-300">—</span>;
      }
      case 'reachability': {
        const val = lead.reachability_score;
        return val != null ? (
          <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${scoreCellColor(val)}`}>{val}</span>
        ) : <span className="text-xs text-gray-300">—</span>;
      }
      case 'data_confidence':
        return lead.data_confidence ? (
          <GradeBadge grade={lead.data_confidence} size="sm" />
        ) : <span className="text-xs text-gray-300">—</span>;
      case 'segment':
        return lead.segment ? (
          <span className={`text-[9px] font-bold uppercase px-1.5 py-0 rounded ${
            lead.segment === 'ENT' ? 'text-purple-600 bg-purple-50' :
            lead.segment === 'MM' ? 'text-blue-600 bg-blue-50' :
            'text-teal-600 bg-teal-50'
          }`}>{lead.segment}</span>
        ) : <span className="text-xs text-gray-300">—</span>;
      case 'signals':
        return lead.signal_count != null ? (
          <span className="text-xs text-gray-600 tabular-nums">{lead.signal_count}</span>
        ) : <span className="text-xs text-gray-300">—</span>;
      default:
        return null;
    }
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

      {/* ── Row 1: Search + Presets + Sort/Filter ──────────────── */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search companies..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
          />
        </div>

        {/* Preset tabs */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => { if (activePreset) { clearDimensionFilters(); setActivePreset(null); setPage(1); } }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              !activePreset ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            All
          </button>
          {SYSTEM_PRESETS.map(preset => {
            const isActive = activePreset === preset.id;
            const colorMap: Record<string, string> = {
              engage: isActive ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:text-emerald-700 hover:bg-emerald-50',
              watch: isActive ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-500 hover:text-amber-700 hover:bg-amber-50',
              research: isActive ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-500 hover:text-sky-700 hover:bg-sky-50',
              pass: isActive ? 'bg-gray-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200',
            };
            return (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${colorMap[preset.actionState] || ''}`}
              >
                {preset.name}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Filter toggle */}
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            showAdvancedFilters || activeFilterCount > 0
              ? 'bg-brand-50 border-brand-300 text-brand-700'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="min-w-[18px] h-[18px] text-[10px] leading-[18px] text-center rounded-full bg-brand-600 text-white px-1">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Column picker */}
        <div className="relative" ref={columnPickerRef}>
          <button
            onClick={() => setShowColumnPicker(!showColumnPicker)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
              showColumnPicker || activeColumns.length > DEFAULT_VISIBLE.size
                ? 'bg-brand-50 border-brand-300 text-brand-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
            Columns
            {activeColumns.length !== DEFAULT_VISIBLE.size && (
              <span className="min-w-[18px] h-[18px] text-[10px] leading-[18px] text-center rounded-full bg-brand-600 text-white px-1">
                {activeColumns.length}
              </span>
            )}
          </button>

          {showColumnPicker && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-2">
              <div className="px-3 py-1.5 mb-1 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">Visible Columns</span>
                <div className="flex items-center gap-2">
                  <button onClick={showAllColumns} className="text-[10px] text-brand-600 hover:underline">All</button>
                  <button onClick={resetColumns} className="text-[10px] text-gray-500 hover:underline">Reset</button>
                </div>
              </div>
              {(['core', 'dimensions', 'meta'] as const).map(group => {
                const groupCols = COLUMNS.filter(c => c.group === group && !c.alwaysVisible);
                if (groupCols.length === 0) return null;
                return (
                  <div key={group}>
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-300 mt-1">
                      {group === 'core' ? 'Core' : group === 'dimensions' ? 'Dimensions' : 'Meta'}
                    </div>
                    {groupCols.map(col => (
                      <label key={col.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 cursor-pointer hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={visibleColumns.has(col.id)}
                          onChange={() => toggleColumn(col.id)}
                          className="rounded border-gray-300 text-brand-600"
                        />
                        {col.label}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Saved filters + match count ─────────────────── */}
      {(savedFilters.length > 0 || activeFilterCount > 0 || matchCount) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {savedFilters.map(sf => (
            <div key={sf.id} className={`group flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
              activePreset === sf.id
                ? 'bg-brand-50 border-brand-300 text-brand-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
            }`}>
              <button onClick={() => applySavedFilter(sf)} className="flex items-center gap-1">
                <Bookmark className="w-3 h-3" />
                {sf.name}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteFilter(sf.id); }}
                className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-400 hover:text-red-500 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {activeFilterCount > 0 && (
            <button
              onClick={() => setShowSaveModal(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-brand-600 hover:text-brand-700 rounded-full border border-dashed border-brand-300 hover:border-brand-400 hover:bg-brand-50/50 transition-colors"
            >
              <Bookmark className="w-3 h-3" />
              Save
            </button>
          )}
          {matchCount && (
            <span className="ml-auto text-xs text-gray-500 tabular-nums">
              <span className="font-semibold text-gray-700">{matchCount.count}</span> leads match
              {matchCount.v2_count < matchCount.count && (
                <span className="text-gray-400 ml-1">({matchCount.v2_count} v2)</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* ── Collapsible Filters Panel ──────────────────────────── */}
      {showAdvancedFilters && (
        <div className="mb-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {/* Section: Filter by */}
          <div className="flex items-center gap-3 p-3 flex-wrap border-b border-gray-100">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 w-14 shrink-0">Filter by</span>
            <select value={segment} onChange={e => { setSegment(e.target.value); setPage(1); }} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50">
              <option value="">All Segments</option>
              {SEGMENTS.filter(Boolean).map(s => <option key={s} value={s}>{s === 'ENT' ? 'Enterprise' : s === 'MM' ? 'Mid-Market' : 'SMB'}</option>)}
            </select>
            <select value={campaignId} onChange={e => { setCampaignId(e.target.value); setRunId(''); setPage(1); }} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50">
              <option value="">All Campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {runs.length > 0 && (
              <select value={runId} onChange={e => { setRunId(e.target.value); setPage(1); }} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 max-w-[200px]">
                <option value="">All Runs</option>
                {runs.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            )}
            <select value={feedbackFilter} onChange={e => { setFeedbackFilter(e.target.value); setNeedsReoutreach(false); setPage(1); }} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50">
              {FEEDBACK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              onClick={() => { setNeedsReoutreach(!needsReoutreach); setFeedbackFilter(''); setPage(1); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                needsReoutreach
                  ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <RefreshCw className="w-3 h-3" />
              Re-outreach
            </button>
          </div>

          {/* Section: Refine */}
          <div className="flex items-center gap-3 p-3 flex-wrap border-b border-gray-100">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 w-14 shrink-0">Refine</span>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-medium text-gray-500 uppercase">Score</label>
              <input type="number" min="0" max="100" placeholder="Min" value={minScore}
                onChange={e => { setMinScore(e.target.value); setActivePreset(null); setPage(1); }}
                className="w-14 px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
              <span className="text-gray-300 text-xs">–</span>
              <input type="number" min="0" max="100" placeholder="Max" value={maxScore}
                onChange={e => { setMaxScore(e.target.value); setActivePreset(null); setPage(1); }}
                className="w-14 px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
            </div>
            <div className="w-px h-5 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-medium text-gray-500 uppercase">
                <Calendar className="w-3 h-3 inline mr-0.5" />Date
              </label>
              <input type="date" value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setActivePreset(null); setPage(1); }}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
              <span className="text-gray-300 text-xs">to</span>
              <input type="date" value={dateTo}
                onChange={e => { setDateTo(e.target.value); setActivePreset(null); setPage(1); }}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
            </div>
            <div className="w-px h-5 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-medium text-gray-500 uppercase">Signals</label>
              <input type="number" min="0" placeholder="Min" value={minSignals}
                onChange={e => { setMinSignals(e.target.value); setActivePreset(null); setPage(1); }}
                className="w-12 px-2 py-1.5 text-xs border border-gray-200 rounded bg-gray-50" />
            </div>
          </div>

          {/* Section: Dimensions */}
          <div className="p-3">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Dimensions</span>
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
                {[
                  { value: '', label: 'All' },
                  { value: '1', label: 'v1' },
                  { value: '2', label: 'v2' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setCompositeVersion(opt.value); setPage(1); }}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                      compositeVersion === opt.value
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 mb-3">
              {DIMENSION_FILTERS.map(dim => {
                const state = DIMENSION_STATE[dim.key];
                const borderColor = dim.color === 'sky' ? 'border-sky-200 focus:ring-sky-200' : 'border-amber-200 focus:ring-amber-200';
                const labelColor = dim.color === 'sky' ? 'text-sky-700' : 'text-amber-700';
                const dotColor = dim.color === 'sky' ? 'bg-sky-400' : 'bg-amber-400';
                return (
                  <div key={dim.key} className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 min-w-[100px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                      <span className={`text-[11px] font-semibold ${labelColor}`}>{dim.label}</span>
                    </div>
                    <input type="number" min="0" max="100" placeholder="Min" value={state.min}
                      onChange={e => { state.setMin(e.target.value); setActivePreset(null); setPage(1); }}
                      className={`w-14 px-2 py-1 text-xs border rounded bg-gray-50 focus:outline-none focus:ring-1 ${borderColor}`} />
                    <span className="text-gray-300 text-xs">–</span>
                    <input type="number" min="0" max="100" placeholder="Max" value={state.max}
                      onChange={e => { state.setMax(e.target.value); setActivePreset(null); setPage(1); }}
                      className={`w-14 px-2 py-1 text-xs border rounded bg-gray-50 focus:outline-none focus:ring-1 ${borderColor}`} />
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                Data Confidence
              </span>
              {GRADE_OPTIONS.map(grade => {
                const isSelected = dataConfidenceGrades.has(grade);
                const gradeColors: Record<string, string> = {
                  A: isSelected ? 'bg-emerald-100 text-emerald-800 border-emerald-400 shadow-sm' : 'bg-white text-emerald-700 border-emerald-200',
                  B: isSelected ? 'bg-sky-100 text-sky-800 border-sky-400 shadow-sm' : 'bg-white text-sky-700 border-sky-200',
                  C: isSelected ? 'bg-amber-100 text-amber-800 border-amber-400 shadow-sm' : 'bg-white text-amber-700 border-amber-200',
                  D: isSelected ? 'bg-orange-100 text-orange-800 border-orange-400 shadow-sm' : 'bg-white text-orange-700 border-orange-200',
                  F: isSelected ? 'bg-red-100 text-red-800 border-red-400 shadow-sm' : 'bg-white text-red-700 border-red-200',
                };
                return (
                  <button
                    key={grade}
                    onClick={() => {
                      const next = new Set(dataConfidenceGrades);
                      next.has(grade) ? next.delete(grade) : next.add(grade);
                      setDataConfidenceGrades(next);
                      setActivePreset(null);
                      setPage(1);
                    }}
                    title={GRADE_DESCRIPTIONS[grade]}
                    className={`w-7 h-7 rounded-md border text-[10px] font-bold transition-all hover:scale-105 ${gradeColors[grade]}`}
                  >
                    {grade}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          {activeFilterCount > 0 && (
            <div className="border-t border-gray-100 px-3 py-2 flex items-center justify-between">
              <button onClick={clearAllFilters}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 transition-colors">
                <X className="w-3.5 h-3.5" />
                Clear all <span className="text-gray-400">({activeFilterCount})</span>
              </button>
              {matchCount && hasDimensionFilters && (
                <span className="text-xs text-gray-500 tabular-nums">
                  <span className="font-semibold text-gray-700">{matchCount.count}</span> match
                  {matchCount.v2_count < matchCount.count && (
                    <span className="text-gray-400"> · {matchCount.v2_count} v2</span>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* V1/V2 Mixed State Banner */}
      {leads.length > 0 && v2Ratio < 0.3 && hasDimensionFilters && (
        <div className="mb-3 flex items-center gap-2 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700">
            <span className="font-semibold">{leads.length - v2LeadCount} of {leads.length}</span> leads lack dimension scores.
            Backfill or re-run campaigns to populate v2 scoring.
          </p>
          <button
            onClick={() => { setCompositeVersion('2'); setPage(1); }}
            className="ml-auto text-xs font-medium text-amber-700 hover:text-amber-900 whitespace-nowrap underline underline-offset-2"
          >
            Show v2 only
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/80 border-b border-gray-200">
              {showCheckboxes && (
                <th className="pl-3 pr-1 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={selectedLeads.size > 0 && (selectedLeads.size === leads.length || selectedLeads.size >= MAX_BULK_SELECTION)}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-brand-600"
                  />
                </th>
              )}
              {activeColumns.map(col => (
                <th key={col.id} className={`px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider ${col.width || ''}`}>
                  {col.sortKey ? (
                    <button onClick={() => toggleSort(col.sortKey!)} className="flex items-center gap-1 hover:text-gray-600 group">
                      {col.label}
                      {sort === col.sortKey ? (
                        order === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-brand-500" />
                          : <ChevronDown className="w-3 h-3 text-brand-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                      )}
                    </button>
                  ) : (
                    <span>{col.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* "Select all matching" banner */}
            {showCheckboxes && selectedLeads.size > 0 && selectedLeads.size >= leads.length && !selectAllMatching && total > leads.length && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-2 bg-brand-50 border-b border-brand-100 text-center">
                  <span className="text-xs text-brand-700">
                    All <span className="font-semibold">{leads.length}</span> on this page selected.{' '}
                    <button onClick={() => setSelectAllMatching(true)}
                      className="font-semibold underline underline-offset-2 hover:text-brand-900 transition-colors">
                      Select all {matchCount?.count ?? total} matching
                    </button>
                  </span>
                </td>
              </tr>
            )}
            {selectAllMatching && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-2 bg-brand-50 border-b border-brand-100 text-center">
                  <span className="text-xs text-brand-700">
                    All <span className="font-semibold">{matchCount?.count ?? total}</span> matching leads selected.{' '}
                    <button onClick={clearBulkSelection}
                      className="font-semibold underline underline-offset-2 hover:text-brand-900 transition-colors">
                      Clear
                    </button>
                  </span>
                </td>
              </tr>
            )}
            {loading ? (
              <tr><td colSpan={colSpan} className="px-4 py-12 text-center text-gray-500">Loading leads...</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-4 py-16 text-center">
                {activeFilterCount > 0 ? (
                  <div className="flex flex-col items-center gap-2">
                    <Search className="w-8 h-8 text-gray-300" />
                    <p className="text-sm font-medium text-gray-500">No leads match these filters</p>
                    <p className="text-xs text-gray-400">Try widening your ranges or removing some filters</p>
                    <button onClick={clearAllFilters} className="mt-2 px-4 py-1.5 text-xs font-medium text-brand-600 border border-brand-300 rounded-lg hover:bg-brand-50 transition-colors">
                      Clear all filters
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">{search ? 'No leads match your search' : 'No leads found'}</p>
                )}
              </td></tr>
            ) : (
              leads.map(lead => {
                const feedback = getFeedback(lead);
                const action = lead.composite_version === 2
                  ? deriveActionState({
                      potential_score: lead.potential_score ?? 0,
                      urgency_score: lead.urgency_score ?? 0,
                      evidence_modifier: lead.evidence_modifier ?? 0.5,
                    })
                  : null;
                const actionCfg = action ? ACTION_CONFIG[action] : null;
                const rowTint = action === 'engage' ? 'bg-emerald-50/30'
                  : action === 'pass' ? 'opacity-60'
                  : '';
                const actionShadow = action ? { boxShadow: `inset 4px 0 0 0 ${ACTION_COLOR_MAP[action] || '#d1d5db'}` } : undefined;

                return (
                  <tr key={lead.id} className={`group hover:bg-gray-50 transition-colors ${selectedLeads.has(lead.id) ? 'bg-brand-50/30' : rowTint}`}>
                    {showCheckboxes && (
                      <td className="pl-3 pr-1 py-2.5" style={actionShadow}>
                        <input
                          type="checkbox"
                          checked={selectedLeads.has(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                          className="rounded border-gray-300 text-brand-600"
                        />
                      </td>
                    )}
                    {activeColumns.map((col, i) => (
                      <td
                        key={col.id}
                        className={`px-3 py-2.5 ${col.width || ''}`}
                        style={i === 0 && !showCheckboxes ? actionShadow : undefined}
                      >
                        {renderCell(col.id, lead, feedback, action, actionCfg)}
                      </td>
                    ))}
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

      {/* ── Floating Bulk Command Bar ─────────────────────────────── */}
      {showCheckboxes && (selectedLeads.size > 0 || selectAllMatching) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-1.5 pl-4 pr-2 py-2.5 bg-gray-900/95 backdrop-blur-sm text-white rounded-2xl shadow-2xl shadow-black/25 border border-white/[0.06]">
            {/* Selection count */}
            <div className="flex items-center gap-2 pr-3">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
              </span>
              <span className="text-sm font-semibold tabular-nums tracking-tight">
                {selectAllMatching ? bulkCount : selectedLeads.size}
              </span>
              <span className="text-xs text-gray-400 font-medium">
                {selectAllMatching ? 'matching' : 'selected'}
              </span>
            </div>

            <div className="w-px h-6 bg-gray-700/80" />

            {/* Pipeline actions */}
            <div className="flex items-center gap-1 px-1.5">
              {canRerun && !selectAllMatching && (
                <button
                  onClick={handleBulkRerun}
                  disabled={bulkRerunning || selectedLeads.size > MAX_RERUN_SELECTION}
                  title={selectedLeads.size > MAX_RERUN_SELECTION ? `Rerun limited to ${MAX_RERUN_SELECTION} leads` : 'Re-enrich & re-score'}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-brand-600 rounded-lg text-xs font-semibold hover:bg-brand-500 disabled:opacity-35 disabled:cursor-not-allowed transition-all active:scale-[0.97]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${bulkRerunning ? 'animate-spin' : ''}`} />
                  {bulkRerunning ? 'Running...' : 'Rerun'}
                </button>
              )}
              <button
                onClick={() => setShowWatchModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600/90 rounded-lg text-xs font-semibold hover:bg-amber-500 transition-all active:scale-[0.97]"
              >
                <Eye className="w-3.5 h-3.5" />
                Watch
              </button>
              <div className="relative" ref={feedbackDropdownRef}>
                <button
                  onClick={() => setShowFeedbackDropdown(!showFeedbackDropdown)}
                  disabled={bulkFeedbacking}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.97] ${
                    showFeedbackDropdown
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-700/80 text-gray-200 hover:bg-gray-600'
                  } disabled:opacity-50`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {bulkFeedbacking ? 'Saving...' : 'Feedback'}
                  <ChevronDown className={`w-3 h-3 transition-transform ${showFeedbackDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* Feedback Dropdown (upward) */}
                {showFeedbackDropdown && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-52 bg-white rounded-xl shadow-2xl shadow-black/20 border border-gray-200/80 py-1.5 z-50">
                    <div className="px-3 py-1.5 mb-1 border-b border-gray-100">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Set verdict</span>
                    </div>
                    <div className="max-h-[280px] overflow-y-auto">
                      {FEEDBACK_OPTIONS.filter(o => o.value && o.value !== 'none').map(o => (
                        <button
                          key={o.value}
                          onClick={() => handleBulkFeedback(o.value)}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors"
                        >
                          <span className={`w-2 h-2 rounded-full ${FEEDBACK_DOT_COLORS[o.value] || 'bg-gray-400'} shrink-0`} />
                          <span className="font-medium text-xs">{o.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="w-px h-6 bg-gray-700/80" />

            {/* Utility */}
            <button
              onClick={handleBulkExport}
              disabled={bulkExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-gray-400 hover:text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {bulkExporting ? 'Saving...' : 'Export'}
            </button>

            {canDelete && !selectAllMatching && (
              <>
                <div className="w-px h-6 bg-gray-700/80" />
                <button
                  onClick={() => setDeleteTarget({ type: 'bulk', ids: Array.from(selectedLeads), count: selectedLeads.size })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-red-400/80 hover:text-red-300 text-xs font-medium transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}

            <button
              onClick={clearBulkSelection}
              className="ml-0.5 p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Save Filter Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-2 mb-4">
              <Bookmark className="w-5 h-5 text-brand-600" />
              <h3 className="font-semibold text-gray-900">Save Filter</h3>
            </div>
            <input
              type="text"
              value={saveFilterName}
              onChange={e => setSaveFilterName(e.target.value)}
              placeholder="Filter name..."
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSaveFilter()}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowSaveModal(false); setSaveFilterName(''); }}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFilter}
                disabled={!saveFilterName.trim() || savingFilter}
                className="px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50"
              >
                {savingFilter ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {/* ── Bulk Watch List Modal ──────────────────────────────────── */}
      {showWatchModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl shadow-black/15 w-full max-w-lg mx-4 overflow-hidden">
            {/* Header — amber accent strip */}
            <div className="bg-gradient-to-r from-amber-500 to-amber-400 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                    <Eye className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-[15px]">Add to Watch List</h3>
                    <p className="text-amber-100 text-xs font-medium">
                      {bulkCount} lead{bulkCount > 1 ? 's' : ''} · park and revisit
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowWatchModal(false); setWatchSnooze(''); setWatchNotes(''); }}
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Safety warning for >50 leads */}
              {bulkCount > 50 && (
                <div className="flex items-start gap-2.5 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Large batch: <span className="font-bold">{bulkCount} leads</span>.
                    Confirm the snooze date and category below.
                  </p>
                </div>
              )}

              {/* Snooze date */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  Wake after
                </label>
                <div className="grid grid-cols-3 gap-2 mb-2.5">
                  {BULK_SNOOZE_PRESETS.map(p => {
                    const d = new Date();
                    d.setDate(d.getDate() + p.days);
                    const val = d.toISOString().slice(0, 10);
                    const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const isSelected = watchSnooze === val;
                    return (
                      <button
                        key={p.label}
                        onClick={() => setWatchSnooze(val)}
                        className={`relative px-3 py-3 rounded-xl border-2 text-center transition-all ${
                          isSelected
                            ? 'bg-amber-50 border-amber-400 shadow-sm shadow-amber-100'
                            : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`block text-sm font-bold ${isSelected ? 'text-amber-700' : 'text-gray-800'}`}>
                          {p.label}
                        </span>
                        <span className={`block text-[10px] font-medium mt-0.5 ${isSelected ? 'text-amber-500' : 'text-gray-400'}`}>
                          {monthDay}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <input
                  type="date"
                  value={watchSnooze}
                  onChange={e => setWatchSnooze(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 focus:bg-white transition-colors"
                />
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-2.5 block">Why are you watching?</label>
                <div className="grid grid-cols-2 gap-2">
                  {BULK_WATCH_CATEGORIES.map(c => {
                    const isSelected = watchCategory === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setWatchCategory(c.id)}
                        className={`text-left px-3.5 py-3 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'bg-amber-50 border-amber-400 shadow-sm shadow-amber-100'
                            : 'bg-white border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className={`text-xs font-bold ${isSelected ? 'text-amber-700' : 'text-gray-700'}`}>
                          {c.label}
                        </span>
                        <span className={`block text-[10px] mt-0.5 leading-snug ${isSelected ? 'text-amber-500' : 'text-gray-400'}`}>
                          {c.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={watchNotes}
                  onChange={e => setWatchNotes(e.target.value)}
                  placeholder="Why are these leads being parked?"
                  rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 focus:bg-white transition-colors resize-none placeholder:text-gray-400"
                />
              </div>

              {/* Re-enrich toggle */}
              <label className="flex items-center justify-between py-2.5 px-3.5 bg-gray-50 rounded-xl cursor-pointer">
                <div>
                  <span className="text-xs font-semibold text-gray-700 block">Auto re-enrich on wake</span>
                  <span className="text-[10px] text-gray-400">Re-score with fresh data when the snooze expires</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={watchReenrich}
                  onClick={() => setWatchReenrich(!watchReenrich)}
                  className={`relative w-10 h-[22px] rounded-full transition-colors shrink-0 ${
                    watchReenrich ? 'bg-amber-500' : 'bg-gray-300'
                  }`}
                >
                  <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                    watchReenrich ? 'left-[22px]' : 'left-[3px]'
                  }`} />
                </button>
              </label>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={() => { setShowWatchModal(false); setWatchSnooze(''); setWatchNotes(''); }}
                className="px-4 py-2 text-sm text-gray-600 font-medium hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkWatch}
                disabled={!watchSnooze || bulkWatching}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-amber-600 rounded-xl hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.97] shadow-sm shadow-amber-200"
              >
                {bulkWatching ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Adding...
                  </span>
                ) : (
                  `Add ${bulkCount} to Watch List`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
