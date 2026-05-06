/**
 * SignalStack Event Bus
 *
 * In-process EventEmitter-based event bus for internal event routing.
 * Consumers: outbound webhooks, SSE streams, audit log.
 *
 * Can be replaced with Redis/Kafka transport later without changing
 * the emit/subscribe interface used by producers.
 */

import { EventEmitter } from 'events';

// ── Event type definitions ──────────────────────────────────────

export interface EventPayloads {
  'lead.created': {
    lead_id: string;
    company_name: string;
    source_type: string;
    domain?: string;
    import_id?: string;
    campaign_id?: string;
  };
  'lead.enriched': {
    lead_id: string;
    company_name: string;
    sources_used: string[];
  };
  'lead.scored': {
    lead_id: string;
    company_name: string;
    fit_score: number;
    fit_score_label: string;
    confidence: string;
  };
  'lead.qualified': {
    lead_id: string;
    company_name: string;
    fit_score: number;
    source_type: string;
  };
  'lead.disqualified': {
    lead_id: string;
    company_name: string;
    fit_score: number;
    source_type: string;
  };
  'lead.status_changed': {
    lead_id: string;
    company_name: string;
    old_status: string;
    new_status: string;
    changed_by?: string;
  };
  'lead.brief_rerun': {
    lead_id: string;
    company_name: string;
    status: 'generating' | 'auditing' | 'completed' | 'failed';
    message?: string;
    audit_score?: number;
  };
  'lead.stage_rerun': {
    lead_id: string;
    company_name: string;
    stage: string;
    status: 'started' | 'processing' | 'completed' | 'failed';
    message?: string;
    run_id?: string;
  };
  'campaign.started': {
    campaign_id: string;
    campaign_name: string;
    run_id: string;
    triggered_by: string;
  };
  'campaign.progress': {
    campaign_id: string;
    campaign_name: string;
    run_id: string;
    phase: string;
    current_company?: string;
    step_number: number;
    total_steps: number;
    tokens: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      estimated_cost: number;
    };
  };
  'campaign.completed': {
    campaign_id: string;
    campaign_name: string;
    run_id: string;
    lead_count: number;
    estimated_cost: number;
  };
  'campaign.failed': {
    campaign_id: string;
    campaign_name: string;
    run_id: string;
    error: string;
  };
  'campaign.cancelled': {
    campaign_id: string;
    campaign_name: string;
    run_id: string;
    partial_leads: number;
  };
  'pipeline.started': {
    run_id: string;
    triggered_by: string;
  };
  'pipeline.progress': {
    run_id: string;
    phase: string;
    current_company?: string;
    step_number: number;
    total_steps: number;
    tokens: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      estimated_cost: number;
    };
  };
  'pipeline.completed': {
    run_id: string;
    lead_count: number;
    estimated_cost: number;
  };
  'pipeline.failed': {
    run_id: string;
    error: string;
  };
  'import.completed': {
    import_id: string;
    source_type: string;
    row_count: number;
    processed_count: number;
    qualified_count: number;
  };
  'import.failed': {
    import_id: string;
    error: string;
  };
  'convergence.detected': {
    lead_id: string;
    company_name: string;
    convergence_score: number;
    matched_campaigns: string[];
  };
  'run.activity': {
    run_id: string;
    campaign_id?: string;
    activity_type: string;
    phase?: string;
    company_name?: string;
    title: string;
    details?: any;
    timestamp: string;
    tokens?: {
      input_tokens: number;
      output_tokens: number;
      estimated_cost: number;
    };
  };
  'run.ai_stream': {
    run_id: string;
    campaign_id?: string;
    phase: string;
    company_name?: string;
    block_type: 'thinking' | 'text';
    delta: string;
    done: boolean;
  };
}

export type EventType = keyof EventPayloads;

export interface SignalStackEvent<T extends EventType = EventType> {
  id: string;
  type: T;
  timestamp: string;
  data: EventPayloads[T];
}

// ── Event Bus class ─────────────────────────────────────────────

let eventCounter = 0;

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many listeners (webhooks + SSE connections)
    this.emitter.setMaxListeners(100);
  }

  /**
   * Emit a typed event to all subscribers
   */
  emit<T extends EventType>(type: T, data: EventPayloads[T]): SignalStackEvent<T> {
    eventCounter++;
    const event: SignalStackEvent<T> = {
      id: `evt_${Date.now()}_${eventCounter}`,
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    this.emitter.emit(type, event);
    this.emitter.emit('*', event); // wildcard for subscribers that want all events

    return event;
  }

  /**
   * Subscribe to a specific event type
   */
  on<T extends EventType>(type: T, handler: (event: SignalStackEvent<T>) => void): void {
    this.emitter.on(type, handler);
  }

  /**
   * Subscribe to all events
   */
  onAll(handler: (event: SignalStackEvent) => void): void {
    this.emitter.on('*', handler);
  }

  /**
   * Unsubscribe from a specific event type
   */
  off<T extends EventType>(type: T, handler: (event: SignalStackEvent<T>) => void): void {
    this.emitter.off(type, handler);
  }

  /**
   * Unsubscribe from all events
   */
  offAll(handler: (event: SignalStackEvent) => void): void {
    this.emitter.off('*', handler);
  }

  /**
   * Get all valid event types (useful for validation)
   */
  static getEventTypes(): EventType[] {
    return [
      'lead.created',
      'lead.enriched',
      'lead.scored',
      'lead.qualified',
      'lead.disqualified',
      'lead.status_changed',
      'lead.brief_rerun',
      'campaign.started',
      'campaign.progress',
      'campaign.completed',
      'campaign.failed',
      'campaign.cancelled',
      'pipeline.started',
      'pipeline.progress',
      'pipeline.completed',
      'pipeline.failed',
      'import.completed',
      'import.failed',
      'convergence.detected',
      'run.activity',
      'run.ai_stream',
    ];
  }
}

// Singleton instance
export const eventBus = new EventBus();
