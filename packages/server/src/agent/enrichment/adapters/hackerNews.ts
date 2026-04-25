/**
 * Hacker News Adapter (FREE — no API key required)
 *
 * Uses the HN Algolia Search API to find company mentions on Hacker News.
 * Particularly valuable for dev-forward companies — surfaces tech discussions,
 * "Who's Hiring" signals, infrastructure commentary, and founder activity.
 *
 * API: https://hn.algolia.com/api/v1/search
 * Rate limit: ~180 req/min, no auth required.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class HackerNewsAdapter implements DataSourceAdapter {
  id = 'hacker_news' as const;

  async healthCheck(_config: DataSourceConfig) {
    try {
      const res = await fetch('https://hn.algolia.com/api/v1/search?query=test&hitsPerPage=1', {
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok, message: res.ok ? 'HN Algolia API available' : 'HN API unreachable' };
    } catch {
      return { ok: false, message: 'Cannot reach HN Algolia API' };
    }
  }

  async enrichCompany(companyName: string, domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    const timeout = config.settings?.timeout_ms || 6000;
    const maxResults = config.settings?.max_results || 8;

    const results = await this.searchHN(companyName, domain, timeout);
    if (results.length === 0) return {};

    const recentNews: NonNullable<CompanyEnrichment['recent_news']> = [];
    const techSignalsFound: string[] = [];
    const hiringSignals: NonNullable<CompanyEnrichment['hiring_signals']> = [];

    const allText = results.map(r => `${r.title} ${r.url || ''}`).join(' ').toLowerCase();

    // Tech signals from HN discussions
    const techPatterns: Record<string, string[]> = {
      'kubernetes': ['kubernetes', 'k8s'],
      'docker': ['docker', 'container'],
      'aws': ['aws ', 'amazon web services'],
      'gcp': ['google cloud', ' gcp '],
      'azure': ['azure'],
      'terraform': ['terraform'],
      'vpn': [' vpn ', 'wireguard', 'openvpn'],
      'zero trust': ['zero trust', 'ztna'],
      'rust': ['rust lang', 'written in rust', 'rewrite in rust'],
      'go': ['golang', ' go lang'],
      'microservices': ['microservices', 'service mesh'],
      'open source': ['open source', 'open-source', 'oss'],
      'datadog': ['datadog'],
      'okta': ['okta'],
    };

    for (const [signal, patterns] of Object.entries(techPatterns)) {
      if (patterns.some(p => allText.includes(p))) {
        techSignalsFound.push(signal);
      }
    }

    // Check for hiring signals
    const hiringPosts = results.filter(r =>
      r.title.toLowerCase().includes('hiring') ||
      r.title.toLowerCase().includes('who is hiring') ||
      r.title.toLowerCase().includes('we\'re hiring') ||
      r.url?.includes('jobs.') ||
      r.url?.includes('/careers')
    );

    if (hiringPosts.length > 0) {
      hiringSignals.push({
        role: 'various',
        keywords: ['hacker news hiring post'],
        department: 'Engineering',
      });
    }

    for (const item of results.slice(0, maxResults)) {
      recentNews.push({
        title: `[HN] ${item.title}`,
        url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
        snippet: item.story_text
          ? item.story_text.replace(/<[^>]+>/g, '').substring(0, 200)
          : `${item.points || 0} points, ${item.num_comments || 0} comments`,
        date: item.created_at,
      });
    }

    const result: Partial<CompanyEnrichment> = {};
    if (recentNews.length > 0) result.recent_news = recentNews;
    if (techSignalsFound.length > 0) result.tech_stack = techSignalsFound;
    if (hiringSignals.length > 0) result.hiring_signals = hiringSignals;

    return result;
  }

  private async searchHN(
    companyName: string,
    domain: string | null,
    timeout: number
  ): Promise<HNHit[]> {
    try {
      const query = encodeURIComponent(companyName);
      // Search stories (not comments) about the company, sorted by relevance
      const url = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=15`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return [];
      const data = await res.json() as { hits: HNHit[] };

      // Filter to hits that actually mention the company or domain
      const lowerName = companyName.toLowerCase();
      const lowerDomain = domain?.toLowerCase().replace(/^https?:\/\//, '') || '';

      return (data.hits || []).filter(hit => {
        const titleLower = hit.title.toLowerCase();
        const urlLower = (hit.url || '').toLowerCase();
        return (
          titleLower.includes(lowerName) ||
          (lowerDomain && urlLower.includes(lowerDomain))
        );
      });
    } catch {
      return [];
    }
  }
}

interface HNHit {
  objectID: string;
  title: string;
  url?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  story_text?: string;
}
