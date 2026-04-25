export interface GoogleSearchResult {
  title: string;
  url: string;
  description: string;
  age: string | null;
}

export async function googleCustomSearch(
  query: string,
  apiKey: string,
  cseId: string,
  count: number = 5
): Promise<GoogleSearchResult[]> {
  const num = Math.min(count, 10); // Google CSE max is 10 per request
  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: query,
    num: String(num),
  });

  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw Object.assign(new Error('Rate limited'), { status: 429 });
    }
    throw new Error(`Google Custom Search API error: ${response.status}`);
  }

  const data = await response.json();
  return (data.items || []).map((item: any) => ({
    title: item.title || '',
    url: item.link || '',
    description: item.snippet || '',
    age: null, // Google CSE doesn't provide age directly
  }));
}
