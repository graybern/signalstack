/**
 * Data Source & Enrichment Types
 *
 * Each data source is a pluggable module that can enrich research candidates
 * with real-time data from external APIs.
 */

export type DataSourceId =
  | 'web_search'
  | 'google_search'
  | 'serper_search'
  | 'crunchbase'
  | 'linkedin'
  | 'apollo'
  | 'clearbit'
  | 'salesforce'
  | 'sixsense'
  | 'hunter'
  | 'builtwith'
  // Free sources (no API key required)
  | 'website_analysis'
  | 'github_presence'
  | 'job_postings'
  | 'dns_fingerprint'
  | 'wikipedia'
  | 'google_news'
  | 'hacker_news'
  | 'tech_fingerprint';

export interface DataSourceConfig {
  id: DataSourceId;
  name: string;
  description: string;
  category: 'research' | 'company_data' | 'people' | 'intent' | 'crm' | 'technographics' | 'firmographics';
  enabled: boolean;
  requires_key: boolean;
  api_key?: string;
  settings: Record<string, any>;
  status: 'active' | 'error' | 'unconfigured';
  last_used?: string;
  error_message?: string;
}

export interface EnrichmentResult {
  source: DataSourceId;
  company_name: string;
  data: Record<string, any>;
  confidence: 'high' | 'medium' | 'low';
  fetched_at: string;
}

export interface CompanyEnrichment {
  // Crunchbase / Apollo / Clearbit data
  employee_count?: number;
  employee_count_source?: DataSourceId;
  employee_count_type?: 'fte' | 'total_headcount' | 'unknown';
  founded_year?: number;
  hq_location?: string;
  funding_stage?: string;
  total_funding?: string;
  last_funding_date?: string;
  last_funding_amount?: string;
  investors?: string[];
  revenue_estimate?: string;
  industry?: string;
  sub_industry?: string;
  description?: string;
  website?: string;
  linkedin_url?: string;
  tech_stack?: string[];  // BuiltWith / Clearbit tech data
  /**
   * Structured tech signals with multi-source corroboration.
   * Each signal tracks which sources confirmed it and auto-calculates confidence:
   *   1 source = low, 2 sources = medium, 3+ sources = high
   */
  tech_signals?: {
    signal: string;
    sources: DataSourceId[];
    confidence: 'high' | 'medium' | 'low';
    evidence?: string;
  }[];
  keywords?: string[];
  // CRM data
  in_crm?: boolean;
  crm_status?: string;
  crm_owner?: string;
  // Intent data
  intent_signals?: { topic: string; score: number; source: DataSourceId }[];
  // People data
  key_people?: {
    name: string;
    title: string;
    linkedin_url?: string;
    email?: string;
    department?: string;
    source: DataSourceId;
  }[];
  // Web search results
  recent_news?: { title: string; url: string; date?: string; snippet: string }[];
  job_postings?: { title: string; url: string; keywords: string[] }[];
  // Website analysis
  deployment_models?: string[];
  pricing_tiers?: string[];
  product_keywords?: string[];
  // GitHub data
  github_repos?: { name: string; stars: number; language: string; description: string }[];
  github_contributor_count?: number;
  open_source_presence?: 'strong' | 'moderate' | 'none';
  // Job/hiring signals
  hiring_signals?: { role: string; keywords: string[]; department: string }[];
  // DNS/tech fingerprint
  dns_email_provider?: string;
  dns_services_detected?: string[];
  http_tech_stack?: string[];
  ssl_org?: string;
  // Wikipedia/Wikidata
  wikipedia_summary?: string;
}

export interface EnrichmentSummary {
  total_candidates: number;
  enriched_count: number;
  sources_used: DataSourceId[];
  errors: { source: DataSourceId; error: string }[];
  duration_ms: number;
}

/**
 * Interface that each data source adapter must implement.
 */
export interface DataSourceAdapter {
  id: DataSourceId;

  /** Check if the source is configured and reachable */
  healthCheck(config: DataSourceConfig): Promise<{ ok: boolean; message: string }>;

