/**
 * Outbound Webhook Dispatcher
 *
 * Subscribes to the event bus and delivers events to registered
 * webhook endpoints. Features:
 * - HMAC-SHA256 payload signing
 * - Exponential backoff retry (3 attempts)
 * - Delivery logging in webhook_deliveries table
 * - Idempotency via delivery ID header
 */

import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { eventBus, type SignalStackEvent, type EventType } from './eventBus.js';

interface WebhookSubscription {
  id: string;
  url: string;
  events: string; // JSON array
  secret: string | null;
  active: number;
  created_by: string | null;
  metadata: string | null;
}

interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event_type: string;
  payload: string;
  status: string;
  http_status: number | null;
  response_body: string | null;
  attempts: number;
  next_retry_at: string | null;
  created_at: string;
  completed_at: string | null;
}

// Retry delays: 30s, 5min, 30min
const RETRY_DELAYS_MS = [30_000, 300_000, 1_800_000];
const MAX_ATTEMPTS = 3;

/**
 * Sign a payload with HMAC-SHA256
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Deliver a webhook event to a subscriber
 */
async function deliverWebhook(
  subscription: WebhookSubscription,
  event: SignalStackEvent,
  deliveryId?: string
): Promise<void> {
  const db = getDb();
  const id = deliveryId || uuid();
  const payloadStr = JSON.stringify({
    id,
    event: event.type,
    timestamp: event.timestamp,
    data: event.data,
  });

  // Create or update delivery record
  if (!deliveryId) {
    db.prepare(`
      INSERT INTO webhook_deliveries (id, subscription_id, event_type, payload, status, attempts, created_at)
      VALUES (?, ?, ?, ?, 'pending', 0, datetime('now'))
    `).run(id, subscription.id, event.type, payloadStr);
  }

  // Attempt delivery
  const attempts = (db.prepare('SELECT attempts FROM webhook_deliveries WHERE id = ?').get(id) as any)?.attempts || 0;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-SignalStack-Delivery-Id': id,
      'X-SignalStack-Event': event.type,
      'User-Agent': 'SignalStack/1.0 Webhooks',
    };

    if (subscription.secret) {
      headers['X-SignalStack-Signature'] = `sha256=${signPayload(payloadStr, subscription.secret)}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000); // 15s timeout

    const response = await fetch(subscription.url, {
      method: 'POST',
      headers,
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => '');

    if (response.ok) {
      db.prepare(`
        UPDATE webhook_deliveries
        SET status = 'success', http_status = ?, response_body = ?, attempts = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(response.status, responseBody.substring(0, 1000), attempts + 1, id);
    } else {
      throw new Error(`HTTP ${response.status}: ${responseBody.substring(0, 500)}`);
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const newAttempts = attempts + 1;

    if (newAttempts < MAX_ATTEMPTS) {
      // Schedule retry
      const delayMs = RETRY_DELAYS_MS[newAttempts - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const nextRetry = new Date(Date.now() + delayMs).toISOString();

      db.prepare(`
        UPDATE webhook_deliveries
        SET status = 'retrying', attempts = ?, next_retry_at = ?, response_body = ?
        WHERE id = ?
      `).run(newAttempts, nextRetry, errorMsg.substring(0, 1000), id);

      // Schedule retry with setTimeout
      setTimeout(() => {
        retryDelivery(id).catch(console.error);
      }, delayMs);

    } else {
      db.prepare(`
        UPDATE webhook_deliveries
        SET status = 'failed', attempts = ?, response_body = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(newAttempts, errorMsg.substring(0, 1000), id);
    }
  }
}

/**
 * Retry a failed delivery
 */
async function retryDelivery(deliveryId: string): Promise<void> {
  const db = getDb();

  const delivery = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(deliveryId) as WebhookDelivery | undefined;
  if (!delivery || delivery.status !== 'retrying') return;

  const subscription = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ? AND active = 1').get(delivery.subscription_id) as WebhookSubscription | undefined;
  if (!subscription) {
    db.prepare("UPDATE webhook_deliveries SET status = 'failed', response_body = 'Subscription inactive or deleted' WHERE id = ?").run(deliveryId);
    return;
  }

  // Reconstruct event from payload
  const payload = JSON.parse(delivery.payload);
  const event: SignalStackEvent = {
    id: payload.id,
    type: delivery.event_type as EventType,
    timestamp: payload.timestamp,
    data: payload.data,
  };

  await deliverWebhook(subscription, event, deliveryId);
}

/**
 * Initialize the webhook dispatcher — subscribes to all events
 */
export function initWebhookDispatcher(): void {
  eventBus.onAll((event: SignalStackEvent) => {
    try {
      const db = getDb();

      // Find matching subscriptions
      const subscriptions = db.prepare(
        'SELECT * FROM webhook_subscriptions WHERE active = 1'
      ).all() as WebhookSubscription[];

      for (const sub of subscriptions) {
        const subscribedEvents: string[] = JSON.parse(sub.events);

        // Check if this subscription wants this event type
        // Support wildcard '*' and prefix matching like 'lead.*'
        const matches = subscribedEvents.some(pattern => {
          if (pattern === '*') return true;
          if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -2);
            return event.type.startsWith(prefix + '.');
          }
          return pattern === event.type;
        });

        if (matches) {
          deliverWebhook(sub, event).catch(err => {
            console.error(`[webhook] Delivery error for subscription ${sub.id}:`, err);
          });
        }
      }
    } catch (err) {
      console.error('[webhook] Dispatcher error:', err);
    }
  });

  console.log('[webhook] Outbound webhook dispatcher initialized');
}
