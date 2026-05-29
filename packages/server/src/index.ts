import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config.js';
import { getDb } from './db/schema.js';
import authRoutes from './auth/routes.js';
import leadRoutes from './routes/leads.js';
import runRoutes from './routes/runs.js';
import icpRoutes from './routes/icp.js';
import exclusionRoutes from './routes/exclusions.js';
import exportRoutes from './routes/exports.js';
import userRoutes from './routes/users.js';
import campaignRoutes from './routes/campaigns.js';
import dataSourceRoutes from './routes/dataSources.js';
import inboundRoutes from './routes/inbound.js';
import webhookRoutes from './routes/webhooks.js';
import eventRoutes from './routes/events.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';
import activityRoutes from './routes/activity.js';
import configTransferRoutes from './routes/configTransfer.js';
import apiKeyRoutes from './routes/apikeys.js';
import researchRoutes from './routes/research.js';
import { initScheduler } from './scheduler/cron.js';
import { initCampaignScheduler } from './scheduler/campaignScheduler.js';
import { initWebhookDispatcher } from './events/webhookDispatcher.js';
import { initNotificationDispatcher } from './services/notificationDispatcher.js';
import { apiVersionHeader } from './middleware/apiVersion.js';
import { defaultRateLimit } from './middleware/rateLimit.js';
import { openApiSpec } from './openapi.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API middleware
app.use('/api', apiVersionHeader);
app.use('/api', defaultRateLimit);

