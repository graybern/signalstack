import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';
import { eventBus } from '../events/eventBus.js';
import type { TokenTracker } from './tokenTracker.js';

interface StreamContext {
  runId: string;
  campaignId?: string;
  phase: string;
  companyName?: string;
}

interface StreamParams {
  model?: string;
  max_tokens: number;
  system: string;
  userMessage: string;
  thinking_budget?: number;
  tracker?: TokenTracker;
  context?: StreamContext;
}

interface StreamResult {
  text: string;
  thinking: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function streamAICall(params: StreamParams): Promise<StreamResult> {
  const aiConfig = getAIConfig();
  const client = await createAIClient();
  const model = resolveModel(params.model || aiConfig.defaultModel, aiConfig.provider);
  const ctx = params.context;

  let maxTokens = params.max_tokens;

  const createParams: any = {
    model,
    system: params.system,
    messages: [{ role: 'user', content: params.userMessage }],
  };

  if (params.thinking_budget) {
    if (maxTokens <= params.thinking_budget) {
      maxTokens = params.thinking_budget + params.max_tokens;
    }
    createParams.thinking = {
      type: 'enabled',
      budget_tokens: params.thinking_budget,
    };
  }

  createParams.max_tokens = maxTokens;

  if (!ctx) {
    const response = await client.messages.create(createParams);
    if (params.tracker) params.tracker.addUsage(response);
    const text = response.content.find((b: any) => b.type === 'text')?.text || '';
    const thinking = response.content.find((b: any) => b.type === 'thinking')?.thinking || '';
    return { text, thinking, usage: response.usage };
  }

  let fullText = '';
  let fullThinking = '';

  const stream = client.messages.stream(createParams);

  stream.on('thinking', (thinkingDelta: string, _thinkingSnapshot: string) => {
    fullThinking += thinkingDelta;
    eventBus.emit('run.ai_stream', {
      run_id: ctx.runId,
      campaign_id: ctx.campaignId,
      phase: ctx.phase,
      company_name: ctx.companyName,
      block_type: 'thinking',
      delta: thinkingDelta,
      done: false,
    });
  });

  stream.on('text', (textDelta: string, _textSnapshot: string) => {
    fullText += textDelta;
    eventBus.emit('run.ai_stream', {
      run_id: ctx.runId,
      campaign_id: ctx.campaignId,
      phase: ctx.phase,
      company_name: ctx.companyName,
      block_type: 'text',
      delta: textDelta,
      done: false,
    });
  });

  const finalMessage = await stream.finalMessage();

  // Emit done signals
  if (fullThinking) {
    eventBus.emit('run.ai_stream', {
      run_id: ctx.runId, campaign_id: ctx.campaignId,
      phase: ctx.phase, company_name: ctx.companyName,
      block_type: 'thinking', delta: '', done: true,
    });
  }
  eventBus.emit('run.ai_stream', {
    run_id: ctx.runId, campaign_id: ctx.campaignId,
    phase: ctx.phase, company_name: ctx.companyName,
    block_type: 'text', delta: '', done: true,
  });

  if (params.tracker) params.tracker.addUsage(finalMessage);

  return { text: fullText, thinking: fullThinking, usage: finalMessage.usage };
}
