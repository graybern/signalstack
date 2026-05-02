import { Router, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requirePermission, hashApiKey, AuthRequest } from '../auth/middleware.js';
import { getRolePermissions } from '../auth/permissions.js';
import { logActivity } from '../services/activityLog.js';
import type { ApiKey } from '../types/index.js';

const router = Router();

function generateApiKey(): string {
  return `ss_${crypto.randomBytes(32).toString('hex')}`;
}

// GET / — List caller's API keys
router.get('/', authenticate, requirePermission('api_keys:manage'), (req: AuthRequest, res: Response) => {
  const keys = getDb().prepare(
    'SELECT id, name, key_prefix, scopes, expires_at, last_used_at, created_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user!.id);

  res.json(keys.map((k: any) => ({ ...k, scopes: JSON.parse(k.scopes) })));
});

// POST / — Create a new API key
router.post('/', authenticate, requirePermission('api_keys:manage'), (req: AuthRequest, res: Response) => {
  const { name, scopes = [], expires_in_days } = req.body;
  const user = req.user!;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(400).json({ error: 'At least one scope is required' });
  }

  const rolePerms = getRolePermissions(user.role);
  const invalid = scopes.filter((s: string) => !rolePerms.includes(s));
  if (invalid.length > 0) {
    return res.status(400).json({
      error: 'Cannot assign scopes beyond your role permissions',
      invalid_scopes: invalid,
    });
  }

  const id = uuid();
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 11);
  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
    : null;

  getDb().prepare(
    'INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, user.id, name.trim(), keyHash, keyPrefix, JSON.stringify(scopes), expiresAt);

  logActivity({
    userId: user.id,
    entityType: 'api_key',
    entityId: id,
    entityTitle: name.trim(),
    action: 'created',
    snapshot: { scopes, expires_at: expiresAt },
  });

  res.status(201).json({
    id,
    name: name.trim(),
    key: rawKey,
    key_prefix: keyPrefix,
    scopes,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });
});

// DELETE /:id — Revoke an API key
router.delete('/:id', authenticate, requirePermission('api_keys:manage'), (req: AuthRequest, res: Response) => {
  const db = getDb();
  const key = db.prepare(
    'SELECT id, name, user_id FROM api_keys WHERE id = ? AND revoked_at IS NULL'
  ).get(req.params.id) as ApiKey | undefined;

  if (!key) return res.status(404).json({ error: 'API key not found' });
  if (key.user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Can only revoke your own API keys' });
  }

  db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?").run(req.params.id);

  logActivity({
    userId: req.user!.id,
    entityType: 'api_key',
    entityId: req.params.id,
    entityTitle: key.name,
    action: 'revoked',
  });

  res.json({ success: true });
});

export default router;
