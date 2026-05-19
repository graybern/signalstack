export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes('network') || msg.includes('econnreset') || msg.includes('etimedout') ||
      msg.includes('econnrefused') || msg.includes('socket hang up') || msg.includes('fetch failed')) {
    return true;
  }
  const status = (err as any).status ?? (err as any).statusCode;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 529) {
    return true;
  }
  if (msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('too many requests') ||
      msg.includes('internal server error') || msg.includes('bad gateway') || msg.includes('service unavailable')) {
    return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2;
  const baseDelay = opts?.baseDelayMs ?? 1000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (opts?.signal?.aborted) throw err;
      if (attempt >= maxRetries || !isTransient(err)) throw err;

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[retry] Attempt ${attempt + 1}/${maxRetries + 1} failed (${err instanceof Error ? err.message : String(err)}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
