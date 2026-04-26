import { useState, useEffect, useRef, useCallback } from 'react';
import { useEventStream, type SSEEvent } from './useEventStream.js';

export interface ActivityEntry {
  id: string;
  run_id: string;
  campaign_id?: string;
  activity_type: string;
  phase?: string;
  company_name?: string;
  title: string;
  details?: any;
  error_message?: string;
  created_at: string;
  tokens?: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost: number;
  };
}

const PHASES = ['discover', 'qualify', 'enrich', 'score', 'brief'] as const;

const PHASE_ALIASES: Record<string, string> = {
  research: 'discover',
  enrichment: 'enrich',
  scoring: 'score',
  brief_generation: 'brief',
};

export function useRunActivity(runId: string | null) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [tokens, setTokens] = useState<{ input_tokens: number; output_tokens: number; estimated_cost: number } | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const seenIds = useRef(new Set<string>());

  const { connectionState, subscribe } = useEventStream({
    types: ['run.activity', 'pipeline.completed', 'pipeline.failed', 'campaign.completed', 'campaign.failed'],
    enabled: !!runId,
  });

  // Load historical activities on mount or runId change
  useEffect(() => {
    if (!runId) {
      setActivities([]);
      setCurrentPhase(null);
      setTokens(null);
      setIsComplete(false);
      seenIds.current.clear();
      return;
    }

    const token = localStorage.getItem('pg_token');
    if (!token) return;

    fetch(`/api/runs/${runId}/activity`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.activities) {
          const entries: ActivityEntry[] = data.activities;
          seenIds.current = new Set(entries.map(e => e.id));
          setActivities(entries);
          // Derive current phase from last phase_start entry
          const lastPhaseStart = [...entries].reverse().find(e => e.activity_type === 'phase_start');
          if (lastPhaseStart?.phase) setCurrentPhase(lastPhaseStart.phase);
          // Check if already completed
          const hasMilestone = entries.some(e => e.activity_type === 'milestone' && e.title.toLowerCase().includes('complete'));
          const hasError = entries.some(e => e.activity_type === 'error');
          if (hasMilestone || hasError) setIsComplete(true);
        }
      })
      .catch(() => {});
  }, [runId]);

  // Subscribe to live activity events
  useEffect(() => {
    if (!runId) return;

    const unsub = subscribe('run.activity', (event: SSEEvent) => {
      const data = event.data;
      if (data.run_id !== runId) return;

      const entry: ActivityEntry = {
        id: event.id,
        run_id: data.run_id,
        campaign_id: data.campaign_id,
        activity_type: data.activity_type,
        phase: data.phase,
        company_name: data.company_name,
        title: data.title,
        details: data.details,
        created_at: data.timestamp,
        tokens: data.tokens,
      };

      // Dedupe
      if (seenIds.current.has(entry.id)) return;
      seenIds.current.add(entry.id);

      setActivities(prev => [...prev, entry]);

      if (data.activity_type === 'phase_start' && data.phase) {
        setCurrentPhase(data.phase);
      }
      if (data.tokens) {
        setTokens(data.tokens);
      }
    });

    const unsubComplete = subscribe('*', (event: SSEEvent) => {
      if (
        (event.type === 'pipeline.completed' || event.type === 'campaign.completed' ||
         event.type === 'pipeline.failed' || event.type === 'campaign.failed') &&
        event.data.run_id === runId
      ) {
        setIsComplete(true);
      }
    });

    return () => { unsub(); unsubComplete(); };
  }, [runId, subscribe]);

  const normalizePhase = (p: string) => PHASE_ALIASES[p] || p;

  const completedPhases = new Set(
    activities
      .filter(a => a.activity_type === 'phase_complete')
      .map(a => a.phase)
      .filter(Boolean)
      .map(p => normalizePhase(p!))
  );

  const normalizedCurrent = currentPhase ? normalizePhase(currentPhase) : null;

  const phaseStates = PHASES.map(p => ({
    phase: p,
    state: completedPhases.has(p)
      ? 'complete' as const
      : normalizedCurrent === p
        ? 'active' as const
        : 'pending' as const,
  }));

  return {
    activities,
    currentPhase,
    phaseStates,
    tokens,
    isComplete,
    isConnected: connectionState === 'connected',
    connectionState,
  };
}
