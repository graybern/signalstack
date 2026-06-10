import { clsx } from 'clsx';
import { useState } from 'react';
import {
  Crosshair, Eye, Search, X, Clock, ArrowUpRight, ChevronDown,
  Zap, Shield, Target, Radio,
} from 'lucide-react';

// ── Base Components (v1 + v2) ───────────────────────────────────

interface ScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

export function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  const color = score >= 70 ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : score >= 55 ? 'bg-amber-100 text-amber-800 border-amber-200'
    : score >= 35 ? 'bg-orange-100 text-orange-800 border-orange-200'
    : 'bg-red-100 text-red-800 border-red-200';

  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs'
    : size === 'lg' ? 'w-14 h-14 text-lg'
    : 'w-10 h-10 text-sm';

  return (
    <div className={clsx('rounded-full border-2 flex items-center justify-center font-bold', color, sizeClass)}>
      {score}
    </div>
  );
}

export function ScoreLabel({ score }: { score: number }) {
  if (score >= 85) return <span className="text-emerald-700 font-medium">Extremely High</span>;
  if (score >= 70) return <span className="text-emerald-600 font-medium">High</span>;
  if (score >= 55) return <span className="text-amber-600 font-medium">Medium</span>;
  if (score >= 35) return <span className="text-orange-600 font-medium">Low</span>;
  return <span className="text-red-600 font-medium">Very Low</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const color = confidence === 'high' ? 'bg-emerald-50 text-emerald-700'
    : confidence === 'medium' ? 'bg-amber-50 text-amber-700'
    : 'bg-gray-100 text-gray-600';

  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', color)}>
      {confidence}
    </span>
  );
}

export function SegmentBadge({ segment }: { segment: string }) {
  const color = segment === 'ENT' ? 'bg-purple-100 text-purple-800'
    : segment === 'MM' ? 'bg-blue-100 text-blue-800'
    : 'bg-teal-100 text-teal-800';

  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold uppercase', color)}>
      {segment}
    </span>
  );
}

function scoreColor(score: number): string {
  if (score >= 85) return '#10b981';
  if (score >= 70) return '#3b82f6';
  if (score >= 55) return '#f59e0b';
  if (score >= 35) return '#f97316';
  return '#ef4444';
}

export function ScoreRing({ score, size = 72, grade }: { score: number; size?: number; grade?: string }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(score, 100) / 100;
  const color = scoreColor(score);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="round"
          className="transition-all duration-500" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none" style={{ color }}>{score}</span>
      </div>
      {grade && (
        <div className="absolute -bottom-1 -right-1">
          <GradeBadge grade={grade} size="sm" />
        </div>
      )}
    </div>
  );
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  B: 'bg-sky-100 text-sky-800 border-sky-300',
  C: 'bg-amber-100 text-amber-800 border-amber-300',
  D: 'bg-orange-100 text-orange-800 border-orange-300',
  F: 'bg-red-100 text-red-800 border-red-300',
};

export function GradeBadge({ grade, size = 'md' }: { grade: string; size?: 'sm' | 'md' }) {
  const colors = GRADE_COLORS[grade] || GRADE_COLORS.F;
  return (
    <span className={clsx(
      'inline-flex items-center justify-center font-bold border rounded-full',
      colors,
      size === 'sm' ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-xs',
    )}>
      {grade}
    </span>
  );
}

const GRADE_DESCRIPTIONS: Record<string, string> = {
  A: 'Excellent. Multiple sources confirm key facts.',
  B: 'Good. Strong enrichment coverage.',
  C: 'Moderate. Key fields unconfirmed.',
  D: 'Limited. Few sources or sparse data.',
  F: 'Insufficient. Can\'t verify basics.',
};

export function GradeTooltip({ grade }: { grade: string }) {
  const desc = GRADE_DESCRIPTIONS[grade] || GRADE_DESCRIPTIONS.F;
  return (
    <span className="relative group">
      <GradeBadge grade={grade} />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-[10px] leading-snug text-white bg-gray-900 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
        <span className="font-semibold">Grade {grade}</span> — {desc}
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  );
}

