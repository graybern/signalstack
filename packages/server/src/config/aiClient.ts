import { config } from '../config.js';
import { getSetting } from '../routes/icp.js';

export type AIProvider = 'vertex' | 'anthropic';

export interface AIConfig {
  provider: AIProvider;
  defaultModel: string;
  // Vertex-specific
  region?: string;
  projectId?: string;
}

export function getAIConfig(): AIConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const projectId = getSetting('vertex.project_id', null) || config.vertexProjectId;

  if (apiKey && !projectId) {
    return {
      provider: 'anthropic',
      defaultModel: getSetting('vertex.default_model', null) || config.defaultModel,
    };
  }

  return {
    provider: 'vertex',
    defaultModel: getSetting('vertex.default_model', null) || config.defaultModel,
    region: getSetting('vertex.region', null) || config.vertexRegion,
    projectId,
  };
}

export function resolveModel(modelId: string, provider: AIProvider): string {
  if (provider === 'anthropic') {
    // vertex format: claude-sonnet-4-6@default → anthropic format: claude-sonnet-4-6-latest
    if (modelId.includes('@')) {
      return modelId.replace(/@.*$/, '-latest');
    }
    return modelId;
  }
  // Vertex: if someone stored an Anthropic-style model ID, convert it
  if (!modelId.includes('@') && !modelId.includes('-latest')) {
    return modelId + '@default';
  }
  if (modelId.endsWith('-latest')) {
    return modelId.replace(/-latest$/, '@default');
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
    return new Anthropic();
  }

  const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk');
  return new AnthropicVertex({
    region: aiConfig.region!,
    projectId: aiConfig.projectId!,
  });
}
