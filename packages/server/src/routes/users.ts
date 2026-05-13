import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireAdmin, requireSuperAdmin, hasRole, AuthRequest } from '../auth/middleware.js';
import { logActivity } from '../services/activityLog.js';
import { PERMISSIONS, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, getRolePermissions, getPermissionCategories, getUserPermissionOverrides, getEffectiveUserPermissions } from '../auth/permissions.js';
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
  const db = getDb();
  const users = db.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.must_change_password, u.last_login_at, u.created_at,
      (SELECT MAX(al.created_at) FROM activity_log al WHERE al.user_id = u.id) as last_activity_at,
      (SELECT al.action || ':' || al.entity_type FROM activity_log al WHERE al.user_id = u.id ORDER BY al.created_at DESC LIMIT 1) as last_activity_summary,
      (SELECT COUNT(*) FROM user_permission_overrides upo WHERE upo.user_id = u.id) as override_count
     FROM users u ORDER BY u.created_at`
  ).all();
  res.json(users);
});

// POST / — Create a user directly (admin+ only)
router.post('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { email, display_name, role = 'member', password } = req.body;
  const actor = req.user!;

  if (!email || !display_name || !password) {
    return res.status(400).json({ error: 'email, display_name, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!ASSIGNABLE_ROLES.includes(role) && role !== 'superadmin') {
    return res.status(400).json({ error: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
  }
  if (role === 'superadmin' || (role === 'admin' && actor.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Insufficient permissions to assign this role' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuid();
  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, role, must_change_password, status) VALUES (?,?,?,?,?,1,?)'
  ).run(id, email.toLowerCase(), password_hash, display_name.trim(), role, 'active');

  logActivity({
    userId: actor.id,
    entityType: 'user',
    entityId: id,
    entityTitle: display_name,
    action: 'created',
    snapshot: { email, role },
  });

  res.status(201).json({ id, email: email.toLowerCase(), display_name: display_name.trim(), role, status: 'active' });
});

// POST /:id/reset-password — Admin resets a user's password (admin+ only)
router.post('/:id/reset-password', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { new_password } = req.body;
  const targetId = req.params.id;
  const actor = req.user!;

  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = getDb();
  const target = db.prepare('SELECT id, role, display_name FROM users WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  if ((target.role === 'superadmin' || target.role === 'admin') && actor.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmins can reset admin passwords' });
  }

  const password_hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .run(password_hash, targetId);

  logActivity({
    userId: actor.id,
    entityType: 'user',
    entityId: targetId,
    entityTitle: target.display_name,
    action: 'updated',
    changes: { password: { old: '[redacted]', new: '[reset]' } },
  });

  res.json({ success: true });
});

// PATCH /:id/status — Suspend or activate a user (admin+ only)
router.patch('/:id/status', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const targetId = req.params.id;
  const actor = req.user!;

  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Status must be active or suspended' });
  }
  if (targetId === actor.id) {
    return res.status(400).json({ error: 'Cannot change your own status' });
  }

  const db = getDb();
  const target = db.prepare('SELECT id, role, display_name, status FROM users WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.role === 'superadmin' && actor.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmins can modify superadmin status' });
  }

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, targetId);

  logActivity({
    userId: actor.id,
    entityType: 'user',
    entityId: targetId,
    entityTitle: target.display_name,
    action: 'updated',
    changes: { status: { old: target.status || 'active', new: status } },
  });

  res.json({ success: true });
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
  const { display_name, current_password, new_password, timezone } = req.body;
  const db = getDb();
  const userId = req.user!.id;

  const updates: string[] = [];
  const values: any[] = [];

  if (display_name && display_name.trim()) {
    updates.push('display_name = ?');
    values.push(display_name.trim());
  }

  if (timezone !== undefined) {
    updates.push('timezone = ?');
    values.push(timezone || null);
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

  const updated = db.prepare('SELECT id, email, display_name, role, timezone, created_at FROM users WHERE id = ?').get(userId);
  res.json(updated);
});

// GET /roles — List roles with their current permissions (any authenticated user)
router.get('/roles', authenticate, (_req: AuthRequest, res: Response) => {
  const ROLE_META: Record<string, { label: string; description: string }> = {
    superadmin: { label: 'Super Admin', description: 'Ultimate authority — manages admins, system-wide settings' },
    admin:      { label: 'Admin',       description: 'Full access — user management, system settings, API keys' },
    operator:   { label: 'Operator',    description: 'Configure ICP, prompts, data sources, exclusions, campaigns' },
    member:     { label: 'Member',      description: 'Run campaigns, import leads, provide feedback, export data' },
    viewer:     { label: 'Viewer',      description: 'Read-only access to leads, briefs, dashboards, run history' },
  };

  const roles = VALID_ROLES.map(role => ({
    role,
    label: ROLE_META[role]?.label || role,
    description: ROLE_META[role]?.description || '',
    permissions: getRolePermissions(role as UserRole),
  }));

  res.json({
    roles,
    permission_catalog: getPermissionCategories(),
    all_permissions: ALL_PERMISSIONS,
  });
});

// PUT /roles/:role/permissions — Update a role's permissions (superadmin only)
router.put('/roles/:role/permissions', authenticate, requireSuperAdmin, (req: AuthRequest, res: Response) => {
  const { role } = req.params;
  const { permissions } = req.body;

  if (!VALID_ROLES.includes(role as UserRole)) {
    return res.status(400).json({ error: `Invalid role: ${role}` });
  }

  if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: 'permissions must be an array' });
  }

  const invalid = permissions.filter((p: string) => !ALL_PERMISSIONS.includes(p));
  if (invalid.length > 0) {
    return res.status(400).json({ error: 'Invalid permissions', invalid });
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role = ?').run(role);
    const insert = db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)');
    for (const perm of permissions) {
      insert.run(role, perm);
    }
  });
  tx();

  logActivity({
    userId: req.user!.id,
    entityType: 'role',
    entityId: role,
    entityTitle: role,
    action: 'updated',
    changes: { permissions: { new: permissions } },
  });

  res.json({ success: true, role, permissions });
});

// POST /roles/:role/reset-permissions — Reset a role to default permissions (superadmin only)
router.post('/roles/:role/reset-permissions', authenticate, requireSuperAdmin, (req: AuthRequest, res: Response) => {
  const { role } = req.params;

  if (!VALID_ROLES.includes(role as UserRole)) {
    return res.status(400).json({ error: `Invalid role: ${role}` });
  }

  const defaults = DEFAULT_ROLE_PERMISSIONS[role as UserRole] || [];
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role = ?').run(role);
    const insert = db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)');
    for (const perm of defaults) {
      insert.run(role, perm);
    }
  });
  tx();

  logActivity({
    userId: req.user!.id,
    entityType: 'role',
    entityId: role,
    entityTitle: role,
    action: 'reset_permissions',
    changes: { permissions: { new: defaults } },
  });

  res.json({ success: true, role, permissions: defaults });
});

// ── Per-User Permission Overrides ─────────────────────────────

// GET /:id/permissions — Get a user's effective permissions including overrides
router.get('/:id/permissions', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  const rolePerms = getRolePermissions(target.role);
  const overrides = getUserPermissionOverrides(req.params.id);
  const effective = getEffectiveUserPermissions(target.role, req.params.id);

  res.json({
    role: target.role,
    role_permissions: rolePerms,
    overrides,
    effective_permissions: effective,
  });
});

// PUT /:id/permissions/overrides — Set permission overrides for a user (superadmin only)
router.put('/:id/permissions/overrides', authenticate, requireSuperAdmin, (req: AuthRequest, res: Response) => {
  const { grants = [], revokes = [] } = req.body;
  const targetId = req.params.id;

  const invalidGrants = grants.filter((p: string) => !ALL_PERMISSIONS.includes(p));
  const invalidRevokes = revokes.filter((p: string) => !ALL_PERMISSIONS.includes(p));
  if (invalidGrants.length || invalidRevokes.length) {
    return res.status(400).json({ error: 'Invalid permissions', invalidGrants, invalidRevokes });
  }

  const db = getDb();
  const target = db.prepare('SELECT id, role, display_name FROM users WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  const oldOverrides = getUserPermissionOverrides(targetId);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(targetId);
    const insert = db.prepare('INSERT INTO user_permission_overrides (user_id, permission, type, granted_by) VALUES (?, ?, ?, ?)');
    for (const perm of grants) insert.run(targetId, perm, 'grant', req.user!.id);
    for (const perm of revokes) insert.run(targetId, perm, 'revoke', req.user!.id);
  });
  tx();

  logActivity({
    userId: req.user!.id,
    entityType: 'user',
    entityId: targetId,
    entityTitle: target.display_name,
    action: 'updated',
    changes: {
      permission_overrides: {
        old: { grants: oldOverrides.grants, revokes: oldOverrides.revokes },
        new: { grants, revokes },
      },
    },
  });

  res.json({ success: true, grants, revokes });
});

// DELETE /:id/permissions/overrides — Clear all overrides for a user (superadmin only)
router.delete('/:id/permissions/overrides', authenticate, requireSuperAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const target = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  const oldOverrides = getUserPermissionOverrides(req.params.id);
  db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(req.params.id);

  logActivity({
    userId: req.user!.id,
    entityType: 'user',
    entityId: req.params.id,
    entityTitle: target.display_name,
    action: 'updated',
    changes: {
      permission_overrides: {
        old: { grants: oldOverrides.grants, revokes: oldOverrides.revokes },
        new: { grants: [], revokes: [] },
      },
    },
  });

  res.json({ success: true });
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
