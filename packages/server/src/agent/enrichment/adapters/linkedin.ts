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

      const hq = this.extractHeadquarters(html);
      if (hq) result.hq_location = hq;

      const founded = this.extractFoundedYear(html);
      if (founded) result.founded_year = founded;

      const industry = this.extractIndustry(html);
      if (industry) result.industry = industry;

      const pageName = this.extractCompanyName(html);
      if (pageName) {
        result.linkedin_page_name = pageName;
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

  private extractHeadquarters(html: string): string | null {
    const testId = html.match(/data-test-id="about-us__headquarters"[^]*?<dd[^>]*>\s*([^<]+?)\s*<\/dd>\s*<\/div>/);
    if (testId) return testId[1].trim();

    const jsonLd = html.match(/"address"\s*:\s*\{[^}]*"addressLocality"\s*:\s*"([^"]+)"[^}]*"addressRegion"\s*:\s*"([^"]+)"/);
    if (jsonLd) return `${jsonLd[1]}, ${jsonLd[2]}`;
    const jsonLdAlt = html.match(/"addressLocality"\s*:\s*"([^"]+)"[^}]*"addressRegion"\s*:\s*"([^"]+)"/);
    if (jsonLdAlt) return `${jsonLdAlt[1]}, ${jsonLdAlt[2]}`;

    // Embedded data: "headquarters":"City, State" or "headquarter":"..."
    const hqField = html.match(/"headquarter(?:s)?"\s*:\s*"([^"]+)"/);
    if (hqField) return hqField[1];

    // "Located in City, State" pattern
    const located = html.match(/Located\s+in\s+([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})/);
    if (located) return located[1];

    return null;
  }

  private extractFoundedYear(html: string): number | null {
    const testId = html.match(/data-test-id="about-us__foundedOn"[^]*?<dd[^>]*>\s*(\d{4})\s*<\/dd>\s*<\/div>/);
    if (testId) return parseInt(testId[1], 10);

    const jsonLdObj = html.match(/"foundingDate"\s*:\s*\{\s*"year"\s*:\s*(\d{4})/);
    if (jsonLdObj) return parseInt(jsonLdObj[1], 10);
    const jsonLdStr = html.match(/"foundingDate"\s*:\s*"(\d{4})(?:-|\b)/);
    if (jsonLdStr) return parseInt(jsonLdStr[1], 10);

    // Embedded data: "foundedOn":{"year":2019}
    const foundedOn = html.match(/"foundedOn"\s*:\s*\{\s*"year"\s*:\s*(\d{4})/);
    if (foundedOn) return parseInt(foundedOn[1], 10);

    // Text pattern: "Founded 2019" or "Founded in 2019"
    const text = html.match(/Founded\s+(?:in\s+)?(\d{4})/i);
    if (text) {
      const year = parseInt(text[1], 10);
      if (year >= 1800 && year <= new Date().getFullYear()) return year;
    }

    return null;
  }

  private extractIndustry(html: string): string | null {
    const testId = html.match(/data-test-id="about-us__industry"[^]*?<dd[^>]*>\s*([^<]+?)\s*<\/dd>\s*<\/div>/);
    if (testId) return testId[1].trim();

    const jsonLd = html.match(/"industry"\s*:\s*"([^"]+)"/);
    if (jsonLd) return jsonLd[1];

    // Embedded data: "localizedIndustry":"Information Technology & Services"
    const localized = html.match(/"localizedIndustry"\s*:\s*"([^"]+)"/);
    if (localized) return localized[1];

    // "companyIndustries":["Computer Software"]
    const arr = html.match(/"companyIndustries"\s*:\s*\["([^"]+)"/);
    if (arr) return arr[1];

    return null;
  }

  private extractCompanyName(html: string): string | null {
    const jsonLd = html.match(/"@type"\s*:\s*"Organization"[^}]*"name"\s*:\s*"([^"]+)"/);
    if (jsonLd) return jsonLd[1];
    const jsonLd2 = html.match(/"name"\s*:\s*"([^"]+)"[^}]*"@type"\s*:\s*"Organization"/);
    if (jsonLd2) return jsonLd2[1];

    const localized = html.match(/"localizedName"\s*:\s*"([^"]+)"/);
    if (localized) return localized[1];

    const titleTag = html.match(/<title[^>]*>([^<|]+?)(?:\s*[|]\s*LinkedIn)?<\/title>/i);
    if (titleTag) {
      const name = titleTag[1].trim();
      if (name.length > 0 && name.length < 100) return name;
    }

    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
    if (ogTitle) {
      const name = ogTitle[1].replace(/\s*[|:]\s*LinkedIn.*$/i, '').trim();
      if (name.length > 0 && name.length < 100) return name;
    }

    return null;
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
