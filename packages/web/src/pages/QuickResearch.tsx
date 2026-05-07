import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { formatDateTime, timeAgo } from '../utils/dates';
import { useEventStream, SSEEvent } from '../hooks/useEventStream';
import { ScoreBadge } from '../components/ScoreBadge';
import { ActivityPanel } from '../components/ActivityPanel';
import {
  Search, Loader2, CheckCircle, XCircle, ExternalLink,
  Globe, Target, ArrowRight, RefreshCw, Clock, Eye,
  ChevronUp, ChevronDown,
} from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface ResearchEntry {
  id: string;
  status: string;
  campaign_id: string;
  campaign_name: string;
  target_lead_ids: string | null;
  started_at: string | null;
  completed_at: string | null;
  estimated_cost: number;
  lead_count: number;
  error_message: string | null;
  created_at: string;
  triggered_by_name: string | null;
  steps_run: string | null;
  lead: {
    id: string;
    company_name: string;
    domain: string;
    fit_score: number | null;
    fit_score_label: string | null;
    segment: string | null;
  } | null;
}

interface ActiveResearch {
  runId: string | null;
  leadId: string;
  domain: string;
  campaignId: string;
  campaignName: string;
  context?: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
  phase?: string;
  currentCompany?: string;
  stepNumber?: number;
  totalSteps?: number;
  error?: string;
}

function normalizeDomain(input: string): string {
  return input.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').trim();
}

