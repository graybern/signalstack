/**
 * Server-Sent Events (SSE) Stream
 *
 * GET /api/events/stream — Real-time event stream
 *   Query params:
 *     types — comma-separated event types to filter (optional, default: all)
 *   Headers:
 *     Authorization: Bearer <jwt>
 *     Last-Event-ID: resume from specific event ID
 *
 * Heartbeat every 30s to keep connection alive.
 */

import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../auth/middleware.js';
import { eventBus, EventBus, type SignalStackEvent, type EventType } from '../events/eventBus.js';

const router = Router();

// Keep track of active SSE connections for cleanup
const activeConnections = new Set<Response>();

// SSE auth: EventSource doesn't support custom headers, so accept token via query param
router.get('/stream', (req, _res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, authenticate, (req: AuthRequest, res: Response) => {
  // Parse requested event types
  const typesParam = req.query.types as string | undefined;
  const requestedTypes: Set<string> | null = typesParam
    ? new Set(typesParam.split(',').map(t => t.trim()).filter(Boolean))
    : null; // null = all events

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to SignalStack event stream', types: requestedTypes ? Array.from(requestedTypes) : ['*'] })}\n\n`);

  activeConnections.add(res);

  // Event handler
  const handler = (event: SignalStackEvent) => {
    // Filter by requested types
    if (requestedTypes) {
      const matches = Array.from(requestedTypes).some(pattern => {
        if (pattern === '*') return true;
        if (pattern.endsWith('.*')) {
          const prefix = pattern.slice(0, -2);
          return event.type.startsWith(prefix + '.');
        }
        return pattern === event.type;
      });
      if (!matches) return;
    }

    // Send SSE formatted event
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  eventBus.onAll(handler);

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    res.write(`:heartbeat ${new Date().toISOString()}\n\n`);
  }, 30_000);

  // Cleanup on disconnect
  req.on('close', () => {
    activeConnections.delete(res);
    eventBus.offAll(handler);
    clearInterval(heartbeat);
  });
});

// GET /api/events/types — List all available event types
router.get('/types', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({
    event_types: EventBus.getEventTypes(),
    description: 'Available event types for SSE stream and webhook subscriptions',
    patterns: {
      'exact': 'lead.qualified — matches only lead.qualified events',
      'prefix': 'lead.* — matches all lead.* events',
      'wildcard': '* — matches all events',
    },
  });
});

// GET /api/events/stats — Connection stats
router.get('/stats', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({
    active_connections: activeConnections.size,
  });
});

export default router;
