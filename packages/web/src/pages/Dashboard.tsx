import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { timeAgo as timeAgoUtil, formatDate, formatDateShort, formatDateTimeWithWeekday } from '../utils/dates';
import { useEventStream } from '../hooks/useEventStream';
import { useAuthContext } from '../App';
import { permissions } from '../utils/permissions';
import { useToast } from '../components/Toast';
import {
  Activity,
  BarChart3,
  TrendingUp,
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  Lightbulb,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Target,
  Users,
  Play,
  AlertCircle,
  Calendar,
  Hash,
  DollarSign,
  Brain,
  Check,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line, CartesianGrid,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────

interface Overview {
  total_leads: number;
  active_campaigns: number;
  total_runs: number;
  completed_runs: number;
  success_rate: number;
  avg_score: number | null;
  feedback_rate: number;
  feedback_breakdown: { verdict: string; count: number }[];
}

interface Run {
  id: string;
  status: string;
  lead_count: number;
  campaign_name?: string;
  campaign_id?: string;
  triggered_by_name?: string;
  created_at: string;
  completed_at?: string;
  started_at?: string;
  estimated_cost?: number;
}

interface TrendDay {
  day: string;
  count: number;
  avg_score: number;
}

interface SegmentData {
  segment: string;
  count: number;
  avg_score: number;
  converted: number;
}

interface FeedbackData {
  score_by_feedback: { verdict: string; count: number; avg_score: number }[];
  score_ranges: { range: string; total: number; positive: number; negative: number }[];
  score_distribution: { range: string; total: number }[];
}

interface Recommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  rationale: string;
  status: string;
  created_at: string;
}

interface SourceData {
  signal_correlation: { signal_range: string; count: number; avg_score: number }[];
}

interface VerticalData {
  name: string;
  campaigns: number;
  leads: number;
  avg_score: number | null;
}

interface UpcomingRun {
  campaign_id: string;
  campaign_name: string;
  schedule_cron: string;
  next_run_at: string | null;
}

// ── Constants ──────────────────────────────────────────────────

const SEGMENT_COLORS: Record<string, string> = { ENT: '#8b5cf6', MM: '#3b82f6', SMB: '#14b8a6' };
const PIE_COLORS = ['#8b5cf6', '#3b82f6', '#14b8a6', '#f59e0b', '#ef4444'];

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  completed: { icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  running: { icon: <Loader2 className="w-4 h-4 animate-spin" />, color: 'text-blue-700', bg: 'bg-blue-50' },
  pending: { icon: <Clock className="w-4 h-4" />, color: 'text-amber-700', bg: 'bg-amber-50' },
  failed: { icon: <XCircle className="w-4 h-4" />, color: 'text-red-700', bg: 'bg-red-50' },
};

const REC_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  icp_adjustment: { label: 'ICP', color: 'bg-purple-100 text-purple-700' },
  source_priority: { label: 'Sources', color: 'bg-blue-100 text-blue-700' },
  campaign_suggestion: { label: 'Campaign', color: 'bg-emerald-100 text-emerald-700' },
  exclusion_suggestion: { label: 'Exclusion', color: 'bg-amber-100 text-amber-700' },
};

const FEEDBACK_LABELS: Record<string, string> = {
  bad_fit: 'Bad Fit',
  good_fit_response: 'Response',
  good_fit_booked: 'Booked',
  good_fit_try_again: 'Try Again',
  good_fit_no_response: 'No Response',
};

const SCORE_RANGE_COLORS: Record<string, string> = {
  '80-100': '#059669',
  '60-79': '#3b82f6',
  '40-59': '#f59e0b',
  '0-39': '#ef4444',
};

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

// ── Main Component ─────────────────────────────────────────────

