import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config(); // also check local .env

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  // CLOUD_ML_REGION='global' is a gcloud SDK default — not a valid model region
  vertexRegion: (process.env.CLOUD_ML_REGION && process.env.CLOUD_ML_REGION !== 'global')
    ? process.env.CLOUD_ML_REGION
    : 'us-east5',
  vertexProjectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID || '',
  defaultModel: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../data/pipeline.db'),
  webDistPath: path.resolve(__dirname, '../../web/dist'),
  cronEnabled: process.env.CRON_ENABLED !== 'false',
  cronSchedule: process.env.CRON_SCHEDULE || '0 14 * * 1', // Monday 7am MST = 14:00 UTC
};
