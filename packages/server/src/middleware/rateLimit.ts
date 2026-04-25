/**
 * Rate Limiting Middleware
 *
 * Sliding window rate limiter using in-memory storage.
 * No external dependencies (Redis can be added later).
 *
 * Returns standard rate limit headers:
 * - X-RateLimit-Limit
 * - X-RateLimit-Remaining
 * - X-RateLimit-Reset
 * - Retry-After (on 429)
 */

import { Request, Response, NextFunction } from 'express';

interface RateLimitWindow {
  count: number;
  resetAt: number; // Unix timestamp in ms
}

// In-memory store: key → window
const windows = new Map<string, RateLimitWindow>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (window.resetAt < now) {
      windows.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  /** Max requests per window */
  max: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Key generator (default: IP-based) */
  keyGenerator?: (req: Request) => string;
  /** Skip rate limiting for certain requests */
  skip?: (req: Request) => boolean;
}

/**
 * Create a rate limiting middleware
 */
export function rateLimit(options: RateLimitOptions) {
  const { max, windowSeconds, keyGenerator, skip } = options;
  const windowMs = windowSeconds * 1000;

  return (req: Request, res: Response, next: NextFunction) => {
    if (skip && skip(req)) return next();

    const key = keyGenerator ? keyGenerator(req) : getDefaultKey(req);
    const now = Date.now();

    let window = windows.get(key);

    // If no window or expired, create new one
    if (!window || window.resetAt < now) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }

    window.count++;

    // Set headers
    const remaining = Math.max(0, max - window.count);
    const resetSeconds = Math.ceil((window.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(window.resetAt / 1000));

    if (window.count > max) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        error: 'Too many requests',
        retry_after: resetSeconds,
        limit: max,
      });
    }

    next();
  };
}

function getDefaultKey(req: Request): string {
  // Use auth token user or IP
  const authReq = req as any;
  if (authReq.user?.id) {
    return `user:${authReq.user.id}`;
  }
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return `apikey:${apiKey}`;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

// ── Pre-configured rate limiters ────────────────────────────────

/** Default: 100 req/min for authenticated users */
export const defaultRateLimit = rateLimit({
  max: 100,
  windowSeconds: 60,
});

/** Strict: 20 req/min for webhook/API key endpoints */
export const webhookRateLimit = rateLimit({
  max: 20,
  windowSeconds: 60,
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] as string;
    return apiKey ? `webhook:${apiKey}` : `webhook:${req.ip}`;
  },
});

/** Heavy ops: 5 req/min (campaign runs, pipeline runs) */
export const heavyOpRateLimit = rateLimit({
  max: 5,
  windowSeconds: 60,
});

/** Upload: 10 req/min */
export const uploadRateLimit = rateLimit({
  max: 10,
  windowSeconds: 60,
});
