/**
 * Webhook Subscription Management Routes
 *
 * CRUD for outbound webhook subscriptions + delivery log.
 *
 * GET    /api/webhooks              — List subscriptions
 * POST   /api/webhooks              — Create subscription
 * PUT    /api/webhooks/:id          — Update subscription
 * DELETE /api/webhooks/:id          — Delete subscription
 * POST   /api/webhooks/:id/test     — Send test event
 * GET    /api/webhooks/:id/deliveries — View delivery log
 * POST   /api/webhooks/:id/deliveries/:did/retry — Retry failed delivery
 */

import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { getDb } from '../db/schema.js';
import { authenticate, requireAdmin, AuthRequest } from '../auth/middleware.js';
import { eventBus, EventBus } from '../events/eventBus.js';

const router = Router();

// ── GET / — List webhook subscriptions ───────────────────────────
router.get('/', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const subscriptions = db.prepare(
    'SELECT * FROM webhook_subscriptions ORDER BY created_at DESC'
  ).all();

  // Parse JSON fields and mask secrets
  const result = (subscriptions as any[]).map(s => ({
    ...s,
    events: JSON.parse(s.events),
    metadata: s.metadata ? JSON.parse(s.metadata) : null,
    secret: s.secret ? '••••••••' : null,
    has_secret: !!s.secret,
  }));

  res.json(result);
});

// ── POST / — Create webhook subscription ─────────────────────────
router.post('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { url, events, secret, name, description } = req.body;

  if (!url || !events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'url and events[] are required' });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Validate event types
  const validTypes = EventBus.getEventTypes();
  for (const event of events) {
    if (event === '*' || event.endsWith('.*')) continue;
    if (!validTypes.includes(event)) {
      return res.status(400).json({ error: `Unknown event type: ${event}. Valid types: ${validTypes.join(', ')}` });
    }
  }

  const db = getDb();
  const id = uuid();

  // Generate secret if not provided but requested
  const signingSecret = secret === true
    ? crypto.randomBytes(32).toString('hex')
    : (typeof secret === 'string' ? secret : null);

  const metadata = JSON.stringify({ name: name || url, description: description || '' });

  db.prepare(`
    INSERT INTO webhook_subscriptions (id, url, events, secret, active, created_by, metadata, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'))
  `).run(id, url, JSON.stringify(events), signingSecret, req.user!.id, metadata);

  res.status(201).json({
    id,
    url,
    events,
    has_secret: !!signingSecret,
    secret_preview: signingSecret ? signingSecret.substring(0, 8) + '...' : null,
    active: true,
    metadata: JSON.parse(metadata),
  });
});

// ── PUT /:id — Update webhook subscription ───────────────────────
router.put('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Webhook subscription not found' });

  const { url, events, active, name, description, secret } = req.body;

  const updates: string[] = [];
  const values: any[] = [];

  if (url !== undefined) {
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL format' }); }
    updates.push('url = ?');
    values.push(url);
  }

  if (events !== undefined) {
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events must be a non-empty array' });
    }
    updates.push('events = ?');
    values.push(JSON.stringify(events));
  }

  if (active !== undefined) {
    updates.push('active = ?');
    values.push(active ? 1 : 0);
  }

  if (secret !== undefined) {
    const signingSecret = secret === true
      ? crypto.randomBytes(32).toString('hex')
      : (secret === false || secret === null ? null : secret);
    updates.push('secret = ?');
    values.push(signingSecret);
  }

  if (name !== undefined || description !== undefined) {
    const existingMeta = existing.metadata ? JSON.parse(existing.metadata) : {};
    if (name !== undefined) existingMeta.name = name;
    if (description !== undefined) existingMeta.description = description;
    updates.push('metadata = ?');
    values.push(JSON.stringify(existingMeta));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

  values.push(req.params.id);
  db.prepare(`UPDATE webhook_subscriptions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(req.params.id) as any;
  res.json({
    ...updated,
    events: JSON.parse(updated.events),
    metadata: updated.metadata ? JSON.parse(updated.metadata) : null,
    secret: updated.secret ? '••••••••' : null,
    has_secret: !!updated.secret,
  });
});

// ── DELETE /:id — Delete webhook subscription ────────────────────
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Webhook subscription not found' });

  // Clean up deliveries
  db.prepare('DELETE FROM webhook_deliveries WHERE subscription_id = ?').run(req.params.id);

  res.json({ success: true });
});

// ── POST /:id/test — Send test event ─────────────────────────────
router.post('/:id/test', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const sub = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(req.params.id) as any;
  if (!sub) return res.status(404).json({ error: 'Webhook subscription not found' });

  // Emit a test event through the event bus
  const event = eventBus.emit('lead.scored', {
    lead_id: 'test_' + uuid().substring(0, 8),
    company_name: 'Test Company Inc.',
    fit_score: 85,
    fit_score_label: 'Strong Fit',
    confidence: 'high',
  });

  res.json({
    message: 'Test event emitted',
    event_id: event.id,
    event_type: event.type,
    note: 'Check delivery log for results',
  });
});

// ── GET /:id/deliveries — Delivery log ───────────────────────────
router.get('/:id/deliveries', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const sub = db.prepare('SELECT id FROM webhook_subscriptions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Webhook subscription not found' });

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = (page - 1) * limit;

  const deliveries = db.prepare(
    'SELECT * FROM webhook_deliveries WHERE subscription_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(req.params.id, limit, offset);

  const total = (db.prepare(
    'SELECT COUNT(*) as count FROM webhook_deliveries WHERE subscription_id = ?'
  ).get(req.params.id) as any).count;

  res.json({
    deliveries,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// ── POST /:id/deliveries/:did/retry — Retry failed delivery ─────
router.post('/:id/deliveries/:did/retry', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const delivery = db.prepare(
    'SELECT * FROM webhook_deliveries WHERE id = ? AND subscription_id = ?'
  ).get(req.params.did, req.params.id) as any;

  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  if (delivery.status === 'success') return res.status(400).json({ error: 'Delivery already succeeded' });

  // Reset for retry
  db.prepare(
    "UPDATE webhook_deliveries SET status = 'retrying', attempts = 0, next_retry_at = NULL WHERE id = ?"
  ).run(delivery.id);

  // Reconstruct and re-deliver
  const sub = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(req.params.id) as any;
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const payload = JSON.parse(delivery.payload);
  const event = {
    id: payload.id,
    type: delivery.event_type,
    timestamp: payload.timestamp,
    data: payload.data,
  } as any;

  // Fire-and-forget retry
  import('../events/webhookDispatcher.js').then(mod => {
    // The dispatcher will handle the retry automatically via retryDelivery
    // For now, emit the event again to trigger delivery
    eventBus.emit(event.type, event.data);
  }).catch(console.error);

  res.json({ success: true, message: 'Retry initiated' });
});

export default router;