const DIMENSION_META: Record<string, { label: string; abbr: string; color: string; barColor: string }> = {
  icp_fit:     { label: 'ICP Fit',     abbr: 'ICP',  color: 'text-sky-700',     barColor: 'bg-sky-500' },
  timing:      { label: 'Timing',      abbr: 'TIME', color: 'text-amber-700',   barColor: 'bg-amber-500' },
  reachability:{ label: 'Reachability', abbr: 'REACH',color: 'text-violet-700',  barColor: 'bg-violet-500' },
  data_confidence: { label: 'Data',    abbr: 'DATA', color: 'text-emerald-700', barColor: 'bg-emerald-500' },
  research_completeness: { label: 'Research', abbr: 'RES', color: 'text-slate-600', barColor: 'bg-slate-400' },
  signal_density: { label: 'Signals',  abbr: 'SIG',  color: 'text-indigo-700',  barColor: 'bg-indigo-500' },
};

export function DimensionGauge({ dimension, value, maxValue = 100 }: { dimension: string; value: number; maxValue?: number }) {
  const meta = DIMENSION_META[dimension] || { label: dimension, abbr: dimension.slice(0, 3).toUpperCase(), color: 'text-gray-600', barColor: 'bg-gray-400' };
  const pct = Math.min(value / maxValue * 100, 100);
  const weak = value < 35;

  return (
    <div className={clsx('flex flex-col gap-0.5 min-w-[70px]', weak && 'opacity-50')}>
      <div className="flex items-baseline justify-between gap-1">
        <span className={clsx('text-[9px] font-medium uppercase tracking-wide', weak ? 'text-gray-400' : meta.color)}>{meta.label}</span>
        <span className={clsx('text-xs font-bold', weak ? 'text-gray-400' : meta.color)}>{value}</span>
      </div>
      <div className="h-[3px] bg-gray-100 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all duration-300', weak ? 'bg-gray-300' : meta.barColor)}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface DimensionRailProps {
  dimensions: {
    icp_fit: number;
    timing: number;
    data_confidence?: string;
    data_confidence_score?: number;
    reachability: number;
    research_completeness: number;
    signal_density?: { total_signals?: number } | null;
  };
}

export function DimensionRail({ dimensions }: DimensionRailProps) {
  const signalCount = dimensions.signal_density?.total_signals ?? 0;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <DimensionGauge dimension="icp_fit" value={dimensions.icp_fit} />
      <DimensionGauge dimension="timing" value={dimensions.timing} />
      <DimensionGauge dimension="reachability" value={dimensions.reachability} />
      <DimensionGauge dimension="data_confidence" value={dimensions.data_confidence_score ?? 0} />
      <DimensionGauge dimension="research_completeness" value={dimensions.research_completeness} />
      <DimensionGauge dimension="signal_density" value={signalCount} maxValue={20} />
    </div>
  );
}

