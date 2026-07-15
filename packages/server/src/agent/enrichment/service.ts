/**
 * Enrichment Service
 *
 * Orchestrates all configured data source adapters to enrich research candidates
 * with real-time data. Sits between the research phase and the scoring phase.
 *
 * Flow: Research → Enrichment → Scoring → Brief Generation
 */

import type {
  DataSourceId,
  DataSourceConfig,
  DataSourceAdapter,
  CompanyEnrichment,
  EnrichmentSummary,
} from './types.js';
import type { ResearchCandidate } from '../researcher.js';
import type { EnrichmentMetadata, LinkedInMatch } from '../../types/index.js';
import { WebSearchAdapter } from './adapters/webSearch.js';
import { CrunchbaseAdapter } from './adapters/crunchbase.js';
import { ApolloAdapter } from './adapters/apollo.js';
import { SalesforceAdapter } from './adapters/salesforce.js';
import { WebsiteAnalysisAdapter } from './adapters/websiteAnalysis.js';
import { GitHubPresenceAdapter } from './adapters/githubPresence.js';
import { JobPostingsAdapter } from './adapters/jobPostings.js';
import { DnsFingerprintAdapter } from './adapters/dnsFingerprint.js';
import { WikipediaAdapter } from './adapters/wikipedia.js';
import { GoogleNewsAdapter } from './adapters/googleNews.js';
import { HackerNewsAdapter } from './adapters/hackerNews.js';
import { TechFingerprintAdapter } from './adapters/techFingerprint.js';
import { SerperSearchAdapter } from './adapters/serperSearch.js';
import { LinkedInAdapter } from './adapters/linkedin.js';
import { getSetting } from '../../routes/icp.js';
import { getDefaultDataSources } from './types.js';
import { getDb } from '../../db/schema.js';

// Registry of all available adapters
const ADAPTERS: Record<string, DataSourceAdapter> = {
  // Free sources (no API key required)
  website_analysis: new WebsiteAnalysisAdapter(),
  github_presence: new GitHubPresenceAdapter(),
  job_postings: new JobPostingsAdapter(),
  dns_fingerprint: new DnsFingerprintAdapter(),
  wikipedia: new WikipediaAdapter(),
  google_news: new GoogleNewsAdapter(),
  hacker_news: new HackerNewsAdapter(),
  tech_fingerprint: new TechFingerprintAdapter(),
  // API-connected sources
  serper_search: new SerperSearchAdapter(),
  web_search: new WebSearchAdapter(),
  crunchbase: new CrunchbaseAdapter(),
  apollo: new ApolloAdapter(),
  salesforce: new SalesforceAdapter(),
  linkedin: new LinkedInAdapter(),
  // Future: clearbit, sixsense, hunter, builtwith
};

/**
 * Get all data source configurations (enabled + disabled).
 */
export function getDataSourceConfigs(): DataSourceConfig[] {
  const saved = getSetting('data_sources', null);
  if (!saved) return getDefaultDataSources();

  // Merge saved configs with defaults to pick up new sources
  const defaults = getDefaultDataSources();
  const savedMap = new Map((saved as DataSourceConfig[]).map(s => [s.id, s]));

  return defaults.map(d => {
    const existing = savedMap.get(d.id);
    if (existing) {
      // If the default changed from requires_key to free (or vice versa), trust the new default
      if (existing.requires_key !== d.requires_key) {
        return { ...d, settings: { ...d.settings, ...existing.settings } };
      }
      return { ...d, ...existing };
    }
    return d;
  });
}

/**
 * Get only enabled and configured data source configs.
 */
export function getEnabledSources(): DataSourceConfig[] {
  return getDataSourceConfigs().filter(s => s.enabled && (s.api_key || !s.requires_key));
}

/**
 * Run health check on a specific data source.
 */
export async function checkDataSourceHealth(
  sourceId: DataSourceId
): Promise<{ ok: boolean; message: string }> {
  const adapter = ADAPTERS[sourceId];
  if (!adapter) return { ok: false, message: `Unknown data source: ${sourceId}` };

  const configs = getDataSourceConfigs();
  const config = configs.find(c => c.id === sourceId);
  if (!config) return { ok: false, message: `No configuration for ${sourceId}` };

  return adapter.healthCheck(config);
}

/**
 * Enrich a list of research candidates with data from all enabled sources.
 *
 * This is the main entry point called by the orchestrator between
 * the research phase and the scoring phase.
 */
