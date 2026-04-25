import { braveWebSearch, type BraveSearchResult } from './braveSearch.js';
import { googleCustomSearch, type GoogleSearchResult } from './googleSearch.js';
import { serperWebSearch, type SerperSearchResult } from './serperSearch.js';
import { getDataSourceConfigs } from '../enrichment/service.js';
import type { CampaignParsed, FunnelStepConfig } from '../../types/index.js';
import type { ExtendedICPConfig } from '../prompts/research.js';
import type { ActivityLogger } from '../activityLogger.js';

/** Common web search result shape (identical across Brave, Google, and Serper providers) */
export type WebSearchResult = BraveSearchResult & GoogleSearchResult & SerperSearchResult;

interface DiscoveryQuery {
  query: string;
  source: 'thesis' | 'pattern' | 'technology' | 'signal' | 'geo';
  label: string;
}

interface SearchResultGroup {
  label: string;
  results: WebSearchResult[];
}

export function buildDiscoveryQueries(
  campaign: CampaignParsed,
  icpConfig: ExtendedICPConfig,
  step: FunnelStepConfig
): DiscoveryQuery[] {
  const queries: DiscoveryQuery[] = [];
  const maxQueries = step.search_max_queries || 8;

  // 1. Pattern thesis — extract key concept and form discovery query
  const thesis = campaign.pattern_thesis;
  if (thesis) {
    // Use first ~80 chars of thesis as a focused query
    const thesisQuery = thesis.length > 100
      ? thesis.substring(0, thesis.indexOf('.', 60) + 1 || 100).trim()
      : thesis;
    queries.push({
      query: `${thesisQuery} companies list`,
      source: 'thesis',
      label: 'Pattern thesis search',
    });
  }

  // 2. Search patterns — one query per vertical
  const patterns = campaign.search_patterns || [];
  for (const pattern of patterns.slice(0, 4)) {
    const keywords = (pattern.keywords || []).slice(0, 3).join(' ');
    const name = pattern.name || '';
    if (name) {
      queries.push({
        query: `"${name}" companies ${keywords} 2025 2026`.trim(),
        source: 'pattern',
        label: `Vertical: ${name}`,
      });
    }
  }

  // 3. Technology categories — group into 1-2 queries
  const techCats = step.technology_categories || [];
  if (techCats.length > 0) {
    const chunk1 = techCats.slice(0, 4).join(' ');
    queries.push({
      query: `${chunk1} companies enterprise startups`,
      source: 'technology',
      label: `Tech categories: ${techCats.slice(0, 4).join(', ')}`,
    });
    if (techCats.length > 4) {
      const chunk2 = techCats.slice(4, 8).join(' ');
      queries.push({
        query: `${chunk2} companies enterprise`,
        source: 'technology',
        label: `Tech categories: ${techCats.slice(4, 8).join(', ')}`,
      });
    }
  }

  // 4. Target signals — convert to search queries
  const signals = campaign.target_signals || [];
  const signalText = signals.slice(0, 3).filter(Boolean);
  if (signalText.length > 0) {
    queries.push({
      query: `${signalText.join(' ')} companies 2025 2026`,
      source: 'signal',
      label: `Buying signals: ${signalText.join(', ')}`,
    });
  }

  // 5. Geographic variant — if geo focus is set, add a geo-scoped thesis query
  const geoFocus = step.geographic_focus || [];
  if (geoFocus.length > 0 && geoFocus.length <= 3) {
    const geoTerms = geoFocus.slice(0, 2).join(' ');
    queries.push({
      query: `enterprise companies ${geoTerms} remote access infrastructure`,
      source: 'geo',
      label: `Geographic: ${geoTerms}`,
    });
  }

  // 6. Example company neighbors — find similar companies
  const examples = (campaign.example_companies || []).slice(0, 2);
  for (const ex of examples) {
    const name = typeof ex === 'string' ? ex : ex.name;
    if (name) {
      queries.push({
        query: `companies similar to "${name}" competitors alternatives`,
        source: 'pattern',
        label: `Similar to: ${name}`,
      });
    }
  }

  return queries.slice(0, maxQueries);
}

