import { Router, Response } from 'express';
import { authenticate, requireAdmin, requirePermission, AuthRequest } from '../auth/middleware.js';
import { getDb } from '../db/schema.js';
import { getActivityLog, getActivityEntry, logActivity } from '../services/activityLog.js';
import type { EntityType } from '../services/activityLog.js';

const router = Router();

router.get('/', authenticate, requirePermission('activity:read'), (req: AuthRequest, res: Response) => {
  const { entity_type, entity_id, user_id, limit, offset } = req.query;

  const result = getActivityLog({
    entityType: entity_type as EntityType | undefined,
    entityId: entity_id as string | undefined,
    userId: user_id as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : 50,
    offset: offset ? parseInt(offset as string, 10) : 0,
  });

  const db = getDb();
  const userRows = db.prepare('SELECT id, display_name, email FROM users').all() as any[];
  const userMap: Record<string, { display_name: string; email: string }> = {};
  for (const u of userRows) {
    userMap[u.id] = { display_name: u.display_name, email: u.email };
  }

  const entries = result.entries.map(entry => ({
    ...entry,
    user: userMap[entry.user_id] || { display_name: 'Unknown', email: '' },
  }));

  res.json({ entries, total: result.total });
});

router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const entry = getActivityEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Activity entry not found' });
  res.json(entry);
});

router.post('/:id/revert', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const entry = getActivityEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Activity entry not found' });

  if (!entry.snapshot) {
    return res.status(400).json({ error: 'No snapshot available for revert' });
  }

  const db = getDb();
  const tableMap: Record<string, string> = {
    campaign: 'campaigns',
    lead: 'leads',
    icp_config: 'icp_config',
    exclusion: 'exclusions',
    user: 'users',
    setting: 'settings',
  };

  const table = tableMap[entry.entity_type];
  if (!table) {
    return res.status(400).json({ error: `Revert not supported for entity type: ${entry.entity_type}` });
  }

  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(entry.entity_id) as any;
  if (!existing) {
    return res.status(404).json({ error: `Entity not found in ${table}` });
  }

  const snapshot = entry.snapshot;
  const columns = Object.keys(snapshot).filter(k => k !== 'id' && k !== 'created_at');
  const setClause = columns.map(c => `${c} = ?`).join(', ');
  const values = columns.map(c => {
    const val = snapshot[c];
    return typeof val === 'object' && val !== null ? JSON.stringify(val) : val;
  });

  db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values, entry.entity_id);

  logActivity({
    userId: req.user!.id,
    entityType: entry.entity_type,
    entityId: entry.entity_id,
    entityTitle: entry.entity_title ?? undefined,
    action: 'reverted',
    snapshot: existing,
  });

  res.json({ success: true, reverted_to: entry.id });
});

export default router;