export async function enrichCandidates(
  candidates: ResearchCandidate[],
  options?: {
    concurrency?: number;
    sourceOverrides?: Record<string, boolean> | null;
    skipSources?: string[];
    onProgress?: (update: { candidate: string; domain: string; index: number; total: number; sourcesHit: number; sourceCount: number }) => void;
  }
): Promise<{ candidates: ResearchCandidate[]; summary: EnrichmentSummary }> {
  const startTime = Date.now();
  let enabledSources = getEnabledSources();

  // Apply campaign-level source overrides
  if (options?.sourceOverrides) {
    enabledSources = enabledSources.filter(s => {
      const override = options.sourceOverrides![s.id];
      if (override === false) return false;  // explicitly disabled
      return true;
    });
    // Also enable any sources that are globally disabled but campaign-enabled
    for (const [sourceId, enabled] of Object.entries(options.sourceOverrides)) {
      if (enabled && !enabledSources.find(s => s.id === sourceId)) {
        const allConfigs = getDataSourceConfigs();
        const config = allConfigs.find(s => s.id === sourceId);
        if (config && ADAPTERS[sourceId]) {
          enabledSources.push(config);
        }
      }
    }
  }

  // Filter out sources already run (e.g. during light enrichment)
  if (options?.skipSources?.length) {
    enabledSources = enabledSources.filter(s => !options.skipSources!.includes(s.id));
  }

  if (enabledSources.length === 0) {
    return {
      candidates,
      summary: {
        total_candidates: candidates.length,
        enriched_count: 0,
        sources_used: [],
        errors: [],
        duration_ms: 0,
      },
    };
  }

  const concurrency = options?.concurrency || 3;
  const errors: EnrichmentSummary['errors'] = [];
  let enrichedCount = 0;

  // Process candidates in batches
  const enrichedCandidates: ResearchCandidate[] = [];

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(candidate => enrichSingleCandidate(candidate, enabledSources, errors))
    );

    for (const { candidate, wasEnriched, sourcesHit } of results) {
      enrichedCandidates.push(candidate);
      if (wasEnriched) enrichedCount++;
      if (options?.onProgress) {
        options.onProgress({
          candidate: candidate.company_name,
          domain: candidate.domain,
          index: enrichedCandidates.length,
          total: candidates.length,
          sourcesHit: sourcesHit,
          sourceCount: enabledSources.length,
        });
      }
    }
  }

  const summary: EnrichmentSummary = {
    total_candidates: candidates.length,
    enriched_count: enrichedCount,
    sources_used: enabledSources.map(s => s.id),
    errors,
    duration_ms: Date.now() - startTime,
  };

  console.log(
    `[enrichment] Enriched ${enrichedCount}/${candidates.length} candidates from ${enabledSources.length} sources in ${summary.duration_ms}ms` +
    (errors.length > 0 ? `. Errors: ${errors.map(e => `${e.source}: ${e.error}`).join(', ')}` : '')
  );

  return { candidates: enrichedCandidates, summary };
}

/**
 * Enrich a single candidate from all enabled sources.
 */
