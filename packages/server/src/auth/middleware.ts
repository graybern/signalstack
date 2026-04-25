import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/schema.js';
import type { User, UserRole } from '../types/index.js';

export interface AuthRequest extends Request {
  user?: User;
}

/**
 * Role hierarchy (higher number = more permissions):
 *   viewer (0)     — read-only access to leads, briefs, dashboards
 *   member (1)     — can run campaigns, import leads, provide feedback
 *   operator (2)   — can configure ICP, prompts, data sources, exclusions
 *   admin (3)      — full access: user management, webhooks, API keys, system settings
 *   superadmin (4) — ultimate authority: manages admins, system-wide settings, cannot be demoted
 */
const ROLE_LEVELS: Record<UserRole, number> = {
  viewer: 0,
  member: 1,
  operator: 2,
  admin: 3,
  superadmin: 4,
};

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as { userId: string };
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(payload.userId) as User | undefined;
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Require a minimum role level.
 * admin > operator > member > viewer
 */
function requireRole(minRole: UserRole) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role as UserRole;
    if (!userRole || ROLE_LEVELS[userRole] < ROLE_LEVELS[minRole]) {
      return res.status(403).json({
        error: `${minRole} access required`,
        required_role: minRole,
        your_role: userRole,
      });
    }
    next();
  };
}

/** Superadmin only — ultimate authority */
export const requireSuperAdmin = requireRole('superadmin');

/** Admin or above (admin, superadmin) */
export const requireAdmin = requireRole('admin');

/** Operator or above (operator, admin, superadmin) */
export const requireOperator = requireRole('operator');

/** Member or above (member, operator, admin, superadmin) — excludes viewer */
export const requireMember = requireRole('member');

/** Any authenticated user including viewer */
export const requireViewer = requireRole('viewer');

/** Check if user has at least a given role (utility for inline checks) */
export function hasRole(user: User | undefined, minRole: UserRole): boolean {
  if (!user) return false;
  return ROLE_LEVELS[user.role as UserRole] >= ROLE_LEVELS[minRole];
}
