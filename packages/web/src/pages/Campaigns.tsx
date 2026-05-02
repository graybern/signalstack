import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthContext } from '../App';
import { useEventStream } from '../hooks/useEventStream';
import { Target, Plus, Play, Users, TrendingUp, Clock, ChevronRight } from 'lucide-react';
import { permissions } from '../utils/permissions';
import { formatDate } from '../utils/dates';

interface CampaignSummary {
  id: string;
  name: string;
  description: string | null;
  pattern_thesis: string;
  example_companies: { name: string; domain: string; why_they_fit: string }[];
  target_signals: string[];
  target_categories: string[];
  target_count: number;
  status: string;
  lead_count: number;
  avg_score: number | null;
  last_run: any;
  created_at: string;
}

interface ActiveRunProgress {
  phase?: string;
  step_number?: number;
  total_steps?: number;
  tokens?: { estimated_cost: number };
}

export function Campaigns() {
  const { user } = useAuthContext();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRuns, setActiveRuns] = useState<Map<string, ActiveRunProgress>>(new Map());

  useEffect(() => {
    api<CampaignSummary[]>('/campaigns').then(data => {
      setCampaigns(data);
      // Detect already-running campaigns from API data
      const running = new Map<string, ActiveRunProgress>();
      for (const c of data) {
        if (c.last_run?.status === 'running') {
          running.set(c.id, { phase: 'processing' });
        }
      }
      if (running.size > 0) setActiveRuns(running);
    }).finally(() => setLoading(false));
  }, []);

  // Subscribe to campaign events for live indicators
  const { subscribe } = useEventStream({
    types: ['campaign.started', 'campaign.progress', 'campaign.completed', 'campaign.failed', 'campaign.cancelled'],
    enabled: true,
  });

  useEffect(() => {
    const unsub = subscribe('*', (event) => {
      const data = event.data as any;
      if (event.type === 'campaign.started') {
        setActiveRuns(prev => new Map(prev).set(data.campaign_id, { phase: 'starting' }));
      }
      if (event.type === 'campaign.progress') {
        setActiveRuns(prev => new Map(prev).set(data.campaign_id, {
          phase: data.phase,
          step_number: data.step_number,
          total_steps: data.total_steps,
          tokens: data.tokens,
        }));
      }
      if (event.type === 'campaign.completed' || event.type === 'campaign.failed' || event.type === 'campaign.cancelled') {
        setActiveRuns(prev => {
          const next = new Map(prev);
          next.delete(data.campaign_id);
          return next;
        });
        // Refresh campaigns list
        api<CampaignSummary[]>('/campaigns').then(setCampaigns).catch(() => {});
      }
    });
    return unsub;
  }, [subscribe]);

  const triggerRun = async (campaignId: string) => {
    try {
      await api(`/campaigns/${campaignId}/run`, { method: 'POST' });
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Research Campaigns</h1>
          <p className="text-sm text-gray-500 mt-1">
            Define success patterns and find more companies like your best customers
          </p>
        </div>
        {permissions.canCreateCampaign(user?.role) && (
          <Link
            to="/campaigns/new"
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Campaign
          </Link>
        )}
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <Target className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Create a research campaign to find companies matching a success pattern.
          </p>
          {permissions.canCreateCampaign(user?.role) && (
            <Link
              to="/campaigns/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-sm"
            >
              <Plus className="w-4 h-4" />
              Create your first campaign
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((c) => (
            <Link
              key={c.id}
              to={`/campaigns/${c.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md hover:border-brand-200 transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
                      <Target className="w-5 h-5 text-brand-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 group-hover:text-brand-700">
                        {c.name}
                      </h3>
                      {c.description && (
                        <p className="text-sm text-gray-500">{c.description}</p>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-gray-600 mt-3 line-clamp-2 ml-13">
                    {c.pattern_thesis}
                  </p>

                  {c.example_companies.length > 0 && (
                    <div className="flex gap-2 mt-3 ml-13">
                      {c.example_companies.map((ex) => (
                        <span
                          key={ex.domain}
                          className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full"
                        >
                          {ex.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-6 mt-4 ml-13 text-xs text-gray-500">
                    {activeRuns.has(c.id) ? (
                      <>
                        <span className="flex items-center gap-1.5 text-green-600 font-medium">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          Running
                        </span>
                        {activeRuns.get(c.id)?.phase && (
                          <span className="capitalize text-gray-600">
                            {activeRuns.get(c.id)!.phase}
                          </span>
                        )}
                        {activeRuns.get(c.id)?.step_number != null && activeRuns.get(c.id)?.total_steps != null && (
                          <span className="flex items-center gap-1.5">
                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-brand-500 rounded-full transition-all"
                                style={{ width: `${Math.round(((activeRuns.get(c.id)!.step_number || 0) / (activeRuns.get(c.id)!.total_steps || 1)) * 100)}%` }}
                              />
                            </div>
                            <span>{Math.round(((activeRuns.get(c.id)!.step_number || 0) / (activeRuns.get(c.id)!.total_steps || 1)) * 100)}%</span>
                          </span>
                        )}
                        {activeRuns.get(c.id)?.tokens?.estimated_cost != null && (
                          <span className="text-gray-400">${activeRuns.get(c.id)!.tokens!.estimated_cost.toFixed(3)}</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {c.lead_count} leads
                        </span>
                        {c.avg_score && (
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3.5 h-3.5" />
                            Avg score: {c.avg_score}
                          </span>
                        )}
                        {c.last_run && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            Last run: {formatDate(c.last_run.completed_at || c.last_run.created_at)}
                          </span>
                        )}
                        <span>{c.target_categories.length} categories</span>
                        <span>{c.target_signals.length} signals</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  {permissions.canRunCampaign(user?.role) && !activeRuns.has(c.id) && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        triggerRun(c.id);
                      }}
                      className="p-2 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                      title="Run campaign research"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {activeRuns.has(c.id) && (
                    <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" title="Run in progress" />
                  )}
                  <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-500 transition-colors" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
