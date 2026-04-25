import { Router, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authenticate, requireAdmin, requireOperator, AuthRequest } from '../auth/middleware.js';
import { getDataSourceConfigs, checkDataSourceHealth } from '../agent/enrichment/service.js';
import { getDefaultDataSources, type DataSourceId, type DataSourceConfig } from '../agent/enrichment/types.js';

const router = Router();

function saveSetting(key: string, value: any, userId: string) {
  getDb().prepare(
    "INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime('now')"
  ).run(key, JSON.stringify(value), userId);
}

/**
 * GET /api/data-sources — List all data source configurations
 */
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  const configs = getDataSourceConfigs();

  // Strip API keys for non-admin users, show only masked version
  const safeConfigs = configs.map(c => ({
    ...c,
    api_key: c.api_key ? maskApiKey(c.api_key) : undefined,
    has_api_key: !!c.api_key,
  }));

  res.json(safeConfigs);
});

/**
 * GET /api/data-sources/:id — Get specific data source config
 */
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const configs = getDataSourceConfigs();
  const config = configs.find(c => c.id === req.params.id);
  if (!config) return res.status(404).json({ error: 'Data source not found' });

  res.json({
    ...config,
    api_key: config.api_key ? maskApiKey(config.api_key) : undefined,
    has_api_key: !!config.api_key,
  });
});

/**
 * PUT /api/data-sources/:id — Update a data source configuration
 */
router.put('/:id', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const sourceId = req.params.id as DataSourceId;
  const body = req.body;

  const configs = getDataSourceConfigs();
  const index = configs.findIndex(c => c.id === sourceId);
  if (index === -1) return res.status(404).json({ error: 'Data source not found' });

  const existing = configs[index];

  // Update fields
  const updated: DataSourceConfig = {
    ...existing,
    enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
    settings: body.settings ? { ...existing.settings, ...body.settings } : existing.settings,
  };

  // Only update API key if explicitly provided and not masked
  if (body.api_key && !body.api_key.includes('••••')) {
    updated.api_key = body.api_key;
    updated.status = 'active'; // Reset status when key is updated
  }

  // If disabling, keep the key but mark unconfigured
  if (body.enabled === false) {
    updated.status = (updated.api_key || !updated.requires_key) ? 'active' : 'unconfigured';
  }

  // Free sources don't need an API key to be active
  if (!updated.requires_key && updated.enabled) {
    updated.status = 'active';
  }

  configs[index] = updated;
  saveSetting('data_sources', configs, req.user!.id);

  res.json({
    ...updated,
    api_key: updated.api_key ? maskApiKey(updated.api_key) : undefined,
    has_api_key: !!updated.api_key,
  });
});

/**
 * POST /api/data-sources/:id/test — Test connection to a data source
 */
router.post('/:id/test', authenticate, requireOperator, async (req: AuthRequest, res: Response) => {
  const sourceId = req.params.id as DataSourceId;

  // If a temporary API key is provided for testing, use it
  const configs = getDataSourceConfigs();
  const config = configs.find(c => c.id === sourceId);
  if (!config) return res.status(404).json({ error: 'Data source not found' });

  // Allow testing with a temporary key
  const testConfig = { ...config };
  if (req.body.api_key && !req.body.api_key.includes('••••')) {
    testConfig.api_key = req.body.api_key;
  }

  const result = await checkDataSourceHealth(sourceId);

  // Update status based on health check
  if (config.api_key || !config.requires_key) {
    config.status = result.ok ? 'active' : 'error';
    config.error_message = result.ok ? undefined : result.message;
    config.last_used = new Date().toISOString();

    const allConfigs = getDataSourceConfigs();
    const idx = allConfigs.findIndex(c => c.id === sourceId);
    if (idx !== -1) {
      allConfigs[idx] = config;
      saveSetting('data_sources', allConfigs, req.user!.id);
    }
  }

  res.json(result);
});

/**
 * DELETE /api/data-sources/:id/key — Remove API key for a data source
 */
router.delete('/:id/key', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const sourceId = req.params.id as DataSourceId;
  const configs = getDataSourceConfigs();
  const index = configs.findIndex(c => c.id === sourceId);
  if (index === -1) return res.status(404).json({ error: 'Data source not found' });

  configs[index] = {
    ...configs[index],
    api_key: undefined,
    enabled: false,
    status: 'unconfigured',
    error_message: undefined,
  };

  saveSetting('data_sources', configs, req.user!.id);
  res.json({ success: true });
});

/**
 * POST /api/data-sources/reset — Reset all data sources to defaults
 */
router.post('/reset', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  saveSetting('data_sources', getDefaultDataSources(), req.user!.id);
  res.json({ success: true });
});

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.substring(0, 4) + '••••••••' + key.substring(key.length - 4);
}

export default router;
