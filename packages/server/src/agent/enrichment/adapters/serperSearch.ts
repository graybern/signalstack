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
    const empEstimates: { count: number; source: string; type: 'fte' | 'total_headcount' | 'unknown' }[] = [];

    try {
      // Primary search: try domain-based query
      const domainQuery = domain ? `${domain} company` : `"${companyName}" company`;
      const data = await this.search(domainQuery, config.api_key);
      allSearchResults.push(...(data.organic || []));
      if (data.knowledgeGraph) allSearchResults.push(data.knowledgeGraph);

      this.extractKnowledgeGraph(data, result, empEstimates);

      // If domain query didn't yield a knowledge graph, try company name
      const domainSlug = domain?.split('.')[0]?.toLowerCase();
      const nameSlug = companyName.toLowerCase().replace(/\s+/g, '');
      if (!data.knowledgeGraph && domain && domainSlug !== nameSlug) {
        const nameData = await this.search(`"${companyName}" company`, config.api_key);
        allSearchResults.push(...(nameData.organic || []));
        if (nameData.knowledgeGraph) allSearchResults.push(nameData.knowledgeGraph);
        this.extractKnowledgeGraph(nameData, result, empEstimates);
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

      // ── Employee count: collect from ALL sources, then pick median ──
      const searchTerm = domain || companyName;

      // Source 1: LinkedIn company page
      if (!result.linkedin_url) {
        const linkedinData = await this.search(`${searchTerm} linkedin company`, config.api_key);
        allSearchResults.push(...(linkedinData.organic || []));
        for (const item of (linkedinData.organic || []).slice(0, 5)) {
          const url = item.link || '';
          if (!url.includes('linkedin.com/company/')) continue;
          if (!result.linkedin_url) {
            const match = url.match(/linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
            if (match) result.linkedin_url = `https://www.${match[0]}`;
          }
          const snippet = item.snippet || '';
          const count = this.parseEmployeeFromText(snippet);
          if (count) empEstimates.push({ count, source: 'linkedin', type: 'total_headcount' });
          if (result.linkedin_url) break;
        }
      }

      // Source 2: FTE/size query
      try {
        const sizeData = await this.search(`${searchTerm} fte size`, config.api_key);
        allSearchResults.push(...(sizeData.organic || []));
        if (sizeData.knowledgeGraph?.attributes) {
          const empCount = this.parseEmployeeCount(sizeData.knowledgeGraph.attributes);
          if (empCount) empEstimates.push({ count: empCount, source: 'knowledge_graph', type: 'fte' });
        }
        if (sizeData.answerBox) {
          const boxText = sizeData.answerBox.answer || sizeData.answerBox.snippet || '';
          const count = this.parseEmployeeFromText(boxText);
          if (count) empEstimates.push({ count, source: 'answer_box', type: 'fte' });
        }
        for (const item of (sizeData.organic || []).slice(0, 3)) {
          const count = this.parseEmployeeFromText(item.snippet || '');
          if (count) { empEstimates.push({ count, source: 'fte_snippet', type: 'fte' }); break; }
        }
      } catch { /* non-critical */ }

      // Source 3: Direct "employees how many" query
      try {
        const empData = await this.search(`"${companyName}" employees how many`, config.api_key);
        allSearchResults.push(...(empData.organic || []));
        for (const item of (empData.organic || []).slice(0, 3)) {
          const count = this.parseEmployeeFromText(item.snippet || '');
          if (count) { empEstimates.push({ count, source: 'direct_query', type: 'unknown' }); break; }
        }
      } catch { /* non-critical */ }

      // Pick best employee count: prefer FTE estimates, fall back to all
      if (empEstimates.length > 0) {
        const fteEstimates = empEstimates.filter(e => e.type === 'fte');
        const estimatesToUse = fteEstimates.length > 0 ? fteEstimates : empEstimates;

        const sorted = [...estimatesToUse].sort((a, b) => a.count - b.count);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
          ? Math.round((sorted[mid - 1].count + sorted[mid].count) / 2)
          : sorted[mid].count;
        result.employee_count = median;
        result.employee_count_source = 'serper_search';
        result.employee_count_type = fteEstimates.length > 0 ? 'fte' : 'unknown';

        // Flag low confidence if estimates diverge significantly
        const minEst = sorted[0].count;
        const maxEst = sorted[sorted.length - 1].count;
        if (maxEst > minEst * 3 && estimatesToUse.length >= 2) {
          const note = `Employee count estimates diverge: ${empEstimates.map(e => `${e.count} (${e.source}, ${e.type})`).join(', ')}. Using ${fteEstimates.length > 0 ? 'FTE' : 'all'} median: ${median}`;
          result.description = result.description ? `${result.description}\n${note}` : note;
        }
      }

      // Tech stack detection: targeted searches for technology stack intelligence
      const techSearchTerm = domain || companyName;
      try {
        const techData = await this.search(`"${techSearchTerm}" technology stack site:stackshare.com`, config.api_key);
        allSearchResults.push(...(techData.organic || []));
        this.extractTechSignals(techData.organic || [], result);
      } catch { /* rate limited or timeout — non-critical */ }

      try {
        const infraData = await this.search(`"${techSearchTerm}" infrastructure VPN kubernetes docker terraform cloud`, config.api_key);
        allSearchResults.push(...(infraData.organic || []));
        this.extractTechSignals(infraData.organic || [], result);
      } catch { /* non-critical */ }

      // People search: find key contacts via LinkedIn profiles
      if (config.settings?.find_people !== false) {
        try {
          const titleKeywords = (config.settings?.target_titles as string[] | undefined) || ['VP Engineering', 'CISO', 'Director IT', 'CTO'];
          const titleQuery = titleKeywords.slice(0, 3).join(' OR ');
          const peopleData = await this.search(`"${companyName}" ${titleQuery} site:linkedin.com/in`, config.api_key);
          const people = this.parsePeopleFromResults(peopleData.organic || []);
          if (people.length > 0) {
            result.key_people = people.slice(0, 5);
          }
        } catch { /* non-critical */ }
      }

      // Competitive intelligence search
      if (config.settings?.competitive_search !== false) {
        try {
          const competitors = (config.settings?.competitor_names as string[] | undefined) || [];
          const compQuery = competitors.length > 0
            ? `"${companyName}" ${competitors.slice(0, 3).map((c: string) => `"${c}"`).join(' OR ')}`
            : `"${companyName}" VPN OR "network access" OR "zero trust" OR "remote access"`;
          const compData = await this.search(compQuery, config.api_key);
          allSearchResults.push(...(compData.organic || []));
          this.extractTechSignals(compData.organic || [], result);
        } catch { /* non-critical */ }
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

  private parsePeopleFromResults(results: any[]): NonNullable<CompanyEnrichment['key_people']> {
    const people: NonNullable<CompanyEnrichment['key_people']> = [];
    const seenNames = new Set<string>();
    for (const item of results.slice(0, 10)) {
      const url = item.link || '';
      if (!url.includes('linkedin.com/in/')) continue;
      const title = item.title || '';
      // LinkedIn titles: "FirstName LastName - Title - Company | LinkedIn"
      const nameMatch = title.match(/^([^-–|]+)\s*[-–]/);
      const titleMatch = title.match(/[-–]\s*([^-–|]+)\s*[-–|]/);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        const personTitle = titleMatch ? titleMatch[1].trim() : '';
        if (name && name.length > 2 && name.length < 60 && !seenNames.has(name.toLowerCase())) {
          seenNames.add(name.toLowerCase());
          people.push({
            name,
            title: personTitle || 'Unknown title',
            linkedin_url: url.split('?')[0],
            source: 'serper_search' as any,
          });
        }
      }
    }
    return people;
  }

  private extractKnowledgeGraph(data: any, result: Partial<CompanyEnrichment>, empEstimates?: { count: number; source: string; type: 'fte' | 'total_headcount' | 'unknown' }[]): void {
    if (!data.knowledgeGraph) return;
    const kg = data.knowledgeGraph;
    const attrs = kg.attributes || {};

    const empCount = this.parseEmployeeCount(attrs);
    if (empCount && empEstimates) {
      empEstimates.push({ count: empCount, source: 'knowledge_graph', type: 'unknown' });
    }

    const descCount = this.parseEmployeeFromText(kg.description || '');
    if (descCount && empEstimates) {
      empEstimates.push({ count: descCount, source: 'kg_description', type: 'unknown' });
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

  private extractTechSignals(results: any[], result: Partial<CompanyEnrichment>): void {
    if (!result.tech_signals) result.tech_signals = [];

    const TECH_KEYWORDS: { pattern: RegExp; tech: string; category: string }[] = [
      { pattern: /\bkubernetes\b/i, tech: 'Kubernetes', category: 'infra' },
      { pattern: /\bdocker\b/i, tech: 'Docker', category: 'infra' },
      { pattern: /\bterraform\b/i, tech: 'Terraform', category: 'infra' },
      { pattern: /\baws\b/i, tech: 'AWS', category: 'cloud' },
      { pattern: /\bazure\b/i, tech: 'Azure', category: 'cloud' },
      { pattern: /\bgoogle cloud\b|gcp\b/i, tech: 'Google Cloud', category: 'cloud' },
      { pattern: /\bcisco anyconnect\b/i, tech: 'Cisco AnyConnect', category: 'vpn' },
      { pattern: /\bglobalprotect\b/i, tech: 'Palo Alto GlobalProtect', category: 'vpn' },
      { pattern: /\bforticlient\b/i, tech: 'Fortinet FortiClient', category: 'vpn' },
      { pattern: /\bpulse secure\b|\bivanti\b/i, tech: 'Ivanti/Pulse Secure', category: 'vpn' },
      { pattern: /\bopenvpn\b/i, tech: 'OpenVPN', category: 'vpn' },
      { pattern: /\btailscale\b/i, tech: 'Tailscale', category: 'vpn' },
      { pattern: /\bzscaler\b/i, tech: 'Zscaler', category: 'security' },
      { pattern: /\bcloudflare access\b/i, tech: 'Cloudflare Access', category: 'security' },
      { pattern: /\bokta\b/i, tech: 'Okta', category: 'auth' },
      { pattern: /\bcrowdstrike\b/i, tech: 'CrowdStrike', category: 'security' },
      { pattern: /\bsentinelone\b/i, tech: 'SentinelOne', category: 'security' },
      { pattern: /\bjamf\b/i, tech: 'Jamf', category: 'mdm' },
      { pattern: /\bintune\b/i, tech: 'Microsoft Intune', category: 'mdm' },
      { pattern: /\bdatadog\b/i, tech: 'Datadog', category: 'observability' },
      { pattern: /\bsplunk\b/i, tech: 'Splunk', category: 'observability' },
      { pattern: /\bjenkins\b/i, tech: 'Jenkins', category: 'devtools' },
      { pattern: /\bgithub\b/i, tech: 'GitHub', category: 'devtools' },
      { pattern: /\bgitlab\b/i, tech: 'GitLab', category: 'devtools' },
      { pattern: /\bjira\b/i, tech: 'Jira', category: 'devtools' },
      { pattern: /\bperforce\b|\bp4\b/i, tech: 'Perforce', category: 'devtools' },
    ];

    const snippets = results.slice(0, 8).map(r => `${r.title || ''} ${r.snippet || ''}`).join(' ');
    const isStackShare = results.some(r => (r.link || '').includes('stackshare.com'));

    for (const kw of TECH_KEYWORDS) {
      if (kw.pattern.test(snippets)) {
        const existing = result.tech_signals!.find(s => s.signal === kw.tech);
        if (existing) {
          if (!existing.sources.includes('serper_search')) {
            existing.sources.push('serper_search');
          }
        } else {
          result.tech_signals!.push({
            signal: kw.tech,
            sources: ['serper_search'],
            confidence: isStackShare ? 'medium' : 'low',
            evidence: `Detected in web search results${isStackShare ? ' (StackShare profile)' : ''}`,
          });
        }
      }
    }
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
