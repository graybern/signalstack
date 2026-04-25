import { useEffect, useRef, useState, useCallback } from 'react';

interface EventStreamOptions {
  types?: string[];
  enabled?: boolean;
}

export interface SSEEvent {
  id: string;
  type: string;
  timestamp: string;
  data: any;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export function useEventStream(options: EventStreamOptions = {}) {
  const { types, enabled = true } = options;
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const handlersRef = useRef<Map<string, Set<(event: SSEEvent) => void>>>(new Map());
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subscribe = useCallback((type: string, handler: (event: SSEEvent) => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const token = localStorage.getItem('pg_token');
    if (!token) return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      const params = new URLSearchParams();
      params.set('token', token);
      if (types?.length) params.set('types', types.join(','));

      setConnectionState('connecting');
      const es = new EventSource(`/api/events/stream?${params}`);
      esRef.current = es;

      const resetHeartbeat = () => {
        if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
        heartbeatTimerRef.current = setTimeout(() => {
          // No message in 45s (heartbeat is 30s) — force reconnect
          es.close();
          scheduleReconnect();
        }, 45_000);
      };

      es.onopen = () => {
        setConnectionState('connected');
        retryCountRef.current = 0;
        resetHeartbeat();
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setConnectionState('disconnected');
        if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
        scheduleReconnect();
      };

      const eventTypes = types || [
        'pipeline.progress', 'pipeline.completed', 'pipeline.failed', 'pipeline.started',
        'campaign.progress', 'campaign.completed', 'campaign.failed', 'campaign.started',
        'run.activity',
      ];

      for (const eventType of eventTypes) {
        es.addEventListener(eventType, (e: MessageEvent) => {
          resetHeartbeat();
          try {
            const parsed: SSEEvent = JSON.parse(e.data);
            setLastEvent(parsed);
            handlersRef.current.get(eventType)?.forEach(h => h(parsed));
            handlersRef.current.get('*')?.forEach(h => h(parsed));
          } catch {
            // Ignore parse errors
          }
        });
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30_000);
      retryCountRef.current++;
      retryTimerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      esRef.current?.close();
      esRef.current = null;
      setConnectionState('disconnected');
    };
  }, [enabled, types?.join(',')]);

  return { lastEvent, isConnected: connectionState === 'connected', connectionState, subscribe };
}
