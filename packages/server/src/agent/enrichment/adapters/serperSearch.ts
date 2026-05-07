import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

export class SerperSearchAdapter implements DataSourceAdapter {
  id = 'serper_search' as const;

  async healthCheck(config: DataSourceConfig): Promise<{ ok: boolean; message: string }> {
    if (!config.api_key) {
      return { ok: false, message: 'Serper API key not configured. Get one at https://serper.dev/' };
    }

    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': config.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'test', num: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) return { ok: true, message: 'Serper API connected' };
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
    const allSearchResults: any[] = [];

    try {
      // Primary search: try domain-based query
      const domainQuery = domain ? `${domain} company` : `"${companyName}" company`;
      const data = await this.search(domainQuery, config.api_key);
      allSearchResults.push(...(data.organic || []));
      if (data.knowledgeGraph) allSearchResults.push(data.knowledgeGraph);

      this.extractKnowledgeGraph(data, result);

      // If domain query didn't yield a knowledge graph, try company name
      const domainSlug = domain?.split('.')[0]?.toLowerCase();
      const nameSlug = companyName.toLowerCase().replace(/\s+/g, '');
      if (!data.knowledgeGraph && domain && domainSlug !== nameSlug) {
        const nameData = await this.search(`"${companyName}" company`, config.api_key);
        allSearchResults.push(...(nameData.organic || []));
        if (nameData.knowledgeGraph) allSearchResults.push(nameData.knowledgeGraph);
        this.extractKnowledgeGraph(nameData, result);
      }

      // Extract funding from organic snippets if knowledge graph didn't have it
      if (!result.total_funding && !result.last_funding_amount) {
        this.extractFundingFromSnippets(allSearchResults, result);
      }

      // Extract HQ and founded year from organic snippets if not found in knowledge graph
      if (!result.hq_location) {
        this.extractHqFromSnippets(allSearchResults, result);
      }
      if (!result.founded_year) {
        this.extractFoundedFromSnippets(allSearchResults, result);
      }

      // Employee count fallback: LinkedIn search (most reliable for headcount)
      if (!result.employee_count || !result.linkedin_url) {
        const searchTerm = domain || companyName;
        const linkedinData = await this.search(`${searchTerm} linkedin company`, config.api_key);
        allSearchResults.push(...(linkedinData.organic || []));

        for (const item of (linkedinData.organic || []).slice(0, 5)) {
          const url = item.link || '';
          if (!url.includes('linkedin.com/company/')) continue;

          if (!result.linkedin_url) {
            const match = url.match(/linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
            if (match) result.linkedin_url = `https://www.${match[0]}`;
          }

          if (!result.employee_count) {
            const snippet = item.snippet || '';
            const count = this.parseEmployeeFromText(snippet);
            if (count) {
              result.employee_count = count;
              result.employee_count_source = 'serper_search';
            }
          }

          if (result.employee_count && result.linkedin_url) break;
        }
      }

      // Employee count fallback: fte/size query with answerBox parsing
      if (!result.employee_count) {
        const searchTerm = domain || companyName;
        const sizeData = await this.search(`${searchTerm} fte size`, config.api_key);
        allSearchResults.push(...(sizeData.organic || []));

        if (sizeData.knowledgeGraph?.attributes) {
          const empCount = this.parseEmployeeCount(sizeData.knowledgeGraph.attributes);
          if (empCount) {
            result.employee_count = empCount;
            result.employee_count_source = 'serper_search';
          }
        }

        if (!result.employee_count && sizeData.answerBox) {
          const boxText = sizeData.answerBox.answer || sizeData.answerBox.snippet || '';
          const count = this.parseEmployeeFromText(boxText);
          if (count) {
            result.employee_count = count;
            result.employee_count_source = 'serper_search';
          }
        }

        if (!result.employee_count) {
          for (const item of (sizeData.organic || []).slice(0, 5)) {
            const snippet = item.snippet || '';
            const count = this.parseEmployeeFromText(snippet);
            if (count) {
              result.employee_count = count;
              result.employee_count_source = 'serper_search';
              break;
            }
          }
        }
      }

      // Final employee count fallback: "{companyName}" employees how many
      if (!result.employee_count) {
        const empData = await this.search(`"${companyName}" employees how many`, config.api_key);
        allSearchResults.push(...(empData.organic || []));

        for (const item of (empData.organic || []).slice(0, 5)) {
          const snippet = item.snippet || '';
          const count = this.parseEmployeeFromText(snippet);
          if (count) {
            result.employee_count = count;
            result.employee_count_source = 'serper_search';
            break;
          }
        }
      }

      // Extract LinkedIn URL from ALL search results across all queries
      if (!result.linkedin_url) {
        for (const item of allSearchResults) {
          const url = item.link || item.url || item.website || '';
          const linkedinMatch = url.match(/linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
          if (linkedinMatch) {
            result.linkedin_url = `https://www.${linkedinMatch[0]}`;
            break;
          }
        }
      }

      // Also check snippet text for LinkedIn URLs
      if (!result.linkedin_url) {
        for (const item of allSearchResults) {
          const text = item.snippet || item.description || '';
          const linkedinMatch = text.match(/linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
          if (linkedinMatch) {
            result.linkedin_url = `https://www.${linkedinMatch[0]}`;
            break;
          }
        }
      }
    } catch (err) {
      console.error(`[serperSearch] Error enriching ${companyName}:`, err);
    }

    return result;
  }

  private extractKnowledgeGraph(data: any, result: Partial<CompanyEnrichment>): void {
    if (!data.knowledgeGraph) return;
    const kg = data.knowledgeGraph;
    const attrs = kg.attributes || {};

    if (!result.employee_count) {
      const empCount = this.parseEmployeeCount(attrs);
      if (empCount) {
        result.employee_count = empCount;
        result.employee_count_source = 'serper_search';
      }
    }

    if (!result.employee_count) {
      const descCount = this.parseEmployeeFromText(kg.description || '');
      if (descCount) {
        result.employee_count = descCount;
        result.employee_count_source = 'serper_search';
      }
    }

    if (!result.hq_location) {
      result.hq_location = attrs['Headquarters'] || attrs['Headquarters:'] || undefined;
    }

    if (!result.founded_year) {
      const founded = attrs['Founded'] || attrs['Founded:'];
      if (founded) {
        const year = parseInt(founded, 10);
        if (year > 1800 && year <= new Date().getFullYear()) {
          result.founded_year = year;
        }
      }
    }

    if (kg.description && !result.description) {
      result.description = kg.description;
    }

    const funding = this.parseFunding(attrs);
    if (funding.total_funding && !result.total_funding) result.total_funding = funding.total_funding;
    if (funding.funding_stage && !result.funding_stage) result.funding_stage = funding.funding_stage;
    if (funding.last_funding_amount && !result.last_funding_amount) result.last_funding_amount = funding.last_funding_amount;
  }

  private extractFundingFromSnippets(results: any[], result: Partial<CompanyEnrichment>): void {
    for (const item of results.slice(0, 10)) {
      const snippet = item.snippet || item.description || '';
      const fundingMatch = snippet.match(/(?:raised|secured|funding|round)\s+\$?([\d.]+)\s*(billion|million|B|M)/i);
      if (fundingMatch) {
        const amount = parseFloat(fundingMatch[1]);
        const unit = fundingMatch[2].toLowerCase();
        result.last_funding_amount = unit.startsWith('b') ? `$${amount}B` : `$${amount}M`;

        const seriesMatch = snippet.match(/series\s+([A-Z])/i);
        if (seriesMatch) {
          result.funding_stage = `Series ${seriesMatch[1].toUpperCase()}`;
        }
        break;
      }
    }
  }

  private extractHqFromSnippets(results: any[], result: Partial<CompanyEnrichment>): void {
    for (const item of results.slice(0, 10)) {
      const text = item.snippet || item.description || '';
      const hqMatch = text.match(/(?:headquartered|based|located)\s+in\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z]{2,})?)/);
      if (hqMatch) {
        result.hq_location = hqMatch[1].trim().replace(/\.\s*$/, '');
        break;
      }
    }
  }

