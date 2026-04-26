import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema.js';

export type EntityType = 'campaign' | 'lead' | 'icp_config' | 'exclusion' | 'user' | 'setting' | 'import';
export type ActionType = 'created' | 'updated' | 'deleted' | 'reverted';

export interface ActivityEntry {
  id: string;
  user_id: string;
  entity_type: EntityType;
  entity_id: string;
  entity_title: string | null;
  action: ActionType;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  snapshot: Record<string, unknown> | null;
  created_at: string;
}

interface LogActivityParams {
  userId: string;
  entityType: EntityType;
  entityId: string;
  entityTitle?: string;
  action: ActionType;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  snapshot?: Record<string, unknown> | null;
}

const SKIP_FIELDS = new Set([
  'updated_at',
  'created_at',
  'password_hash',
]);

export function logActivity(params: LogActivityParams): string {
  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO activity_log (id, user_id, entity_type, entity_id, entity_title, action, changes, snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.userId,
    params.entityType,
    params.entityId,
    params.entityTitle ?? null,
    params.action,
    params.changes ? JSON.stringify(params.changes) : null,
    params.snapshot ? JSON.stringify(params.snapshot) : null,
  );

  return id;
}

export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> | null {
  const diff: Record<string, { old: unknown; new: unknown }> = {};

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (SKIP_FIELDS.has(key)) continue;

    const oldVal = before[key] ?? null;
    const newVal = after[key] ?? null;

    const oldStr = typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal);
    const newStr = typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal);

    if (oldStr !== newStr) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

export function getActivityLog(filters: {
  entityType?: EntityType;
  entityId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): { entries: ActivityEntry[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.entityType) {
    conditions.push('entity_type = ?');
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    conditions.push('entity_id = ?');
    params.push(filters.entityId);
  }
  if (filters.userId) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const total = (db.prepare(`SELECT COUNT(*) as count FROM activity_log ${where}`).get(...params) as any).count;

  const rows = db.prepare(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[];

  const entries: ActivityEntry[] = rows.map(row => ({
    ...row,
    changes: row.changes ? JSON.parse(row.changes) : null,
    snapshot: row.snapshot ? JSON.parse(row.snapshot) : null,
  }));

  return { entries, total };
}

export function getActivityEntry(id: string): ActivityEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    ...row,
    changes: row.changes ? JSON.parse(row.changes) : null,
    snapshot: row.snapshot ? JSON.parse(row.snapshot) : null,
  };
}
