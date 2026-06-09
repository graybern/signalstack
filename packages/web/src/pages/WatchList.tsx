import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { SegmentBadge, DualBars, WatchBadge } from '../components/ScoreBadge';
import {
  Eye, Clock, AlertTriangle, ArrowUpRight, ArrowDownRight,
  X, RefreshCw, ChevronDown, Filter, Bell, Minus, Play,
  Calendar, Radio, Search, MessageSquare,
} from 'lucide-react';
import { clsx } from 'clsx';

// ── Types ──────────────────────────────────────────────────────

interface WatchItem {
  id: string;
  lead_id: string;
  campaign_id: string;
  category: 'timing_watch' | 'data_needs' | 'nurture' | 'manual';
  status: 'active' | 'woken' | 'dismissed' | 'converted';
  snooze_until: string;
  rerun_on_wake: boolean;
  notes: string | null;
  score_snapshot: { fit_score: number; potential_score: number; urgency_score: number; signal_quality: number; evidence_modifier: number } | null;
  delta: { fit_score_change: number; potential_change: number; urgency_change: number } | null;
  woken_at: string | null;
  created_at: string;
  lead: { company_name: string; segment: string; domain: string; fit_score: number; fit_score_label: string };
}

interface WatchStats {
  total_watching: number;
  waking_today: number;
  waking_this_week: number;
  woken: number;
  by_category: Record<string, number>;
}

interface WatchGroups {
  waking_today: WatchItem[];
  waking_this_week: WatchItem[];
  watching: WatchItem[];
}

// ── Constants ──────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  timing_watch: { label: 'Timing', icon: Clock, color: 'text-amber-600' },
  data_needs: { label: 'Data', icon: Search, color: 'text-sky-600' },
  nurture: { label: 'Nurture', icon: Radio, color: 'text-violet-600' },
  manual: { label: 'Manual', icon: Eye, color: 'text-gray-500' },
};

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatWakeDate(dateStr: string): string {
  const d = daysUntil(dateStr);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d <= 7) return `${d}d`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Delta Badge ────────────────────────────────────────────────

