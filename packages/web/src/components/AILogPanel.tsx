import { useState, useEffect, useRef, useCallback } from 'react';
import { useEventStream, type SSEEvent } from '../hooks/useEventStream';
import { Sparkles, ChevronDown, Loader2 } from 'lucide-react';

interface AIStreamDelta {
  run_id: string;
  campaign_id?: string;
  phase: string;
  company_name?: string;
  block_type: 'thinking' | 'text';
  delta: string;
  done: boolean;
}

type StreamStatus = 'idle' | 'thinking' | 'responding' | 'done';

interface AIBlock {
  id: number;
  phase: string;
  company_name?: string;
  thinking: string;
  text: string;
  thinkingDone: boolean;
  textDone: boolean;
  model?: string;
}

const PHASE_LABELS: Record<string, string> = {
  score: 'Scoring',
  brief: 'Brief Generation',
  discover: 'Research',
  enrich: 'Enrichment',
};

const STATUS_CONFIG: Record<StreamStatus, { label: string; color: string; bg: string }> = {
  idle: { label: '', color: '', bg: '' },
  thinking: { label: 'Thinking...', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
  responding: { label: 'Responding...', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
  done: { label: 'Complete', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
};

export function AILogPanel({ runId, campaignId, model }: { runId: string; campaignId?: string; model?: string }) {
  const [blocks, setBlocks] = useState<AIBlock[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [expanded, setExpanded] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const blockCounterRef = useRef(0);
  const currentBlockRef = useRef<{ id: number; company: string; phase: string } | null>(null);

  const { subscribe } = useEventStream({
    types: ['run.ai_stream'],
    enabled: true,
  });

  const handleStreamEvent = useCallback((event: SSEEvent) => {
    const data = event.data as AIStreamDelta;
    if (data.run_id !== runId) return;

    const key = `${data.phase}:${data.company_name || ''}`;
    const current = currentBlockRef.current;

    if (!current || `${current.phase}:${current.company}` !== key) {
      blockCounterRef.current++;
      const newBlock: AIBlock = {
        id: blockCounterRef.current,
        phase: data.phase,
        company_name: data.company_name,
        thinking: '',
        text: '',
        thinkingDone: false,
        textDone: false,
      };
      currentBlockRef.current = {
        id: newBlock.id,
        company: data.company_name || '',
        phase: data.phase,
      };
      setBlocks(prev => [...prev, newBlock]);
    }

    const blockId = currentBlockRef.current!.id;

    if (data.done) {
      setBlocks(prev => prev.map(b =>
        b.id === blockId
          ? { ...b, [data.block_type === 'thinking' ? 'thinkingDone' : 'textDone']: true }
          : b
      ));
      if (data.block_type === 'text') {
        setStatus('done');
        setTimeout(() => setStatus('idle'), 2000);
      } else if (data.block_type === 'thinking') {
        setStatus('responding');
      }
      return;
    }

    if (data.block_type === 'thinking') {
      setStatus('thinking');
    } else {
      setStatus('responding');
    }

    setBlocks(prev => prev.map(b =>
      b.id === blockId
        ? { ...b, [data.block_type]: b[data.block_type] + data.delta }
        : b
    ));
  }, [runId]);

  useEffect(() => {
    return subscribe('run.ai_stream', handleStreamEvent);
  }, [subscribe, handleStreamEvent]);

  useEffect(() => {
    if (!userScrolledRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [blocks, status]);

  if (blocks.length === 0 && status === 'idle') return null;

  const statusCfg = STATUS_CONFIG[status];
  const currentBlock = blocks[blocks.length - 1];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-900">AI Log</span>
        </div>

        {status !== 'idle' && (
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${statusCfg.bg} ${statusCfg.color}`}>
            {status !== 'done' && <Loader2 className="w-3 h-3 animate-spin" />}
            {statusCfg.label}
          </div>
        )}
      </div>

      {/* Collapsible AI Log */}
      <div className="border-t border-gray-100">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-50 transition-colors"
        >
          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
          <span className="text-xs text-gray-500">
            AI Log{model ? ` (Using ${model})` : ''}
          </span>
        </button>

        {expanded && (
          <div
            ref={scrollContainerRef}
            onScroll={() => {
              if (!scrollContainerRef.current) return;
              const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
              userScrolledRef.current = scrollHeight - scrollTop - clientHeight > 50;
            }}
            className="px-4 pb-4 space-y-3 max-h-[400px] overflow-y-auto">
            {blocks.map(block => {
              const phaseLabel = PHASE_LABELS[block.phase] || block.phase;
              const isThinking = !block.thinkingDone && block.thinking;
              const isResponding = !block.textDone && block.text;

              return (
                <div key={block.id} className="space-y-2">
                  {/* Phase + company label */}
                  {block.company_name && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500">{phaseLabel}</span>
                      <span className="text-xs text-gray-400">—</span>
                      <span className="text-xs font-medium text-gray-700">{block.company_name}</span>
                    </div>
                  )}

                  {/* Thinking block */}
                  {block.thinking && (
                    <div className="border-l-2 border-amber-300 bg-amber-50/50 rounded-r-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                          <span className="text-xs font-semibold text-amber-600">Thinking</span>
                        </div>
                        {isThinking && (
                          <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
                        )}
                      </div>
                      <div className="px-3 pb-3">
                        <pre className="text-[13px] text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                          {block.thinking}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Response block */}
                  {block.text && (
                    <div className="border-l-2 border-blue-300 bg-blue-50/50 rounded-r-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          <span className="text-xs font-semibold text-blue-600">Response</span>
                        </div>
                        {isResponding && (
                          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                        )}
                      </div>
                      <div className="px-3 pb-3">
                        <pre className="text-[13px] text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                          {block.text}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Waiting state */}
                  {!block.thinking && !block.text && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Waiting for AI response...
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