async function enrichSingleCandidate(
  candidate: ResearchCandidate,
  sources: DataSourceConfig[],
  errors: EnrichmentSummary['errors']
): Promise<{ candidate: ResearchCandidate; wasEnriched: boolean; sourcesHit: number }> {
  const enrichments: { sourceId: string; data: Partial<CompanyEnrichment> }[] = [];
  const sourcesResponded: string[] = [];
  const sourcesFailed: string[] = [];
  const sourcesAvailable = sources.map(s => s.id);
  let discoveredLinkedinUrl = candidate.linkedin_company_url || '';
  const isUserCorrectedLinkedin = candidate.enrichment_metadata?.linkedin_match?.user_corrected === true;

  // Cross-campaign: inherit user-corrected LinkedIn URLs from other campaigns
  if (!discoveredLinkedinUrl && !isUserCorrectedLinkedin && candidate.domain) {
    const crossCampaign = lookupCrossCampaignLinkedIn(candidate.domain);
    if (crossCampaign) {
      discoveredLinkedinUrl = crossCampaign.url;
      candidate.linkedin_company_url = crossCampaign.url;
      candidate.enrichment_metadata = { ...(candidate.enrichment_metadata || {} as EnrichmentMetadata), linkedin_match: crossCampaign.linkedinMatch };
    }
  }

  for (const sourceConfig of sources) {
    const adapter = ADAPTERS[sourceConfig.id];
    if (!adapter) continue;

    if (discoveredLinkedinUrl) {
      sourceConfig.settings = { ...sourceConfig.settings, linkedin_url: discoveredLinkedinUrl };
    }

    try {
      const enrichment = await adapter.enrichCompany(
        candidate.company_name,
        candidate.domain,
        sourceConfig
      );
      if (Object.keys(enrichment).length > 0) {
        enrichments.push({ sourceId: sourceConfig.id, data: enrichment });
        sourcesResponded.push(sourceConfig.id);
        if (enrichment.linkedin_url && !discoveredLinkedinUrl && !isUserCorrectedLinkedin) {
          discoveredLinkedinUrl = enrichment.linkedin_url;
        }
      } else {
        sourcesResponded.push(sourceConfig.id);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ source: sourceConfig.id, error: errorMsg });
      sourcesFailed.push(sourceConfig.id);
    }
  }

  if (enrichments.length === 0) {
    const emptyMeta = buildEnrichmentMetadata([], sourcesResponded, sourcesFailed, sourcesAvailable, {} as CompanyEnrichment);
    return {
      candidate: { ...candidate, enrichment_source_count: candidate.enrichment_source_count || 0, enrichment_metadata: mergeMetadata(candidate.enrichment_metadata, emptyMeta) },
      wasEnriched: false, sourcesHit: 0,
    };
  }

  const merged = mergeEnrichments(enrichments.map(e => e.data));

  let linkedinMatch: LinkedInMatch | undefined;
  if (discoveredLinkedinUrl && !isUserCorrectedLinkedin) {
    const slugMatch = discoveredLinkedinUrl.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/);
    if (slugMatch) {
      const linkedinSources: string[] = [];
      for (const e of enrichments) {
        if (e.data.linkedin_url) linkedinSources.push(e.sourceId);
      }
      linkedinMatch = computeLinkedInConfidence(
        slugMatch[1],
        candidate.company_name,
        linkedinSources,
        merged.linkedin_page_name || null,
      );
    }
  }

  const metadata = buildEnrichmentMetadata(enrichments, sourcesResponded, sourcesFailed, sourcesAvailable, merged, linkedinMatch);
  const enrichedCandidate = applyCandidateEnrichment(candidate, merged);
  enrichedCandidate.enrichment_source_count = (candidate.enrichment_source_count || 0) + enrichments.length;
  enrichedCandidate.enrichment_metadata = mergeMetadata(candidate.enrichment_metadata, metadata);

  // Restore user-corrected URL if applyCandidateEnrichment overwrote it
  if (isUserCorrectedLinkedin && candidate.linkedin_company_url) {
    enrichedCandidate.linkedin_company_url = candidate.linkedin_company_url;
  }

  return { candidate: enrichedCandidate, wasEnriched: true, sourcesHit: enrichments.length };
}

const TRACKED_FIELDS = ['employee_count', 'hq_location', 'founded_year', 'funding_stage', 'website', 'linkedin_url'] as const;

function countCorroboration(fieldSources: Record<string, string[]>): number {
  return Object.values(fieldSources).filter(s => s.length >= 2).length;
}

function normalizeForSlugMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.'"""'']/g, '')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|tech|solutions|software|group|holdings|international|global|gmbh|ag|sa|plc|pty|bv|nv)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function slugMatchesCompanyName(slug: string, companyName: string): boolean {
  const normSlug = slug.toLowerCase().replace(/[-_]/g, '');
  const normName = normalizeForSlugMatch(companyName);
  if (!normSlug || !normName) return false;
  if (normSlug === normName) return true;
  if (normSlug.includes(normName) || normName.includes(normSlug)) return true;
  const words = companyName.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 0);
  if (words.length >= 2) {
    const initials = words.map(w => w[0]).join('');
    if (normSlug === initials) return true;
  }
  return false;
}

export function computeLinkedInConfidence(
  slug: string,
  companyName: string,
  contributingSources: string[],
  pageCompanyName: string | null,
): LinkedInMatch {
  const url = `https://www.linkedin.com/company/${slug}`;
  const slugMatches = slugMatchesCompanyName(slug, companyName);

  let pageNameMatches = false;
  if (pageCompanyName) {
    const normPage = normalizeForSlugMatch(pageCompanyName);
    const normCompany = normalizeForSlugMatch(companyName);
    pageNameMatches = normPage === normCompany
      || normPage.includes(normCompany)
      || normCompany.includes(normPage);
  }

  let confidence: 'high' | 'medium' | 'low';
  if (slugMatches && (contributingSources.length >= 2 || pageNameMatches)) {
    confidence = 'high';
  } else if (slugMatches || pageNameMatches) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    url,
    slug,
    contributing_sources: contributingSources,
    confidence,
    slug_matches_name: slugMatches,
    page_company_name: pageCompanyName,
    validated_at: new Date().toISOString(),
    user_corrected: false,
  };
}

