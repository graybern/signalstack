import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../auth/middleware.js';
import { getSetting, saveSetting } from './icp.js';
import { logActivity } from '../services/activityLog.js';
import { config } from '../config.js';
import { getDb } from '../db/schema.js';

const router = Router();

// Field definitions for vertex config
const VERTEX_FIELDS = ['project_id', 'region', 'default_model'] as const;
type VertexField = typeof VERTEX_FIELDS[number];

function getSettingKey(field: VertexField): string {
  return `vertex.${field}`;
}

function getEnvValue(field: VertexField): string | null {
  switch (field) {
    case 'project_id': return config.vertexProjectId || null;
    case 'region': return config.vertexRegion || null;
    case 'default_model': return config.defaultModel || null;
  }
}

function getDefault(field: VertexField): string {
  switch (field) {
    case 'project_id': return '';
    case 'region': return 'us-east5';
    case 'default_model': return 'claude-opus-4-6@default';
  }
}

// GET /settings/vertex — Returns current vertex config with source info
router.get('/vertex', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  const result: Record<string, { value: string; source: string; env_present: boolean }> = {};

  for (const field of VERTEX_FIELDS) {
    const dbValue = getSetting(getSettingKey(field), null);
    const envValue = getEnvValue(field);
    const defaultValue = getDefault(field);

    if (dbValue !== null) {
      result[field] = { value: dbValue, source: 'database', env_present: !!envValue };
    } else if (envValue) {
      result[field] = { value: envValue, source: 'env', env_present: true };
    } else {
      result[field] = { value: defaultValue, source: 'default', env_present: false };
    }
  }

  res.json(result);
});

// PUT /settings/vertex — Save vertex config overrides
router.put('/vertex', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const body = req.body;

  const changedFields: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of VERTEX_FIELDS) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
      const oldVal = getSetting(getSettingKey(field), getEnvValue(field) || getDefault(field));
      saveSetting(getSettingKey(field), body[field], req.user!.id);
      if (String(oldVal) !== String(body[field])) {
        changedFields[field] = { old: oldVal, new: body[field] };
      }
    }
  }

  if (Object.keys(changedFields).length > 0) {
    logActivity({
      userId: req.user!.id,
      entityType: 'setting',
      entityId: 'vertex',
      entityTitle: 'AI Provider Config',
      action: 'updated',
      changes: changedFields,
    });
  }

  res.json({ success: true });
});

// DELETE /settings/vertex/:field — Clear a specific override (fall back to env)
router.delete('/vertex/:field', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const field = req.params.field as VertexField;
  if (!VERTEX_FIELDS.includes(field)) {
    return res.status(400).json({ error: `Invalid field: ${field}. Valid fields: ${VERTEX_FIELDS.join(', ')}` });
  }

  getDb().prepare('DELETE FROM app_settings WHERE key = ?').run(getSettingKey(field));
  res.json({ success: true, field, fallback_source: getEnvValue(field) ? 'env' : 'default' });
});

// GET /settings/keys — Generic key-value settings (used by ApiKeysManager)
router.get('/keys', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  const keys: Record<string, string> = {};
  const rows = getDb().prepare("SELECT key, value FROM app_settings WHERE key LIKE 'key.%'").all() as any[];
  for (const row of rows) {
    const shortKey = row.key.replace('key.', '');
    try { keys[shortKey] = JSON.parse(row.value); } catch { keys[shortKey] = row.value; }
  }
  res.json(keys);
});

// PUT /settings/keys — Save a generic key-value setting
router.put('/keys', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });

  saveSetting(`key.${key}`, value, req.user!.id);
  res.json({ success: true });
});

export default router;
