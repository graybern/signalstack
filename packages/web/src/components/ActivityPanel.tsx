import { useEffect, useRef, useState } from 'react';
import { useRunActivity, type ActivityEntry } from '../hooks/useRunActivity.js';
import { TokenCounter } from './TokenCounter.js';
import { ConnectionStatus } from './ConnectionStatus.js';

interface ActivityPanelProps {
  runId: string;
  campaignId?: string;
  onClose?: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  discover: 'Discovery',
  research: 'Research',
  qualify: 'Qualification',
  enrich: 'Enrichment',
  enrichment: 'Enrichment',
  score: 'Scoring',
  scoring: 'Scoring',
  brief: 'Brief Generation',
  brief_generation: 'Brief Generation',
  analysis: 'Analysis',
};

const TYPE_ICONS: Record<string, string> = {
  phase_start: '\u25B6',
  phase_complete: '\u2713',
  thinking: '\u2026',
  finding: '\u2022',
  scoring: '\u2605',
  milestone: '\u2605',
  error: '\u2717',
  token_update: '\u25CF',
};

const TYPE_COLORS: Record<string, string> = {
  phase_start: 'text-blue-400',
  phase_complete: 'text-emerald-400',
  thinking: 'text-gray-400',
  finding: 'text-cyan-400',
  scoring: 'text-amber-400',
  milestone: 'text-emerald-300',
  error: 'text-red-400',
};

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 5) return 'now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const icon = TYPE_ICONS[entry.activity_type] || '\u25CF';
  const color = TYPE_COLORS[entry.activity_type] || 'text-gray-500';
  const isBold = entry.activity_type === 'milestone' || entry.activity_type === 'phase_start' || entry.activity_type === 'phase_complete';
  const hasDetails = entry.details || entry.error_message;

  return (
    <div className="group px-3 py-1.5 hover:bg-gray-800/50 transition-colors">
      <div
        className={`flex items-start gap-2 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <span className={`${color} text-xs mt-0.5 w-3 flex-shrink-0 text-center`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${isBold ? 'text-gray-100 font-medium' : 'text-gray-300'} ${entry.activity_type === 'error' ? 'text-red-300' : ''}`}>
            {entry.company_name && entry.activity_type !== 'phase_start' && entry.activity_type !== 'phase_complete' && (
              <span className="text-gray-500">[{entry.company_name}] </span>
            )}
            {entry.title}
          </span>
        </div>
        <span className="text-[10px] text-gray-600 flex-shrink-0 mt-0.5">{timeAgo(entry.created_at)}</span>
        {hasDetails && (
          <span className="text-gray-600 text-[10px] mt-0.5 opacity-0 group-hover:opacity-100">{expanded ? '\u25B2' : '\u25BC'}</span>
        )}
      </div>
      {expanded && hasDetails && (
        <div className="ml-5 mt-1 mb-1 p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-400 overflow-x-auto">
          {entry.error_message && <div className="text-red-400 mb-1">{entry.error_message}</div>}
          {entry.details && <pre className="whitespace-pre-wrap">{JSON.stringify(entry.details, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

function PhaseRail({ phases }: { phases: { phase: string; state: 'pending' | 'active' | 'complete' }[] }) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800">
      {phases.map(({ phase, state }, i) => (
        <div key={phase} className="flex items-center gap-1">
          {i > 0 && <div className="w-4 h-px bg-gray-700" />}
          <div
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
              state === 'complete'
                ? 'bg-emerald-900/50 text-emerald-400'
                : state === 'active'
                ? 'bg-blue-900/50 text-blue-400 animate-pulse'
                : 'bg-gray-800 text-gray-600'
            }`}
          >
            {state === 'complete' ? '\u2713 ' : ''}{PHASE_LABELS[phase] || phase}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityPanel({ runId, onClose }: ActivityPanelProps) {
  const { activities, phaseStates, tokens, isComplete, connectionState } = useRunActivity(runId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const userScrolled = useRef(false);

  // Auto-scroll to bottom on new entries (unless user scrolled up)
  useEffect(() => {
    if (!userScrolled.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activities.length]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    userScrolled.current = scrollHeight - scrollTop - clientHeight > 50;
  };

  const currentPhaseLabel = phaseStates.find(p => p.state === 'active');

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900/80 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-400 hover:text-gray-200 text-xs"
          >
            {collapsed ? '\u25B6' : '\u25BC'}
          </button>
          <span className="text-xs font-medium text-gray-200">
            {isComplete ? 'Run Complete' : currentPhaseLabel ? `${PHASE_LABELS[currentPhaseLabel.phase] || currentPhaseLabel.phase}...` : 'Starting...'}
          </span>
          <ConnectionStatus state={connectionState} />
        </div>
        <div className="flex items-center gap-2">
          {tokens && (
            <TokenCounter
              input_tokens={tokens.input_tokens}
              output_tokens={tokens.output_tokens}
              estimated_cost={tokens.estimated_cost}
            />
          )}
          {onClose && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm ml-2">\u2715</button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Phase Rail */}
          <PhaseRail phases={phaseStates} />

          {/* Activity Log */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700"
          >
            {activities.length === 0 ? (
              <div className="px-3 py-6 text-center text-gray-600 text-sm">
                Waiting for activity...
              </div>
            ) : (
              activities
                .filter(a => a.activity_type !== 'token_update')
                .map((entry) => <ActivityItem key={entry.id} entry={entry} />)
            )}
          </div>

          {/* Footer */}
          {isComplete && (
            <div className="px-3 py-2 bg-gray-900/50 border-t border-gray-800 text-center">
              <span className="text-[11px] text-gray-500">
                {activities.some(a => a.activity_type === 'error') ? 'Run failed' : 'Run completed'} — {activities.length} activity entries
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