// API routes — canonical under /api, also available under /api/v1
const mountRoutes = (prefix: string) => {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/leads`, leadRoutes);
  app.use(`${prefix}/runs`, runRoutes);
  app.use(`${prefix}/icp`, icpRoutes);
  app.use(`${prefix}/exclusions`, exclusionRoutes);
  app.use(`${prefix}/exports`, exportRoutes);
  app.use(`${prefix}/users`, userRoutes);
  app.use(`${prefix}/campaigns`, campaignRoutes);
  app.use(`${prefix}/data-sources`, dataSourceRoutes);
  app.use(`${prefix}/inbound`, inboundRoutes);
  app.use(`${prefix}/webhooks`, webhookRoutes);
  app.use(`${prefix}/events`, eventRoutes);
  app.use(`${prefix}/analytics`, analyticsRoutes);
  app.use(`${prefix}/settings`, settingsRoutes);
  app.use(`${prefix}/activity`, activityRoutes);
  app.use(`${prefix}/config-transfer`, configTransferRoutes);
  app.use(`${prefix}/api-keys`, apiKeyRoutes);
  app.use(`${prefix}/research`, researchRoutes);
};

mountRoutes('/api');
mountRoutes('/api/v1');

// OpenAPI spec
app.get('/api/docs/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});
app.get('/api/v1/docs/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});

// Health check
app.get('/api/health', async (_req, res) => {
  const { getActiveRunIds } = await import('./agent/runRegistry.js');
  const usage = process.memoryUsage();
  const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
  res.json({
    status: 'ok',
    version: 'v1',
    time: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    memory: {
      rss_mb: mb(usage.rss),
      heap_used_mb: mb(usage.heapUsed),
      heap_total_mb: mb(usage.heapTotal),
    },
    active_runs: getActiveRunIds().length,
  });
});

// AI provider health check
app.get('/api/health/ai', async (_req, res) => {
  try {
    const { getAIConfig, createAIClient, resolveModel } = await import('./config/vertexConfig.js');
    const aiConfig = getAIConfig();

    if (aiConfig.provider === 'vertex' && !aiConfig.projectId) {
      return res.json({ ok: false, error: 'No Vertex AI project ID configured' });
    }
    if (aiConfig.provider === 'anthropic' && !aiConfig.apiKey) {
      return res.json({ ok: false, error: 'No Anthropic API key configured — set ANTHROPIC_API_KEY or add one in Settings' });
    }

    const start = Date.now();
    const client = await createAIClient();
    const model = resolveModel(aiConfig.defaultModel, aiConfig.provider);
    const response = await client.messages.create({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with OK' }],
    });
    const latency = Date.now() - start;

    res.json({
      ok: true,
      provider: aiConfig.provider,
      model,
      ...(aiConfig.provider === 'vertex' ? { region: aiConfig.region, project_id: aiConfig.projectId } : {}),
      latency_ms: latency,
      tokens_used: response.usage?.input_tokens + response.usage?.output_tokens || 0,
    });
  } catch (err: any) {
    res.json({ ok: false, error: err.message || 'Connection failed' });
  }
});

// Backward-compatible alias
app.get('/api/health/vertex', (_req, res) => {
  res.redirect(307, '/api/health/ai');
});

// Serve frontend in production
if (config.nodeEnv === 'production') {
  app.use(express.static(config.webDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(config.webDistPath, 'index.html'));
  });
}

// Initialize DB and auto-seed on first run
const db = getDb();
console.log(`Database initialized at ${config.dbPath}`);

const { c: userCount } = db.prepare('SELECT COUNT(*) as c FROM users').get() as any;
if (userCount === 0) {
  const { v4: uuid } = await import('uuid');
  const bcryptMod = await import('bcryptjs');
  const hashSync = bcryptMod.default?.hashSync ?? bcryptMod.hashSync;
  db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, role, must_change_password) VALUES (?,?,?,?,?,?)'
  ).run(uuid(), 'admin@example.com', hashSync('admin123', 10), 'Admin', 'superadmin', 1);
  console.log('Created default admin user (admin@example.com / admin123 — must change on first login)');
}

// Clean up stale pipeline runs (orphaned by server crash/restart)
// Any run still marked running/pending at startup is orphaned — the in-memory AbortController registry is empty
const staleRuns = db.prepare(
  "UPDATE pipeline_runs SET status = 'failed', completed_at = datetime('now'), error_message = 'Server restarted while run was in progress — use Resume to continue' WHERE status IN ('running', 'pending')"
).run();
if (staleRuns.changes > 0) {
  console.log(`[startup] Marked ${staleRuns.changes} orphaned pipeline run(s) as failed`);
  // Update lead_count for orphaned runs so partial results are visible
  const orphanedRuns = db.prepare(
    "SELECT id FROM pipeline_runs WHERE error_message LIKE 'Server restarted%' AND lead_count = 0 AND completed_at >= datetime('now', '-1 minute')"
  ).all() as any[];
  for (const run of orphanedRuns) {
    const count = (db.prepare('SELECT COUNT(*) as c FROM leads WHERE run_id = ?').get(run.id) as any)?.c || 0;
    if (count > 0) {
      db.prepare('UPDATE pipeline_runs SET lead_count = ? WHERE id = ?').run(count, run.id);
    }
  }
}

// Seed role permissions on first run
import { seedRolePermissions, ensureNewPermissions } from './auth/permissions.js';
seedRolePermissions();
ensureNewPermissions();

initWebhookDispatcher();
initNotificationDispatcher();
initScheduler();
initCampaignScheduler();

const server = app.listen(config.port, () => {
  console.log(`SignalStack server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use — another server instance is running. This process will exit.`);
    process.exit(1);
  }
  throw err;
});

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — draining active runs...`);

  server.close();

  const { getActiveRunIds, cancelRun } = await import('./agent/runRegistry.js');
  const activeIds = getActiveRunIds();
  if (activeIds.length > 0) {
    console.log(`[shutdown] Cancelling ${activeIds.length} active run(s)`);
    for (const id of activeIds) {
      cancelRun(id);
    }

    const deadline = Date.now() + 30_000;
    while (getActiveRunIds().length > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const remaining = getActiveRunIds();
    if (remaining.length > 0) {
      console.log(`[shutdown] ${remaining.length} run(s) did not finish in time — marking as cancelled`);
      for (const id of remaining) {
        db.prepare(
          `UPDATE pipeline_runs SET status = 'cancelled', completed_at = datetime('now'),
           error_message = 'Server shutdown while run was in progress — use Resume to continue'
           WHERE id = ? AND status = 'running'`
        ).run(id);
      }
    }
  }

  console.log('[shutdown] Clean exit');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', async (err) => {
  console.error('[CRASH] Uncaught exception:', err);
  try {
    const { getActiveRunIds } = await import('./agent/runRegistry.js');
    const activeIds = getActiveRunIds();
    if (activeIds.length > 0) {
      console.error(`[CRASH] ${activeIds.length} active run(s) will be orphaned`);
      for (const id of activeIds) {
        try {
          db.prepare(
            `UPDATE pipeline_runs SET status = 'failed', completed_at = datetime('now'),
             error_message = ? WHERE id = ? AND status = 'running'`
          ).run(`Server crashed: ${err.message} — use Resume to continue`, id);
        } catch { /* best effort */ }
      }
    }
  } catch { /* best effort */ }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WARNING] Unhandled rejection:', reason);
});
