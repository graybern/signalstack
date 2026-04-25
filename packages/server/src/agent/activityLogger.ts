/**
 * ActivityLogger — writes structured activity entries to DB and emits SSE events.
 * Each entry represents a step of AI reasoning: thinking, findings, phase transitions, errors.
 * Persisted to run_activity_log for post-run review; streamed live via run.activity events.
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { eventBus } from '../events/eventBus.js';

export interface ActivityEntry {
  type: string;
  phase?: string;
  company?: string;
  title: string;
  details?: any;
  error?: string;
}

export class ActivityLogger {
  private runId: string;
  private campaignId?: string;
  private tokenSnapshot?: { input_tokens: number; output_tokens: number; estimated_cost: number };

  constructor(runId: string, campaignId?: string) {
    this.runId = runId;
    this.campaignId = campaignId;
  }

  /** Update the token snapshot (called from tracker.onUsage) */
  setTokens(tokens: { input_tokens: number; output_tokens: number; estimated_cost: number }) {
    this.tokenSnapshot = tokens;
  }

  /** Core log method — writes to DB and emits SSE event */
  log(entry: ActivityEntry): void {
    const id = uuid();
    const now = new Date().toISOString();

    try {
      getDb().prepare(
        `INSERT INTO run_activity_log (id, run_id, campaign_id, activity_type, phase, company_name, title, details, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        this.runId,
        this.campaignId || null,
        entry.type,
        entry.phase || null,
        entry.company || null,
        entry.title,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.error || null,
        now,
      );
    } catch (err) {
      console.error('[ActivityLogger] DB write failed:', err);
    }

    eventBus.emit('run.activity', {
      run_id: this.runId,
      campaign_id: this.campaignId,
      activity_type: entry.type,
      phase: entry.phase,
      company_name: entry.company,
      title: entry.title,
      details: entry.details,
      timestamp: now,
      tokens: this.tokenSnapshot,
    });
  }

  // ── Convenience methods ──────────────────────────────────────

  thinking(phase: string, title: string, details?: any) {
    this.log({ type: 'thinking', phase, title, details });
  }

  finding(phase: string, company: string, title: string, details?: any) {
    this.log({ type: 'finding', phase, company, title, details });
  }

  phaseStart(phase: string, title: string, details?: any) {
    this.log({ type: 'phase_start', phase, title, details });
  }

  phaseComplete(phase: string, title: string, details?: any) {
    this.log({ type: 'phase_complete', phase, title, details });
  }

  error(phase: string, title: string, error: string) {
    this.log({ type: 'error', phase, title, error });
  }

  milestone(title: string, details?: any) {
    this.log({ type: 'milestone', title, details });
  }
}
