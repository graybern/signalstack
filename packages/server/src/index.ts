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
import { initScheduler } from './scheduler/cron.js';
import { initCampaignScheduler } from './scheduler/campaignScheduler.js';
import { initWebhookDispatcher } from './events/webhookDispatcher.js';
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
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: 'v1', time: new Date().toISOString() });
});

// AI provider health check
app.get('/api/health/ai', async (_req, res) => {
  try {
    const { getAIConfig, createAIClient, resolveModel } = await import('./config/vertexConfig.js');
    const aiConfig = getAIConfig();

    if (aiConfig.provider === 'vertex' && !aiConfig.projectId) {
      return res.json({ ok: false, error: 'No Vertex AI project ID configured' });
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
  console.log('Empty database detected — running seed...');
  await import('./db/seed.js');
}

initWebhookDispatcher();
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

function cleanup() {
  server.close();
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
