/**
 * Signal Convergence Checker
 *
 * When an inbound lead matches patterns from active outbound campaigns,
 * it's a strong buying signal — the company is both being targeted AND
 * showing inbound interest. This module detects those overlaps.
 */

import { getDb } from '../db/schema.js';

export interface ConvergenceResult {
  score: number; // 0-100
  matched_campaigns: { id: string; name: string; match_type: string }[];
  details: string;
}

/**
 * Check if a company (by name or domain) converges with any active campaigns.
 *
 * Two match types:
 * 1. Domain match — the company's domain appears in leads from an active campaign
 * 2. Pattern match — the company's signals match campaign search_pattern keywords
 */
export function checkConvergence(
  companyName: string,
  domain: string | null,
  signals: string[]
): ConvergenceResult {
  const db = getDb();
  const matched: ConvergenceResult['matched_campaigns'] = [];

  // Load active campaigns with their search patterns
  const campaigns = db
    .prepare("SELECT id, name, search_patterns, target_signals FROM campaigns WHERE status = 'active'")
    .all() as { id: string; name: string; search_patterns: string; target_signals: string }[];

  for (const campaign of campaigns) {
    // 1. Domain match: check if this company already appears in campaign leads
    if (domain) {
      const existingLead = db
        .prepare('SELECT id FROM leads WHERE campaign_id = ? AND (domain = ? OR company_name = ?) LIMIT 1')
        .get(campaign.id, domain, companyName) as { id: string } | undefined;

      if (existingLead) {
        matched.push({ id: campaign.id, name: campaign.name, match_type: 'domain_match' });
        continue; // Already matched, skip pattern check
      }
    }

    // 2. Pattern match: compare signals against campaign search_patterns keywords
    let searchPatterns: { keywords?: string[] }[] = [];
    let targetSignals: string[] = [];
    try { searchPatterns = JSON.parse(campaign.search_patterns || '[]'); } catch {}
    try { targetSignals = JSON.parse(campaign.target_signals || '[]'); } catch {}

    const allKeywords = [
      ...searchPatterns.flatMap(sp => sp.keywords || []),
      ...targetSignals,
    ].map(k => k.toLowerCase());

    if (allKeywords.length === 0) continue;

    const signalText = signals.join(' ').toLowerCase();
    const companyLower = companyName.toLowerCase();

    let keywordHits = 0;
    for (const keyword of allKeywords) {
      if (signalText.includes(keyword) || companyLower.includes(keyword)) {
        keywordHits++;
      }
    }

    // Require at least 2 keyword matches for pattern convergence
    if (keywordHits >= 2) {
      matched.push({ id: campaign.id, name: campaign.name, match_type: `pattern_match (${keywordHits} keywords)` });
    }
  }

  if (matched.length === 0) {
    return { score: 0, matched_campaigns: [], details: '' };
  }

  // Score: domain matches are stronger than pattern matches
  const domainMatches = matched.filter(m => m.match_type === 'domain_match').length;
  const patternMatches = matched.length - domainMatches;
  const score = Math.min(100, domainMatches * 50 + patternMatches * 30);

  const details = matched
    .map(m => `${m.name} (${m.match_type})`)
    .join('; ');

  return { score, matched_campaigns: matched, details };
}
