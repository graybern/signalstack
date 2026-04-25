/**
 * AI config resolver.
 * Reads from app_settings (database) first, falls back to env vars via config.
 * Supports both Vertex AI and direct Anthropic API.
 */

export { getAIConfig, createAIClient, resolveModel } from './aiClient.js';
export type { AIConfig, AIProvider } from './aiClient.js';

// Backward-compatible alias
import { getAIConfig } from './aiClient.js';

export interface VertexConfig {
  projectId: string;
  region: string;
  defaultModel: string;
}

export function getVertexConfig(): VertexConfig {
  const cfg = getAIConfig();
  return {
    projectId: cfg.projectId || '',
    region: cfg.region || '',
    defaultModel: cfg.defaultModel,
  };
}
