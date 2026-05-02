import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config.js';
import { getDb } from '../db/schema.js';
import { getRolePermissions, userHasPermission } from './permissions.js';
import type { User, UserRole, ApiKey } from '../types/index.js';

export interface AuthRequest extends Request {
  user?: User;
  apiKeyScopes?: string[];
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

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const db = getDb();

  if (header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), config.jwtSecret) as { userId: string };
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId) as User | undefined;
      if (!user) return res.status(401).json({ error: 'User not found' });
      if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  } else if (header.startsWith('ApiKey ')) {
    const raw = header.slice(7);
    const keyHash = hashApiKey(raw);
    const apiKey = db.prepare(
      'SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL'
    ).get(keyHash) as ApiKey | undefined;

    if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });

    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API key expired' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(apiKey.user_id) as User | undefined;
    if (!user || user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended or not found' });
    }

    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(apiKey.id);

    req.user = user;
    req.apiKeyScopes = JSON.parse(apiKey.scopes);
    next();
  } else {
    return res.status(401).json({ error: 'Invalid authorization format — use Bearer or ApiKey' });
  }
}

const ROLE_REQUIRED_SCOPES: Record<UserRole, string[]> = {
  superadmin: ['users:write', 'settings:write'],
  admin: ['users:read', 'settings:write'],
  operator: ['campaigns:write', 'icp:write', 'exclusions:write'],
  member: ['campaigns:run', 'leads:feedback'],
  viewer: ['campaigns:read', 'leads:read', 'runs:read', 'analytics:read'],
};

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

    if (req.apiKeyScopes) {
      const requiredScopes = ROLE_REQUIRED_SCOPES[minRole] || [];
      const hasAny = requiredScopes.some(s => req.apiKeyScopes!.includes(s));
      if (!hasAny) {
        return res.status(403).json({
          error: 'API key lacks required scopes for this endpoint',
          required_any: requiredScopes,
          key_scopes: req.apiKeyScopes,
        });
      }
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

/** Require specific permission(s) — checks role_permissions table and API key scopes */
export function requirePermission(...permissions: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    const missing = permissions.filter(
      p => !userHasPermission(req.user!.role, p, req.apiKeyScopes)
    );

    if (missing.length > 0) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: missing,
        your_role: req.user.role,
      });
    }
    next();
  };
}

/** Get effective permissions for the current request (role perms ∩ API key scopes) */
export function getEffectivePermissions(req: AuthRequest): string[] {
  if (!req.user) return [];
  const rolePerms = getRolePermissions(req.user.role);
  if (!req.apiKeyScopes) return rolePerms;
  return req.apiKeyScopes.filter(s => rolePerms.includes(s));
}

export { hashApiKey };
