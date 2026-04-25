/**
 * Web Search Adapter
 *
 * Uses Brave Search API for real-time web search results.
 * Falls back to constructing search-informed context for the Claude agent.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class WebSearchAdapter implements DataSourceAdapter {
  id = 'web_search' as const;

  async healthCheck(config: DataSourceConfig): Promise<{ ok: boolean; message: string }> {
    if (!config.api_key) {
      return { ok: false, message: 'Brave Search API key not configured. Get one at https://api.search.brave.com/' };
    }

    try {
      const response = await fetch('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
        headers: { 'X-Subscription-Token': config.api_key },
      });
      if (response.ok) return { ok: true, message: 'Brave Search API connected' };
      const text = await response.text();
      return { ok: false, message: `API error: ${response.status} - ${text.substring(0, 200)}` };
    } catch (err) {
      return { ok: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async enrichCompany(
    companyName: string,
    domain: string | null,
    config: DataSourceConfig
  ): Promise<Partial<CompanyEnrichment>> {
    if (!config.api_key) return {};

    const result: Partial<CompanyEnrichment> = {};
    const maxResults = config.settings?.max_results_per_query || 10;
    const searchTypes = config.settings?.search_types || ['company_news', 'funding', 'job_postings'];

    try {
      // Company news search
      if (searchTypes.includes('company_news')) {
        const news = await this.search(`"${companyName}" company news 2025 2026`, config.api_key, maxResults);
        result.recent_news = news.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
          date: r.age || undefined,
        }));
      }

      // Job postings search
      if (searchTypes.includes('job_postings')) {
        const searchDomain = domain ? `site:${domain}` : `"${companyName}"`;
        const jobs = await this.search(`${searchDomain} careers jobs VPN security infrastructure engineer`, config.api_key, 5);
        result.job_postings = jobs.map(r => ({
          title: r.title,
          url: r.url,
          keywords: this.extractKeywords(r.description),
        }));
      }

      // Funding search
      if (searchTypes.includes('funding')) {
        const funding = await this.search(`"${companyName}" funding round raised series`, config.api_key, 3);
        // Parse funding info from snippets
        for (const item of funding) {
          const fundingMatch = item.description.match(/\$[\d.]+[MBK]\s*(series\s*[A-Z])?/i);
          if (fundingMatch && !result.last_funding_amount) {
            result.last_funding_amount = fundingMatch[0];
          }
        }
      }

      // Tech stack search
      if (searchTypes.includes('tech_stack')) {
        const techDomain = domain || companyName;
        const tech = await this.search(`"${techDomain}" technology stack infrastructure kubernetes docker vpn`, config.api_key, 5);
        const techKeywords = new Set<string>();
        for (const item of tech) {
          for (const kw of this.extractKeywords(item.description)) {
            techKeywords.add(kw);
          }
        }
        if (techKeywords.size > 0) {
          result.tech_stack = Array.from(techKeywords).slice(0, 15);
        }
      }
    } catch (err) {
      console.error(`[webSearch] Error enriching ${companyName}:`, err);
    }

    return result;
  }

  private async search(query: string, apiKey: string, count: number): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, count: String(count) });
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
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

  private extractKeywords(text: string): string[] {
    const techTerms = [
      'kubernetes', 'k8s', 'docker', 'aws', 'azure', 'gcp', 'terraform',
      'vpn', 'ztna', 'zero trust', 'sso', 'okta', 'cloudflare', 'zscaler',
      'tailscale', 'wireguard', 'iam', 'siem', 'soar', 'pam', 'mfa',
      'ci/cd', 'jenkins', 'github actions', 'datadog', 'splunk', 'elastic',
      'remote access', 'private network', 'sd-wan', 'sase',
    ];

    const lower = text.toLowerCase();
    return techTerms.filter(term => lower.includes(term));
  }
}

interface SearchResult {
  title: string;
  url: string;
  description: string;
  age: string | null;
}