export async function executeDiscoverySearches(
  queries: DiscoveryQuery[],
  apiKey: string,
  maxResultsPerQuery: number = 5,
  logger?: ActivityLogger,
  provider: 'brave' | 'google' | 'serper' = 'brave',
  cseId?: string
): Promise<SearchResultGroup[]> {
  const groups: SearchResultGroup[] = [];

  const doSearch = provider === 'serper'
    ? (query: string, count: number) => serperWebSearch(query, apiKey, count)
    : provider === 'google' && cseId
      ? (query: string, count: number) => googleCustomSearch(query, apiKey, cseId!, count)
      : (query: string, count: number) => braveWebSearch(query, apiKey, count);

  for (const q of queries) {
    try {
      const results = await doSearch(q.query, maxResultsPerQuery);
      groups.push({ label: q.label, results });

      // 200ms stagger to respect rate limits
      if (queries.indexOf(q) < queries.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err: any) {
      if (err.status === 429) {
        logger?.thinking('discover', `Search rate limited on "${q.label}" — waiting 1s and retrying`);
        await new Promise(r => setTimeout(r, 1000));
        try {
          const results = await doSearch(q.query, maxResultsPerQuery);
          groups.push({ label: q.label, results });
        } catch {
          logger?.thinking('discover', `Search retry failed for "${q.label}" — skipping`);
        }
      } else {
        logger?.thinking('discover', `Search failed for "${q.label}": ${err.message || err} — skipping`);
      }
    }
  }

  return groups;
}

export function structureSearchResults(groups: SearchResultGroup[]): string {
  // Deduplicate by domain
  const seen = new Map<string, { title: string; description: string; age: string | null; label: string; url: string }>();

  for (const group of groups) {
    for (const result of group.results) {
      try {
        const domain = new URL(result.url).hostname.replace(/^www\./, '');
        // Keep the first (highest-ranked) result per domain
        if (!seen.has(domain)) {
          seen.set(domain, {
            title: result.title,
            description: result.description.substring(0, 200),
            age: result.age,
            label: group.label,
            url: result.url,
          });
        }
      } catch {
        // Skip malformed URLs
      }
    }
  }

  if (seen.size === 0) return '';

  // Group results by source label for readability
  const byLabel = new Map<string, string[]>();
  for (const [domain, r] of seen) {
    const lines = byLabel.get(r.label) || [];
    const ageSuffix = r.age ? ` [${r.age}]` : '';
    lines.push(`- **${r.title}** (${domain}): ${r.description}${ageSuffix}`);
    byLabel.set(r.label, lines);
  }

  const sections: string[] = [];
  for (const [label, lines] of byLabel) {
    sections.push(`### ${label}\n${lines.join('\n')}`);
  }

  return `${sections.join('\n\n')}\n\n_${seen.size} unique results from ${groups.length} searches_`;
}

export async function runSearchAugmentedDiscovery(
  campaign: CampaignParsed,
  icpConfig: ExtendedICPConfig,
  step: FunnelStepConfig,
  logger?: ActivityLogger
): Promise<string | undefined> {
  // Check available search providers (prefer Serper > Brave > Google)
  const configs = getDataSourceConfigs();
  const serperConfig = configs.find(c => c.id === 'serper_search');
  const braveConfig = configs.find(c => c.id === 'web_search');
  const googleConfig = configs.find(c => c.id === 'google_search');

  let provider: 'brave' | 'google' | 'serper';
  let apiKey: string;
  let cseId: string | undefined;

  if (serperConfig?.api_key) {
    provider = 'serper';
    apiKey = serperConfig.api_key;
    logger?.thinking('discover', 'Using Serper.dev (Google results) for web discovery');
  } else if (braveConfig?.api_key) {
    provider = 'brave';
    apiKey = braveConfig.api_key;
    logger?.thinking('discover', 'Using Brave Search for web discovery');
  } else if (googleConfig?.api_key && googleConfig.settings?.cse_id) {
    provider = 'google';
    apiKey = googleConfig.api_key;
    cseId = googleConfig.settings.cse_id;
    logger?.thinking('discover', 'Using Google Custom Search for web discovery (100 free queries/day)');
  } else {
    logger?.thinking('discover', 'No web search API configured — falling back to AI-only discovery. Configure Serper.dev, Brave Search, or Google Custom Search in Data Sources.');
    return undefined;
  }

  // Build queries from campaign config
  const queries = buildDiscoveryQueries(campaign, icpConfig, step);
  const providerLabel = provider === 'serper' ? 'Serper.dev' : provider === 'brave' ? 'Brave' : 'Google';
  logger?.thinking('discover', `Running ${queries.length} web searches via ${providerLabel}...`, {
    queries: queries.map(q => q.label),
    provider,
  });

  // Execute searches
  const maxResults = step.search_max_results_per_query || 5;
  const groups = await executeDiscoverySearches(queries, apiKey, maxResults, logger, provider, cseId);

  // Structure results
  const context = structureSearchResults(groups);
  const totalResults = groups.reduce((sum, g) => sum + g.results.length, 0);
  const uniqueDomains = new Set<string>();
  for (const g of groups) {
    for (const r of g.results) {
      try { uniqueDomains.add(new URL(r.url).hostname.replace(/^www\./, '')); } catch {}
    }
  }

  logger?.thinking('discover', `Web search complete — ${totalResults} raw results, ${uniqueDomains.size} unique domains`, {
    total_results: totalResults,
    unique_domains: uniqueDomains.size,
    queries_executed: groups.length,
  });

  return context || undefined;
}
