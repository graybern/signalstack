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
  const enrichments: Partial<CompanyEnrichment>[] = [];
  let discoveredLinkedinUrl = candidate.linkedin_company_url || '';

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
        enrichments.push(enrichment);
        if (enrichment.linkedin_url && !discoveredLinkedinUrl) {
          discoveredLinkedinUrl = enrichment.linkedin_url;
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ source: sourceConfig.id, error: errorMsg });
    }
  }

  if (enrichments.length === 0) {
    return { candidate: { ...candidate, enrichment_source_count: candidate.enrichment_source_count || 0 }, wasEnriched: false, sourcesHit: 0 };
  }

  // Merge enrichments into candidate
  const merged = mergeEnrichments(enrichments);
  const enrichedCandidate = applyCandidateEnrichment(candidate, merged);
  enrichedCandidate.enrichment_source_count = (candidate.enrichment_source_count || 0) + enrichments.length;

  return { candidate: enrichedCandidate, wasEnriched: true, sourcesHit: enrichments.length };
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
      newSignals.push(`[News] ${news.title}`);
    }
  }

  if (enrichment.job_postings?.length) {
    const relevantJobs = enrichment.job_postings.slice(0, 2);
    for (const job of relevantJobs) {
      newSignals.push(`[Jobs] ${job.title}`);
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
      newSources.push(news.url);
    }
  }
  updated.sources = newSources;

  return updated;
}
