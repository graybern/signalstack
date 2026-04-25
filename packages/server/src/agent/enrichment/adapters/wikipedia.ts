/**
 * Wikipedia / Wikidata Adapter (FREE — no API key required)
 *
 * Retrieves company information from Wikipedia and Wikidata —
 * employee counts, founding year, HQ location, and industry classification.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

const UA = 'SignalStack/1.0 (prospect-intelligence-tool)';

export class WikipediaAdapter implements DataSourceAdapter {
  id = 'wikipedia' as const;

  async healthCheck(_config: DataSourceConfig) {
    try {
      const res = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/Google', {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok, message: res.ok ? 'Wikipedia API available' : 'Wikipedia API error' };
    } catch {
      return { ok: false, message: 'Wikipedia API unreachable' };
    }
  }

  async enrichCompany(companyName: string, _domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    const result: Partial<CompanyEnrichment> = {};

    const summary = await this.fetchWikipediaSummary(companyName);
    if (summary) {
      result.wikipedia_summary = summary.substring(0, 500);
      result.description = summary.substring(0, 300);
    }

    if (config.settings?.include_wikidata !== false) {
      const wd = await this.fetchWikidataInfo(companyName);
      if (wd) {
        if (wd.employee_count) result.employee_count = wd.employee_count;
        if (wd.founded_year) result.founded_year = wd.founded_year;
      }
    }

    return result;
  }

  private async fetchWikipediaSummary(companyName: string): Promise<string | null> {
    for (const term of [companyName, `${companyName} (company)`, `${companyName} (software)`]) {
      try {
        const encoded = encodeURIComponent(term.replace(/ /g, '_'));
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`, {
          headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json() as any;
          if (data.type === 'standard' && data.extract) return data.extract;
        }
      } catch { /* continue */ }
    }

    // Fallback: search
    try {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(companyName + ' company')}&format=json&srlimit=3`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json() as any;
        const results = data?.query?.search || [];
        if (results.length > 0) {
          const title = encodeURIComponent(results[0].title.replace(/ /g, '_'));
          const sRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, {
            headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000),
          });
          if (sRes.ok) {
            const sd = await sRes.json() as any;
            if (sd.extract) return sd.extract;
          }
        }
      }
    } catch { /* search failed */ }
    return null;
  }

  private async fetchWikidataInfo(companyName: string): Promise<{ employee_count?: number; founded_year?: number } | null> {
    try {
      const sRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(companyName)}&language=en&format=json&limit=3&type=item`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) }
      );
      if (!sRes.ok) return null;
      const sd = await sRes.json() as any;
      const entities = sd?.search || [];
      const entity = entities.find((e: any) =>
        e.description?.toLowerCase().includes('company') ||
        e.description?.toLowerCase().includes('software') ||
        e.description?.toLowerCase().includes('corporation')
      ) || entities[0];
      if (!entity) return null;

      const dRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=claims&format=json`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) }
      );
      if (!dRes.ok) return null;
      const dd = await dRes.json() as any;
      const claims = dd?.entities?.[entity.id]?.claims || {};
      const result: any = {};

      const emp = claims['P1128']?.[0]?.mainsnak?.datavalue?.value?.amount;
      if (emp) result.employee_count = parseInt(emp.replace('+', ''));

      const inc = claims['P571']?.[0]?.mainsnak?.datavalue?.value?.time;
      if (inc) { const m = inc.match(/\+(\d{4})/); if (m) result.founded_year = parseInt(m[1]); }

      return Object.keys(result).length > 0 ? result : null;
    } catch { return null; }
  }
}