function DeltaBadge({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  const positive = value > 0;
  return (
    <span className={clsx(
      'inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded',
      positive ? 'text-emerald-700 bg-emerald-50 border border-emerald-200/60' : 'text-red-600 bg-red-50 border border-red-200/60',
    )}>
      {positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {label} {positive ? '+' : ''}{value}
    </span>
  );
}

// ── Watch Item Card ────────────────────────────────────────────

function WatchItemCard({ item, urgency, onAction }: {
  item: WatchItem;
  urgency: 'today' | 'week' | 'watching';
  onAction: (id: string, action: string, payload?: any) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [snoozeDate, setSnoozeDate] = useState('');
  const [showSnooze, setShowSnooze] = useState(false);
  const catMeta = CATEGORY_META[item.category] || CATEGORY_META.manual;
  const CatIcon = catMeta.icon;
  const snapshot = item.score_snapshot;

  const isWoken = item.status === 'woken';
  const hasDelta = item.delta && (item.delta.fit_score_change !== 0 || item.delta.potential_change !== 0 || item.delta.urgency_change !== 0);

  const hasPositiveDelta = hasDelta && item.delta && (item.delta.potential_change > 0 || item.delta.urgency_change > 0);

  return (
    <div className={clsx(
      'group rounded-lg border transition-all border-l-[3px]',
      urgency === 'today'
        ? 'bg-white border-red-200/80 border-l-red-400 hover:border-red-300 hover:shadow-sm'
        : urgency === 'week'
        ? 'bg-white border-amber-200/60 border-l-amber-400 hover:border-amber-300 hover:shadow-sm'
        : isWoken && hasPositiveDelta
        ? 'bg-white border-gray-200/80 border-l-emerald-400 hover:border-emerald-200 hover:shadow-sm'
        : 'bg-white border-gray-200/80 border-l-violet-300 hover:border-violet-200 hover:shadow-sm',
    )}>
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          {/* Urgency indicator */}
          <div className={clsx('mt-1 shrink-0', urgency === 'today' && 'relative')}>
            {urgency === 'today' && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-3 h-3 rounded-full bg-red-400 animate-ping opacity-40" />
              </span>
            )}
            <div className={clsx(
              'w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold',
              urgency === 'today' ? 'bg-red-100 text-red-700' :
              urgency === 'week' ? 'bg-amber-100 text-amber-700' :
              'bg-violet-50 text-violet-600',
            )}>
              {formatWakeDate(item.snooze_until)}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link
                to={`/leads/${item.lead_id}`}
                className="text-sm font-semibold text-gray-900 hover:text-brand-700 truncate transition-colors"
              >
                {item.lead.company_name}
              </Link>
              <SegmentBadge segment={item.lead.segment} />
              <span className={clsx('inline-flex items-center gap-0.5 text-[9px] font-medium uppercase tracking-wide', catMeta.color)}>
                <CatIcon className="w-2.5 h-2.5" />
                {catMeta.label}
              </span>
              {isWoken && (
                <span className={clsx(
                  'text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded',
                  hasPositiveDelta ? 'text-emerald-700 bg-emerald-100 border border-emerald-200/60' : 'text-emerald-600 bg-emerald-50',
                )}>
                  {hasPositiveDelta ? 'Improved' : 'Woken'}
                </span>
              )}
            </div>

            {/* Score bars + delta */}
            <div className="flex items-center gap-3 flex-wrap">
              {snapshot && (
                <DualBars
                  potential={snapshot.potential_score ?? snapshot.fit_score}
                  urgency={snapshot.urgency_score ?? 0}
                  evidenceModifier={snapshot.evidence_modifier}
                />
              )}
              {hasDelta && item.delta && (
                <div className="flex items-center gap-1.5">
                  <DeltaBadge label="FIT" value={item.delta.potential_change} />
                  <DeltaBadge label="INT" value={item.delta.urgency_change} />
                </div>
              )}
            </div>

            {item.notes && (
              <div className="flex items-start gap-1 mt-1.5">
                <MessageSquare className="w-3 h-3 text-gray-300 mt-0.5 shrink-0" />
                <p className="text-[11px] text-gray-400 line-clamp-1">{item.notes}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="shrink-0 flex items-center gap-1">
            {urgency === 'today' && item.status === 'active' && (
              <button
                onClick={() => onAction(item.id, 'wake')}
                className="p-1.5 rounded-md text-red-500 hover:bg-red-50 transition-colors"
                title="Wake now"
              >
                <Bell className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition-colors"
            >
              <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', showActions && 'rotate-180')} />
            </button>
          </div>
        </div>

        {/* Expanded actions */}
        {showActions && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex items-center gap-2">
            {item.status === 'active' && (
              <>
                <button
                  onClick={() => setShowSnooze(!showSnooze)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors"
                >
                  <Clock className="w-3 h-3" /> Snooze
                </button>
                <button
                  onClick={() => onAction(item.id, 'wake')}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors"
                >
                  <Play className="w-3 h-3" /> Wake now
                </button>
                <button
                  onClick={() => onAction(item.id, 'dismiss')}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                >
                  <X className="w-3 h-3" /> Dismiss
                </button>
              </>
            )}
            {(item.status === 'woken' || item.status === 'dismissed') && (
              <button
                onClick={() => onAction(item.id, 'convert', { trigger_rescore: true })}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Re-score & activate
              </button>
            )}
            <Link
              to={`/leads/${item.lead_id}`}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 transition-colors"
            >
              View lead <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        )}

        {/* Snooze picker */}
        {showSnooze && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {[
                  { label: '1w', days: 7 },
                  { label: '2w', days: 14 },
                  { label: '1mo', days: 30 },
                  { label: '3mo', days: 90 },
                ].map(p => {
                  const d = new Date();
                  d.setDate(d.getDate() + p.days);
                  const val = d.toISOString().slice(0, 10);
                  return (
                    <button
                      key={p.label}
                      onClick={() => { onAction(item.id, 'snooze', { snooze_until: val }); setShowSnooze(false); }}
                      className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <input
                type="date"
                value={snoozeDate}
                onChange={e => setSnoozeDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="text-[11px] px-2 py-1 border border-gray-200 rounded-md"
              />
              {snoozeDate && (
                <button
                  onClick={() => { onAction(item.id, 'snooze', { snooze_until: snoozeDate }); setShowSnooze(false); }}
                  className="px-2 py-1 text-[10px] font-medium text-white bg-brand-600 hover:bg-brand-700 rounded transition-colors"
                >
                  Set
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section Component ──────────────────────────────────────────

function WatchSection({ title, icon, items, urgency, accent, onAction }: {
  title: string;
  icon: React.ReactNode;
  items: WatchItem[];
  urgency: 'today' | 'week' | 'watching';
  accent: string;
  onAction: (id: string, action: string, payload?: any) => void;
}) {
  if (items.length === 0) {
    return (
      <div className={clsx('rounded-xl border border-dashed p-6 text-center', accent)}>
        <div className="flex items-center justify-center gap-2 mb-1">
          {icon}
          <span className="text-sm font-medium text-gray-400">{title}</span>
        </div>
        <p className="text-xs text-gray-400">
          {urgency === 'today' ? 'No leads waking today' :
           urgency === 'week' ? 'Nothing upcoming this week' :
           'No leads on watch'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        {icon}
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className={clsx(
          'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
          urgency === 'today' ? 'bg-red-100 text-red-700' :
          urgency === 'week' ? 'bg-amber-100 text-amber-700' :
          'bg-violet-100 text-violet-700',
        )}>
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <WatchItemCard key={item.id} item={item} urgency={urgency} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────

export function WatchList() {
  const [groups, setGroups] = useState<WatchGroups | null>(null);
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const { showToast } = useToast();

  const loadData = useCallback(() => {
    setError('');
    Promise.all([
      api('/watchlist'),
      api('/watchlist/stats'),
    ])
      .then(([g, s]) => {
        setGroups(g);
        setStats(s);
      })
      .catch(err => setError(err.message || 'Failed to load watch list'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAction = async (id: string, action: string, payload?: any) => {
    try {
      if (action === 'dismiss') {
        await api(`/watchlist/${id}/dismiss`, { method: 'POST', body: JSON.stringify({}) });
      } else if (action === 'convert') {
        await api(`/watchlist/${id}/convert`, { method: 'POST', body: JSON.stringify(payload || {}) });
      } else if (action === 'wake') {
        await api(`/watchlist/${id}/wake`, { method: 'POST' });
      } else if (action === 'snooze') {
        await api(`/watchlist/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      }
      loadData();
    } catch (err: any) {
      showToast('error', `${action} failed`, err.message || 'Something went wrong');
    }
  };

  const filterItems = (items: WatchItem[]) => {
    if (filterCategory === 'all') return items;
    return items.filter(i => i.category === filterCategory);
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
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-700 mb-3">{error}</p>
        <button onClick={loadData} className="text-sm text-red-600 hover:text-red-700 font-medium">
          Try again
        </button>
      </div>
    );
  }

  const categoryEntries = Object.entries(stats?.by_category || {}).filter(([, count]) => count > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-violet-100">
            <Eye className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Watch List</h1>
            <p className="text-sm text-gray-500">Monitoring high-fit leads for timing signals</p>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-violet-200/60 bg-violet-50/40 p-3.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Eye className="w-4 h-4 text-violet-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.total_watching}</p>
            <p className="text-xs text-gray-500">Watching</p>
          </div>
          <div className={clsx(
            'rounded-xl border p-3.5',
            stats.waking_today > 0
              ? 'border-red-200 bg-red-50/60'
              : 'border-gray-200 bg-white',
          )}>
            <div className="flex items-center gap-1.5 mb-1">
              {stats.waking_today > 0 ? (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
              ) : (
                <AlertTriangle className="w-4 h-4 text-gray-400" />
              )}
            </div>
            <p className={clsx('text-2xl font-bold', stats.waking_today > 0 ? 'text-red-700' : 'text-gray-900')}>
              {stats.waking_today}
            </p>
            <p className="text-xs text-gray-500">Waking today</p>
          </div>
          <div className="rounded-xl border border-amber-200/60 bg-amber-50/40 p-3.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Calendar className="w-4 h-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.waking_this_week}</p>
            <p className="text-xs text-gray-500">This week</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-3.5">
            <div className="flex items-center gap-1.5 mb-1">
              <RefreshCw className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.woken}</p>
            <p className="text-xs text-gray-500">Woken</p>
          </div>
        </div>
      )}

      {/* Category filter */}
      {categoryEntries.length > 0 && (
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <div className="flex gap-1">
            <button
              onClick={() => setFilterCategory('all')}
              className={clsx(
                'px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
                filterCategory === 'all' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100',
              )}
            >
              All
            </button>
            {categoryEntries.map(([cat, count]) => {
              const meta = CATEGORY_META[cat] || CATEGORY_META.manual;
              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={clsx(
                    'inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
                    filterCategory === cat ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100',
                  )}
                >
                  {meta.label} <span className="opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline sections */}
      {groups && (
        <div className="space-y-6">
          <WatchSection
            title="Waking Today"
            icon={<span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" /></span>}
            items={filterItems(groups.waking_today)}
            urgency="today"
            accent="border-red-200"
            onAction={handleAction}
          />
          <WatchSection
            title="Waking This Week"
            icon={<Clock className="w-4 h-4 text-amber-500" />}
            items={filterItems(groups.waking_this_week)}
            urgency="week"
            accent="border-amber-200"
            onAction={handleAction}
          />
          <WatchSection
            title="Watching"
            icon={<Eye className="w-4 h-4 text-violet-500" />}
            items={filterItems(groups.watching)}
            urgency="watching"
            accent="border-violet-200"
            onAction={handleAction}
          />
        </div>
      )}

      {/* Full empty state */}
      {groups && groups.waking_today.length === 0 && groups.waking_this_week.length === 0 && groups.watching.length === 0 && (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-100 mb-4">
            <Eye className="w-6 h-6 text-violet-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No leads on watch</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Leads with high fit but low intent will appear here when you add them to the watch list from their detail page.
          </p>
        </div>
      )}
    </div>
  );
}