export function MiniGauge({ label, value, maxValue = 100, color }: { label: string; value: number; maxValue?: number; color: string }) {
  const pct = Math.min(value / maxValue * 100, 100);
  const weak = value < 35;
  return (
    <div className="flex items-center gap-1">
      <span className={clsx('text-[9px] font-medium uppercase', weak ? 'text-gray-400' : `text-${color}-600`)}>{label}</span>
      <div className="w-8 h-[3px] bg-gray-100 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', weak ? 'bg-gray-300' : `bg-${color}-500`)}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const DOT_COLORS: Record<string, string> = {
  confirmed: 'bg-emerald-500',
  responded: 'bg-emerald-500',
  inferred: 'bg-amber-400',
  failed: 'bg-red-400',
  unchecked: 'bg-gray-300',
};

export function SourceDot({ status, label }: { status: string; label?: string }) {
  const bg = DOT_COLORS[status] || DOT_COLORS.unchecked;
  return (
    <span className="inline-flex items-center gap-1" title={label || status}>
      <span className={clsx('w-2 h-2 rounded-full inline-block', bg)} />
      {label && <span className="text-[10px] text-gray-500">{label}</span>}
    </span>
  );
}

// ── V2 Scoring Components ───────────────────────────────────────

export type ActionState = 'engage' | 'watch' | 'research' | 'pass' | 'watching';

export const ACTION_CONFIG: Record<ActionState, {
  label: string;
  verb: string;
  icon: typeof Crosshair;
  bg: string;
  border: string;
  text: string;
  iconColor: string;
  btnBg: string;
  btnText: string;
  glow: string;
}> = {
  engage: {
    label: 'Engage',
    verb: 'Ready to contact',
    icon: Crosshair,
    bg: 'bg-emerald-950',
    border: 'border-emerald-800/60',
    text: 'text-emerald-100',
    iconColor: 'text-emerald-400',
    btnBg: 'bg-emerald-500 hover:bg-emerald-400',
    btnText: 'text-white',
    glow: 'shadow-[inset_0_1px_0_0_rgba(16,185,129,0.15)]',
  },
  watch: {
    label: 'Watch',
    verb: 'Monitor for timing',
    icon: Eye,
    bg: 'bg-amber-950',
    border: 'border-amber-800/60',
    text: 'text-amber-100',
    iconColor: 'text-amber-400',
    btnBg: 'bg-amber-500 hover:bg-amber-400',
    btnText: 'text-amber-950',
    glow: 'shadow-[inset_0_1px_0_0_rgba(245,158,11,0.15)]',
  },
  research: {
    label: 'Research',
    verb: 'Needs more data',
    icon: Search,
    bg: 'bg-sky-950',
    border: 'border-sky-800/60',
    text: 'text-sky-100',
    iconColor: 'text-sky-400',
    btnBg: 'bg-sky-500 hover:bg-sky-400',
    btnText: 'text-white',
    glow: 'shadow-[inset_0_1px_0_0_rgba(14,165,233,0.15)]',
  },
  pass: {
    label: 'Pass',
    verb: 'Does not fit ICP',
    icon: X,
    bg: 'bg-gray-900',
    border: 'border-gray-700/60',
    text: 'text-gray-300',
    iconColor: 'text-gray-500',
    btnBg: 'bg-gray-700 hover:bg-gray-600',
    btnText: 'text-gray-200',
    glow: '',
  },
  watching: {
    label: 'Watching',
    verb: 'On watch list',
    icon: Clock,
    bg: 'bg-violet-950',
    border: 'border-violet-800/60',
    text: 'text-violet-100',
    iconColor: 'text-violet-400',
    btnBg: 'bg-violet-500 hover:bg-violet-400',
    btnText: 'text-white',
    glow: 'shadow-[inset_0_1px_0_0_rgba(139,92,246,0.15)]',
  },
};

export function deriveActionState(dims: {
  potential_score?: number;
  urgency_score?: number;
  evidence_modifier?: number;
  watch_candidate?: boolean;
}, isWatching?: boolean): ActionState {
  if (isWatching) return 'watching';
  const fit = dims.potential_score ?? 0;
  const intent = dims.urgency_score ?? 0;
  const evidence = dims.evidence_modifier ?? 0.5;

  if (fit >= 60 && intent < 35) return 'watch';
  if (fit < 40) return 'pass';
  if (evidence < 0.65 && fit >= 40) return 'research';
  if (fit >= 55 && intent >= 35) return 'engage';
  return 'research';
}

interface ActionCardProps {
  dimensions: {
    potential_score?: number;
    urgency_score?: number;
    evidence_modifier?: number;
    watch_candidate?: boolean;
    watch_reason?: string | null;
  };
  leadId?: string;
  isWatching?: boolean;
  watchWakeDate?: string | null;
  watchCategory?: string | null;
  watchItemId?: string | null;
  championName?: string | null;
  championTitle?: string | null;
  championLinkedIn?: string | null;
  onAction?: (action: ActionState) => void;
  onWatchAdded?: () => void;
}

const SNOOZE_PRESETS = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
];

const WATCH_CATEGORIES = [
  { id: 'timing_watch', label: 'Timing', desc: 'Waiting for buying signals' },
  { id: 'data_needs', label: 'Data', desc: 'Needs more enrichment' },
  { id: 'nurture', label: 'Nurture', desc: 'Long-term monitoring' },
  { id: 'manual', label: 'Manual', desc: 'Custom watch' },
];

