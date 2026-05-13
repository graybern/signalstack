import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export class LinkedInAdapter implements DataSourceAdapter {
  id = 'linkedin' as const;

  async healthCheck(_config: DataSourceConfig): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch('https://www.linkedin.com/', {
        method: 'HEAD',
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.status < 400, message: res.status < 400 ? 'LinkedIn reachable' : `HTTP ${res.status}` };
    } catch {
      return { ok: false, message: 'LinkedIn unreachable' };
    }
  }

  async enrichCompany(
    companyName: string,
    _domain: string | null,
    config: DataSourceConfig
  ): Promise<Partial<CompanyEnrichment>> {
    const linkedinUrl = config.settings?.linkedin_url as string | undefined;
    if (!linkedinUrl) return {};

    const slug = linkedinUrl.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!slug) return {};

    try {
      const response = await fetch(`https://www.linkedin.com/company/${slug}/`, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.log(`[linkedin] HTTP ${response.status} for ${companyName} (${slug})`);
        return {};
      }

      const html = await response.text();
      const result: Partial<CompanyEnrichment> = {};

      const empCount = this.extractEmployeeCount(html);
      if (empCount) {
        result.employee_count = empCount;
        result.employee_count_source = 'linkedin';
        result.employee_count_type = 'total_headcount';
      }

      if (!result.linkedin_url) {
        result.linkedin_url = `https://www.linkedin.com/company/${slug}`;
      }

      return result;
    } catch (err) {
      console.log(`[linkedin] Fetch failed for ${companyName}: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  }

  private extractEmployeeCount(html: string): number | null {
    // JSON-LD structured data: "numberOfEmployees":{"value":1474,"@type":"QuantitativeValue"}
    const jsonLd = html.match(/"numberOfEmployees"\s*:\s*\{\s*"value"\s*:\s*(\d+)/);
    if (jsonLd) {
      return parseInt(jsonLd[1], 10);
    }

    // "Discover all X,XXX employees" or "View all X,XXX employees"
    const discoverAll = html.match(/(?:Discover|View)\s+all\s+([\d,]+)\s+employees/i);
    if (discoverAll) {
      return parseInt(discoverAll[1].replace(/,/g, ''), 10);
    }

    // "X,XXX employees on LinkedIn"
    const onLinkedin = html.match(/([\d,]+)\s+employees\s+on\s+LinkedIn/i);
    if (onLinkedin) {
      return parseInt(onLinkedin[1].replace(/,/g, ''), 10);
    }

    return null;
  }
}