  /** Enrich a single company */
  enrichCompany(
    companyName: string,
    domain: string | null,
    config: DataSourceConfig
  ): Promise<Partial<CompanyEnrichment>>;
}

/**
 * Default configurations for all available data sources.
 */
export function getDefaultDataSources(): DataSourceConfig[] {
  return [
    // --- Free sources (no API key required) ---
    {
      id: 'website_analysis',
      name: 'Company Website Analysis',
      description: 'Fetches company websites to extract product info, deployment models, pricing tiers, and tech keywords. Critical for identifying self-hosted/on-prem deployment evidence.',
      category: 'research',
      requires_key: false,
      enabled: true,
      settings: {
        max_pages: 5,
        look_for: ['pricing', 'products', 'about', 'docs', 'self-hosted', 'on-premise'],
        timeout_ms: 5000,
      },
      status: 'active',
    },
    {
      id: 'github_presence',
      name: 'GitHub Presence',
      description: 'Searches GitHub for company repositories, open-source projects, and tech stack indicators. Optional API token for higher rate limits.',
      category: 'technographics',
      requires_key: false,
      enabled: true,
      settings: {
        max_repos: 10,
        check_topics: true,
        look_for_self_hosted: true,
      },
      status: 'active',
    },
    {
      id: 'job_postings',
      name: 'Job Postings Analysis',
      description: 'Analyzes company career pages for hiring signals — tech stack, growth indicators, and infrastructure investment patterns.',
      category: 'research',
      requires_key: false,
      enabled: true,
      settings: {
        max_listings: 20,
        keyword_categories: ['infrastructure', 'security', 'networking', 'cloud', 'devops'],
      },
      status: 'active',
    },
    {
      id: 'dns_fingerprint',
      name: 'DNS & Tech Fingerprint',
      description: 'Analyzes DNS records (MX, TXT, SPF) and HTTP headers to detect email providers, SaaS tools, and infrastructure choices.',
      category: 'technographics',
      requires_key: false,
      enabled: true,
      settings: {
        check_mx: true,
        check_txt: true,
        check_http_headers: true,
        timeout_ms: 3000,
      },
      status: 'active',
    },
    {
      id: 'wikipedia',
      name: 'Wikipedia / Wikidata',
      description: 'Retrieves company information from Wikipedia and Wikidata — employee counts, founding year, HQ location, and industry classification.',
      category: 'firmographics',
      requires_key: false,
      enabled: true,
      settings: {
        include_wikidata: true,
        fallback_to_search: true,
      },
      status: 'active',
    },
    {
      id: 'google_news',
      name: 'Google News RSS',
      description: 'Fetches recent news articles via Google News RSS. No API key required. Surfaces press releases, funding announcements, security incidents, and tech mentions.',
      category: 'research',
      requires_key: false,
      enabled: true,
      settings: {
        max_results: 10,
        timeout_ms: 8000,
      },
      status: 'active',
    },
    {
      id: 'hacker_news',
      name: 'Hacker News',
      description: 'Searches Hacker News via the Algolia API for company discussions, "Who\'s Hiring" signals, and tech community sentiment. Best for dev-forward companies.',
      category: 'research',
      requires_key: false,
      enabled: true,
      settings: {
        max_results: 8,
        timeout_ms: 6000,
      },
      status: 'active',
    },
    {
      id: 'tech_fingerprint',
      name: 'Tech Fingerprint (Wappalyzer-style)',
      description: 'Scans company website script tags, CDN domains, and inline code to detect actual loaded technologies — auth providers, observability tools, analytics platforms, and more.',
      category: 'technographics',
      requires_key: false,
      enabled: true,
      settings: {
        timeout_ms: 6000,
        scan_login_page: true,
      },
      status: 'active',
    },
    // --- API-connected sources (require API key) ---
    {
      id: 'serper_search',
      name: 'Serper.dev (Google Results)',
      description: 'Google search results via Serper.dev API. 2,500 free queries to start, then affordable paid plans.',
      category: 'research',
      requires_key: true,
      enabled: false,
      settings: {
        max_results_per_query: 10,
      },
      status: 'unconfigured',
    },
    {
      id: 'web_search',
      name: 'Web Search',
      description: 'Real-time web search for company news, job postings, and recent activity. Uses Brave Search API for structured results.',
      category: 'research',
      requires_key: true,
      enabled: false,
      settings: {
        max_results_per_query: 10,
        search_types: ['company_news', 'job_postings', 'funding', 'tech_stack'],
      },
      status: 'unconfigured',
    },
    {
      id: 'google_search',
      name: 'Google Custom Search',
      description: 'Google-powered web search (100 free queries/day). Requires a Google API key and Custom Search Engine ID.',
      category: 'research',
      requires_key: true,
      enabled: false,
      settings: {
        max_results_per_query: 10,
        cse_id: '',
      },
      status: 'unconfigured',
    },
    {
      id: 'crunchbase',
      name: 'Crunchbase',
      description: 'Company data, funding rounds, investors, employee counts, and acquisitions. Best source for startup/growth company intelligence.',
      category: 'company_data',
      requires_key: true,
      enabled: false,
      settings: {
        include_funding_rounds: true,
        include_investors: true,
        include_acquisitions: true,
        include_news: true,
      },
      status: 'unconfigured',
    },
    {
      id: 'apollo',
      name: 'Apollo.io',
      description: 'Company enrichment + people database. Find decision-makers with verified emails, titles, and departments. Best all-in-one enrichment source.',
      category: 'people',
      requires_key: true,
      enabled: false,
      settings: {
        enrich_companies: true,
        find_people: true,
        max_people_per_company: 5,
        target_titles: [],  // Populated from buyer persona config
        verified_emails_only: true,
      },
      status: 'unconfigured',
    },
    {
      id: 'clearbit',
      name: 'Clearbit (HubSpot)',
      description: 'Company enrichment, tech stack detection, and firmographics. Now part of HubSpot — free tier available for basic lookups.',
      category: 'company_data',
      requires_key: true,
      enabled: false,
      settings: {
        include_tech_stack: true,
        include_firmographics: true,
        reveal_anonymous_traffic: false,
      },
      status: 'unconfigured',
    },
    {
      id: 'linkedin',
      name: 'LinkedIn Company Page',
      description: 'Public LinkedIn company page scraping for accurate employee count. No API key required.',
      category: 'firmographics',
      requires_key: false,
      enabled: true,
      settings: {
        scrape_employee_count: true,
      },
      status: 'active',
    },
    {
      id: 'salesforce',
      name: 'Salesforce CRM',
      description: 'Check existing accounts, open opportunities, and contact history. Prevents duplicating known accounts and surfaces warm leads.',
      category: 'crm',
      requires_key: true,
      enabled: false,
      settings: {
        instance_url: '',
        check_accounts: true,
        check_opportunities: true,
        check_contacts: true,
        exclude_existing_customers: true,
        exclude_open_opportunities: false,
      },
      status: 'unconfigured',
    },
    {
      id: 'sixsense',
      name: '6sense',
      description: 'B2B intent data and predictive analytics. Identifies companies actively researching your solution category based on anonymous web behavior.',
      category: 'intent',
      requires_key: true,
      enabled: false,
      settings: {
        include_intent_topics: true,
        min_intent_score: 60,
        buying_stage_filter: ['awareness', 'consideration', 'decision'],
      },
      status: 'unconfigured',
    },
    {
      id: 'hunter',
      name: 'Hunter.io',
      description: 'Email finder and verifier. Find professional email addresses for decision-makers identified by other sources.',
      category: 'people',
      requires_key: true,
      enabled: false,
      settings: {
        verify_emails: true,
        max_emails_per_company: 5,
        target_departments: ['IT', 'Engineering', 'Security'],
      },
      status: 'unconfigured',
    },
    {
      id: 'builtwith',
      name: 'BuiltWith',
      description: 'Technology profiling — detect what tools, frameworks, and infrastructure a company uses. Great for identifying VPN/security product usage.',
      category: 'technographics',
      requires_key: true,
      enabled: false,
      settings: {
        include_current_tech: true,
        include_historical: false,
        categories: ['security', 'networking', 'cloud', 'devops'],
      },
      status: 'unconfigured',
    },
  ];
}