export function ActionCard({ dimensions, leadId, isWatching, watchWakeDate, watchCategory, watchItemId, championName, championTitle, championLinkedIn, onAction, onWatchAdded }: ActionCardProps) {
  const state = deriveActionState(dimensions, isWatching);
  const config = ACTION_CONFIG[state];
  const Icon = config.icon;

  const [showWatchForm, setShowWatchForm] = useState(false);
  const [watchSnooze, setWatchSnooze] = useState('');
  const [watchCat, setWatchCat] = useState('timing_watch');
  const [watchNotes, setWatchNotes] = useState('');
  const [watchReenrich, setWatchReenrich] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [watchConfirmed, setWatchConfirmed] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const rationale = state === 'engage'
    ? `Fit ${dimensions.potential_score ?? 0} + Intent ${dimensions.urgency_score ?? 0} — strong on both axes`
    : state === 'watch'
    ? dimensions.watch_reason || `Fit ${dimensions.potential_score ?? 0} is strong but Intent ${dimensions.urgency_score ?? 0} is low`
    : state === 'research'
    ? `Evidence modifier at ${((dimensions.evidence_modifier ?? 0.5) * 100).toFixed(0)}% — data gaps reduce confidence`
    : state === 'watching'
    ? `Monitoring until signals change${watchWakeDate ? ` — wakes ${watchWakeDate}` : ''}`
    : `Fit score ${dimensions.potential_score ?? 0} below threshold`;

  const btnLabel = state === 'engage' ? 'Start outreach'
    : state === 'watch' ? 'Add to watch list'
    : state === 'research' ? 'Re-enrich lead'
    : state === 'watching' ? 'View watch list'
    : 'Dismiss';

  const handleButtonClick = () => {
    if (state === 'watch') {
      setShowWatchForm(!showWatchForm);
    } else {
      onAction?.(state);
    }
  };

  const handleSubmitWatch = async () => {
    if (!leadId || !watchSnooze) return;
    setSubmitting(true);
    try {
      const { api } = await import('../api/client');
      await api(`/watchlist/${leadId}`, {
        method: 'POST',
        body: JSON.stringify({
          snooze_until: watchSnooze,
          category: watchCat,
          notes: watchNotes || undefined,
          rerun_on_wake: watchReenrich,
        }),
      });
      setShowWatchForm(false);
      setWatchConfirmed(true);
      setTimeout(() => setWatchConfirmed(false), 3000);
      onWatchAdded?.();
    } catch (err) {
      console.error('Failed to add to watch list:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismissWatch = async () => {
    if (!watchItemId) return;
    setDismissing(true);
    try {
      const { api } = await import('../api/client');
      await api(`/watchlist/${watchItemId}/dismiss`, { method: 'POST' });
      onWatchAdded?.();
    } catch (err) {
      console.error('Failed to dismiss watch:', err);
    } finally {
      setDismissing(false);
    }
  };

  const selectPreset = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setWatchSnooze(d.toISOString().slice(0, 10));
  };

  return (
    <div className={clsx(
      'rounded-xl border p-4 transition-all',
      config.bg, config.border, config.glow,
    )}>
      {/* Score context bar */}
      <div className={clsx('flex items-center gap-2 mb-3 pb-2 border-b border-white/[0.08] text-[10px] font-medium tabular-nums', config.text, 'opacity-50')}>
        <span>FIT {dimensions.potential_score ?? 0}</span>
        <span className="opacity-30">·</span>
        <span>INT {dimensions.urgency_score ?? 0}</span>
        {dimensions.evidence_modifier != null && (
          <>
            <span className="opacity-30">·</span>
            <span>EV {Math.round((dimensions.evidence_modifier) * 100)}%</span>
          </>
        )}
      </div>
      <div className="flex items-start gap-3">
        <div className={clsx('mt-0.5 p-1.5 rounded-lg bg-white/[0.07]')}>
          <Icon className={clsx('w-4 h-4', config.iconColor)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={clsx('text-sm font-semibold tracking-tight', config.text)}>{config.label}</span>
            <span className={clsx('text-[10px] uppercase tracking-wider opacity-60', config.text)}>{config.verb}</span>
          </div>
          <p className={clsx('text-[11px] leading-relaxed opacity-70 mb-3', config.text)}>
            {rationale}
          </p>
          {state === 'watching' && watchWakeDate && (
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-3 h-3 text-violet-400" />
              <span className="text-[11px] text-violet-300">
                Wakes {watchWakeDate}
                {watchCategory && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-violet-800/50 text-violet-300 text-[10px]">{watchCategory.replace(/_/g, ' ')}</span>}
              </span>
            </div>
          )}
          {watchConfirmed && (
            <div className="flex items-center gap-1.5 mb-2 px-2 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-[11px] font-medium">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              Added to watch list
            </div>
          )}
          <button
            onClick={handleButtonClick}
            className={clsx(
              'w-full py-1.5 rounded-lg text-xs font-medium transition-colors',
              config.btnBg, config.btnText,
            )}
          >
            {showWatchForm ? 'Cancel' : btnLabel}
          </button>
          {state === 'watching' && watchItemId && (
            <button
              onClick={handleDismissWatch}
              disabled={dismissing}
              className="w-full mt-1.5 py-1 text-[10px] text-violet-300/70 hover:text-violet-200 transition-colors disabled:opacity-40"
            >
              {dismissing ? 'Removing...' : 'Remove from watch list'}
            </button>
          )}
          {state === 'engage' && championName && championLinkedIn && (
            <a
              href={championLinkedIn}
              target="_blank"
              rel="noopener"
              className={clsx('flex items-center gap-1.5 mt-2 text-[10px] opacity-70 hover:opacity-100 transition-opacity', config.text)}
            >
              <ArrowUpRight className="w-3 h-3" />
              <span className="truncate">{championName}, {championTitle}</span>
            </a>
          )}
        </div>
      </div>

      {/* Inline Watch Form */}
      {showWatchForm && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
          {/* Snooze date presets */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-amber-300/60 mb-1.5 block">Wake after</label>
            <div className="flex gap-1.5 mb-1.5">
              {SNOOZE_PRESETS.map(p => {
                const d = new Date();
                d.setDate(d.getDate() + p.days);
                const val = d.toISOString().slice(0, 10);
                const selected = watchSnooze === val;
                return (
                  <button
                    key={p.label}
                    onClick={() => selectPreset(p.days)}
                    className={clsx(
                      'px-2 py-1 text-[10px] font-medium rounded-md transition-colors',
                      selected
                        ? 'bg-amber-500 text-amber-950'
                        : 'bg-white/[0.06] text-amber-200/80 hover:bg-white/10',
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <input
              type="date"
              value={watchSnooze}
              onChange={e => setWatchSnooze(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full text-[11px] px-2 py-1.5 bg-white/[0.06] border border-white/10 rounded-md text-amber-100 placeholder-amber-300/30"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-amber-300/60 mb-1.5 block">Category</label>
            <div className="grid grid-cols-2 gap-1">
              {WATCH_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setWatchCat(c.id)}
                  className={clsx(
                    'text-left px-2 py-1.5 rounded-md text-[10px] transition-colors',
                    watchCat === c.id
                      ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                      : 'bg-white/[0.04] text-amber-200/60 border border-transparent hover:bg-white/[0.06]',
                  )}
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="block text-[9px] opacity-60 mt-0.5">{c.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-amber-300/60 mb-1.5 block">Notes <span className="opacity-50">(optional)</span></label>
            <input
              type="text"
              value={watchNotes}
              onChange={e => setWatchNotes(e.target.value)}
              placeholder="Why are we watching this lead?"
              className="w-full text-[11px] px-2 py-1.5 bg-white/[0.06] border border-white/10 rounded-md text-amber-100 placeholder-amber-300/20"
            />
          </div>

          {/* Re-enrich toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => setWatchReenrich(!watchReenrich)}
              className={clsx(
                'w-7 h-4 rounded-full transition-colors relative cursor-pointer',
                watchReenrich ? 'bg-amber-500' : 'bg-white/10',
              )}
            >
              <div className={clsx(
                'w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all',
                watchReenrich ? 'left-3.5' : 'left-0.5',
              )} />
            </div>
            <span className="text-[10px] text-amber-200/70">Re-enrich & re-score on wake</span>
          </label>

          {/* Submit */}
          <button
            onClick={handleSubmitWatch}
            disabled={!watchSnooze || submitting}
            className="w-full py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-amber-950 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Adding...' : 'Add to watch list'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Three-Bucket Strip ──────────────────────────────────────────

export interface BucketData {
  label: string;
  question: string;
  score: number;
  icon: typeof Target;
  colorScheme: {
    bar: string;
    barTrack: string;
    label: string;
    score: string;
    subLabel: string;
    subBar: string;
    bg: string;
    border: string;
    accentBorder: string;
    expandedBg: string;
  };
  subDimensions: { label: string; value: number; weight: number }[];
}

export function buildBuckets(dims: {
  icp_fit: number;
  timing: number;
  data_confidence_score?: number;
  reachability: number;
  research_completeness: number;
  signal_quality?: number;
  potential_score?: number;
  urgency_score?: number;
  evidence_modifier?: number;
}): BucketData[] {
  return [
    {
      label: 'FIT',
      question: 'Would they buy?',
      score: dims.potential_score ?? Math.round(dims.icp_fit * 0.7 + dims.reachability * 0.2 + (dims.data_confidence_score ?? 0) * 0.1),
      icon: Target,
      colorScheme: {
        bar: 'bg-sky-500',
        barTrack: 'bg-sky-100',
        label: 'text-sky-600',
        score: 'text-sky-700',
        subLabel: 'text-sky-600/70',
        subBar: 'bg-sky-400',
        bg: 'bg-sky-50/70',
        border: 'border-sky-200/60',
        accentBorder: 'border-l-sky-400',
        expandedBg: 'bg-sky-50',
      },
      subDimensions: [
        { label: 'ICP Fit', value: dims.icp_fit, weight: 70 },
        { label: 'Reachability', value: dims.reachability, weight: 20 },
        { label: 'Data Confidence', value: dims.data_confidence_score ?? 0, weight: 10 },
      ],
    },
    {
      label: 'INTENT',
      question: 'Want to buy now?',
      score: dims.urgency_score ?? Math.round(dims.timing * 0.6 + (dims.signal_quality ?? 0) * 0.4),
      icon: Zap,
      colorScheme: {
        bar: 'bg-amber-500',
        barTrack: 'bg-amber-100',
        label: 'text-amber-600',
        score: 'text-amber-700',
        subLabel: 'text-amber-600/70',
        subBar: 'bg-amber-400',
        bg: 'bg-amber-50/70',
        border: 'border-amber-200/60',
        accentBorder: 'border-l-amber-400',
        expandedBg: 'bg-amber-50',
      },
      subDimensions: [
        { label: 'Timing', value: dims.timing, weight: 60 },
        { label: 'Signal Quality', value: dims.signal_quality ?? 0, weight: 40 },
      ],
    },
    {
      label: 'EVIDENCE',
      question: 'Can we prove it?',
      score: Math.round((dims.evidence_modifier ?? (0.5 + dims.research_completeness / 200)) * 100),
      icon: Shield,
      colorScheme: {
        bar: 'bg-slate-500',
        barTrack: 'bg-slate-100',
        label: 'text-slate-500',
        score: 'text-slate-700',
        subLabel: 'text-slate-500/70',
        subBar: 'bg-slate-400',
        bg: 'bg-slate-50/70',
        border: 'border-slate-200/60',
        accentBorder: 'border-l-slate-400',
        expandedBg: 'bg-slate-50',
      },
      subDimensions: [
        { label: 'Research', value: dims.research_completeness, weight: 100 },
      ],
    },
  ];
}

function BucketPanel({ bucket, expanded, onToggle }: { bucket: BucketData; expanded: boolean; onToggle: () => void }) {
  const { colorScheme: c } = bucket;
  const Icon = bucket.icon;
  const pct = Math.min(bucket.score, 100);
  const evidenceDisplay = bucket.label === 'EVIDENCE';
  const displayScore = evidenceDisplay ? `${pct}%` : bucket.score.toString();
  const weak = bucket.score < 35;

  return (
    <div className={clsx(
      'flex-1 min-w-0 rounded-lg border-l-[3px] border border-r border-t border-b transition-all',
      c.accentBorder, expanded ? c.expandedBg : c.bg,
      'border-r-gray-200/40 border-t-gray-200/40 border-b-gray-200/40',
    )}>
      <button onClick={onToggle} className="w-full text-left px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Icon className={clsx('w-3.5 h-3.5', c.label)} />
            <span className={clsx('text-[10px] font-semibold uppercase tracking-wider', c.label)}>{bucket.label}</span>
            <span className={clsx('text-[9px] opacity-40 hidden sm:inline', c.label)}>{bucket.question}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={clsx('text-base font-bold tabular-nums', weak ? 'text-gray-400' : c.score)}>{displayScore}</span>
            <ChevronDown className={clsx('w-3 h-3 transition-transform', c.label, expanded && 'rotate-180')} />
          </div>
        </div>
        <div className={clsx('h-[5px] rounded-full overflow-hidden', c.barTrack)}>
          <div className={clsx('h-full rounded-full transition-all duration-500', weak ? 'bg-gray-300' : c.bar)}
            style={{ width: `${pct}%` }} />
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 border-t border-gray-200/30">
          {bucket.subDimensions.map((sub, i) => (
            <div key={sub.label} className={clsx(
              'flex items-center gap-2 py-1.5 px-1 -mx-1 rounded',
              i % 2 === 1 && 'bg-gray-50/60',
            )}>
              <span className={clsx('text-[10px] w-24 truncate font-medium', c.subLabel)}>{sub.label}</span>
              <div className={clsx('flex-1 h-1.5 rounded-full overflow-hidden', c.barTrack)}>
                <div className={clsx('h-full rounded-full', c.subBar)}
                  style={{ width: `${Math.min(sub.value, 100)}%` }} />
              </div>
              <span className={clsx('text-[11px] font-semibold tabular-nums w-6 text-right', c.subLabel)}>{sub.value}</span>
              <span className="text-[9px] text-gray-400 w-7 text-right">{sub.weight}%</span>
            </div>
          ))}
          {evidenceDisplay && (
            <div className="mt-1.5 text-[9px] text-slate-400 px-1">
              Scales composite: {pct}% of max score applied
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ThreeBucketStripProps {
  dimensions: {
    icp_fit: number;
    timing: number;
    data_confidence_score?: number;
    reachability: number;
    research_completeness: number;
    signal_quality?: number;
    potential_score?: number;
    urgency_score?: number;
    evidence_modifier?: number;
  };
}

export function ThreeBucketStrip({ dimensions }: ThreeBucketStripProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0, 1, 2]));
  const buckets = buildBuckets(dimensions);

  return (
    <div className="flex gap-2">
      {buckets.map((bucket, i) => (
        <BucketPanel
          key={bucket.label}
          bucket={bucket}
          expanded={expanded.has(i)}
          onToggle={() => setExpanded(prev => {
            const next = new Set(prev);
            next.has(i) ? next.delete(i) : next.add(i);
            return next;
          })}
        />
      ))}
    </div>
  );
}

// ── Watch Badge ─────────────────────────────────────────────────

type WatchCategory = 'timing_watch' | 'data_needs' | 'nurture' | 'manual';

const WATCH_ICONS: Record<WatchCategory, typeof Clock> = {
  timing_watch: Clock,
  data_needs: Search,
  nurture: Radio,
  manual: Eye,
};

function daysUntil(dateStr: string): number {
  const now = new Date();
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

interface WatchBadgeProps {
  wakeDate?: string | null;
  category?: WatchCategory | string;
  compact?: boolean;
}

export function WatchBadge({ wakeDate, category = 'manual', compact = false }: WatchBadgeProps) {
  const days = wakeDate ? daysUntil(wakeDate) : null;
  const isWakingToday = days !== null && days <= 0;
  const isWakingThisWeek = days !== null && days > 0 && days <= 7;
  const WIcon = WATCH_ICONS[(category as WatchCategory)] || Eye;

  const urgencyClass = isWakingToday
    ? 'bg-red-50 text-red-700 border-red-200'
    : isWakingThisWeek
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-violet-50 text-violet-700 border-violet-200';

  const dateDisplay = isWakingToday
    ? 'today'
    : days !== null && days <= 7
    ? `${days}d`
    : wakeDate
    ? new Date(wakeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  if (compact) {
    return (
      <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium border', urgencyClass)}>
        {isWakingToday && <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" /></span>}
        <WIcon className="w-2.5 h-2.5" />
        {dateDisplay}
      </span>
    );
  }

  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border', urgencyClass)}>
      {isWakingToday && <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" /></span>}
      <WIcon className="w-3 h-3" />
      <span>{dateDisplay}</span>
      {!compact && category && <span className="opacity-60">{(category as string).replace(/_/g, ' ')}</span>}
    </span>
  );
}

// ── Dual Bars (LeadCard) ────────────────────────────────────────

interface DualBarsProps {
  potential: number;
  urgency: number;
  evidenceModifier?: number;
}

export function DualBars({ potential, urgency, evidenceModifier }: DualBarsProps) {
  const fitPct = Math.min(potential, 100);
  const intPct = Math.min(urgency, 100);
  const fitWeak = potential < 35;
  const intWeak = urgency < 35;
  const evMod = evidenceModifier ?? 1;
  const evPct = Math.round(evMod * 100);

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1 min-w-0">
        <span className={clsx('text-[9px] font-semibold uppercase tracking-wide w-5 shrink-0', fitWeak ? 'text-gray-400' : 'text-sky-600')}>FIT</span>
        <div className="w-[4.5rem] h-[5px] bg-sky-100 rounded-full overflow-hidden">
          <div className={clsx('h-full rounded-full transition-all', fitWeak ? 'bg-gray-300' : 'bg-sky-500')}
            style={{ width: `${fitPct}%` }} />
        </div>
        <span className={clsx('text-[10px] font-bold tabular-nums w-6', fitWeak ? 'text-gray-400' : 'text-sky-700')}>{potential}</span>
      </div>
      <div className="w-px h-3.5 bg-gray-200/80" />
      <div className="flex items-center gap-1 min-w-0">
        <span className={clsx('text-[9px] font-semibold uppercase tracking-wide w-5 shrink-0', intWeak ? 'text-gray-400' : 'text-amber-600')}>INT</span>
        <div className="w-[4.5rem] h-[5px] bg-amber-100 rounded-full overflow-hidden">
          <div className={clsx('h-full rounded-full transition-all', intWeak ? 'bg-gray-300' : 'bg-amber-500')}
            style={{ width: `${intPct}%` }} />
        </div>
        <span className={clsx('text-[10px] font-bold tabular-nums w-6', intWeak ? 'text-gray-400' : 'text-amber-700')}>{urgency}</span>
      </div>
      {evidenceModifier !== undefined && (
        <>
          <div className="w-px h-3.5 bg-gray-200/80" />
          <span className={clsx(
            'text-[9px] font-semibold tabular-nums px-1.5 py-0.5 rounded',
            evPct >= 80 ? 'text-slate-600 bg-slate-100' :
            evPct >= 60 ? 'text-amber-600 bg-amber-50' :
            'text-red-500 bg-red-50',
          )}>
            {evPct}%
          </span>
        </>
      )}
    </div>
  );
}

// ── Inline Score Strip (Leads table) ──────────────────────────────

interface InlineScoreStripProps {
  score: number;
  potential?: number | null;
  urgency?: number | null;
  evidenceModifier?: number | null;
  compositeVersion?: number;
}

function dimColor(val: number): string {
  if (val >= 60) return 'text-emerald-700 bg-emerald-50';
  if (val >= 35) return 'text-amber-700 bg-amber-50';
  return 'text-gray-500 bg-gray-50';
}

export function InlineScoreStrip({ score, potential, urgency, evidenceModifier, compositeVersion }: InlineScoreStripProps) {
  const hasV2 = compositeVersion === 2 && potential != null && urgency != null;
  const evPct = evidenceModifier != null ? Math.round(evidenceModifier * 100) : null;

  return (
    <div className="flex items-center gap-1.5">
      <ScoreBadge score={score} size="sm" />
      {hasV2 ? (
        <div className="flex items-center gap-1 text-[11px] font-semibold tabular-nums">
          <span className={clsx('px-1.5 py-0.5 rounded', dimColor(potential!))}>
            <span className="text-[9px] font-medium opacity-60 mr-0.5">F</span>{potential}
          </span>
          <span className={clsx('px-1.5 py-0.5 rounded', dimColor(urgency!))}>
            <span className="text-[9px] font-medium opacity-60 mr-0.5">I</span>{urgency}
          </span>
          {evPct !== null && (
            <span className={clsx('px-1.5 py-0.5 rounded text-[10px]',
              evPct >= 80 ? 'text-slate-600 bg-slate-50' :
              evPct >= 60 ? 'text-amber-600 bg-amber-50' :
              'text-red-500 bg-red-50',
            )}>
              {evPct}%
            </span>
          )}
        </div>
      ) : (
        <span className="text-[9px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">v1</span>
      )}
    </div>
  );
}
