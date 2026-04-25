/**
 * Salesforce CRM Adapter
 *
 * Checks existing accounts, opportunities, and contacts to prevent
 * recommending companies already in the sales pipeline.
 *
 * Uses Salesforce REST API with OAuth 2.0 client credentials flow.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class SalesforceAdapter implements DataSourceAdapter {
  id = 'salesforce' as const;

  async healthCheck(config: DataSourceConfig): Promise<{ ok: boolean; message: string }> {
    if (!config.api_key) {
      return { ok: false, message: 'Salesforce access token not configured. Set up Connected App in Salesforce Setup → App Manager.' };
    }
    if (!config.settings?.instance_url) {
      return { ok: false, message: 'Salesforce instance URL not configured (e.g., https://yourorg.my.salesforce.com)' };
    }

    try {
      const response = await fetch(`${config.settings.instance_url}/services/data/v59.0/`, {
        headers: {
          'Authorization': `Bearer ${config.api_key}`,
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) return { ok: true, message: 'Salesforce connected' };
      if (response.status === 401) return { ok: false, message: 'Access token expired or invalid' };
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
    if (!config.api_key || !config.settings?.instance_url) return {};
    const result: Partial<CompanyEnrichment> = {};

    try {
      const baseUrl = config.settings.instance_url;
      const headers = {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type': 'application/json',
      };

      // Check accounts
      if (config.settings?.check_accounts !== false) {
        const accountQuery = domain
          ? `SELECT Id, Name, Website, Type, OwnerId, Owner.Name, Industry, NumberOfEmployees FROM Account WHERE Website LIKE '%${domain}%' LIMIT 5`
          : `SELECT Id, Name, Website, Type, OwnerId, Owner.Name, Industry, NumberOfEmployees FROM Account WHERE Name LIKE '%${companyName}%' LIMIT 5`;

        const accountResponse = await fetch(
          `${baseUrl}/services/data/v59.0/query?q=${encodeURIComponent(accountQuery)}`,
          { headers }
        );

        if (accountResponse.ok) {
          const accountData = await accountResponse.json();
          if (accountData.records?.length > 0) {
            const account = accountData.records[0];
            result.in_crm = true;
            result.crm_status = account.Type || 'Account exists';
            result.crm_owner = account.Owner?.Name || null;
            if (account.Industry) result.industry = account.Industry;
            if (account.NumberOfEmployees) {
              result.employee_count = account.NumberOfEmployees;
              result.employee_count_source = 'salesforce';
            }
          }
        }
      }

      // Check open opportunities
      if (config.settings?.check_opportunities !== false && result.in_crm) {
        const oppQuery = domain
          ? `SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE Account.Website LIKE '%${domain}%' AND IsClosed = false LIMIT 5`
          : `SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE Account.Name LIKE '%${companyName}%' AND IsClosed = false LIMIT 5`;

        const oppResponse = await fetch(
          `${baseUrl}/services/data/v59.0/query?q=${encodeURIComponent(oppQuery)}`,
          { headers }
        );

        if (oppResponse.ok) {
          const oppData = await oppResponse.json();
          if (oppData.records?.length > 0) {
            result.crm_status = `Open opportunity: ${oppData.records[0].StageName} (${oppData.records[0].Name})`;
          }
        }
      }

      // Check contacts
      if (config.settings?.check_contacts !== false) {
        const contactQuery = domain
          ? `SELECT Id, Name, Title, Email, Department FROM Contact WHERE Account.Website LIKE '%${domain}%' LIMIT 10`
          : `SELECT Id, Name, Title, Email, Department FROM Contact WHERE Account.Name LIKE '%${companyName}%' LIMIT 10`;

        const contactResponse = await fetch(
          `${baseUrl}/services/data/v59.0/query?q=${encodeURIComponent(contactQuery)}`,
          { headers }
        );

        if (contactResponse.ok) {
          const contactData = await contactResponse.json();
          if (contactData.records?.length > 0) {
            result.key_people = contactData.records.map((c: any) => ({
              name: c.Name,
              title: c.Title || null,
              email: c.Email || null,
              department: c.Department || null,
              source: 'salesforce' as const,
            }));
          }
        }
      }
    } catch (err) {
      console.error(`[salesforce] Error enriching ${companyName}:`, err);
    }

    return result;
  }
}
