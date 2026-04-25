/**
 * DNS & Tech Fingerprint Adapter (FREE — no API key required)
 *
 * Analyzes DNS records (MX, TXT, SPF) and HTTP headers to detect
 * email providers, SaaS tools, and infrastructure choices.
 */

import dns from 'dns';
import { promisify } from 'util';
import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

const resolveMx = promisify(dns.resolveMx);
const resolveTxt = promisify(dns.resolveTxt);

export class DnsFingerprintAdapter implements DataSourceAdapter {
  id = 'dns_fingerprint' as const;

  async healthCheck(_config: DataSourceConfig) {
    try {
      await resolveMx('google.com');
      return { ok: true, message: 'DNS resolution available' };
    } catch {
      return { ok: false, message: 'DNS resolution failed' };
    }
  }

  async enrichCompany(_companyName: string, domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    if (!domain) return {};
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const result: Partial<CompanyEnrichment> = {};
    const servicesDetected: string[] = [];
    const techStack: string[] = [];
    const timeout = config.settings?.timeout_ms || 3000;

    if (config.settings?.check_mx !== false) {
      try {
        const mxRecords = await Promise.race([
          resolveMx(cleanDomain),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
        ]);
        const emailProvider = this.detectEmailProvider(mxRecords);
        if (emailProvider) { result.dns_email_provider = emailProvider; servicesDetected.push(emailProvider); }
      } catch { /* MX lookup failed */ }
    }

    if (config.settings?.check_txt !== false) {
      try {
        const txtRecords = await Promise.race([
          resolveTxt(cleanDomain),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
        ]);
        servicesDetected.push(...this.analyzeTxtRecords(txtRecords));
      } catch { /* TXT lookup failed */ }
    }

    if (config.settings?.check_http_headers !== false) {
      try {
        const res = await fetch(`https://${cleanDomain}`, {
          method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeout),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SignalStack/1.0)' },
        });
        const httpTech = this.analyzeHeaders(res.headers);
        if (httpTech.length > 0) { result.http_tech_stack = httpTech; techStack.push(...httpTech); }
      } catch { /* HTTP check failed */ }
    }

    if (servicesDetected.length > 0) result.dns_services_detected = [...new Set(servicesDetected)];
    if (techStack.length > 0) result.tech_stack = techStack;
    return result;
  }

  private detectEmailProvider(mxRecords: dns.MxRecord[]): string | null {
    const mxHosts = mxRecords.map(r => r.exchange.toLowerCase());
    const providers: Record<string, string[]> = {
      'Google Workspace': ['google.com', 'googlemail.com', 'aspmx.l.google.com'],
      'Microsoft 365': ['outlook.com', 'microsoft.com', 'protection.outlook.com'],
      'Zoho Mail': ['zoho.com', 'zoho.eu'],
      'ProtonMail': ['protonmail.ch', 'proton.me'],
      'Mimecast': ['mimecast.com'],
    };
    for (const [provider, domains] of Object.entries(providers)) {
      if (mxHosts.some(mx => domains.some(d => mx.includes(d)))) return provider;
    }
    return null;
  }

  private analyzeTxtRecords(txtRecords: string[][]): string[] {
    const detected: string[] = [];
    const allTxt = txtRecords.map(r => r.join(' ')).join(' ').toLowerCase();
    const patterns: Record<string, string[]> = {
      'Salesforce': ['salesforce', 'pardot'], 'HubSpot': ['hubspot'], 'SendGrid': ['sendgrid'],
      'Mailchimp': ['mailchimp', 'mandrillapp'], 'Zendesk': ['zendesk'], 'Atlassian': ['atlassian'],
      'Docusign': ['docusign'], 'Google': ['google-site-verification'], 'Amazon SES': ['amazonses'],
      'Stripe': ['stripe-verification'],
    };
    for (const [service, pats] of Object.entries(patterns)) {
      if (pats.some(p => allTxt.includes(p))) detected.push(service);
    }
    return detected;
  }

  private analyzeHeaders(headers: Headers): string[] {
    const tech: string[] = [];
    const server = headers.get('server')?.toLowerCase() || '';
    const poweredBy = headers.get('x-powered-by')?.toLowerCase() || '';
    if (headers.get('cf-ray') || server.includes('cloudflare')) tech.push('Cloudflare');
    if (server.includes('nginx')) tech.push('Nginx');
    if (server.includes('apache')) tech.push('Apache');
    if (server.includes('amazons3') || server.includes('cloudfront')) tech.push('AWS');
    if (server.includes('gws') || server.includes('gfe')) tech.push('Google Cloud');
    if (poweredBy.includes('express')) tech.push('Express.js');
    if (poweredBy.includes('next')) tech.push('Next.js');
    if (headers.get('x-vercel-id')) tech.push('Vercel');
    if (headers.get('x-netlify-request-id')) tech.push('Netlify');
    return tech;
  }
}