export function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [trends, setTrends] = useState<TrendDay[]>([]);
  const [segments, setSegments] = useState<SegmentData[]>([]);
  const [feedbackData, setFeedbackData] = useState<FeedbackData | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [sourceData, setSourceData] = useState<SourceData | null>(null);
  const [verticals, setVerticals] = useState<VerticalData[]>([]);
  const [upcomingRuns, setUpcomingRuns] = useState<UpcomingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [runProgress, setRunProgress] = useState<Map<string, { phase?: string; step_number?: number; total_steps?: number; tokens?: { estimated_cost: number } }>>(new Map());

  const { subscribe } = useEventStream({
    types: ['pipeline.completed', 'campaign.completed', 'pipeline.failed', 'campaign.failed', 'pipeline.started', 'campaign.started', 'campaign.progress', 'campaign.cancelled'],
  });

  const loadDashboard = useCallback(() => {
    Promise.all([
      api('/analytics/overview'),
      api('/runs'),
      api('/analytics/trends?days=30'),
      api('/analytics/segments'),
      api('/analytics/feedback'),
      api('/analytics/recommendations?status=pending'),
      api('/analytics/sources').catch(() => null),
      api('/analytics/verticals').catch(() => ({ verticals: [] })),
      api('/runs/upcoming').catch(() => []),
    ])
      .then(([ov, rn, tr, sg, fb, rc, src, vt, upcoming]) => {
        setOverview(ov);
        setRuns(Array.isArray(rn) ? rn : (rn?.runs || []));
        setTrends(tr.leads_by_day || []);
        setSegments(sg);
        setFeedbackData(fb);
        setRecommendations(Array.isArray(rc) ? rc : []);
        setSourceData(src);
        setVerticals(vt?.verticals || []);
        setUpcomingRuns((Array.isArray(upcoming) ? upcoming : []).slice(0, 3));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const unsub = subscribe('*', (event) => {
      const data = event.data as any;
      if (event.type === 'campaign.progress') {
        setRunProgress(prev => new Map(prev).set(data.run_id, {
          phase: data.phase,
          step_number: data.step_number,
          total_steps: data.total_steps,
          tokens: data.tokens,
        }));
        return;
      }
      if (event.type === 'campaign.completed' || event.type === 'campaign.failed' || event.type === 'campaign.cancelled') {
        setRunProgress(prev => {
          const next = new Map(prev);
          next.delete(data.run_id);
          return next;
        });
      }
      loadDashboard();
    });
    return unsub;
  }, [subscribe, loadDashboard]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleGenerateRecs = async () => {
    setGenerating(true);
    setRecError(null);
    try {
      await api('/analytics/recommendations/generate', { method: 'POST' });
      const recs = await api('/analytics/recommendations?status=pending');
      setRecommendations(Array.isArray(recs) ? recs : []);
    } catch (err: any) {
      setRecError(err.message || 'Failed to generate recommendations');
    } finally {
      setGenerating(false);
    }
  };

  const handleRecAction = async (id: string, status: 'accepted' | 'dismissed') => {
    try {
      await api(`/analytics/recommendations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setRecommendations(prev => prev.filter(r => r.id !== id));
    } catch (err: any) {
      console.error('Failed to update recommendation:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'pending');
  const recentRuns = runs.filter(r => r.status === 'completed' || r.status === 'failed').slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Analytics command center</p>
      </div>

      {/* ═══ Section 1: Overview Stats — full width, prominent ═══ */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <OverviewStat icon={<Users className="w-5 h-5 text-brand-600" />} label="Total Leads" value={overview.total_leads} accent="brand" to="/leads" />
          <OverviewStat icon={<Target className="w-5 h-5 text-indigo-600" />} label="Campaigns" value={overview.active_campaigns} accent="indigo" to="/campaigns" />
          <OverviewStat icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} label="Avg Score" value={overview.avg_score ?? '—'} accent="emerald" to="/leads" />
          <OverviewStat icon={<Play className="w-5 h-5 text-blue-600" />} label="Total Runs" value={overview.total_runs} accent="blue" to="/runs" />
          <OverviewStat icon={<CheckCircle2 className="w-5 h-5 text-green-600" />} label="Success Rate" value={`${overview.success_rate}%`} accent="green" to="/runs" />
          <OverviewStat icon={<BarChart3 className="w-5 h-5 text-amber-600" />} label="Feedback Rate" value={`${overview.feedback_rate}%`} accent="amber" to="/leads" />
        </div>
      )}

      {/* ═══ Section 2: Operations — Active, Recent, Upcoming ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active Runs */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">Active Runs</h3>
            {activeRuns.length > 0 && (
              <span className="ml-auto px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">{activeRuns.length}</span>
            )}
          </div>
          {activeRuns.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No active runs</p>
          ) : (
            <div className="space-y-2">
              {activeRuns.map(run => (
                <RunPill key={run.id} run={run} progress={runProgress.get(run.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Recent Runs */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Recent Runs</h3>
            </div>
            <Link to="/runs" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No runs yet</p>
          ) : (
            <div className="space-y-1">
              {recentRuns.map(run => (
                <RunPill key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Scheduled Runs */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-gray-900">Upcoming Scheduled</h3>
          </div>
          {upcomingRuns.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No scheduled campaigns</p>
          ) : (
            <div className="space-y-3">
              {upcomingRuns.map(ur => (
                <Link key={ur.campaign_id} to={`/campaigns/${ur.campaign_id}`} className="block px-3 py-2.5 rounded-lg border border-gray-100 hover:border-brand-200 hover:bg-brand-50/30 transition-colors">
                  <p className="text-sm font-medium text-gray-900 mb-1">{ur.campaign_name}</p>
                  <p className="text-xs text-gray-500">
                    {ur.next_run_at ? `Next: ${formatDateTimeWithWeekday(ur.next_run_at)}` : describeCron(ur.schedule_cron)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Section 3: Analytics Grid ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Trend */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Lead Volume (30 days)</h3>
          {trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  labelFormatter={d => formatDate(d)}
                  formatter={(value: any, name: any) => [
                    name === 'count' ? value : Math.round(value),
                    name === 'count' ? 'Leads' : 'Avg Score',
                  ]}
                />
                <Line type="monotone" dataKey="count" stroke="#7c3aed" strokeWidth={2} dot={false} name="count" />
                <Line type="monotone" dataKey="avg_score" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="avg_score" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-16">No trend data yet</p>
          )}
        </div>

        {/* Segment Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Segment Breakdown</h3>
          {segments.length > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie
                    data={segments}
                    dataKey="count"
                    nameKey="segment"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={45}
                    paddingAngle={2}
                  >
                    {segments.map((s) => (
                      <Cell key={s.segment} fill={SEGMENT_COLORS[s.segment] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-3">
                {segments.map(s => (
                  <div key={s.segment} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SEGMENT_COLORS[s.segment] }} />
                      <span className="text-sm font-medium text-gray-900">{s.segment}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-gray-900">{s.count}</span>
                      <span className="text-xs text-gray-400 ml-1.5">avg {Math.round(s.avg_score)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-16">No segment data yet</p>
          )}
        </div>

        {/* Score Distribution — always show if leads exist */}
        {feedbackData && feedbackData.score_distribution && feedbackData.score_distribution.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Score Distribution</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={feedbackData.score_distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="range" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [v, 'Leads']} />
                <Bar dataKey="total" name="Leads" radius={[4, 4, 0, 0]}>
                  {feedbackData.score_distribution.map((d) => (
                    <Cell key={d.range} fill={SCORE_RANGE_COLORS[d.range] || '#7c3aed'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top Patterns — use vertical names (search_patterns) instead of signals */}
        {segments.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Top Verticals</h3>
            <TopVerticalsWidget />
          </div>
        )}

        {/* Score vs Feedback */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Score vs Feedback</h3>
          {feedbackData && feedbackData.score_by_feedback.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={feedbackData.score_by_feedback.map(f => ({
                verdict: FEEDBACK_LABELS[f.verdict] || f.verdict,
                count: f.count,
                avg_score: Math.round(f.avg_score),
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="verdict" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="#7c3aed" radius={[4, 4, 0, 0]} name="Count" />
                <Bar dataKey="avg_score" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Avg Score" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-16">
              <BarChart3 className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No feedback data yet</p>
              <p className="text-xs text-gray-300 mt-1">Provide feedback on leads to populate this chart</p>
            </div>
          )}
        </div>

        {/* Score Range Outcomes */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Score Range Outcomes</h3>
          {feedbackData && feedbackData.score_ranges.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={feedbackData.score_ranges} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="range" type="category" tick={{ fontSize: 12 }} width={55} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="positive" fill="#10b981" stackId="a" name="Positive" />
                <Bar dataKey="negative" fill="#ef4444" stackId="a" name="Negative" radius={[0, 4, 4, 0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-16">
              <TrendingUp className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No score range data yet</p>
              <p className="text-xs text-gray-300 mt-1">Provide feedback on leads to see outcome correlations</p>
            </div>
          )}
        </div>

        {/* Feedback Distribution (from overview) */}
        {overview && overview.feedback_breakdown.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Feedback Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={overview.feedback_breakdown.map(f => ({
                name: FEEDBACK_LABELS[f.verdict] || f.verdict,
                count: f.count,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {overview.feedback_breakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Vertical Distribution */}
        {verticals.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Vertical Distribution</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={verticals.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={100} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="leads" fill="#14b8a6" radius={[0, 4, 4, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Source Performance */}
        {sourceData && sourceData.signal_correlation.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Source Performance</h3>
            <p className="text-xs text-gray-400 mb-2">Signal count vs. average score correlation</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sourceData.signal_correlation.map(s => ({
                signals: s.signal_range,
                count: s.count,
                avg_score: Math.round(s.avg_score),
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="signals" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="avg_score" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Avg Score" />
                <Bar dataKey="count" fill="#e2e8f0" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ═══ Section 4: Campaign Performance Table ═══ */}
      <CampaignPerformanceTable />

      {/* ═══ Section 5: Cross-Campaign Run Trends ═══ */}
      <RunTrendsCharts />

      {/* ═══ Section 6: Global Insights (ICP Refinement) ═══ */}
      <GlobalInsightsCard />

      {/* ═══ Section 7: AI Recommendations ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <h3 className="text-base font-semibold text-gray-900">AI Recommendations</h3>
            {recommendations.length > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                {recommendations.length}
              </span>
            )}
          </div>
          <button
            onClick={handleGenerateRecs}
            disabled={generating}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4" />}
            {generating ? 'Analyzing...' : 'Generate'}
          </button>
        </div>

        {recError && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{recError}</p>
            <button onClick={() => setRecError(null)} className="ml-auto text-red-400 hover:text-red-600 text-xs">Dismiss</button>
          </div>
        )}

        {recommendations.length === 0 && !recError ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No pending recommendations. Click Generate to analyze your data.
          </p>
        ) : recommendations.length === 0 ? null : (
          <div className="space-y-3">
            {recommendations.map(rec => (
              <div key={rec.id} className="border border-gray-100 rounded-lg p-3 hover:border-gray-200 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${REC_TYPE_LABELS[rec.type]?.color || 'bg-gray-100 text-gray-600'}`}>
                        {REC_TYPE_LABELS[rec.type]?.label || rec.type}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{rec.title}</span>
                    </div>
                    <p className="text-sm text-gray-600">{rec.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{rec.rationale}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleRecAction(rec.id, 'accepted')}
                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"
                      title="Accept"
                    >
                      <ThumbsUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRecAction(rec.id, 'dismissed')}
                      className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                      title="Dismiss"
                    >
                      <ThumbsDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

const ACCENT_STYLES: Record<string, string> = {
  brand: 'border-brand-100 bg-brand-50/40',
  indigo: 'border-indigo-100 bg-indigo-50/40',
  emerald: 'border-emerald-100 bg-emerald-50/40',
  blue: 'border-blue-100 bg-blue-50/40',
  green: 'border-green-100 bg-green-50/40',
  amber: 'border-amber-100 bg-amber-50/40',
};

function OverviewStat({ icon, label, value, accent, to }: { icon: React.ReactNode; label: string; value: string | number; accent: string; to?: string }) {
  const content = (
    <>
      <div className="flex items-center gap-2 mb-2">{icon}</div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </>
  );
  const base = `rounded-xl border p-4 ${ACCENT_STYLES[accent] || 'border-gray-200 bg-white'}`;
  if (to) {
    return (
      <Link to={to} className={`${base} hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer block`}>
        {content}
      </Link>
    );
  }
  return <div className={base}>{content}</div>;
}

function RunPill({ run, progress }: { run: Run; progress?: { phase?: string; step_number?: number; total_steps?: number; tokens?: { estimated_cost: number } } }) {
  const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const isActive = run.status === 'running' || run.status === 'pending';

  return (
    <Link to={isActive ? `/campaigns/${run.campaign_id}` : `/runs`} className="flex items-center gap-3 py-2 px-2.5 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="shrink-0">
        {isActive ? (
          <span className="flex w-5 h-5 items-center justify-center"><span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" /></span>
        ) : (
          <span className={cfg.color}>{cfg.icon}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 font-medium truncate">{run.campaign_name || 'Pipeline Run'}</p>
        {isActive && progress?.phase && (
          <p className="text-xs text-gray-500 capitalize">{progress.phase}
            {progress.step_number != null && progress.total_steps != null && (
              <span className="text-gray-400 ml-1">({Math.round((progress.step_number / progress.total_steps) * 100)}%)</span>
            )}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        {isActive && progress?.step_number != null && progress.total_steps != null ? (
          <div className="flex items-center gap-2">
            <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${Math.round((progress.step_number / progress.total_steps) * 100)}%` }} />
            </div>
            {progress.tokens?.estimated_cost != null && (
              <span className="text-[10px] text-gray-400">${progress.tokens.estimated_cost.toFixed(2)}</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {run.lead_count > 0 && (
              <span className="text-xs font-medium text-gray-600">{run.lead_count} leads</span>
            )}
            <span className="text-[10px] text-gray-400">{timeAgoUtil(run.completed_at || run.created_at)}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function RunTrendsCharts() {
  const [trends, setTrends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/analytics/run-trends?limit=20')
      .then((data: any) => setTrends(data?.trends || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || trends.length < 2) return null;

  const scoreData = trends.map(t => ({
    name: t.campaign_name ? t.campaign_name.substring(0, 20) : 'Run',
    date: formatDateShort(t.created_at),
    avg_score: Math.round(t.avg_score || 0),
    leads: t.lead_count || 0,
  }));

  const costData = trends.map(t => ({
    name: t.campaign_name ? t.campaign_name.substring(0, 20) : 'Run',
    date: formatDateShort(t.created_at),
    cost: Math.round((t.estimated_cost || 0) * 1000) / 1000,
    leads: t.lead_count || 0,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-gray-900">Score Trend (All Runs)</h3>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={scoreData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg text-xs">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-gray-500">{d.date}</div>
                      <div className="text-brand-600">Avg Score: {d.avg_score}</div>
                      <div className="text-gray-400">{d.leads} leads</div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="avg_score" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-gray-900">Cost per Run</h3>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg text-xs">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-gray-500">{d.date}</div>
                      <div className="text-emerald-600">${d.cost.toFixed(3)}</div>
                      <div className="text-gray-400">{d.leads} leads</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="cost" fill="#10b981" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function CampaignPerformanceTable() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<string>('lead_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    api('/campaigns')
      .then((data: any) => {
        const list = Array.isArray(data) ? data : (data?.campaigns || []);
        setCampaigns(list.filter((c: any) => c.status === 'active'));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...campaigns].sort((a, b) => {
    const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === 'desc' ? -cmp : cmp;
  });

  if (loading) return null;
  if (campaigns.length === 0) return null;

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <span className="text-gray-300 text-[10px]">&#8597;</span>;
    return <span className="text-brand-600 text-[10px]">{sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-gray-900">Campaign Performance</h3>
          <span className="text-xs text-gray-400">{campaigns.length} active</span>
        </div>
        <Link to="/campaigns" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
          View all <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {[
              { key: 'name', label: 'Campaign' },
              { key: 'lead_count', label: 'Leads' },
              { key: 'avg_score', label: 'Avg Score' },
              { key: 'run_count', label: 'Runs' },
              { key: 'last_run_cost', label: 'Last Cost' },
              { key: 'status', label: 'Status' },
            ].map(col => (
              <th key={col.key} className="px-4 py-2.5 text-left">
                <button onClick={() => handleSort(col.key)} className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase hover:text-gray-700">
                  {col.label} <SortIcon col={col.key} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((c: any) => (
            <tr key={c.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3">
                <Link to={`/campaigns/${c.id}`} className="font-medium text-gray-900 hover:text-brand-600">{c.name}</Link>
              </td>
              <td className="px-4 py-3 text-gray-700">{c.lead_count || 0}</td>
              <td className="px-4 py-3">
                {c.avg_score ? (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    c.avg_score >= 70 ? 'bg-emerald-50 text-emerald-700' :
                    c.avg_score >= 55 ? 'bg-blue-50 text-blue-700' :
                    c.avg_score >= 35 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
                  }`}>{Math.round(c.avg_score)}</span>
                ) : <span className="text-gray-400">--</span>}
              </td>
              <td className="px-4 py-3 text-gray-500">{c.run_count || 0}</td>
              <td className="px-4 py-3 text-gray-500">
                {c.last_run_cost ? `$${c.last_run_cost.toFixed(2)}` : '--'}
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  c.schedule_enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>{c.schedule_enabled ? 'Scheduled' : 'Manual'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const INSIGHT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  scoring_accuracy: { label: 'Scoring', color: 'bg-blue-100 text-blue-700' },
  persona_effectiveness: { label: 'Persona', color: 'bg-purple-100 text-purple-700' },
  vertical_performance: { label: 'Vertical', color: 'bg-teal-100 text-teal-700' },
  messaging_patterns: { label: 'Messaging', color: 'bg-amber-100 text-amber-700' },
  timing_patterns: { label: 'Timing', color: 'bg-rose-100 text-rose-700' },
  competitive_intel: { label: 'Competitive', color: 'bg-red-100 text-red-700' },
  composite: { label: 'Composite', color: 'bg-indigo-100 text-indigo-700' },
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-500',
};

function GlobalInsightsCard() {
  const { user } = useAuthContext();
  const { showToast } = useToast();
  const [insights, setInsights] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(confirmTimerRef.current), []);

  const canEdit = permissions.canAccessSettings(user?.role);

  useEffect(() => {
    api('/analytics/global-insights?status=active')
      .then((data: any) => setInsights(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const data = await api('/analytics/global-insights/analyze', { method: 'POST' }) as any;
      setInsights(data.insights || []);
      showToast('success', `${data.count || 0} global insights generated`);
    } catch (err: any) {
      showToast('error', 'Analysis failed', err?.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAction = async (id: string, action: 'applied' | 'dismissed') => {
    try {
      await api(`/analytics/global-insights/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: action }),
      });
      setInsights(prev => prev.filter(i => i.id !== id));
      setConfirming(null);
      showToast('success', action === 'applied' ? 'Insight applied' : 'Insight dismissed');
    } catch (err: any) {
      showToast('error', 'Failed to update insight', err?.message);
    }
  };

  if (!canEdit) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-500" />
          <h3 className="text-base font-semibold text-gray-900">System Insights</h3>
          <span className="text-xs text-gray-400">Cross-campaign ICP refinement</span>
          {insights.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
              {insights.length}
            </span>
          )}
        </div>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
          {analyzing ? 'Analyzing...' : 'Run Analysis'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
      ) : insights.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          No active insights. Click Run Analysis to analyze cross-campaign patterns.
        </p>
      ) : (
        <div className="space-y-3">
          {insights.map(insight => (
            <div key={insight.id} className="border border-gray-100 rounded-lg p-3 hover:border-gray-200 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${INSIGHT_TYPE_LABELS[insight.insight_type]?.color || 'bg-gray-100 text-gray-600'}`}>
                      {INSIGHT_TYPE_LABELS[insight.insight_type]?.label || insight.insight_type}
                    </span>
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${CONFIDENCE_COLORS[insight.confidence] || CONFIDENCE_COLORS.medium}`}>
                      {insight.confidence}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{insight.title}</span>
                  </div>
                  <p className="text-sm text-gray-600">{insight.summary}</p>
                  {expanded === insight.id && insight.details && (
                    <div className="mt-2 space-y-2">
                      {typeof insight.details === 'object' && Object.entries(insight.details).map(([key, val]: [string, any]) => (
                        <div key={key} className="text-xs">
                          <span className="font-medium text-gray-500 capitalize">{key.replace(/_/g, ' ')}:</span>
                          <span className="text-gray-600 ml-1">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
                        </div>
                      ))}
                      {insight.recommendations && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="text-xs font-medium text-gray-500 mb-1">Recommendations:</p>
                          {(Array.isArray(insight.recommendations) ? insight.recommendations : [insight.recommendations]).map((rec: any, i: number) => (
                            <p key={i} className="text-xs text-gray-600">{typeof rec === 'string' ? rec : rec.description || JSON.stringify(rec)}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setExpanded(expanded === insight.id ? null : insight.id)}
                    className="text-xs text-brand-600 hover:text-brand-700 mt-1 flex items-center gap-0.5"
                  >
                    {expanded === insight.id ? <>Less <ChevronUp className="w-3 h-3" /></> : <>Details <ChevronDown className="w-3 h-3" /></>}
                  </button>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {confirming === `apply-${insight.id}` ? (
                    <button
                      onClick={() => handleAction(insight.id, 'applied')}
                      className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      onClick={() => { setConfirming(`apply-${insight.id}`); confirmTimerRef.current = setTimeout(() => setConfirming(c => c === `apply-${insight.id}` ? null : c), 3000); }}
                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"
                      title="Apply"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  {confirming === `dismiss-${insight.id}` ? (
                    <button
                      onClick={() => handleAction(insight.id, 'dismissed')}
                      className="px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      onClick={() => { setConfirming(`dismiss-${insight.id}`); confirmTimerRef.current = setTimeout(() => setConfirming(c => c === `dismiss-${insight.id}` ? null : c), 3000); }}
                      className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                      title="Dismiss"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {insight.feedback_count} feedback entries &middot; {new Date(insight.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopVerticalsWidget() {
  const [verticalNames, setVerticalNames] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/campaigns')
      .then((campaigns: any[]) => {
        const nameMap: Record<string, number> = {};
        for (const c of (Array.isArray(campaigns) ? campaigns : [])) {
          const patterns = c.search_patterns || [];
          for (const p of (Array.isArray(patterns) ? patterns : [])) {
            const name = typeof p === 'string' ? p : p.name;
            if (name) nameMap[name] = (nameMap[name] || 0) + 1;
          }
        }
        const sorted = Object.entries(nameMap)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        setVerticalNames(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || verticalNames.length === 0) return <p className="text-sm text-gray-400 text-center py-16">No verticals defined yet</p>;

  const maxCount = verticalNames[0]?.count || 1;

  return (
    <div className="space-y-2">
      {verticalNames.map(({ name, count }) => (
        <div key={name} className="flex items-center gap-3">
          <span className="text-xs text-gray-700 w-48 truncate" title={name}>{name}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${(count / maxCount) * 100}%` }} />
          </div>
          <span className="text-xs text-gray-400 w-5 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
}

