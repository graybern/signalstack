export interface SerperSearchResult {
  title: string;
  url: string;
  description: string;
  age: string | null;
}

export async function serperWebSearch(
  query: string,
  apiKey: string,
  count: number = 5
): Promise<SerperSearchResult[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: count }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw Object.assign(new Error('Rate limited'), { status: 429 });
    }
    throw new Error(`Serper API error: ${response.status}`);
  }

  const data = await response.json();
  return (data.organic || []).map((r: any) => ({
    title: r.title || '',
    url: r.link || '',
    description: r.snippet || '',
    age: r.date || null,
  }));
}
