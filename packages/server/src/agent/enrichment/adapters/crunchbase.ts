/**
 * Crunchbase Adapter
 *
 * Uses the Crunchbase Basic API to enrich company data with funding,
 * investors, employee counts, and organizational details.
 *
 * API docs: https://data.crunchbase.com/docs
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class CrunchbaseAdapter implements DataSourceAdapter {
  id = 'crunchbase' as const;

  async healthCheck(config: DataSourceConfig): Promise<{ ok: boolean; message: string }> {
    if (!config.api_key) {
      return { ok: false, message: 'Crunchbase API key not configured. Get one at https://data.crunchbase.com/' };
    }

    try {
      const response = await fetch(
        `https://api.crunchbase.com/api/v4/autocompletes?query=test&collection_ids=organizations&limit=1&user_key=${config.api_key}`
      );
      if (response.ok) return { ok: true, message: 'Crunchbase API connected' };
      if (response.status === 401) return { ok: false, message: 'Invalid API key' };
      return { ok: false, message: `API error: ${response.status}` };
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

    try {
      // Search for the organization
      const searchQuery = domain || companyName;
      const searchResponse = await fetch(
        `https://api.crunchbase.com/api/v4/autocompletes?query=${encodeURIComponent(searchQuery)}&collection_ids=organizations&limit=3&user_key=${config.api_key}`
      );

      if (!searchResponse.ok) {
        console.error(`[crunchbase] Search failed for "${companyName}": ${searchResponse.status}`);
        return {};
      }

      const searchData = await searchResponse.json();
      const entities = searchData.entities || [];
      if (entities.length === 0) return {};

      // Find best match
      const match = this.findBestMatch(entities, companyName, domain);
      if (!match) return {};

      const permalink = match.identifier?.permalink;
      if (!permalink) return {};

      // Fetch full organization data
      const orgResponse = await fetch(
        `https://api.crunchbase.com/api/v4/entities/organizations/${permalink}?card_ids=fields,funding_rounds,investors&user_key=${config.api_key}`
      );

      if (!orgResponse.ok) {
        console.error(`[crunchbase] Org fetch failed for "${permalink}": ${orgResponse.status}`);
        return {};
      }

      const orgData = await orgResponse.json();
      return this.parseOrgData(orgData, config);
    } catch (err) {
      console.error(`[crunchbase] Error enriching ${companyName}:`, err);
      return {};
    }
  }

  private findBestMatch(entities: any[], companyName: string, domain: string | null): any {
    const nameLower = companyName.toLowerCase();

    // Prefer domain match
    if (domain) {
      const domainMatch = entities.find((e: any) => {
        const entityDomain = e.identifier?.value?.toLowerCase() || '';
        const entityPermalink = e.identifier?.permalink?.toLowerCase() || '';
        return entityDomain.includes(domain.replace('.com', '').replace('.io', '')) ||
               entityPermalink.includes(domain.replace('.com', '').replace('.io', ''));
      });
      if (domainMatch) return domainMatch;
    }

    // Fall back to name match
    const nameMatch = entities.find((e: any) =>
      (e.identifier?.value || '').toLowerCase().includes(nameLower) ||
      nameLower.includes((e.identifier?.value || '').toLowerCase())
    );

    return nameMatch || entities[0];
  }

  private parseOrgData(orgData: any, config: DataSourceConfig): Partial<CompanyEnrichment> {
    const result: Partial<CompanyEnrichment> = {};
    const fields = orgData.properties || {};
    const cards = orgData.cards || {};

    // Basic info
    if (fields.num_employees_enum) {
      result.employee_count = this.parseEmployeeEnum(fields.num_employees_enum);
      result.employee_count_source = 'crunchbase';
    }

    if (fields.founded_on) {
      result.founded_year = parseInt(fields.founded_on.substring(0, 4));
    }

    if (fields.location_identifiers?.length) {
      const loc = fields.location_identifiers[0];
      result.hq_location = loc.value || null;
    }

    if (fields.short_description) {
      result.description = fields.short_description;
    }

    if (fields.website_url) {
      result.website = fields.website_url;
    }

    if (fields.linkedin) {
      result.linkedin_url = fields.linkedin;
    }

    if (fields.category_groups?.length) {
      result.industry = fields.category_groups.map((c: any) => c.value).join(', ');
    }

    if (fields.categories?.length) {
      result.keywords = fields.categories.map((c: any) => c.value);
    }

    // Funding data
    if (config.settings?.include_funding_rounds && cards.funding_rounds?.length) {
      const rounds = cards.funding_rounds;
      const latestRound = rounds[0];

      if (latestRound) {
        result.funding_stage = latestRound.properties?.investment_type || null;
        if (latestRound.properties?.money_raised) {
          result.last_funding_amount = `$${(latestRound.properties.money_raised.value / 1_000_000).toFixed(1)}M`;
        }
        result.last_funding_date = latestRound.properties?.announced_on || null;
      }

      // Total funding
      const totalFunding = rounds.reduce((sum: number, r: any) =>
        sum + (r.properties?.money_raised?.value || 0), 0);
      if (totalFunding > 0) {
        result.total_funding = `$${(totalFunding / 1_000_000).toFixed(1)}M`;
      }
    }

    // Investors
    if (config.settings?.include_investors && cards.investors?.length) {
      result.investors = cards.investors
        .slice(0, 10)
        .map((i: any) => i.identifier?.value || '')
        .filter(Boolean);
    }

    return result;
  }

  private parseEmployeeEnum(enumStr: string): number {
    const ranges: Record<string, number> = {
      'c_00001_00010': 5,
      'c_00011_00050': 30,
      'c_00051_00100': 75,
      'c_00101_00250': 175,
      'c_00251_00500': 375,
      'c_00501_01000': 750,
      'c_01001_05000': 3000,
      'c_05001_10000': 7500,
      'c_10001_plus': 15000,
    };
    return ranges[enumStr] || 0;
  }
}
