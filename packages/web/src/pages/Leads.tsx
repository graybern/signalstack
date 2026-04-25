import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  Search,
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

const SEGMENTS = ['', 'ENT', 'MM', 'SMB'];
const PAGE_SIZE = 25;

const FEEDBACK_OPTIONS = [
  { value: '', label: 'All Feedback' },
  { value: 'bad_fit', label: 'Bad Fit' },
  { value: 'good_fit_response', label: 'Response' },
  { value: 'good_fit_booked', label: 'Booked' },
  { value: 'good_fit_try_again', label: 'Try Again' },
  { value: 'good_fit_no_response', label: 'No Response' },
  { value: 'none', label: 'No Feedback' },
];

const FEEDBACK_COLORS: Record<string, string> = {
  bad_fit: 'bg-red-50 text-red-700 border-red-200',
  good_fit_response: 'bg-green-50 text-green-700 border-green-200',
  good_fit_booked: 'bg-blue-50 text-blue-700 border-blue-200',
  good_fit_try_again: 'bg-amber-50 text-amber-700 border-amber-200',
  good_fit_no_response: 'bg-gray-100 text-gray-600 border-gray-200',
  // Legacy
  good_fit: 'bg-green-50 text-green-700 border-green-200',
  not_fit: 'bg-red-50 text-red-700 border-red-200',
};

const FEEDBACK_LABELS: Record<string, string> = {
  bad_fit: 'Bad Fit',
  good_fit_response: 'Response',
  good_fit_booked: 'Booked',
  good_fit_try_again: 'Try Again',
  good_fit_no_response: 'No Response',
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

export function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('');
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
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

  useEffect(() => {
    api('/campaigns').then((data: any) => {
      setCampaigns((data || []).map((c: any) => ({ id: c.id, name: c.name })));
    }).catch(() => {});
    api('/leads/stats').then((data: any) => setStats(data)).catch(() => {});
  }, []);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort, order });
      if (segment) params.set('segment', segment);
      if (campaignId) params.set('campaign_id', campaignId);
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
      const data = await api(`/leads?${params}`);
      setLeads((data as any).leads);
      setTotal((data as any).total);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  }, [page, segment, feedbackFilter, campaignId, sort, order, needsReoutreach, minScore, maxScore, minSignals, dateFrom, dateTo]);

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

      if (format === 'json') {
        const data = await api(`/leads/export?${params}`);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `leads-export-${new Date().toISOString().slice(0, 10)}.json`);
      } else {
        const response = await fetch(`/api/leads/export?${params}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        const blob = await response.blob();
        downloadBlob(blob, `leads-export-${new Date().toISOString().slice(0, 10)}.csv`);
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filteredLeads = search
    ? leads.filter(l =>
        l.company_name.toLowerCase().includes(search.toLowerCase()) ||
        l.domain?.toLowerCase().includes(search.toLowerCase())
      )
    : leads;

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
        <select value={campaignId} onChange={e => { setCampaignId(e.target.value); setPage(1); }} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
          <option value="">All Campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
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
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-500">Loading leads...</td></tr>
            ) : filteredLeads.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-500">{search ? 'No leads match your search' : 'No leads found'}</td></tr>
            ) : (
              filteredLeads.map(lead => {
                const feedback = getFeedback(lead);
                const signalCount = lead.signal_count || 0;
                return (
                  <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
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
                        <p className="text-xs text-amber-600 mt-0.5">{new Date(lead.next_outreach_date).toLocaleDateString()}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/leads/${lead.id}`} className="text-gray-400 hover:text-brand-600">
                        <ExternalLink className="w-4 h-4" />
                      </Link>
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
