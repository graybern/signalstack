import { getDb } from '../../db/schema.js';
import { getSetting } from '../../routes/icp.js';
import {
  getDefaultICP,
  getDefaultCompanyContext,
  getDefaultDisqualifiers,
  getDefaultSignalWeights,
  getDefaultBuyerPersonas,
  getDefaultSegmentDetails,
  getDefaultGeographies,
  getDefaultExcludedDomainPatterns,
} from '../../config/icpDefaults.js';
import type { ExtendedICPConfig } from '../../types/index.js';

export function loadExtendedIcpConfig(
  promptConfig: any,
  icpOverrides?: Record<string, any> | null
): ExtendedICPConfig {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 1')
    .get() as Record<string, string> | undefined;

  const defaults = getDefaultICP();
  const base = row ? {
    segments: JSON.parse(row.segments),
    verticals: JSON.parse(row.verticals),
    tech_signals: JSON.parse(row.tech_signals),
    competitors: JSON.parse(row.competitors),
    success_stories: row.success_stories ? JSON.parse(row.success_stories) : {},
  } : {
    segments: defaults.segments,
    verticals: defaults.verticals,
    tech_signals: defaults.tech_signals,
    competitors: defaults.competitors,
    success_stories: defaults.success_stories,
  };

  if (icpOverrides) {
    if (icpOverrides.verticals) base.verticals = icpOverrides.verticals;
    if (icpOverrides.tech_signals) base.tech_signals = icpOverrides.tech_signals;
    if (icpOverrides.competitors) base.competitors = icpOverrides.competitors;
    if (icpOverrides.segments) base.segments = { ...base.segments, ...icpOverrides.segments };
  }

  const extended: ExtendedICPConfig = {
    ...base,
    company_context: getSetting('icp.company_context', getDefaultCompanyContext()),
    geographies: getSetting('icp.geographies', getDefaultGeographies()),
    segment_details: getSetting('icp.segment_details', getDefaultSegmentDetails()),
    disqualifiers: getSetting('icp.disqualifiers', getDefaultDisqualifiers()),
    signal_weights: getSetting('icp.signal_weights', getDefaultSignalWeights()),
    buyer_personas: getSetting('icp.buyer_personas', getDefaultBuyerPersonas()),
    excluded_domain_patterns: getSetting('icp.excluded_domain_patterns', getDefaultExcludedDomainPatterns()),
    prompt_config: promptConfig,
  };

  if (icpOverrides) {
    if (icpOverrides.disqualifiers) extended.disqualifiers = icpOverrides.disqualifiers;
    if (icpOverrides.signal_weights) extended.signal_weights = icpOverrides.signal_weights;
    if (icpOverrides.buyer_personas) extended.buyer_personas = { ...extended.buyer_personas, ...icpOverrides.buyer_personas };
    if (icpOverrides.geographies) extended.geographies = { ...extended.geographies, ...icpOverrides.geographies };
    if (icpOverrides.company_context) extended.company_context = { ...extended.company_context, ...icpOverrides.company_context };
    if (icpOverrides.segment_details) extended.segment_details = { ...extended.segment_details, ...icpOverrides.segment_details };
    if (icpOverrides.excluded_domain_patterns) extended.excluded_domain_patterns = icpOverrides.excluded_domain_patterns;
  }

  return extended;
}
