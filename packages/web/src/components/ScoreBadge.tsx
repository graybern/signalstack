import { clsx } from 'clsx';

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