function buildEnrichmentMetadata(
  enrichments: { sourceId: string; data: Partial<CompanyEnrichment> }[],
  sourcesResponded: string[],
  sourcesFailed: string[],
  sourcesAvailable: string[],
  merged: CompanyEnrichment,
  linkedinMatch?: LinkedInMatch,
): EnrichmentMetadata {
  const field_completeness = {
    employee_count: !!merged.employee_count,
    hq_location: !!merged.hq_location,
    founded_year: !!merged.founded_year,
    funding_stage: !!merged.funding_stage,
    website: !!merged.website,
    linkedin_url: !!merged.linkedin_url,
  };

  const field_sources: Record<string, string[]> = {};
  for (const field of TRACKED_FIELDS) {
    const contributing: string[] = [];
    for (const e of enrichments) {
      const val = (e.data as any)[field];
      if (val != null && val !== '' && val !== 0) {
        contributing.push(e.sourceId);
      }
    }
    if (contributing.length > 0) {
      field_sources[field] = contributing;
    }
  }

  return {
    sources_responded: sourcesResponded,
    sources_failed: sourcesFailed,
    sources_available: sourcesAvailable,
    field_completeness,
    field_sources,
    corroboration_count: countCorroboration(field_sources),
    ...(linkedinMatch ? { linkedin_match: linkedinMatch } : {}),
  };
}

function mergeMetadata(existing: EnrichmentMetadata | undefined, incoming: EnrichmentMetadata): EnrichmentMetadata {
  if (!existing) return incoming;
  const merged_responded = [...new Set([...existing.sources_responded, ...incoming.sources_responded])];
  // Remove from failed any source that later succeeded
  const merged_failed = [...new Set([...existing.sources_failed, ...incoming.sources_failed])]
    .filter(s => !merged_responded.includes(s));
  const merged_available = [...new Set([...existing.sources_available, ...incoming.sources_available])];

  const merged_field_sources: Record<string, string[]> = { ...existing.field_sources };
  for (const [field, sources] of Object.entries(incoming.field_sources)) {
    merged_field_sources[field] = [...new Set([...(merged_field_sources[field] || []), ...sources])];
  }

  const merged_completeness = { ...existing.field_completeness };
  for (const [k, v] of Object.entries(incoming.field_completeness) as [keyof typeof merged_completeness, boolean][]) {
    if (v) merged_completeness[k] = true;
  }

  return {
    sources_responded: merged_responded,
    sources_failed: merged_failed,
    sources_available: merged_available,
    field_completeness: merged_completeness,
    field_sources: merged_field_sources,
    corroboration_count: countCorroboration(merged_field_sources),
    linkedin_match: existing?.linkedin_match?.user_corrected
      ? existing.linkedin_match
      : (incoming.linkedin_match || existing.linkedin_match),
  };
}

