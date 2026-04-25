/**
 * Google News RSS Adapter (FREE — no API key required)
 *
 * Searches Google News RSS for recent company news, press releases,
 * funding announcements, security incidents, and tech signals.
 * Google News RSS is free and requires no API key.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class GoogleNewsAdapter implements DataSourceAdapter {
  id = 'google_news' as const;

  async healthCheck(_config: DataSourceConfig) {
    try {
      const url = 'https://news.google.com/rss/search?q=test&hl=en-US&gl=US&ceid=US:en';
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      return { ok: res.ok || res.status === 405, message: 'Google News RSS available' };
    } catch {
      return { ok: false, message: 'Cannot reach Google News RSS' };
    }
  }

  async enrichCompany(companyName: string, domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    const timeout = config.settings?.timeout_ms || 8000;
    const maxResults = config.settings?.max_results || 10;

    // Run company news and tech/security-specific queries in parallel
    const queries = [
      `"${companyName}" company`,
      `"${companyName}" security infrastructure technology`,
    ];

    const allArticles: CompanyEnrichment['recent_news'] = [];
    const techSignalsFound: string[] = [];

    await Promise.allSettled(
      queries.map(async (query) => {
        const articles = await this.fetchNewsRss(query, timeout);
        allArticles.push(...articles);
      })
    );

    if (allArticles.length === 0) return {};

    // Deduplicate by URL
    const seen = new Set<string>();
    const uniqueArticles = allArticles.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    // Extract tech signals from news text
    const allText = uniqueArticles.map(a => `${a.title} ${a.snippet}`).join(' ').toLowerCase();
    const techPatterns: Record<string, string[]> = {
      'vpn': ['vpn', 'virtual private network'],
      'zero trust': ['zero trust', 'ztna', 'zero-trust'],
      'kubernetes': ['kubernetes', 'k8s'],
      'docker': ['docker', 'container'],
      'aws': ['aws', 'amazon web services'],
      'azure': ['azure', 'microsoft cloud'],
      'gcp': ['google cloud', 'gcp'],
      'okta': ['okta'],
      'cloudflare': ['cloudflare'],
      'zscaler': ['zscaler'],
      'tailscale': ['tailscale'],
      'terraform': ['terraform', 'infrastructure as code'],
      'datadog': ['datadog'],
      'sso': ['single sign-on', ' sso ', 'saml'],
    };

    for (const [signal, patterns] of Object.entries(techPatterns)) {
      if (patterns.some(p => allText.includes(p))) {
        techSignalsFound.push(signal);
      }
    }

    const result: Partial<CompanyEnrichment> = {
      recent_news: uniqueArticles.slice(0, maxResults),
    };

    if (techSignalsFound.length > 0) {
      result.tech_stack = techSignalsFound;
    }

    return result;
  }

  private async fetchNewsRss(query: string, timeout: number): Promise<NonNullable<CompanyEnrichment['recent_news']>> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SignalStack/1.0)',
          'Accept': 'application/rss+xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) return [];
      const xml = await res.text();
      return this.parseRssItems(xml);
    } catch {
      return [];
    }
  }

  private parseRssItems(xml: string): NonNullable<CompanyEnrichment['recent_news']> {
    const articles: NonNullable<CompanyEnrichment['recent_news']> = [];

    // Extract <item> blocks
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch;

    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      const item = itemMatch[1];

      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/) ||
                        item.match(/<guid>(https?:\/\/[^<]+)<\/guid>/);
      const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                        item.match(/<description>(.*?)<\/description>/);
      const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

      const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim();
      const url = linkMatch?.[1]?.trim();
      const rawDesc = descMatch?.[1] || '';
      const snippet = rawDesc.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim().substring(0, 200);
      const date = pubDateMatch?.[1]?.trim();

      if (title && url && url.startsWith('http')) {
        // Filter out Google's redirect URLs for the display URL
        const cleanUrl = url.includes('news.google.com') ? url : url;
        articles.push({ title, url: cleanUrl, snippet: snippet || title, date });
      }

      if (articles.length >= 15) break;
    }

    return articles;
  }
}
