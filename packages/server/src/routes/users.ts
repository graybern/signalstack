import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireAdmin, requireSuperAdmin, hasRole, AuthRequest } from '../auth/middleware.js';
import { logActivity } from '../services/activityLog.js';
import type { UserRole } from '../types/index.js';

const router = Router();

const VALID_ROLES: UserRole[] = ['superadmin', 'admin', 'operator', 'member', 'viewer'];
const ASSIGNABLE_ROLES: UserRole[] = ['admin', 'operator', 'member', 'viewer'];

function saveSetting(key: string, value: any, userId: string) {
  getDb().prepare(
    "INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime('now')"
  ).run(key, JSON.stringify(value), userId);
}

function getSetting(key: string, defaultValue: any): any {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  if (!row) return defaultValue;
  try { return JSON.parse(row.value); } catch { return defaultValue; }
}

// GET / — List all users (admin+ only)
router.get('/', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  const users = getDb().prepare(
    'SELECT id, email, display_name, role, created_at FROM users ORDER BY created_at'
  ).all();
  res.json(users);
});

// PATCH /:id/role — Change user role (admin+ only, with superadmin protections)
router.patch('/:id/role', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { role } = req.body;
  const targetId = req.params.id;
  const actor = req.user!;

  if (!ASSIGNABLE_ROLES.includes(role) && role !== 'superadmin') {
    return res.status(400).json({ error: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
  }

  if (targetId === actor.id) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  const db = getDb();
  const target = db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Only superadmins can assign/remove superadmin role
  if (role === 'superadmin' && actor.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmins can grant superadmin role' });
  }

  // Only superadmins can change another superadmin's role
  if (target.role === 'superadmin' && actor.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmins can modify other superadmins' });
  }

  // Admins can only assign roles at or below their level (not superadmin)
  if (actor.role === 'admin' && role === 'superadmin') {
    return res.status(403).json({ error: 'Admins cannot grant superadmin role' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);

  logActivity({
    userId: actor.id,
    entityType: 'user',
    entityId: targetId,
    entityTitle: target.display_name || target.email,
    action: 'updated',
    changes: { role: { old: target.role, new: role } },
  });

  res.json({ success: true });
});

// PUT /profile — Update own profile (any authenticated user)
router.put('/profile', authenticate, (req: AuthRequest, res: Response) => {
  const { display_name, current_password, new_password } = req.body;
  const db = getDb();
  const userId = req.user!.id;

  const updates: string[] = [];
  const values: any[] = [];

  if (display_name && display_name.trim()) {
    updates.push('display_name = ?');
    values.push(display_name.trim());
  }

  if (new_password) {
    if (!current_password) {
      return res.status(400).json({ error: 'Current password required to set new password' });
    }
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
    if (!bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    updates.push('password_hash = ?');
    values.push(bcrypt.hashSync(new_password, 10));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No updates provided' });
  }

  values.push(userId);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT id, email, display_name, role, created_at FROM users WHERE id = ?').get(userId);
  res.json(updated);
});

// GET /roles — List available roles and permissions (any authenticated user)
router.get('/roles', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({
    roles: [
      {
        role: 'superadmin',
        label: 'Super Admin',
        description: 'Ultimate authority — manages admins, system-wide settings, cannot be demoted by admins',
        permissions: ['*', 'manage_admins'],
      },
      {
        role: 'admin',
        label: 'Admin',
        description: 'Full access — user management, system settings, webhooks, API keys',
        permissions: ['*'],
      },
      {
        role: 'operator',
        label: 'Operator',
        description: 'Configure ICP, prompts, data sources, exclusions, campaign settings',
        permissions: ['read', 'run', 'configure'],
      },
      {
        role: 'member',
        label: 'Member',
        description: 'Run campaigns, import leads, provide feedback, export data',
        permissions: ['read', 'run'],
      },
      {
        role: 'viewer',
        label: 'Viewer',
        description: 'Read-only access to leads, briefs, dashboards, and run history',
        permissions: ['read'],
      },
    ],
  });
});

// ── Invite Management ─────────────────────────────────────────

// GET /invites — List all invites (admin+ only)
router.get('/invites', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  const invites = getDb().prepare(
    'SELECT i.id, i.email, i.role, i.token, i.expires_at, i.accepted_at, i.created_at, u.display_name as invited_by_name FROM invites i LEFT JOIN users u ON i.invited_by = u.id ORDER BY i.created_at DESC'
  ).all();
  res.json(invites);
});

// POST /invites — Create an invite (admin+ only)
router.post('/invites', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { email, role = 'viewer', expires_in_days = 7 } = req.body;
  const actor = req.user!;

  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
  }

  // Admins cannot invite someone as superadmin
  if (role === 'superadmin') {
    return res.status(403).json({ error: 'Cannot invite users as superadmin' });
  }

  // Only superadmins can invite admins
  if (role === 'admin' && actor.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmins can invite users as admin' });
  }

  const db = getDb();

  // Check if email already has an active user
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) return res.status(409).json({ error: 'User with this email already exists' });

  // Check for existing pending invite to same email
  const existingInvite = db.prepare(
    "SELECT id FROM invites WHERE email = ? AND accepted_at IS NULL AND expires_at > datetime('now')"
  ).get(email) as any;
  if (existingInvite) {
    // Revoke old invite and create new one
    db.prepare('DELETE FROM invites WHERE id = ?').run(existingInvite.id);
  }

  const id = uuid();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO invites (id, email, role, token, invited_by, expires_at) VALUES (?,?,?,?,?,?)'
  ).run(id, email.toLowerCase(), role, token, actor.id, expiresAt);

  res.status(201).json({
    id,
    email: email.toLowerCase(),
    role,
    token,
    invite_url: `/register?invite=${token}`,
    expires_at: expiresAt,
  });
});

// DELETE /invites/:id — Revoke an invite (admin+ only)
router.delete('/invites/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const result = getDb().prepare('DELETE FROM invites WHERE id = ? AND accepted_at IS NULL').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Invite not found or already accepted' });
  res.json({ success: true });
});

// DELETE /:id — Remove a user (admin+ only, with superadmin protections)
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const actor = req.user!;

  if (targetId === actor.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const db = getDb();
  const target = db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Only superadmins can delete admins or other superadmins
  if ((target.role === 'superadmin' || target.role === 'admin') && actor.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmins can remove admin users' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  logActivity({
    userId: actor.id,
    entityType: 'user',
    entityId: targetId,
    entityTitle: target.display_name || target.email,
    action: 'deleted',
    snapshot: { id: target.id, role: target.role, email: target.email, display_name: target.display_name },
  });

  res.json({ success: true });
});

// ── Registration Settings ─────────────────────────────────────

// GET /settings/registration — Get registration settings (admin+ only)
router.get('/settings/registration', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  res.json({
    allow_self_registration: getSetting('allow_self_registration', false),
  });
});

// PUT /settings/registration — Update registration settings (superadmin only)
router.put('/settings/registration', authenticate, requireSuperAdmin, (req: AuthRequest, res: Response) => {
  const { allow_self_registration } = req.body;
  if (typeof allow_self_registration !== 'boolean') {
    return res.status(400).json({ error: 'allow_self_registration must be a boolean' });
  }
  saveSetting('allow_self_registration', allow_self_registration, req.user!.id);
  res.json({ success: true, allow_self_registration });
});

export default router;