function lookupCrossCampaignLinkedIn(domain: string): { url: string; linkedinMatch: LinkedInMatch } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT linkedin_company_url, enrichment_metadata
    FROM leads
    WHERE domain = ?
      AND linkedin_company_url IS NOT NULL
      AND json_extract(enrichment_metadata, '$.linkedin_match.user_corrected') = 1
    ORDER BY json_extract(enrichment_metadata, '$.linkedin_match.validated_at') DESC
    LIMIT 1
  `).get(domain) as any;

  if (!row) return null;
  try {
    const metadata = JSON.parse(row.enrichment_metadata);
    return { url: row.linkedin_company_url, linkedinMatch: metadata.linkedin_match };
  } catch {
    return null;
  }
}

/**
 * Merge multiple enrichment results, preferring higher-confidence sources.
 * Priority: CRM data > Crunchbase > Apollo > Web Search
 */
function mergeEnrichments(enrichments: Partial<CompanyEnrichment>[]): CompanyEnrichment {
  const merged: CompanyEnrichment = {};

  const EMPLOYEE_SOURCE_PRIORITY: Record<string, number> = {
    salesforce: 5, linkedin: 4, apollo: 3, crunchbase: 2, serper_search: 1.5, wikipedia: 1,
  };

  for (const e of enrichments) {
    if (e.employee_count) {
      const newPriority = EMPLOYEE_SOURCE_PRIORITY[e.employee_count_source || ''] || 0;
      const existingPriority = EMPLOYEE_SOURCE_PRIORITY[merged.employee_count_source || ''] || 0;
      if (!merged.employee_count || newPriority > existingPriority) {
        merged.employee_count = e.employee_count;
        merged.employee_count_source = e.employee_count_source;
        merged.employee_count_type = e.employee_count_type;
      }
    }

    // Simple fields — first non-null wins
    if (e.founded_year && !merged.founded_year) merged.founded_year = e.founded_year;
    if (e.hq_location && !merged.hq_location) merged.hq_location = e.hq_location;
    if (e.funding_stage && !merged.funding_stage) merged.funding_stage = e.funding_stage;
    if (e.total_funding && !merged.total_funding) merged.total_funding = e.total_funding;
    if (e.last_funding_date && !merged.last_funding_date) merged.last_funding_date = e.last_funding_date;
    if (e.last_funding_amount && !merged.last_funding_amount) merged.last_funding_amount = e.last_funding_amount;
    if (e.revenue_estimate && !merged.revenue_estimate) merged.revenue_estimate = e.revenue_estimate;
    if (e.industry && !merged.industry) merged.industry = e.industry;
    if (e.description && !merged.description) merged.description = e.description;
    if (e.website && !merged.website) merged.website = e.website;
    if (e.linkedin_url && !merged.linkedin_url) merged.linkedin_url = e.linkedin_url;

    // CRM data — always overwrite (highest priority)
    if (e.in_crm !== undefined) merged.in_crm = e.in_crm;
    if (e.crm_status) merged.crm_status = e.crm_status;
    if (e.crm_owner) merged.crm_owner = e.crm_owner;

    // Merge arrays
    if (e.investors?.length) {
      merged.investors = [...(merged.investors || []), ...e.investors];
    }
    if (e.tech_stack?.length) {
      merged.tech_stack = [...new Set([...(merged.tech_stack || []), ...e.tech_stack])];
    }
    if (e.keywords?.length) {
      merged.keywords = [...new Set([...(merged.keywords || []), ...e.keywords])];
    }
    if (e.key_people?.length) {
      merged.key_people = [...(merged.key_people || []), ...e.key_people];
    }
    if (e.intent_signals?.length) {
      merged.intent_signals = [...(merged.intent_signals || []), ...e.intent_signals];
    }
    if (e.recent_news?.length) {
      merged.recent_news = [...(merged.recent_news || []), ...e.recent_news];
    }
    if (e.job_postings?.length) {
      merged.job_postings = [...(merged.job_postings || []), ...e.job_postings];
    }

    // Website analysis
    if (e.deployment_models?.length) {
      merged.deployment_models = [...new Set([...(merged.deployment_models || []), ...e.deployment_models])];
    }
    if (e.pricing_tiers?.length) {
      merged.pricing_tiers = [...new Set([...(merged.pricing_tiers || []), ...e.pricing_tiers])];
    }
    if (e.product_keywords?.length) {
      merged.product_keywords = [...new Set([...(merged.product_keywords || []), ...e.product_keywords])];
    }
    // GitHub
    if (e.github_repos?.length) {
      merged.github_repos = [...(merged.github_repos || []), ...e.github_repos];
    }
    if (e.github_contributor_count && !merged.github_contributor_count) {
      merged.github_contributor_count = e.github_contributor_count;
    }
    if (e.open_source_presence && !merged.open_source_presence) {
      merged.open_source_presence = e.open_source_presence;
    }
    // Hiring
    if (e.hiring_signals?.length) {
      merged.hiring_signals = [...(merged.hiring_signals || []), ...e.hiring_signals];
    }
    // Tech signals (structured, with multi-source corroboration)
    if (e.tech_signals?.length) {
      if (!merged.tech_signals) merged.tech_signals = [];
      for (const incoming of e.tech_signals) {
        const existing = merged.tech_signals.find(s => s.signal === incoming.signal);
        if (existing) {
          // Accumulate sources from all adapters that confirmed this signal
          for (const src of incoming.sources) {
            if (!existing.sources.includes(src)) existing.sources.push(src);
          }
          // Recalculate confidence based on total corroborating source count
          const count = existing.sources.length;
          existing.confidence = count >= 3 ? 'high' : count >= 2 ? 'medium' : 'low';
          // Append evidence if different
          if (incoming.evidence && existing.evidence && !existing.evidence.includes(incoming.evidence)) {
            existing.evidence = `${existing.evidence}; ${incoming.evidence}`;
          } else if (incoming.evidence && !existing.evidence) {
            existing.evidence = incoming.evidence;
          }
        } else {
          merged.tech_signals.push({ ...incoming, sources: [...incoming.sources] });
        }
      }
    }
    // DNS
    if (e.dns_email_provider && !merged.dns_email_provider) {
      merged.dns_email_provider = e.dns_email_provider;
    }
    if (e.dns_services_detected?.length) {
      merged.dns_services_detected = [...new Set([...(merged.dns_services_detected || []), ...e.dns_services_detected])];
    }
    if (e.http_tech_stack?.length) {
      merged.http_tech_stack = [...new Set([...(merged.http_tech_stack || []), ...e.http_tech_stack])];
    }
    // Wikipedia
    if (e.wikipedia_summary && !merged.wikipedia_summary) {
      merged.wikipedia_summary = e.wikipedia_summary;
    }
  }

  // Deduplicate people by name
  if (merged.key_people?.length) {
    const seen = new Set<string>();
    merged.key_people = merged.key_people.filter(p => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return merged;
}

/**
 * Apply enrichment data back to the research candidate.
 * Updates fields with higher-quality data from enrichment sources,
 * and appends enrichment findings to signals and notes.
 */
function applyCandidateEnrichment(
  candidate: ResearchCandidate,
  enrichment: CompanyEnrichment
): ResearchCandidate {
  const updated = { ...candidate };
  const enrichmentNotes: string[] = [];

  // Override with better data — cross-validate employee count
  if (enrichment.employee_count) {
    const discoverEst = candidate.employee_count_estimate;
    const enrichEst = enrichment.employee_count;
    const isPublic = /public|ipo/i.test(candidate.funding_stage || enrichment.funding_stage || '');

    if (!discoverEst || discoverEst === 0) {
      updated.employee_count_estimate = enrichEst;
      enrichmentNotes.push(`Employee count (${enrichment.employee_count_source}): ${enrichEst}`);
    } else if (enrichment.employee_count_source && ['salesforce', 'linkedin', 'apollo'].includes(enrichment.employee_count_source)) {
      updated.employee_count_estimate = enrichEst;
      enrichmentNotes.push(`Employee count updated from ${enrichment.employee_count_source}: ${enrichEst}`);
    } else {
      const ratio = Math.max(discoverEst, enrichEst) / Math.max(Math.min(discoverEst, enrichEst), 1);
      if (ratio > 5) {
        const enrichType = enrichment.employee_count_type || 'unknown';
        let chosen: number;
        if (enrichType === 'total_headcount') {
          chosen = enrichEst;
        } else {
          chosen = Math.min(discoverEst, enrichEst);
        }
        updated.employee_count_estimate = chosen;
        enrichmentNotes.push(`Employee count: discover=${discoverEst}, enrichment=${enrichEst} (${enrichment.employee_count_source}, ${enrichType}) — ${ratio.toFixed(0)}x divergence, using ${chosen}`);
      } else {
        updated.employee_count_estimate = enrichEst;
        enrichmentNotes.push(`Employee count updated from ${enrichment.employee_count_source}: ${enrichEst}`);
      }
    }
  }

  if (enrichment.hq_location && !candidate.hq_location) {
    updated.hq_location = enrichment.hq_location;
  }

  if (enrichment.founded_year && !candidate.founded_year) {
    updated.founded_year = enrichment.founded_year;
  }

  if (enrichment.funding_stage && !candidate.funding_stage) {
    updated.funding_stage = enrichment.funding_stage;
  }

  if (enrichment.total_funding && !candidate.total_funding) {
    updated.total_funding = enrichment.total_funding;
  }

  if (enrichment.investors?.length && !candidate.investors) {
    updated.investors = enrichment.investors.join(', ');
  }

  if (enrichment.linkedin_url) {
    updated.linkedin_company_url = enrichment.linkedin_url;
  }

  // Add enrichment signals
  const newSignals: string[] = [...(candidate.signals || [])];

  if (enrichment.in_crm) {
    newSignals.push(`[CRM] Already in Salesforce: ${enrichment.crm_status || 'Account exists'}`);
    if (enrichment.crm_owner) {
      enrichmentNotes.push(`CRM owner: ${enrichment.crm_owner}`);
    }
  }

  if (enrichment.intent_signals?.length) {
    for (const signal of enrichment.intent_signals.slice(0, 3)) {
      newSignals.push(`[Intent] ${signal.topic} (score: ${signal.score})`);
    }
  }

  if (enrichment.tech_stack?.length) {
    const relevantTech = enrichment.tech_stack.slice(0, 10).join(', ');
    enrichmentNotes.push(`Tech stack: ${relevantTech}`);
  }

  // Tech signals with confidence + corroboration
  if (enrichment.tech_signals?.length) {
    const highConf = enrichment.tech_signals.filter(s => s.confidence === 'high');
    const medConf = enrichment.tech_signals.filter(s => s.confidence === 'medium');
    const lowConf = enrichment.tech_signals.filter(s => s.confidence === 'low');

    if (highConf.length > 0) {
      newSignals.push(`[TechStack] Confirmed (high): ${highConf.map(s => s.signal).join(', ')}`);
    }
    if (medConf.length > 0) {
      newSignals.push(`[TechStack] Likely (medium): ${medConf.map(s => s.signal).join(', ')}`);
    }
    if (lowConf.length > 0) {
      enrichmentNotes.push(`Tech signals (low confidence): ${lowConf.map(s => s.signal).join(', ')}`);
    }

    // Full corroboration detail in notes
    const signalDetails = enrichment.tech_signals
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.confidence] - order[b.confidence];
      })
      .slice(0, 20)
      .map(s => `${s.signal} [${s.confidence}, ${s.sources.length} source${s.sources.length > 1 ? 's' : ''}: ${s.sources.join('+')}]${s.evidence ? ` — ${s.evidence}` : ''}`)
      .join('\n  ');
    enrichmentNotes.push(`Tech signal details:\n  ${signalDetails}`);
  }

  if (enrichment.recent_news?.length) {
    for (const news of enrichment.recent_news.slice(0, 3)) {
      newSignals.push(`[News] ${news.title}${news.url ? ` (${news.url})` : ''}`);
    }
  }

  if (enrichment.job_postings?.length) {
    const relevantJobs = enrichment.job_postings.slice(0, 2);
    for (const job of relevantJobs) {
      newSignals.push(`[Jobs] ${job.title}${job.url ? ` (${job.url})` : ''}`);
    }
  }

  if (enrichment.key_people?.length) {
    const topPeople = enrichment.key_people.slice(0, 5);
    updated.key_people = topPeople.map(p => ({
      name: p.name,
      title: p.title || 'Unknown title',
      linkedin_url: p.linkedin_url,
    }));
    enrichmentNotes.push(
      `Key contacts: ${topPeople.map(p => `${p.name} (${p.title || 'unknown title'})`).join(', ')}`
    );
  }

  if (enrichment.last_funding_amount) {
    enrichmentNotes.push(`Latest funding: ${enrichment.last_funding_amount} (${enrichment.last_funding_date || 'date unknown'})`);
  }

  if (enrichment.revenue_estimate) {
    enrichmentNotes.push(`Revenue estimate: ${enrichment.revenue_estimate}`);
  }

  // Website deployment models
  if (enrichment.deployment_models?.length) {
    for (const model of enrichment.deployment_models) {
      newSignals.push(`[Website] ${model}`);
    }
  }
  if (enrichment.product_keywords?.length) {
    enrichmentNotes.push(`Product keywords: ${enrichment.product_keywords.slice(0, 15).join(', ')}`);
  }

  // GitHub presence
  if (enrichment.github_repos?.length) {
    const totalStars = enrichment.github_repos.reduce((sum, r) => sum + r.stars, 0);
    newSignals.push(`[GitHub] ${enrichment.github_repos.length} repos (${totalStars} total stars)`);
    if (enrichment.open_source_presence === 'strong') {
      newSignals.push(`[GitHub] Strong open-source presence`);
    }
    const topRepos = enrichment.github_repos.slice(0, 3);
    enrichmentNotes.push(`Top repos: ${topRepos.map(r => `${r.name} (${r.stars}\u2605)`).join(', ')}`);
  }

  // Hiring signals
  if (enrichment.hiring_signals?.length) {
    for (const signal of enrichment.hiring_signals.slice(0, 3)) {
      newSignals.push(`[Jobs] Hiring: ${signal.role} (${signal.department})`);
    }
  }

  // DNS/tech fingerprint
  if (enrichment.dns_email_provider) {
    enrichmentNotes.push(`Email provider: ${enrichment.dns_email_provider}`);
  }
  if (enrichment.dns_services_detected?.length) {
    enrichmentNotes.push(`Services detected (DNS): ${enrichment.dns_services_detected.join(', ')}`);
  }
  if (enrichment.http_tech_stack?.length) {
    enrichmentNotes.push(`HTTP tech: ${enrichment.http_tech_stack.join(', ')}`);
  }

  // Wikipedia
  if (enrichment.wikipedia_summary) {
    enrichmentNotes.push(`Wikipedia: ${enrichment.wikipedia_summary.substring(0, 200)}`);
  }

  updated.signals = newSignals;

  // Append enrichment notes to candidate notes
  if (enrichmentNotes.length > 0) {
    const enrichmentSection = '\n\n--- Enrichment Data ---\n' + enrichmentNotes.join('\n');
    updated.notes = (candidate.notes || '') + enrichmentSection;
  }

  // Add enrichment sources to candidate sources
  const newSources = [...(candidate.sources || [])];
  if (enrichment.recent_news?.length) {
    for (const news of enrichment.recent_news.slice(0, 3)) {
      if (news.url) newSources.push(news.url);
    }
  }
  if (enrichment.job_postings?.length) {
    for (const job of enrichment.job_postings.slice(0, 2)) {
      if (job.url) newSources.push(job.url);
    }
  }
  updated.sources = newSources;

  return updated;
}

export async function enrichFromLinkedIn(
  companyName: string,
  linkedinUrl: string,
  userCorrected: boolean,
): Promise<{
  enrichment: Partial<CompanyEnrichment>;
  linkedinMatch: LinkedInMatch;
}> {
  const adapter = ADAPTERS['linkedin'];
  const config: DataSourceConfig = {
    id: 'linkedin' as DataSourceId,
    name: 'LinkedIn Company Page',
    description: 'Targeted re-enrichment',
    category: 'firmographics',
    enabled: true,
    requires_key: false,
    settings: { linkedin_url: linkedinUrl },
    status: 'active',
  };

  const enrichment = await adapter.enrichCompany(companyName, null, config);

  const slugMatch = linkedinUrl.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/);
  const slug = slugMatch ? slugMatch[1] : linkedinUrl;

  const linkedinMatch = computeLinkedInConfidence(
    slug,
    companyName,
    userCorrected ? ['user'] : ['linkedin'],
    enrichment.linkedin_page_name || null,
  );
  linkedinMatch.user_corrected = userCorrected;

  return { enrichment, linkedinMatch };
}

// ── LinkedIn Pre-flight ─────────────────────────────────────────

export interface PreflightResult {
  domain: string;
  companyName: string;
  linkedinMatch: LinkedInMatch | null;
}

export interface PreflightResponse {
  results: PreflightResult[];
  summary: { total: number; high: number; medium: number; low: number; none: number };
}

export async function serperLinkedinSearch(
  domain: string,
  companyName: string,
): Promise<PreflightResult> {
  const configs = getDataSourceConfigs();
  const serperConfig = configs.find(c => c.id === 'serper_search');
  const apiKey = serperConfig?.api_key;

  if (!apiKey) {
    return { domain, companyName, linkedinMatch: null };
  }

  try {
    const query = `${domain} linkedin company`;
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error(`[preflight] Serper API error for ${domain}: ${response.status} — ${errBody}`);
      return { domain, companyName, linkedinMatch: null };
    }

    const data = await response.json();
    const organic: any[] = data.organic || [];

    let linkedinUrl: string | null = null;
    let pageCompanyName: string | null = null;

    for (const item of organic.slice(0, 5)) {
      const url = (item.link || '').toLowerCase();
      if (!url.includes('linkedin.com/company/')) continue;
      const match = url.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/);
      if (match) {
        linkedinUrl = `https://www.linkedin.com/company/${match[1]}`;
        const title = item.title || '';
        const pipeIdx = title.indexOf('|');
        const dashIdx = title.indexOf(' - ');
        if (pipeIdx > 0) pageCompanyName = title.substring(0, pipeIdx).trim();
        else if (dashIdx > 0) pageCompanyName = title.substring(0, dashIdx).trim();
        break;
      }
    }

    if (!linkedinUrl) {
      return { domain, companyName, linkedinMatch: null };
    }

    const slug = linkedinUrl.match(/company\/([a-zA-Z0-9_-]+)/)?.[1] || '';
    const linkedinMatch = computeLinkedInConfidence(slug, companyName, ['serper_search'], pageCompanyName);

    return { domain, companyName, linkedinMatch };
  } catch (err) {
    console.error(`[preflight] Error for ${domain}:`, err);
    return { domain, companyName, linkedinMatch: null };
  }
}

