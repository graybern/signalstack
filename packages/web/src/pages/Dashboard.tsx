import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useEventStream } from '../hooks/useEventStream';
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
  next_run?: string;
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
      api('/campaigns?schedule_enabled=1').catch(() => []),
    ])
      .then(([ov, rn, tr, sg, fb, rc, src, vt, scheduledCampaigns]) => {
        setOverview(ov);
        setRuns(Array.isArray(rn) ? rn : (rn?.runs || []));
        setTrends(tr.leads_by_day || []);
        setSegments(sg);
        setFeedbackData(fb);
        setRecommendations(Array.isArray(rc) ? rc : []);
        setSourceData(src);
        setVerticals(vt?.verticals || []);
        const upcoming = (Array.isArray(scheduledCampaigns) ? scheduledCampaigns : [])
          .filter((c: any) => c.schedule_enabled && c.schedule_cron)
          .map((c: any) => ({
            campaign_id: c.id,
            campaign_name: c.name,
            schedule_cron: c.schedule_cron,
          }))
          .slice(0, 3);
        setUpcomingRuns(upcoming);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Auto-refresh on run state changes and track progress
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
        return; // Don't reload dashboard on every progress event
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
      // Reload recommendations
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

      {/* ═══ Section 1: Operations Bar ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Active Runs */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">Active Runs</h3>
          </div>
          {activeRuns.length === 0 ? (
            <p className="text-sm text-gray-400">No active runs</p>
          ) : (
            <div className="space-y-2">
              {activeRuns.map(run => (
                <RunPill key={run.id} run={run} progress={runProgress.get(run.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Recent Runs */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Recent Runs</h3>
            </div>
            <Link to="/runs" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-gray-400">No runs yet</p>
          ) : (
            <div className="space-y-1.5">
              {recentRuns.map(run => (
                <RunPill key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Runs */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-gray-900">Upcoming</h3>
          </div>
          {upcomingRuns.length === 0 ? (
            <p className="text-sm text-gray-400">No scheduled runs</p>
          ) : (
            <div className="space-y-2">
              {upcomingRuns.map(ur => (
                <Link key={ur.campaign_id} to={`/campaigns/${ur.campaign_id}`} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50">
                  <span className="text-sm text-gray-900 truncate">{ur.campaign_name}</span>
                  <span className="text-xs text-gray-400 font-mono shrink-0">{ur.schedule_cron}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-900">Overview</h3>
          </div>
          {overview && (
            <div className="grid grid-cols-2 gap-3">
              <MiniStat icon={<Users className="w-3.5 h-3.5" />} label="Total Leads" value={overview.total_leads} />
              <MiniStat icon={<Target className="w-3.5 h-3.5" />} label="Campaigns" value={overview.active_campaigns} />
              <MiniStat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Avg Score" value={overview.avg_score ?? '—'} />
              <MiniStat icon={<BarChart3 className="w-3.5 h-3.5" />} label="Feedback" value={`${overview.feedback_rate}%`} />
              <MiniStat icon={<Play className="w-3.5 h-3.5" />} label="Total Runs" value={overview.total_runs} />
              <MiniStat icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Success" value={`${overview.success_rate}%`} />
            </div>
          )}
        </div>
      </div>

      {/* ═══ Section 2: Analytics Grid ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Trend */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Lead Volume (30 days)</h3>
          {trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  labelFormatter={d => new Date(d).toLocaleDateString()}
                  formatter={(value: any, name: any) => [
                    name === 'count' ? value : Math.round(value),
                    name === 'count' ? 'Leads' : 'Avg Score',
                  ]}
                />
                <Line type="monotone" dataKey="count" stroke="#7c3aed" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="avg_score" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No trend data yet</p>
          )}
        </div>

        {/* Segment Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Segment Breakdown</h3>
          {segments.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie
                    data={segments}
                    dataKey="count"
                    nameKey="segment"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    innerRadius={40}
                    paddingAngle={2}
                  >
                    {segments.map((s) => (
                      <Cell key={s.segment} fill={SEGMENT_COLORS[s.segment] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {segments.map(s => (
                  <div key={s.segment} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SEGMENT_COLORS[s.segment] }} />
                      <span className="font-medium">{s.segment}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-900 font-medium">{s.count}</span>
                      <span className="text-gray-400 text-xs ml-1">avg {Math.round(s.avg_score)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No segment data yet</p>
          )}
        </div>

        {/* Feedback Accuracy */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Score vs Feedback</h3>
          {feedbackData && feedbackData.score_by_feedback.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={feedbackData.score_by_feedback.map(f => ({
                verdict: FEEDBACK_LABELS[f.verdict] || f.verdict,
                count: f.count,
                avg_score: Math.round(f.avg_score),
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="verdict" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="count" fill="#7c3aed" radius={[4, 4, 0, 0]} name="Count" />
                <Bar dataKey="avg_score" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Avg Score" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No feedback data yet</p>
          )}
        </div>

        {/* Score Range Outcomes */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Score Range Outcomes</h3>
          {feedbackData && feedbackData.score_ranges.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={feedbackData.score_ranges} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="range" type="category" tick={{ fontSize: 11 }} width={55} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="positive" fill="#10b981" stackId="a" name="Positive" radius={[0, 0, 0, 0]} />
                <Bar dataKey="negative" fill="#ef4444" stackId="a" name="Negative" radius={[0, 4, 4, 0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No score range data yet</p>
          )}
        </div>

        {/* Feedback Breakdown (from overview) */}
        {overview && overview.feedback_breakdown.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Feedback Distribution</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={overview.feedback_breakdown.map(f => ({
                name: FEEDBACK_LABELS[f.verdict] || f.verdict,
                count: f.count,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {overview.feedback_breakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Score Distribution Histogram */}
        {overview && overview.total_leads > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Score Distribution</h3>
            {feedbackData && feedbackData.score_ranges.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={feedbackData.score_ranges.map(r => ({
                  range: r.range,
                  total: r.total,
                  positive: r.positive,
                  negative: r.negative,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="total" fill="#7c3aed" radius={[4, 4, 0, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-400 text-center py-12">No score data yet</p>
            )}
          </div>
        )}

        {/* Vertical Distribution */}
        {verticals.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Vertical Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={verticals.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={90} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="leads" fill="#14b8a6" radius={[0, 4, 4, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Source Performance */}
        {sourceData && sourceData.signal_correlation.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Source Performance</h3>
            <p className="text-xs text-gray-400 mb-2">Signal count vs. average score correlation</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sourceData.signal_correlation.map(s => ({
                signals: s.signal_range,
                count: s.count,
                avg_score: Math.round(s.avg_score),
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="signals" tick={{ fontSize: 11 }} label={{ value: 'Signals', position: 'bottom', fontSize: 10, offset: -5 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="avg_score" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Avg Score" />
                <Bar dataKey="count" fill="#e2e8f0" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top Patterns */}
        {segments.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Patterns</h3>
            <TopPatternsWidget />
          </div>
        )}
      </div>

      {/* ═══ Section 2b: Campaign Performance Table ═══ */}
      <CampaignPerformanceTable />

      {/* ═══ Section 2c: Cross-Campaign Run Trends ═══ */}
      <RunTrendsCharts />

      {/* ═══ Section 3: AI Recommendations ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
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

function RunPill({ run, progress }: { run: Run; progress?: { phase?: string; step_number?: number; total_steps?: number; tokens?: { estimated_cost: number } } }) {
  const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const isActive = run.status === 'running' || run.status === 'pending';

  return (
    <Link to={`/runs/${run.id}`} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        {isActive ? (
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
        ) : (
          <span className={cfg.color}>{cfg.icon}</span>
        )}
        <span className="text-sm text-gray-900 truncate">
          {run.campaign_name || 'Pipeline Run'}
        </span>
        {isActive && progress?.phase && (
          <span className="text-xs text-gray-500 capitalize shrink-0">{progress.phase}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isActive && progress?.step_number != null && progress?.total_steps != null ? (
          <>
            <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-full transition-all"
                style={{ width: `${Math.round((progress.step_number / progress.total_steps) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{Math.round((progress.step_number / progress.total_steps) * 100)}%</span>
            {progress.tokens?.estimated_cost != null && (
              <span className="text-xs text-gray-400">${progress.tokens.estimated_cost.toFixed(3)}</span>
            )}
          </>
        ) : (
          <>
            {run.lead_count > 0 && (
              <span className="text-xs text-gray-500">{run.lead_count} leads</span>
            )}
            <span className="text-xs text-gray-400">
              {timeAgo(run.completed_at || run.created_at)}
            </span>
          </>
        )}
      </div>
    </Link>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400">{icon}</span>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-bold text-gray-900">{value}</p>
      </div>
    </div>
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
    name: t.campaign_name ? t.campaign_name.substring(0, 15) : 'Run',
    date: new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    avg_score: Math.round(t.avg_score || 0),
    leads: t.lead_count || 0,
  }));

  const costData = trends.map(t => ({
    name: t.campaign_name ? t.campaign_name.substring(0, 15) : 'Run',
    date: new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    cost: Math.round((t.estimated_cost || 0) * 1000) / 1000,
    leads: t.lead_count || 0,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Score Trend */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
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

      {/* Cost per Run */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-emerald-600" />
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
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
                    c.avg_score >= 80 ? 'bg-emerald-50 text-emerald-700' :
                    c.avg_score >= 60 ? 'bg-blue-50 text-blue-700' :
                    c.avg_score >= 40 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
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

function TopPatternsWidget() {
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/campaigns')
      .then((campaigns: any[]) => {
        const tagMap: Record<string, number> = {};
        for (const c of (Array.isArray(campaigns) ? campaigns : [])) {
          const signals: string[] = JSON.parse(c.target_signals || '[]');
          const categories: string[] = JSON.parse(c.target_categories || '[]');
          for (const t of [...signals, ...categories]) {
            tagMap[t] = (tagMap[t] || 0) + 1;
          }
        }
        const sorted = Object.entries(tagMap)
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12);
        setTags(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || tags.length === 0) return <p className="text-sm text-gray-400 text-center py-12">No patterns yet</p>;

  const maxCount = tags[0]?.count || 1;

  return (
    <div className="space-y-1.5">
      {tags.map(({ tag, count }) => (
        <div key={tag} className="flex items-center gap-2">
          <Hash className="w-3 h-3 text-gray-400 shrink-0" />
          <span className="text-xs text-gray-700 w-28 truncate">{tag}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(count / maxCount) * 100}%` }} />
          </div>
          <span className="text-xs text-gray-400 w-5 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
