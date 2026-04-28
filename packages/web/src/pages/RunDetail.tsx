import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, Loader2,
  Users, TrendingUp, DollarSign, Target, ExternalLink,
  ChevronDown, ChevronUp, Trash2, AlertTriangle,
} from 'lucide-react';
import { ScoreBadge, SegmentBadge } from '../components/ScoreBadge';
import { ActivityPanel } from '../components/ActivityPanel';
import { AILogPanel } from '../components/AILogPanel';

interface RunData {
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

interface LeadSummary {
  id: string;
  company_name: string;
  domain: string | null;
  segment: string;
  fit_score: number;
  fit_score_label: string;
  confidence: string;
  employee_count: string | null;
  hq_location: string | null;
  lead_status: string;
  current_feedback: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  completed: { icon: <CheckCircle2 className="w-5 h-5" />, label: 'Completed', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  running: { icon: <Loader2 className="w-5 h-5 animate-spin" />, label: 'Running', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  pending: { icon: <Clock className="w-5 h-5" />, label: 'Pending', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  failed: { icon: <XCircle className="w-5 h-5" />, label: 'Failed', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
};

const FEEDBACK_LABELS: Record<string, string> = {
  bad_fit: 'Bad Fit',
  good_fit_response: 'Response',
  good_fit_booked: 'Booked',
  good_fit_try_again: 'Try Again',
  good_fit_no_response: 'No Response',
};

const FEEDBACK_COLORS: Record<string, string> = {
  bad_fit: 'bg-red-50 text-red-700',
  good_fit_response: 'bg-green-50 text-green-700',
  good_fit_booked: 'bg-blue-50 text-blue-700',
  good_fit_try_again: 'bg-amber-50 text-amber-700',
  good_fit_no_response: 'bg-gray-100 text-gray-600',
};

export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunData | null>(null);
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showLeads, setShowLeads] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleClearLeads = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await api(`/leads/by-run/${id}`, { method: 'DELETE' });
      setLeads([]);
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error('Failed to clear leads:', err);
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    api(`/runs/${id}`)
      .then((data: any) => {
        setRun(data.run);
        setLeads(data.leads || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="text-center py-20">
        <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-700">{error || 'Run not found'}</p>
        <Link to="/runs" className="text-sm text-brand-600 hover:underline mt-2 inline-block">
          Back to Run History
        </Link>
      </div>
    );
  }

  const status = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const isActive = run.status === 'running' || run.status === 'pending';
  const duration = run.started_at && run.completed_at
    ? formatDuration(new Date(run.completed_at).getTime() - new Date(run.started_at).getTime())
    : run.started_at
      ? isActive ? 'In progress...' : '—'
      : '—';

  return (
    <div>
      {/* Back nav */}
      <Link to="/runs" className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Run History
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg border ${status.bg}`}>
              <span className={status.color}>{status.icon}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {run.campaign_name || 'Pipeline Run'}
              </h1>
              <div className="flex items-center gap-3 mt-0.5 text-sm text-gray-500">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${status.bg} ${status.color}`}>
                  {status.label}
                </span>
                {run.triggered_by_name && <span>by {run.triggered_by_name}</span>}
                <span>{new Date(run.created_at).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {leads.length > 0 && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              Clear Leads
            </button>
          )}
          {run.campaign_id && (
            <Link
              to={`/campaigns/${run.campaign_id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Target className="w-4 h-4" />
              View Campaign
            </Link>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard icon={<Users className="w-4 h-4 text-brand-500" />} label="Leads" value={String(run.lead_count)} />
        <StatCard icon={<TrendingUp className="w-4 h-4 text-emerald-500" />} label="Avg Score" value={leads.length > 0 ? String(Math.round(leads.reduce((s, l) => s + l.fit_score, 0) / leads.length)) : '—'} />
        <StatCard icon={<Clock className="w-4 h-4 text-blue-500" />} label="Duration" value={duration} />
        <StatCard icon={<DollarSign className="w-4 h-4 text-amber-500" />} label="Cost" value={run.estimated_cost > 0 ? `$${run.estimated_cost.toFixed(2)}` : '—'} />
        <StatCard icon={<Target className="w-4 h-4 text-purple-500" />} label="Model" value={run.model_used ? run.model_used.split('@')[0].replace('claude-', '') : '—'} />
      </div>

      {/* Error message */}
      {run.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700 font-medium">Run Error</p>
          <p className="text-sm text-red-600 mt-1">{run.error_message}</p>
        </div>
      )}

      {/* AI Output Console — streaming thinking + response */}
      <div className="mb-4">
        <AILogPanel runId={run.id} campaignId={run.campaign_id || undefined} model={run.model_used || undefined} />
      </div>

      {/* Activity Terminal — hero section */}
      <div className="mb-6">
        <ActivityPanel runId={run.id} campaignId={run.campaign_id || undefined} />
      </div>

      {/* Leads table */}
      {leads.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <button
            onClick={() => setShowLeads(!showLeads)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 rounded-t-xl"
          >
            <span className="text-sm font-semibold text-gray-900">
              Generated Leads ({leads.length})
            </span>
            {showLeads ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showLeads && (
            <div className="border-t border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Segment</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Feedback</th>
                    <th className="px-4 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {leads.map(lead => (
                    <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <Link to={`/leads/${lead.id}`} className="font-medium text-gray-900 hover:text-brand-600">
                          {lead.company_name}
                        </Link>
                        {lead.domain && <p className="text-xs text-gray-400">{lead.domain}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        <ScoreBadge score={lead.fit_score} size="sm" />
                      </td>
                      <td className="px-4 py-2.5">
                        <SegmentBadge segment={lead.segment} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {lead.hq_location || '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {lead.current_feedback && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FEEDBACK_COLORS[lead.current_feedback] || 'bg-gray-100 text-gray-600'}`}>
                            {FEEDBACK_LABELS[lead.current_feedback] || lead.current_feedback}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link to={`/leads/${lead.id}`} className="text-gray-400 hover:text-brand-600">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Clear Run Leads</h3>
                <p className="text-sm text-gray-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              Delete all {leads.length} leads from this run? Their personas and feedback will also be removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleClearLeads}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <p className="text-[10px] text-gray-500 uppercase">{label}</p>
          <p className="text-sm font-bold text-gray-900 truncate">{value}</p>
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainingSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainingSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}
