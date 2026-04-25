/**
 * API Versioning Middleware
 *
 * Adds version prefix support and response headers.
 * Current version: v1
 *
 * Routes mounted under /api/v1/... are canonical.
 * Routes under /api/... are aliased to /api/v1/... for backwards compat.
 */

import { Request, Response, NextFunction } from 'express';

export const CURRENT_API_VERSION = 'v1';

/**
 * Middleware that adds API version response header
 */
export function apiVersionHeader(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-API-Version', CURRENT_API_VERSION);
  next();
}
