/**
 * Apollo.io Adapter
 *
 * Company enrichment + people database.
 * Best all-in-one source for both company data and decision-maker contacts.
 *
 * API docs: https://apolloio.github.io/apollo-api-docs/
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class ApolloAdapter implements DataSourceAdapter {
  id = 'apollo' as const;
  private baseUrl = 'https://api.apollo.io/v1';

  async healthCheck(config: DataSourceConfig): Promise<{ ok: boolean; message: string }> {
    if (!config.api_key) {
      return { ok: false, message: 'Apollo.io API key not configured. Get one at https://app.apollo.io/#/settings/integrations/api' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/auth/health`, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': config.api_key,
        },
      });
      if (response.ok) return { ok: true, message: 'Apollo.io API connected' };
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
    const result: Partial<CompanyEnrichment> = {};

    try {
      // Enrich company data
      if (config.settings?.enrich_companies !== false) {
        const companyData = await this.enrichOrganization(companyName, domain, config.api_key);
        if (companyData) {
          Object.assign(result, companyData);
        }
      }

      // Find people at the company
      if (config.settings?.find_people !== false && domain) {
        const people = await this.findPeople(
          domain,
          config.api_key,
          config.settings?.max_people_per_company || 5,
          config.settings?.target_titles || []
        );
        if (people.length > 0) {
          result.key_people = people;
        }
      }
    } catch (err) {
      console.error(`[apollo] Error enriching ${companyName}:`, err);
    }

    return result;
  }

  private async enrichOrganization(
    companyName: string,
    domain: string | null,
    apiKey: string
  ): Promise<Partial<CompanyEnrichment> | null> {
    const body: any = {};
    if (domain) {
      body.domain = domain;
    } else {
      body.name = companyName;
    }

    const response = await fetch(`${this.baseUrl}/organizations/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const org = data.organization;
    if (!org) return null;

    const result: Partial<CompanyEnrichment> = {};

    if (org.estimated_num_employees) {
      result.employee_count = org.estimated_num_employees;
      result.employee_count_source = 'apollo';
    }

    if (org.founded_year) result.founded_year = org.founded_year;
    if (org.city || org.state || org.country) {
      result.hq_location = [org.city, org.state, org.country].filter(Boolean).join(', ');
    }
    if (org.short_description) result.description = org.short_description;
    if (org.website_url) result.website = org.website_url;
    if (org.linkedin_url) result.linkedin_url = org.linkedin_url;
    if (org.industry) result.industry = org.industry;
    if (org.subindustry) result.sub_industry = org.subindustry;
    if (org.keywords?.length) result.keywords = org.keywords;
    if (org.annual_revenue_printed) result.revenue_estimate = org.annual_revenue_printed;
    if (org.latest_funding_stage) result.funding_stage = org.latest_funding_stage;
    if (org.total_funding_printed) result.total_funding = org.total_funding_printed;
    if (org.latest_funding_round_date) result.last_funding_date = org.latest_funding_round_date;

    // Technology tags
    if (org.technology_names?.length) {
      result.tech_stack = org.technology_names;
    }

    return result;
  }

  private async findPeople(
    domain: string,
    apiKey: string,
    maxPeople: number,
    targetTitles: string[]
  ): Promise<CompanyEnrichment['key_people'] & any[]> {
    // Build title keywords for search
    const titleKeywords = targetTitles.length > 0
      ? targetTitles
      : ['VP', 'Director', 'Head', 'CISO', 'CTO', 'CIO', 'Manager'];

    const body: any = {
      q_organization_domains: domain,
      page: 1,
      per_page: maxPeople,
      person_titles: titleKeywords,
      person_seniorities: ['director', 'vp', 'c_suite', 'manager'],
    };

    const response = await fetch(`${this.baseUrl}/mixed_people/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const people = data.people || [];

    return people.map((p: any) => ({
      name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      title: p.title || null,
      linkedin_url: p.linkedin_url || null,
      email: p.email || null,
      department: p.departments?.[0] || null,
      source: 'apollo' as const,
    }));
  }
}