export function QuickResearch() {
  const [domain, setDomain] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [context, setContext] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<ActiveResearch | null>(null);
  const [showActiveLog, setShowActiveLog] = useState(true);
  const [history, setHistory] = useState<ResearchEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const { subscribe } = useEventStream({
    types: [
      'campaign.progress', 'campaign.completed', 'campaign.failed',
      'pipeline.progress', 'pipeline.completed', 'pipeline.failed',
      'lead.stage_rerun', 'run.activity',
    ],
  });

  const loadHistory = useCallback(async () => {
    try {
      const data = await api('/research/history');
      setHistory(data || []);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    api('/campaigns').then((data: any) => {
      const list = (Array.isArray(data) ? data : data.campaigns || [])
        .filter((c: Campaign) => c.status === 'active');
      setCampaigns(list);
      if (list.length === 1) setCampaignId(list[0].id);
    }).catch(() => {});
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const unsub = subscribe('*', (event: SSEEvent) => {
      if (!active?.runId) return;
      const { type, data } = event;

      if ((type === 'campaign.progress' || type === 'pipeline.progress') && data.run_id === active.runId) {
        setActive(prev => prev ? {
          ...prev,
          status: 'running',
          phase: data.phase,
          currentCompany: data.current_company,
          stepNumber: data.step_number,
          totalSteps: data.total_steps,
        } : null);
      }

      if ((type === 'campaign.completed' || type === 'pipeline.completed') && data.run_id === active.runId) {
        setActive(prev => prev ? { ...prev, status: 'completed' } : null);
        loadHistory();
      }

      if ((type === 'campaign.failed' || type === 'pipeline.failed') && data.run_id === active.runId) {
        setActive(prev => prev ? { ...prev, status: 'failed', error: data.error } : null);
        loadHistory();
      }
    });
    return unsub;
  }, [subscribe, active?.runId, loadHistory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeDomain(domain);
    if (!normalized || !normalized.includes('.')) {
      setError('Enter a valid domain (e.g. workday.com)');
      return;
    }
    if (!campaignId) {
      setError('Select a campaign');
      return;
    }

    setSubmitting(true);
    setError('');
    setActive(null);
    setShowActiveLog(true);

    const campaign = campaigns.find(c => c.id === campaignId);

    try {
      const result = await api('/research', {
        method: 'POST',
        body: JSON.stringify({ domain: normalized, campaign_id: campaignId, ...(context.trim() ? { context: context.trim() } : {}) }),
      });
      setActive({
        runId: result.run_id,
        leadId: result.lead_id,
        domain: result.domain,
        campaignId,
        campaignName: campaign?.name || '',
        context: context.trim() || undefined,
        status: 'starting',
      });
      setDomain('');
      setContext('');
    } catch (err: any) {
      setError(err.message || 'Failed to start research');
    } finally {
      setSubmitting(false);
    }
  };

  const normalized = normalizeDomain(domain);
  const PHASE_LABELS: Record<string, string> = {
    enrichment: 'Enriching',
    scoring: 'Scoring',
    brief_generation: 'Generating Brief',
    audit: 'Auditing',
    research: 'Researching',
  };

  const COL_SPAN = 9;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Quick Research</h1>
        <p className="text-sm text-gray-500">Run the pipeline against a single company using an existing campaign's settings.</p>
      </div>

      {/* Research Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Domain</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={domain}
                  onChange={e => { setDomain(e.target.value); setError(''); }}
                  placeholder="e.g. workday.com"
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              {domain && normalized && normalized !== domain.toLowerCase().trim() && (
                <p className="text-xs text-gray-400 mt-1">
                  Will research: <span className="font-mono text-gray-600">{normalized}</span>
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Settings</label>
              <div className="relative">
                <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={campaignId}
                  onChange={e => { setCampaignId(e.target.value); setError(''); }}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent appearance-none bg-white"
                >
                  <option value="">Select campaign...</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting || !domain.trim() || !campaignId}
              className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Research
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Additional Context <span className="font-normal text-gray-400">(optional)</span></label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="e.g. Upcoming call — they mentioned evaluating ZTNA to replace GlobalProtect, ~500 employees, Series B..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm resize-y"
            />
            {context.length > 0 && (
              <p className="text-xs text-gray-400 mt-0.5 text-right">{context.length} chars</p>
            )}
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">
              <XCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </form>
      </div>

      {/* Active Research Status + Activity Log */}
      {active && (
        <div className={`rounded-xl border mb-6 overflow-hidden ${
          active.status === 'completed' ? 'bg-emerald-50 border-emerald-200' :
          active.status === 'failed' ? 'bg-red-50 border-red-200' :
          'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              {active.status === 'completed' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : active.status === 'failed' ? (
                <XCircle className="w-5 h-5 text-red-600" />
              ) : (
                <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{active.domain}</span>
                  <span className="text-xs text-gray-500">via {active.campaignName}</span>
                </div>
                {active.context && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-1" title={active.context}>
                    Context: "{active.context}"
                  </p>
                )}
                {active.status === 'starting' && (
                  <p className="text-xs text-amber-700">Starting pipeline...</p>
                )}
                {active.status === 'running' && active.phase && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-amber-700 font-medium">
                      {PHASE_LABELS[active.phase] || active.phase}
                      {active.currentCompany ? ` — ${active.currentCompany}` : ''}
                    </p>
                    {active.stepNumber != null && active.totalSteps != null && (
                      <span className="text-[10px] text-amber-600">
                        {active.stepNumber}/{active.totalSteps}
                      </span>
                    )}
                  </div>
                )}
                {active.status === 'completed' && (
                  <p className="text-xs text-emerald-700">Research complete</p>
                )}
                {active.status === 'failed' && (
                  <p className="text-xs text-red-700">{active.error || 'Research failed'}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowActiveLog(!showActiveLog)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 bg-white/70 rounded-lg border border-gray-200 hover:bg-white transition-colors"
              >
                <Eye className="w-3 h-3" />
                {showActiveLog ? 'Hide Log' : 'Show Log'}
              </button>
              <Link
                to={`/leads/${active.leadId}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 bg-white rounded-lg border border-gray-200 hover:border-brand-200 transition-colors"
              >
                View Lead
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
          {showActiveLog && active.runId && (
            <div className="border-t border-gray-200/50">
              <ActivityPanel runId={active.runId} />
            </div>
          )}
        </div>
      )}

      {/* Research History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" /> Recent Researches
          </h2>
          <button
            onClick={loadHistory}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {loadingHistory ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No quick researches yet. Enter a domain above to get started.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Campaign</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Steps</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map(entry => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    expanded={expandedLogId === entry.id}
                    onToggleLog={() => setExpandedLogId(expandedLogId === entry.id ? null : entry.id)}
                    colSpan={COL_SPAN}
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

const STEP_LABELS: Record<string, { label: string; color: string }> = {
  enrich: { label: 'E', color: 'bg-blue-100 text-blue-700' },
  score: { label: 'S', color: 'bg-amber-100 text-amber-700' },
  brief: { label: 'B', color: 'bg-purple-100 text-purple-700' },
  audit: { label: 'A', color: 'bg-emerald-100 text-emerald-700' },
  discover: { label: 'D', color: 'bg-cyan-100 text-cyan-700' },
  qualify: { label: 'Q', color: 'bg-gray-100 text-gray-600' },
};

function StepsPills({ stepsRun }: { stepsRun: string | null }) {
  if (!stepsRun) return <span className="text-xs text-gray-400">—</span>;
  try {
    const steps: string[] = JSON.parse(stepsRun);
    return (
      <div className="flex items-center gap-0.5">
        {steps.map(step => {
          const info = STEP_LABELS[step] || { label: step[0]?.toUpperCase() || '?', color: 'bg-gray-100 text-gray-600' };
          return (
            <span
              key={step}
              className={`w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded ${info.color}`}
              title={step}
            >
              {info.label}
            </span>
          );
        })}
      </div>
    );
  } catch {
    return <span className="text-xs text-gray-400">—</span>;
  }
}

function HistoryRow({ entry, expanded, onToggleLog, colSpan }: {
  entry: ResearchEntry;
  expanded: boolean;
  onToggleLog: () => void;
  colSpan: number;
}) {
  const isRunning = entry.status === 'running' || entry.status === 'pending';
  const isFailed = entry.status === 'failed';

  return (
    <>
      <tr className={`hover:bg-gray-50 ${isFailed ? 'bg-red-50/30' : ''}`}>
        <td className="px-4 py-3">
          {entry.lead ? (
            <Link to={`/leads/${entry.lead.id}`} className="group">
              <span className="text-sm font-medium text-gray-900 group-hover:text-brand-600">
                {entry.lead.company_name}
              </span>
              <span className="block text-xs text-gray-400 font-mono">{entry.lead.domain}</span>
            </Link>
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {entry.campaign_name ? (
            <Link to={`/campaigns/${entry.campaign_id}`} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
              {entry.campaign_name}
            </Link>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {entry.lead?.fit_score != null ? (
            <ScoreBadge score={entry.lead.fit_score} />
          ) : (
            <span className="text-xs text-gray-400">{isRunning ? '...' : '—'}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <StepsPills stepsRun={entry.steps_run} />
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={entry.status} error={entry.error_message} />
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">
          {entry.estimated_cost > 0 ? `$${entry.estimated_cost.toFixed(2)}` : '—'}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500" title={formatDateTime(entry.created_at)}>
          {timeAgo(entry.created_at)}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">
          {entry.triggered_by_name || 'System'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleLog}
              className={`p-1 rounded hover:bg-gray-100 transition-colors ${expanded ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="View activity log"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            {entry.lead && (
              <Link to={`/leads/${entry.lead.id}`} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-brand-600 inline-flex">
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={colSpan} className="px-0 py-0 bg-gray-50">
            <ActivityPanel runId={entry.id} onClose={onToggleLog} />
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === 'running' || status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
        <Loader2 className="w-3 h-3 animate-spin" />
        Running
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
        <CheckCircle className="w-3 h-3" />
        Done
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full" title={error || undefined}>
        <XCircle className="w-3 h-3" />
        Failed
      </span>
    );
  }
  return <span className="text-xs text-gray-400">{status}</span>;
}
