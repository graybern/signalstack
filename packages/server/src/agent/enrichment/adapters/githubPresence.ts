/**
 * GitHub Presence Adapter (FREE — optional API token for higher rate limits)
 *
 * Searches GitHub for company repositories, open-source projects, and tech stack indicators.
 * 60 req/hr unauthenticated, 5000 with optional token.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class GitHubPresenceAdapter implements DataSourceAdapter {
  id = 'github_presence' as const;

  async healthCheck(config: DataSourceConfig) {
    try {
      const headers = this.getHeaders(config);
      const res = await fetch('https://api.github.com/rate_limit', { headers, signal: AbortSignal.timeout(5000) });
      const data = await res.json() as any;
      const remaining = data?.rate?.remaining ?? 0;
      return { ok: true, message: `GitHub API available. Rate limit remaining: ${remaining}` };
    } catch (err) {
      return { ok: false, message: `GitHub API unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async enrichCompany(companyName: string, domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    const headers = this.getHeaders(config);
    const orgName = this.guessOrgName(companyName, domain);
    let repos = await this.fetchOrgRepos(orgName, headers, config);
    if (repos.length === 0) repos = await this.searchRepos(companyName, headers, config);
    if (repos.length === 0) return {};

    const result: Partial<CompanyEnrichment> = {};
    result.github_repos = repos.slice(0, config.settings?.max_repos || 10).map((r: any) => ({
      name: r.name || r.full_name || '',
      stars: r.stargazers_count || 0,
      language: r.language || 'unknown',
      description: (r.description || '').substring(0, 200),
    }));

    const totalStars = repos.reduce((sum: number, r: any) => sum + (r.stargazers_count || 0), 0);
    result.open_source_presence = totalStars > 1000 || repos.length > 20 ? 'strong'
      : totalStars > 100 || repos.length > 5 ? 'moderate' : 'none';

    const techStack: string[] = [];
    const selfHostedSignals = ['self-hosted', 'on-prem', 'helm', 'docker-compose', 'kubernetes', 'k8s', 'terraform', 'ansible'];
    for (const repo of repos) {
      const text = `${repo.name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`.toLowerCase();
      if (selfHostedSignals.some(s => text.includes(s))) techStack.push(`self-hosted: ${repo.name}`);
      for (const topic of (repo.topics || [])) {
        if (!techStack.includes(topic)) techStack.push(topic);
      }
    }
    if (techStack.length > 0) result.tech_stack = techStack.slice(0, 20);
    return result;
  }

  private getHeaders(config: DataSourceConfig): Record<string, string> {
    const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'SignalStack/1.0' };
    if (config.api_key) headers['Authorization'] = `Bearer ${config.api_key}`;
    return headers;
  }

  private guessOrgName(companyName: string, domain: string | null): string {
    if (domain) {
      const parts = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('.');
      if (parts.length >= 2) return parts[0];
    }
    return companyName.toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  private async fetchOrgRepos(orgName: string, headers: Record<string, string>, config: DataSourceConfig): Promise<any[]> {
    try {
      const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(orgName)}/repos?sort=stars&per_page=${config.settings?.max_repos || 10}`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      return await res.json() as any[];
    } catch { return []; }
  }

  private async searchRepos(companyName: string, headers: Record<string, string>, config: DataSourceConfig): Promise<any[]> {
    try {
      const query = encodeURIComponent(`org:${companyName.toLowerCase().replace(/\s+/g, '-')}`);
      const res = await fetch(`https://api.github.com/search/repositories?q=${query}&sort=stars&per_page=${config.settings?.max_repos || 10}`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return data.items || [];
    } catch { return []; }
  }
}