export async function linkedinPreflight(
  inputs: Array<{ domain: string; companyName?: string }>,
): Promise<PreflightResponse> {
  const CONCURRENCY = 5;
  const results: PreflightResult[] = [];
  let running = 0;
  let idx = 0;

  const items = inputs.map(inp => ({
    domain: inp.domain,
    companyName: inp.companyName || inp.domain.split('.')[0].charAt(0).toUpperCase() + inp.domain.split('.')[0].slice(1),
  }));

  await new Promise<void>(resolve => {
    function next() {
      if (results.length === items.length) { resolve(); return; }
      while (running < CONCURRENCY && idx < items.length) {
        const item = items[idx++];
        running++;
        serperLinkedinSearch(item.domain, item.companyName)
          .then(r => { results.push(r); })
          .catch(() => { results.push({ domain: item.domain, companyName: item.companyName, linkedinMatch: null }); })
          .finally(() => { running--; next(); });
      }
    }
    next();
  });

  const summary = { total: results.length, high: 0, medium: 0, low: 0, none: 0 };
  for (const r of results) {
    if (!r.linkedinMatch) summary.none++;
    else if (r.linkedinMatch.confidence === 'high') summary.high++;
    else if (r.linkedinMatch.confidence === 'medium') summary.medium++;
    else summary.low++;
  }

  return { results, summary };
}
