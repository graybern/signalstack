import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../auth/middleware.js';
import { getSetting, saveSetting } from './icp.js';
import { logActivity } from '../services/activityLog.js';
import { config } from '../config.js';
import { getDb } from '../db/schema.js';
import type { AIProvider } from '../config/aiClient.js';

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

function maskApiKey(key: string): string {
  if (key.length <= 12) return '••••••••';
  return key.slice(0, 7) + '••••••••' + key.slice(-4);
}

// GET /settings/ai — Returns full AI provider config with source info
router.get('/ai', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  const dbProvider = getSetting('ai.provider', null) as AIProvider | null;
  const dbApiKey = getSetting('ai.api_key', null) as string | null;
  const envApiKey = process.env.ANTHROPIC_API_KEY || null;
  const projectId = getSetting('vertex.project_id', null) || config.vertexProjectId;

  const autoDetected: AIProvider = envApiKey && !projectId ? 'anthropic' : 'vertex';

  const vertexFields: Record<string, { value: string; source: string; env_present: boolean }> = {};
  for (const field of VERTEX_FIELDS) {
    const dbValue = getSetting(getSettingKey(field), null);
    const envValue = getEnvValue(field);
    const defaultValue = getDefault(field);

    if (dbValue !== null) {
      vertexFields[field] = { value: dbValue, source: 'database', env_present: !!envValue };
    } else if (envValue) {
      vertexFields[field] = { value: envValue, source: 'env', env_present: true };
    } else {
      vertexFields[field] = { value: defaultValue, source: 'default', env_present: false };
    }
  }

  let apiKeyInfo: { masked: string; source: string } | null = null;
  if (dbApiKey) {
    apiKeyInfo = { masked: maskApiKey(dbApiKey), source: 'database' };
  } else if (envApiKey) {
    apiKeyInfo = { masked: maskApiKey(envApiKey), source: 'env' };
  }

  res.json({
    provider: {
      value: dbProvider || autoDetected,
      source: dbProvider ? 'database' : 'auto',
      auto_detected: autoDetected,
    },
    api_key: apiKeyInfo,
    env_api_key_present: !!envApiKey,
    vertex: vertexFields,
  });
});

// PUT /settings/ai — Save AI provider config (provider, API key, vertex fields)
router.put('/ai', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { provider, api_key, ...vertexBody } = req.body;
  const changedFields: Record<string, { old: unknown; new: unknown }> = {};

  if (provider && (provider === 'vertex' || provider === 'anthropic')) {
    const oldProvider = getSetting('ai.provider', null);
    if (oldProvider !== provider) {
      saveSetting('ai.provider', provider, req.user!.id);
      changedFields.provider = { old: oldProvider || '(auto)', new: provider };
    }
  }

  if (api_key !== undefined) {
    if (api_key === '') {
      getDb().prepare("DELETE FROM app_settings WHERE key = 'ai.api_key'").run();
      changedFields.api_key = { old: '(set)', new: '(cleared)' };
    } else {
      saveSetting('ai.api_key', api_key, req.user!.id);
      changedFields.api_key = { old: '(previous)', new: maskApiKey(api_key) };
    }
  }

  for (const field of VERTEX_FIELDS) {
    if (vertexBody[field] !== undefined && vertexBody[field] !== null && vertexBody[field] !== '') {
      const oldVal = getSetting(getSettingKey(field), getEnvValue(field) || getDefault(field));
      saveSetting(getSettingKey(field), vertexBody[field], req.user!.id);
      if (String(oldVal) !== String(vertexBody[field])) {
        changedFields[field] = { old: oldVal, new: vertexBody[field] };
      }
    }
  }

  if (Object.keys(changedFields).length > 0) {
    logActivity({
      userId: req.user!.id,
      entityType: 'setting',
      entityId: 'ai-provider',
      entityTitle: 'AI Provider Config',
      action: 'updated',
      changes: changedFields,
    });
  }

  res.json({ success: true });
});

// DELETE /settings/ai/:field — Clear a specific AI setting
router.delete('/ai/:field', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const field = req.params.field;

  if (field === 'provider') {
    getDb().prepare("DELETE FROM app_settings WHERE key = 'ai.provider'").run();
    return res.json({ success: true, field, fallback: 'auto-detect' });
  }
  if (field === 'api_key') {
    getDb().prepare("DELETE FROM app_settings WHERE key = 'ai.api_key'").run();
    return res.json({ success: true, field, fallback: process.env.ANTHROPIC_API_KEY ? 'env' : 'none' });
  }

  const vertexField = field as VertexField;
  if (!VERTEX_FIELDS.includes(vertexField)) {
    return res.status(400).json({ error: `Invalid field: ${field}` });
  }
  getDb().prepare('DELETE FROM app_settings WHERE key = ?').run(getSettingKey(vertexField));
  res.json({ success: true, field, fallback_source: getEnvValue(vertexField) ? 'env' : 'default' });
});

// Backward-compatible: GET /settings/vertex → redirects to /settings/ai
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

// Backward-compatible: PUT /settings/vertex
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

// Backward-compatible: DELETE /settings/vertex/:field
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

// GET /settings/timezone — Returns server timezone + list for schedule display
router.get('/timezone', authenticate, (_req: AuthRequest, res: Response) => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const abbr = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() || '';
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const absH = Math.floor(Math.abs(offset) / 60);
  const absM = Math.abs(offset) % 60;
  const utcOffset = `UTC${sign}${absH}${absM ? ':' + String(absM).padStart(2, '0') : ''}`;

  const timezones = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'America/Phoenix',
    'America/Toronto',
    'America/Vancouver',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];

  const timezoneList = timezones.map(zone => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
    const parts = formatter.formatToParts(now);
    const zoneAbbr = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const offsetMs = getTimezoneOffsetMs(zone, now);
    const offSign = offsetMs >= 0 ? '+' : '-';
    const offH = Math.floor(Math.abs(offsetMs) / 3600000);
    const offM = Math.floor((Math.abs(offsetMs) % 3600000) / 60000);
    const utcOff = `UTC${offSign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
    return { zone, abbreviation: zoneAbbr, utc_offset: utcOff };
  });

  res.json({ timezone: tz, abbreviation: abbr, utc_offset: utcOffset, timezones: timezoneList });
});

// GET /settings/webhook_default_campaign — Default campaign for webhook leads
router.get('/webhook_default_campaign', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'webhook_default_campaign'").get() as { value: string } | undefined;
  res.json({ value: row ? JSON.parse(row.value) : null });
});

// PUT /settings/webhook_default_campaign — Set default campaign for webhook leads
router.put('/webhook_default_campaign', authenticate, (req: AuthRequest, res: Response) => {
  const { value } = req.body;
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('webhook_default_campaign', ?)"
  ).run(JSON.stringify(value || ''));
  res.json({ success: true });
});

function getTimezoneOffsetMs(zone: string, date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const zoneStr = date.toLocaleString('en-US', { timeZone: zone });
  return new Date(zoneStr).getTime() - new Date(utcStr).getTime();
}

export default router;
