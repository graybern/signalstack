/**
 * SEC EDGAR Adapter (FREE — no API key required)
 *
 * Fetches real SEC 10-K/10-Q filings and searches for ICP-relevant keywords.
 * Returns verified filing URLs and matched excerpts — never fabricates citations.
 * Only works for US-listed public companies; returns empty for private companies.
 *
 * EDGAR rate limit: 10 req/sec. Required: User-Agent with contact info.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

const EDGAR_USER_AGENT = 'SignalStack/1.0 (admin@signalstack.dev)';

const KEYWORD_CATEGORIES: Record<string, { high: string[]; medium: string[] }> = {
  security_access: {
    high: ['vpn', 'virtual private network', 'remote access', 'zero trust', 'ztna', 'zero-trust', 'network access control'],
    medium: ['cybersecurity', 'network security', 'access control', 'identity and access', 'privileged access'],
  },
  infrastructure: {
    high: ['infrastructure modernization', 'cloud migration', 'digital transformation'],
    medium: ['hybrid cloud', 'multi-cloud', 'on-premise', 'on-premises', 'data center'],
  },
  workforce: {
    high: ['remote workforce', 'hybrid work', 'distributed team', 'work from home', 'remote work'],
    medium: ['flexible work', 'return to office', 'workforce transformation'],
  },
  compliance: {
    high: ['soc 2', 'hipaa', 'pci dss', 'fedramp'],
    medium: ['gdpr', 'iso 27001', 'nist framework'],
  },
  competitor: {
    high: ['cisco anyconnect', 'globalprotect', 'palo alto networks', 'zscaler', 'cloudflare access', 'tailscale', 'netskope'],
    medium: ['fortinet', 'fortigate', 'citrix'],
  },
};

interface TickerEntry {
  cik_str: string;
  ticker: string;
  title: string;
}

interface TickerCache {
  entries: TickerEntry[];
  tickerToCik: Map<string, TickerEntry>;
  normalizedNameToCik: Map<string, TickerEntry>;
  fetchedAt: number;
}

let tickerCache: TickerCache | null = null;

const STRIP_SUFFIXES = /\b(inc\.?|corp\.?|ltd\.?|llc\.?|co\.?|plc\.?|group|holdings|international|technologies|technology|systems|solutions|software|services|enterprises|corporation|incorporated|limited|company)\b/gi;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(STRIP_SUFFIXES, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function padCik(cik: string | number): string {
  return String(cik).padStart(10, '0');
}

export class SecEdgarAdapter implements DataSourceAdapter {
  id = 'sec_edgar' as const;

  async healthCheck(_config: DataSourceConfig) {
    try {
      const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
        method: 'HEAD',
        headers: { 'User-Agent': EDGAR_USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok, message: res.ok ? 'SEC EDGAR available' : `EDGAR returned ${res.status}` };
    } catch {
      return { ok: false, message: 'Cannot reach SEC EDGAR' };
    }
  }

  async enrichCompany(companyName: string, domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    const timeout = config.settings?.timeout_ms || 15000;
    const maxFilings = config.settings?.max_filings || 2;
    const cacheTtlHours = config.settings?.cache_ttl_hours || 24;

    const entry = await this.resolveCompanyToCIK(companyName, domain, cacheTtlHours, timeout);
    if (!entry) return {};

    const cik = padCik(entry.cik_str);
    const filings = await this.fetchFilingIndex(cik, maxFilings, timeout);
    if (filings.length === 0) return {};

    const secFilings: NonNullable<CompanyEnrichment['sec_filings']> = [];
    const techSignals: NonNullable<CompanyEnrichment['tech_signals']> = [];

    for (const filing of filings) {
      const text = await this.fetchFilingText(entry.cik_str, filing.accessionNumber, filing.primaryDocument, timeout);
      if (!text) continue;

      const keywordMatches = this.searchKeywords(text);
      const totalHits = keywordMatches.reduce((sum, m) => sum + m.match_count, 0);

      const accessionNoDashes = filing.accessionNumber.replace(/-/g, '');
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(entry.cik_str)}/${accessionNoDashes}/${filing.primaryDocument}`;

      secFilings.push({
        form_type: filing.formType,
        filing_date: filing.filingDate,
        accession_number: filing.accessionNumber,
        filing_url: filingUrl,
        cik,
        company_name_sec: entry.title,
        keyword_matches: keywordMatches,
        total_keyword_hits: totalHits,
      });

      for (const match of keywordMatches) {
        if (match.confidence === 'high' && match.match_count > 0) {
          techSignals.push({
            signal: match.keyword,
            sources: ['sec_edgar' as const],
            confidence: 'high',
            evidence: `Found ${match.match_count}x in SEC ${filing.formType} (${filing.filingDate})`,
          });
        }
      }
    }

    const result: Partial<CompanyEnrichment> = {};
    if (secFilings.length > 0) result.sec_filings = secFilings;
    if (techSignals.length > 0) result.tech_signals = techSignals;
    return result;
  }

  private async resolveCompanyToCIK(
    companyName: string,
    domain: string | null,
    cacheTtlHours: number,
    timeout: number,
  ): Promise<TickerEntry | null> {
    const cache = await this.loadTickerMap(cacheTtlHours, timeout);
    if (!cache) return null;

    // Try domain-derived ticker (e.g., twilio.com → TWLO)
    if (domain) {
      const domainBase = domain.replace(/^www\./, '').split('.')[0].toUpperCase();
      const byTicker = cache.tickerToCik.get(domainBase);
      if (byTicker) {
        const normalizedTitle = normalizeName(byTicker.title);
        const normalizedInput = normalizeName(companyName);
        if (normalizedTitle.includes(normalizedInput) || normalizedInput.includes(normalizedTitle)) {
          return byTicker;
        }
      }
    }

    // Try exact normalized name match
    const normalizedInput = normalizeName(companyName);
    const byName = cache.normalizedNameToCik.get(normalizedInput);
    if (byName) return byName;

    // Try substring match (input contains entry or entry contains input)
    for (const entry of cache.entries) {
      const normalizedEntry = normalizeName(entry.title);
      if (normalizedEntry.length >= 4 && normalizedInput.length >= 4) {
        if (normalizedInput.includes(normalizedEntry) || normalizedEntry.includes(normalizedInput)) {
          return entry;
        }
      }
    }

    return null;
  }

  private async loadTickerMap(cacheTtlHours: number, timeout: number): Promise<TickerCache | null> {
    const ttlMs = cacheTtlHours * 60 * 60 * 1000;
    if (tickerCache && (Date.now() - tickerCache.fetchedAt) < ttlMs) {
      return tickerCache;
    }

    try {
      const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
        headers: { 'User-Agent': EDGAR_USER_AGENT },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return tickerCache;

      const data = await res.json() as Record<string, { cik_str: string; ticker: string; title: string }>;
      const entries: TickerEntry[] = Object.values(data);

      const tickerToCik = new Map<string, TickerEntry>();
      const normalizedNameToCik = new Map<string, TickerEntry>();

      for (const entry of entries) {
        tickerToCik.set(entry.ticker.toUpperCase(), entry);
        normalizedNameToCik.set(normalizeName(entry.title), entry);
      }

      tickerCache = { entries, tickerToCik, normalizedNameToCik, fetchedAt: Date.now() };
      return tickerCache;
    } catch {
      return tickerCache;
    }
  }

  private async fetchFilingIndex(
    cik: string,
    maxFilings: number,
    timeout: number,
  ): Promise<{ formType: string; filingDate: string; accessionNumber: string; primaryDocument: string }[]> {
    try {
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': EDGAR_USER_AGENT },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return [];

      const data = await res.json() as any;
      const recent = data.filings?.recent;
      if (!recent) return [];

      const filings: { formType: string; filingDate: string; accessionNumber: string; primaryDocument: string }[] = [];
      let found10K = false;
      let found10Q = false;

      for (let i = 0; i < (recent.form?.length || 0); i++) {
        const form = recent.form[i] as string;
        if (form === '10-K' && !found10K) {
          filings.push({
            formType: form,
            filingDate: recent.filingDate[i],
            accessionNumber: recent.accessionNumber[i],
            primaryDocument: recent.primaryDocument[i],
          });
          found10K = true;
        } else if (form === '10-Q' && !found10Q) {
          filings.push({
            formType: form,
            filingDate: recent.filingDate[i],
            accessionNumber: recent.accessionNumber[i],
            primaryDocument: recent.primaryDocument[i],
          });
          found10Q = true;
        }
        if (filings.length >= maxFilings) break;
      }

      return filings;
    } catch {
      return [];
    }
  }

  private async fetchFilingText(
    cik: string,
    accessionNumber: string,
    primaryDocument: string,
    timeout: number,
  ): Promise<string | null> {
    try {
      const accessionNoDashes = accessionNumber.replace(/-/g, '');
      const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNoDashes}/${primaryDocument}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': EDGAR_USER_AGENT },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return null;

      const html = await res.text();
      return this.stripHtml(html);
    } catch {
      return null;
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private searchKeywords(text: string): NonNullable<CompanyEnrichment['sec_filings']>[0]['keyword_matches'] {
    const lowerText = text.toLowerCase();
    const matches: NonNullable<CompanyEnrichment['sec_filings']>[0]['keyword_matches'] = [];

    for (const [category, { high, medium }] of Object.entries(KEYWORD_CATEGORIES)) {
      for (const keyword of high) {
        const result = this.findKeywordMatches(lowerText, text, keyword);
        if (result.count > 0) {
          matches.push({
            keyword,
            category: category as any,
            match_count: result.count,
            confidence: 'high',
            excerpts: result.excerpts,
          });
        }
      }
      for (const keyword of medium) {
        const result = this.findKeywordMatches(lowerText, text, keyword);
        if (result.count > 0) {
          matches.push({
            keyword,
            category: category as any,
            match_count: result.count,
            confidence: 'medium',
            excerpts: result.excerpts,
          });
        }
      }
    }

    return matches;
  }

  private findKeywordMatches(
    lowerText: string,
    originalText: string,
    keyword: string,
  ): { count: number; excerpts: string[] } {
    const excerpts: string[] = [];
    let count = 0;
    let searchFrom = 0;

    while (true) {
      const idx = lowerText.indexOf(keyword, searchFrom);
      if (idx === -1) break;
      count++;

      if (excerpts.length < 3) {
        const start = Math.max(0, idx - 80);
        const end = Math.min(originalText.length, idx + keyword.length + 80);
        let excerpt = originalText.substring(start, end).trim();
        if (start > 0) excerpt = '...' + excerpt;
        if (end < originalText.length) excerpt = excerpt + '...';
        excerpts.push(excerpt);
      }

      searchFrom = idx + keyword.length;
    }

    return { count, excerpts };
  }
}
