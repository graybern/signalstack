import { clsx } from 'clsx';

interface ScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

export function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  const color = score >= 80 ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : score >= 60 ? 'bg-amber-100 text-amber-800 border-amber-200'
    : score >= 40 ? 'bg-orange-100 text-orange-800 border-orange-200'
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
  if (score >= 90) return <span className="text-emerald-700 font-medium">Extremely High</span>;
  if (score >= 75) return <span className="text-emerald-600 font-medium">High</span>;
  if (score >= 60) return <span className="text-amber-600 font-medium">Medium</span>;
  if (score >= 40) return <span className="text-orange-600 font-medium">Low</span>;
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
