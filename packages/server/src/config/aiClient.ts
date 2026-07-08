import { config } from '../config.js';
import { getSetting } from '../routes/icp.js';

export type AIProvider = 'vertex' | 'anthropic';

export interface AIConfig {
  provider: AIProvider;
  defaultModel: string;
  // Vertex-specific
  region?: string;
  projectId?: string;
  // Anthropic-specific
  apiKey?: string;
}

export function getAIConfig(): AIConfig {
  const dbProvider = getSetting('ai.provider', null) as AIProvider | null;
  const dbApiKey = getSetting('ai.api_key', null) as string | null;
  const envApiKey = process.env.ANTHROPIC_API_KEY || null;
  const projectId = getSetting('vertex.project_id', null) || config.vertexProjectId;
  const defaultModel = getSetting('vertex.default_model', null) || config.defaultModel;

  const effectiveProvider = dbProvider
    || (envApiKey ? 'anthropic' : 'vertex');

  if (effectiveProvider === 'anthropic') {
    return {
      provider: 'anthropic',
      defaultModel,
      apiKey: dbApiKey || envApiKey || undefined,
    };
  }

  return {
    provider: 'vertex',
    defaultModel,
    region: getSetting('vertex.region', null) || config.vertexRegion,
    projectId,
  };
}

export function resolveModel(modelId: string, provider: AIProvider): string {
  if (provider === 'anthropic') {
    // Strip Vertex-style version suffixes (@default, @20251001)
    if (modelId.includes('@')) {
      return modelId.replace(/@.*$/, '');
    }
    return modelId;
  }
  // Vertex AI: @default is not a valid version tag — strip it
  // (4.6+ models use dateless IDs; older models use @date like @20251001)
  if (modelId.endsWith('@default')) {
    return modelId.slice(0, -'@default'.length);
  }
  if (modelId.endsWith('-latest')) {
    return modelId.slice(0, -'-latest'.length);
  }
  return modelId;
}

interface AIClientLike {
  messages: {
    create: (params: any) => Promise<any>;
    stream: (params: any) => any;
  };
}

export async function createAIClient(): Promise<AIClientLike> {
  const aiConfig = getAIConfig();

  if (aiConfig.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({
      ...(aiConfig.apiKey ? { apiKey: aiConfig.apiKey } : {}),
    });
  }

  const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk');
  return new AnthropicVertex({
    region: aiConfig.region!,
    projectId: aiConfig.projectId!,
  });
}
