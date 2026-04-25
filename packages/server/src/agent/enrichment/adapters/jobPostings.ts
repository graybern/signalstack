/**
 * Job Postings Analysis Adapter (FREE — no API key required)
 *
 * Pulls job postings from multiple sources:
 *   1. Greenhouse (boards.greenhouse.io) — JSON API, no key required
 *   2. Lever (jobs.lever.co) — JSON API, no key required
 *   3. Workday (company.wd5.myworkdayjobs.com) — JSON API, no key required
 *   4. Direct career page scraping (HTML fallback)
 *
 * Greenhouse and Lever expose public JSON APIs that are far more reliable
 * and structured than HTML scraping. Most mid-to-large tech companies use one
 * of these three ATS systems, making this a high-yield free source.
 *
 * Analyzes postings for tech stack signals, security investment patterns,
 * infrastructure decisions, and buying triggers.
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

// ATS slug overrides for companies whose slug differs from their domain
// e.g., riotgames.com -> greenhouse slug is "riotgames"
const ATS_SLUG_MAP: Record<string, { greenhouse?: string; lever?: string }> = {
  'riotgames.com': { greenhouse: 'riotgames' },
  'epicgames.com': { greenhouse: 'epicgames' },
  'cloudflare.com': { greenhouse: 'cloudflare' },
  'crowdstrike.com': { greenhouse: 'crowdstrike' },
  'datadog.com': { greenhouse: 'datadog' },
  'hashicorp.com': { greenhouse: 'hashicorp' },
  'snyk.io': { lever: 'snyk' },
  'wiz.io': { greenhouse: 'wiz' },
  'figma.com': { greenhouse: 'figma' },
};

export class JobPostingsAdapter implements DataSourceAdapter {
  id = 'job_postings' as const;

  async healthCheck(_config: DataSourceConfig) {
    return { ok: true, message: 'Job postings analysis uses public career APIs — always available' };
  }

  async enrichCompany(companyName: string, domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    const maxListings = config.settings?.max_listings || 30;

    // Try ATS APIs first (structured, reliable), fall back to HTML scraping
    const [greenhouse, lever, workday] = await Promise.allSettled([
      this.fetchGreenhouse(companyName, domain),
      this.fetchLever(companyName, domain),
      this.fetchWorkday(companyName, domain),
    ]);

    const allJobs: JobListing[] = [];
    for (const result of [greenhouse, lever, workday]) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allJobs.push(...result.value);
      }
    }

    // Fall back to HTML scraping if ATS APIs returned nothing
    if (allJobs.length === 0 && domain) {
      const scraped = await this.scrapeCareerPage(domain, config);
      allJobs.push(...scraped);
    }

    if (allJobs.length === 0) return {};

    const result: Partial<CompanyEnrichment> = {};
    const jobPostings: NonNullable<CompanyEnrichment['job_postings']> = [];
    const techSignals: NonNullable<CompanyEnrichment['tech_signals']> = [];

    // Track tech keywords found across all job postings
    const techMentionCounts = new Map<string, number>();

    for (const job of allJobs.slice(0, maxListings)) {
      const text = `${job.title} ${job.description || ''} ${(job.keywords || []).join(' ')}`.toLowerCase();
      const keywords = this.extractJobKeywords(text);

      jobPostings.push({
        title: job.title,
        url: job.url,
        keywords,
      });

      // Count tech keyword mentions across postings
      for (const kw of keywords) {
        techMentionCounts.set(kw, (techMentionCounts.get(kw) || 0) + 1);
      }
    }

    // Build tech signals with source corroboration count
    for (const [tech, count] of techMentionCounts.entries()) {
      techSignals.push({
        signal: tech,
        sources: ['job_postings' as const],
        confidence: count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low',
        evidence: `Mentioned in ${count} job posting${count > 1 ? 's' : ''}`,
      });
    }

    if (jobPostings.length > 0) result.job_postings = jobPostings;
    if (techSignals.length > 0) result.tech_signals = techSignals;

    // Hiring signals by department
    const hiringSignals = this.analyzeHiringSignals(allJobs);
    if (hiringSignals.length > 0) result.hiring_signals = hiringSignals;

    return result;
  }

  /** Greenhouse Public Jobs API — no auth required */
  private async fetchGreenhouse(companyName: string, domain: string | null): Promise<JobListing[]> {
    const slug = this.getGreenhouseSlug(companyName, domain);
    const slugVariants = [slug, ...this.getSlugVariants(slug)];

    for (const s of slugVariants) {
      try {
        const url = `https://boards.greenhouse.io/embed/job_board/jobs.json?for=${s}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) continue;
        const data = await res.json() as { jobs?: GreenhouseJob[] };
        if (!data.jobs?.length) continue;

        return data.jobs.map(j => ({
          title: j.title,
          url: j.absolute_url,
          description: j.location?.name,
          keywords: [],
          source: 'greenhouse',
        }));
      } catch { /* try next */ }
    }
    return [];
  }

  /** Lever Public Jobs API — no auth required */
  private async fetchLever(companyName: string, domain: string | null): Promise<JobListing[]> {
    const slug = this.getLeverSlug(companyName, domain);
    const slugVariants = [slug, ...this.getSlugVariants(slug)];

    for (const s of slugVariants) {
      try {
        const url = `https://api.lever.co/v0/postings/${s}?mode=json`;
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) continue;
        const data = await res.json() as LeverPosting[];
        if (!Array.isArray(data) || data.length === 0) continue;

        return data.map(j => ({
          title: j.text,
          url: j.hostedUrl,
          description: j.categories?.team || '',
          keywords: [],
          source: 'lever',
        }));
      } catch { /* try next */ }
    }
    return [];
  }

  /** Workday Jobs API — no auth required for public listings */
  private async fetchWorkday(companyName: string, _domain: string | null): Promise<JobListing[]> {
    // Workday slugs are highly company-specific — too many variants to guess reliably
    // Only try for companies with known Workday setup
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const subdomains = [`${slug}`, `${slug}careers`];

    for (const sub of subdomains) {
      try {
        const url = `https://${sub}.wd5.myworkdayjobs.com/wday/cxs/${sub}/External/jobs`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ limit: 20, offset: 0, searchText: '' }),
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) continue;
        const data = await res.json() as { jobPostings?: WorkdayJob[] };
        if (!data.jobPostings?.length) continue;

        return data.jobPostings.map(j => ({
          title: j.title,
          url: `https://${sub}.wd5.myworkdayjobs.com/External/${j.externalPath}`,
          keywords: [],
          source: 'workday',
        }));
      } catch { /* try next */ }
    }
    return [];
  }

  /** HTML career page scraping — fallback */
  private async scrapeCareerPage(domain: string, _config: DataSourceConfig): Promise<JobListing[]> {
    const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    const careerPaths = ['/careers', '/jobs', '/careers/openings', '/about/careers', '/join', '/open-positions'];
    let careerHtml: string | null = null;
    let careerUrl = baseUrl;

    for (const path of careerPaths) {
      try {
        const url = `${baseUrl}${path}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
          redirect: 'follow',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
          careerHtml = await res.text();
          careerUrl = url;
          break;
        }
      } catch { /* continue */ }
    }

    if (!careerHtml) return [];
    const titles = this.extractJobTitles(careerHtml);
    return titles.slice(0, 20).map(title => ({
      title,
      url: careerUrl,
      keywords: [],
      source: 'html_scrape',
    }));
  }

  private getGreenhouseSlug(companyName: string, domain: string | null): string {
    const cleanDomain = domain?.replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (cleanDomain && ATS_SLUG_MAP[cleanDomain]?.greenhouse) {
      return ATS_SLUG_MAP[cleanDomain].greenhouse!;
    }
    return companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private getLeverSlug(companyName: string, domain: string | null): string {
    const cleanDomain = domain?.replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (cleanDomain && ATS_SLUG_MAP[cleanDomain]?.lever) {
      return ATS_SLUG_MAP[cleanDomain].lever!;
    }
    return companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private getSlugVariants(base: string): string[] {
    return [
      `${base}careers`,
      `${base}-careers`,
      base.replace(/inc$/, ''),
      base.replace(/corp$/, ''),
      base.replace(/llc$/, ''),
    ].filter(s => s !== base && s.length > 0);
  }

  private extractJobTitles(html: string): string[] {
    const titles: string[] = [];
    const patterns = [
      /<h[2-4][^>]*class="[^"]*(?:job|position|role|title|opening)[^"]*"[^>]*>([^<]+)/gi,
      /<a[^>]*(?:href="[^"]*(?:job|position|career|opening|lever\.co|greenhouse\.io)[^"]*")[^>]*>([^<]+)/gi,
      /<(?:li|div|span)[^>]*class="[^"]*(?:job-title|position-title|opening-title|role-name|posting-title)[^"]*"[^>]*>([^<]+)/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const title = match[1].trim().replace(/\s+/g, ' ');
        if (title.length > 3 && title.length < 120 && !titles.includes(title)) titles.push(title);
      }
    }
    return titles;
  }

  private extractJobKeywords(text: string): string[] {
    const keywordMap: Record<string, string[]> = {
      'kubernetes': ['kubernetes', 'k8s'],
      'docker': ['docker', 'containers'],
      'terraform': ['terraform', 'infrastructure as code'],
      'aws': ['aws', 'amazon web services', 'ec2', 's3'],
      'azure': ['azure', 'microsoft cloud'],
      'gcp': ['gcp', 'google cloud', 'gke'],
      'vpn': ['vpn', 'virtual private network'],
      'zero trust': ['zero trust', 'ztna'],
      'security': ['security engineer', 'infosec', 'cybersecurity', 'soc analyst'],
      'network': ['network engineer', 'sre', 'reliability engineer'],
      'devops': ['devops', 'platform engineering', 'site reliability'],
      'okta': ['okta', 'okta sso'],
      'cloudflare': ['cloudflare'],
      'datadog': ['datadog'],
      'pam': ['privileged access', 'pam', 'cyberark'],
      'siem': ['siem', 'splunk', 'elastic siem'],
      'iam': ['iam', 'identity and access', 'identity management'],
      'python': ['python'],
      'go': ['golang', 'go language'],
      'rust': ['rust'],
    };

    const found: string[] = [];
    for (const [keyword, patterns] of Object.entries(keywordMap)) {
      if (patterns.some(p => text.includes(p))) found.push(keyword);
    }
    return found;
  }

  private analyzeHiringSignals(jobs: JobListing[]): NonNullable<CompanyEnrichment['hiring_signals']> {
    const signals: NonNullable<CompanyEnrichment['hiring_signals']> = [];
    const allTitles = jobs.map(j => j.title.toLowerCase()).join(' ');

    const departments: Record<string, { roles: string[]; keywords: string[] }> = {
      'Security': { roles: ['security engineer', 'ciso', 'infosec', 'soc', 'compliance', 'devsecops'], keywords: ['zero trust', 'vpn', 'iam', 'siem', 'identity'] },
      'IT / Infrastructure': { roles: ['it engineer', 'network engineer', 'sysadmin', 'infrastructure engineer', 'platform'], keywords: ['vpn', 'network', 'active directory', 'on-prem'] },
      'Engineering': { roles: ['software engineer', 'backend', 'sre', 'devops', 'cloud engineer'], keywords: ['kubernetes', 'terraform', 'aws', 'platform engineering'] },
      'Product': { roles: ['product manager', 'product lead', 'technical pm'], keywords: ['enterprise', 'self-hosted', 'on-premise'] },
    };

    for (const [dept, dc] of Object.entries(departments)) {
      const matchedRoles = dc.roles.filter(r => allTitles.includes(r));
      const matchedKw = dc.keywords.filter(k => allTitles.includes(k));
      if (matchedRoles.length > 0 || matchedKw.length > 0) {
        signals.push({ role: matchedRoles[0] || dept, keywords: matchedKw, department: dept });
      }
    }

    return signals;
  }
}

interface JobListing {
  title: string;
  url: string;
  description?: string;
  keywords: string[];
  source: string;
}

interface GreenhouseJob {
  title: string;
  absolute_url: string;
  location?: { name: string };
}

interface LeverPosting {
  text: string;
  hostedUrl: string;
  categories?: { team?: string; department?: string };
}

interface WorkdayJob {
  title: string;
  externalPath: string;
}
