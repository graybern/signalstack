/**
 * Token usage tracking for pipeline runs.
 * Accumulates input/output tokens across all Claude API calls in a run,
 * then persists totals + estimated cost to the pipeline_runs table.
 */

// Pricing per 1M tokens (as of 2025 — update as needed)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-6': { input: 5.0, output: 25.0 },
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  default: { input: 3.0, output: 15.0 },
};

function lookupPricing(model: string): { input: number; output: number } {
  const base = model.replace(/@.*$/, '');
  return MODEL_PRICING[base] || MODEL_PRICING[model] || MODEL_PRICING.default;
}

export type TokenUsageCallback = (summary: ReturnType<TokenTracker['getSummary']>) => void;

export class TokenTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private model: string;
  private onUsageCallback?: TokenUsageCallback;

  constructor(model: string) {
    this.model = model;
  }

  /** Register a callback invoked after each addUsage call */
  onUsage(cb: TokenUsageCallback) {
    this.onUsageCallback = cb;
  }

  /** Call after each Claude API response to accumulate usage */
  addUsage(response: { usage?: { input_tokens?: number; output_tokens?: number } }) {
    if (response.usage) {
      this.inputTokens += response.usage.input_tokens || 0;
      this.outputTokens += response.usage.output_tokens || 0;
      this.onUsageCallback?.(this.getSummary());
    }
  }

  getInputTokens(): number {
    return this.inputTokens;
  }

  getOutputTokens(): number {
    return this.outputTokens;
  }

  getTotalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  getEstimatedCost(): number {
    const pricing = lookupPricing(this.model);
    const inputCost = (this.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (this.outputTokens / 1_000_000) * pricing.output;
    return Math.round((inputCost + outputCost) * 10000) / 10000; // 4 decimal places
  }

  getModel(): string {
    return this.model;
  }

  getSummary() {
    return {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      total_tokens: this.getTotalTokens(),
      estimated_cost: this.getEstimatedCost(),
      model: this.model,
    };
  }
}

/**
 * Multi-model token tracker for funnel pipelines where different steps
 * use different Claude models. Aggregates costs across all models.
 */
export class MultiModelTokenTracker {
  private trackers = new Map<string, TokenTracker>();
  private defaultModel: string;
  private onUsageCallback?: TokenUsageCallback;

  constructor(defaultModel: string) {
    this.defaultModel = defaultModel;
  }

  onUsage(cb: TokenUsageCallback) {
    this.onUsageCallback = cb;
    // Re-wire any existing child trackers to propagate through the new callback
    for (const t of this.trackers.values()) {
      t.onUsage(() => {
        this.onUsageCallback?.(this.getSummary());
      });
    }
  }

  private getTracker(model: string): TokenTracker {
    if (!this.trackers.has(model)) {
      const t = new TokenTracker(model);
      // Wire child tracker's callback to fire parent's aggregated summary
      t.onUsage(() => {
        this.onUsageCallback?.(this.getSummary());
      });
      this.trackers.set(model, t);
    }
    return this.trackers.get(model)!;
  }

  addUsage(response: { usage?: { input_tokens?: number; output_tokens?: number } }, model?: string) {
    const tracker = this.getTracker(model || this.defaultModel);
    tracker.addUsage(response);
    this.onUsageCallback?.(this.getSummary());
  }

  getSummary() {
    let input_tokens = 0;
    let output_tokens = 0;
    let estimated_cost = 0;

    for (const tracker of this.trackers.values()) {
      const s = tracker.getSummary();
      input_tokens += s.input_tokens;
      output_tokens += s.output_tokens;
      estimated_cost += s.estimated_cost;
    }

    return {
      input_tokens,
      output_tokens,
      total_tokens: input_tokens + output_tokens,
      estimated_cost: Math.round(estimated_cost * 10000) / 10000,
      model: this.defaultModel,
    };
  }

  /** Get a single-model tracker view for passing to functions that expect TokenTracker */
  getTrackerForModel(model: string): TokenTracker {
    return this.getTracker(model);
  }
}
