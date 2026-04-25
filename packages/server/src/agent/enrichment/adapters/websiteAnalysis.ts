/**
 * Company Website Analysis Adapter (FREE — no API key required)
 *
 * Fetches company websites and extracts deployment model evidence,
 * product keywords, pricing signals, and tech indicators.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class WebsiteAnalysisAdapter implements DataSourceAdapter {
  id = 'website_analysis' as const;

  async healthCheck(_config: DataSourceConfig) {
    try {
      const res = await fetch('https://www.google.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      return { ok: res.ok, message: res.ok ? 'Website fetching available' : 'HTTP request failed' };
    } catch {
      return { ok: false, message: 'Cannot make outbound HTTP requests' };
    }
  }

  async enrichCompany(companyName: string, domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    if (!domain) return {};

    const timeout = config.settings?.timeout_ms || 5000;
    const maxPages = config.settings?.max_pages || 5;
    const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;

    const deploymentModels: string[] = [];
    const productKeywords: string[] = [];
    const pricingTiers: string[] = [];
    const allText: string[] = [];

    try {
      const html = await this.fetchPage(baseUrl, timeout);
      if (html) {
        allText.push(html);
        const subpages = this.extractSubpageLinks(html, baseUrl, config.settings?.look_for || [
          'pricing', 'products', 'about', 'docs', 'self-hosted', 'on-premise', 'enterprise', 'deployment',
        ]);
        let fetched = 0;
        for (const url of subpages) {
          if (fetched >= maxPages - 1) break;
          await new Promise(r => setTimeout(r, 200));
          const subHtml = await this.fetchPage(url, timeout);
          if (subHtml) { allText.push(subHtml); fetched++; }
        }
      }
    } catch {
      return {};
    }

    if (allText.length === 0) return {};
    const combinedText = allText.join(' ').toLowerCase();

    const deploymentPatterns: Record<string, string[]> = {
      'Self-hosted deployment': ['self-hosted', 'self hosted', 'on-premises', 'on-prem', 'on premise'],
      'Cloud deployment': ['cloud-hosted', 'fully managed', 'cloud deployment'],
      'Hybrid deployment': ['hybrid deployment', 'hybrid cloud', 'multi-cloud'],
      'Air-gapped / private cloud': ['air-gapped', 'air gapped', 'private cloud', 'private deployment'],
      'Customer environment deployment': ['customer environment', 'customer vpc', 'customer infrastructure', 'deploy into', 'byoc', 'bring your own'],
      'VPC / PrivateLink': ['privatelink', 'private link', 'vpc peering', 'network peering'],
    };
    for (const [model, patterns] of Object.entries(deploymentPatterns)) {
      if (patterns.some(p => combinedText.includes(p))) deploymentModels.push(model);
    }

    const techKeywords = [
      'kubernetes', 'k8s', 'docker', 'terraform', 'helm', 'aws', 'azure', 'gcp',
      'zero trust', 'ztna', 'vpn', 'sso', 'saml', 'oauth', 'ldap', 'active directory',
      'api gateway', 'microservices', 'serverless', 'edge computing',
      'soc 2', 'hipaa', 'pci dss', 'gdpr', 'fedramp', 'iso 27001',
      'data residency', 'data sovereignty', 'encryption at rest', 'encryption in transit',
      'agent-based', 'agentless', 'connector', 'scanner', 'collector',
      'real-time', 'low latency', 'high throughput', 'streaming',
    ];
    for (const kw of techKeywords) {
      if (combinedText.includes(kw)) productKeywords.push(kw);
    }

    const pricingPatterns: Record<string, string[]> = {
      'Free tier available': ['free tier', 'free plan', 'free forever', 'open source'],
      'Enterprise plan': ['enterprise', 'enterprise plan', 'contact sales', 'custom pricing'],
      'Self-hosted pricing': ['self-hosted pricing', 'on-prem license'],
      'Usage-based pricing': ['pay as you go', 'usage-based', 'per seat', 'per user'],
    };
    for (const [tier, patterns] of Object.entries(pricingPatterns)) {
      if (patterns.some(p => combinedText.includes(p))) pricingTiers.push(tier);
    }

    const result: Partial<CompanyEnrichment> = { website: baseUrl };
    const metaDesc = allText[0]?.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i);
    if (metaDesc) result.description = metaDesc[1].substring(0, 300);
    if (deploymentModels.length > 0) result.deployment_models = deploymentModels;
    if (productKeywords.length > 0) result.product_keywords = [...new Set(productKeywords)];
    if (pricingTiers.length > 0) result.pricing_tiers = pricingTiers;

    return result;
  }

  private async fetchPage(url: string, timeout: number): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SignalStack/1.0; +https://signalstack.app)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  private extractSubpageLinks(html: string, baseUrl: string, lookFor: string[]): string[] {
    const links: string[] = [];
    const hrefRegex = /href=["']([^"'#]+)["']/gi;
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
      const href = match[1];
      for (const term of lookFor) {
        if (href.toLowerCase().includes(term.toLowerCase())) {
          try {
            const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
            if (!links.includes(fullUrl)) links.push(fullUrl);
          } catch { /* invalid URL */ }
          break;
        }
      }
    }
    return links.slice(0, 10);
  }
}