  private extractFoundedFromSnippets(results: any[], result: Partial<CompanyEnrichment>): void {
    for (const item of results.slice(0, 10)) {
      const text = item.snippet || item.description || '';
      const foundedMatch = text.match(/(?:founded|established|started)\s+(?:in\s+)?(\d{4})/i);
      if (foundedMatch) {
        const year = parseInt(foundedMatch[1], 10);
        if (year > 1800 && year <= new Date().getFullYear()) {
          result.founded_year = year;
          break;
        }
      }
    }
  }

  private async search(query: string, apiKey: string): Promise<any> {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw Object.assign(new Error('Rate limited'), { status: 429 });
      }
      throw new Error(`Serper API error: ${response.status}`);
    }

    return response.json();
  }

  private parseEmployeeCount(attrs: Record<string, string>): number | null {
    const keys = [
      'Number of employees', 'Employees', 'Company size',
      'Number of employees:', 'Employees:', 'Company size:',
      'Size', 'Size:', 'Staff', 'Staff:',
    ];

    for (const key of keys) {
      const val = attrs[key];
      if (val) {
        const count = this.parseEmployeeFromText(val);
        if (count) return count;
      }
    }
    return null;
  }

  private parseEmployeeFromText(text: string): number | null {
    // "150-500 employees" → midpoint 325
    const rangeMatch = text.match(/(\d[\d,]*)\s*[-–—to]+\s*(\d[\d,]*)\s*(?:employees|staff|people|workers|FTEs?)/i);
    if (rangeMatch) {
      const low = parseInt(rangeMatch[1].replace(/,/g, ''), 10);
      const high = parseInt(rangeMatch[2].replace(/,/g, ''), 10);
      return Math.round((low + high) / 2);
    }

    // LinkedIn-style bare range: "501-1,000" or "· 201-500 ·" (no trailing keyword)
    const bareRange = text.match(/(?:^|[·|\s])(\d[\d,]*)\s*[-–—]\s*(\d[\d,]*)(?:\s*[·|\s]|$)/);
    if (bareRange) {
      const low = parseInt(bareRange[1].replace(/,/g, ''), 10);
      const high = parseInt(bareRange[2].replace(/,/g, ''), 10);
      if (low >= 10 && high <= 500000 && high > low) {
        return Math.round((low + high) / 2);
      }
    }

    // "~500 employees" or "approximately 500 employees"
    const approxMatch = text.match(/(?:~|approximately|about|around|over|nearly|roughly)\s*(\d[\d,]*)\s*(?:employees|staff|people|workers|FTEs?)/i);
    if (approxMatch) {
      return parseInt(approxMatch[1].replace(/,/g, ''), 10);
    }

    // "500 employees", "500+ employees", "467 total employees"
    const exactMatch = text.match(/(\d[\d,]*)\+?\s*(?:total\s+)?(?:employees|staff|people|workers|FTEs?)/i);
    if (exactMatch) {
      return parseInt(exactMatch[1].replace(/,/g, ''), 10);
    }

    // "has 467 employees", "employs 467 people", "230 people work at"
    const hasMatch = text.match(/(?:has|have|employs?|with)\s+(\d[\d,]*)\s*(?:total\s+)?(?:employees|staff|people|workers)/i);
    if (hasMatch) {
      return parseInt(hasMatch[1].replace(/,/g, ''), 10);
    }

    // "230 people work at" or "442 people are employed at"
    const workAtMatch = text.match(/(\d[\d,]*)\s*(?:people|employees)\s+(?:work|are employed)\s+at/i);
    if (workAtMatch) {
      return parseInt(workAtMatch[1].replace(/,/g, ''), 10);
    }

    // Just a number with comma formatting that looks like employee count (e.g. "1,200")
    const plainNumber = text.match(/^(\d[\d,]*)$/);
    if (plainNumber) {
      const n = parseInt(plainNumber[1].replace(/,/g, ''), 10);
      if (n >= 10 && n <= 500000) return n;
    }

    return null;
  }

  private parseFunding(attrs: Record<string, string>): {
    total_funding?: string;
    funding_stage?: string;
    last_funding_amount?: string;
  } {
    const result: { total_funding?: string; funding_stage?: string; last_funding_amount?: string } = {};

    const fundingKeys = [
      'Total funding', 'Total funding:', 'Funding', 'Funding:',
      'Total raised', 'Total raised:', 'Capital raised', 'Capital raised:',
    ];
    for (const key of fundingKeys) {
      if (attrs[key]) {
        result.total_funding = attrs[key];
        break;
      }
    }

    const stageKeys = [
      'Funding stage', 'Funding stage:', 'Latest round', 'Latest round:',
      'Last funding type', 'Last funding type:', 'Funding type', 'Funding type:',
    ];
    for (const key of stageKeys) {
      if (attrs[key]) {
        result.funding_stage = attrs[key];
        break;
      }
    }

    const lastKeys = [
      'Last funding', 'Last funding:', 'Latest funding', 'Latest funding:',
      'Last round', 'Last round:', 'Latest round amount', 'Latest round amount:',
    ];
    for (const key of lastKeys) {
      if (attrs[key]) {
        result.last_funding_amount = attrs[key];
        break;
      }
    }

    return result;
  }
}
