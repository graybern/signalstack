interface TokenCounterProps {
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function TokenCounter({ input_tokens, output_tokens, estimated_cost }: TokenCounterProps) {
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-gray-900 text-gray-300 rounded-full text-[11px] font-mono">
      <span className="text-blue-400">{formatTokens(input_tokens)} in</span>
      <span className="text-gray-600">|</span>
      <span className="text-emerald-400">{formatTokens(output_tokens)} out</span>
      <span className="text-gray-600">|</span>
      <span className="text-amber-400">~${estimated_cost.toFixed(2)}</span>
    </div>
  );
}
