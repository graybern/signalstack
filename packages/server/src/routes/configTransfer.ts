import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../auth/middleware.js';
import { exportData, importData, ExportMode, ImportMode } from '../services/configTransfer.js';

const router = Router();

// GET /config-transfer/export?mode=config|full
router.get('/export', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const mode = (req.query.mode as string) || 'config';
  if (mode !== 'config' && mode !== 'full') {
    return res.status(400).json({ error: 'mode must be "config" or "full"' });
  }

  try {
    const payload = exportData(mode as ExportMode);
    const filename = `signalstack-${mode}-${new Date().toISOString().slice(0, 10)}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

// POST /config-transfer/import?mode=replace|merge
router.post('/import', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const mode = (req.query.mode as string) || 'merge';
  if (mode !== 'replace' && mode !== 'merge') {
    return res.status(400).json({ error: 'mode must be "replace" or "merge"' });
  }

  const payload = req.body;
  if (!payload || !payload.metadata) {
    return res.status(400).json({ error: 'Invalid export file — missing metadata' });
  }

  if (!payload.metadata.version) {
    return res.status(400).json({ error: 'Invalid export file — missing version in metadata' });
  }

  try {
    const result = importData(payload, mode as ImportMode);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

// GET /config-transfer/preview — Dry-run summary of what an import would do
router.post('/preview', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const payload = req.body;
  if (!payload || !payload.metadata) {
    return res.status(400).json({ error: 'Invalid export file' });
  }

  const summary: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'metadata' && Array.isArray(value)) {
      summary[key] = value.length;
    }
  }

  res.json({
    export_mode: payload.metadata.export_mode,
    exported_at: payload.metadata.exported_at,
    app_version: payload.metadata.app_version,
    table_counts: summary,
  });
});

export default router;
