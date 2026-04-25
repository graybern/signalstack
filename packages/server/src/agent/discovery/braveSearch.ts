export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age: string | null;
}

export async function braveWebSearch(
  query: string,
  apiKey: string,
  count: number = 5
): Promise<BraveSearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(count) });
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw Object.assign(new Error('Rate limited'), { status: 429 });
    }
    throw new Error(`Brave Search API error: ${response.status}`);
  }

  const data = await response.json();
  return (data.web?.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || '',
    age: r.age || null,
  }));
}
