import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireOperator, AuthRequest } from '../auth/middleware.js';
import { logActivity } from '../services/activityLog.js';
import {
  getDefaultICP,
  getDefaultCompanyContext,
  getDefaultGeographies,
  getDefaultSegmentDetails,
  getDefaultDisqualifiers,
  getDefaultSignalWeights,
  getDefaultBuyerPersonas,
  getDefaultExcludedDomainPatterns,
} from '../config/icpDefaults.js';

const router = Router();

// ── ICP Config (versioned) ──────────────────────────────────────────

router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const config = db.prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 1').get();
  if (!config) return res.json(getDefaultICP());

  res.json(parseICPRow(config));
});

router.put('/', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const body = req.body;
  const db = getDb();

  const latest = db.prepare('SELECT version FROM icp_config ORDER BY version DESC LIMIT 1').get() as any;
  const version = latest ? latest.version + 1 : 1;

  const id = uuid();
  db.prepare(
    'INSERT INTO icp_config (id, version, segments, verticals, tech_signals, competitors, success_stories, updated_by) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    id, version,
    JSON.stringify(body.segments),
    JSON.stringify(body.verticals),
    JSON.stringify(body.tech_signals),
    JSON.stringify(body.competitors),
    JSON.stringify(body.success_stories || {}),
    req.user!.id
  );

  // Also save extended ICP fields to app_settings
  const extendedFields = ['company_context', 'geographies', 'segment_details', 'disqualifiers', 'signal_weights', 'buyer_personas', 'excluded_domain_patterns'];
  for (const key of extendedFields) {
    if (body[key] !== undefined) {
      saveSetting(`icp.${key}`, body[key], req.user!.id);
    }
  }

  logActivity({
    userId: req.user!.id,
    entityType: 'icp_config',
    entityId: id,
    entityTitle: `ICP v${version}`,
    action: 'created',
    snapshot: body,
  });

  res.json({ success: true, version });
});

router.get('/full', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const config = db.prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 1').get();
  const base = config ? parseICPRow(config) : getDefaultICP();

  // Merge extended fields from app_settings
  const extended = {
    company_context: getSetting('icp.company_context', getDefaultCompanyContext()),
    geographies: getSetting('icp.geographies', getDefaultGeographies()),
    segment_details: getSetting('icp.segment_details', getDefaultSegmentDetails()),
    disqualifiers: getSetting('icp.disqualifiers', getDefaultDisqualifiers()),
    signal_weights: getSetting('icp.signal_weights', getDefaultSignalWeights()),
    buyer_personas: getSetting('icp.buyer_personas', getDefaultBuyerPersonas()),
    excluded_domain_patterns: getSetting('icp.excluded_domain_patterns', getDefaultExcludedDomainPatterns()),
  };

  res.json({ ...base, ...extended });
});

router.get('/history', authenticate, (_req: AuthRequest, res: Response) => {
  const configs = getDb().prepare('SELECT * FROM icp_config ORDER BY version DESC LIMIT 20').all();
  res.json(configs.map(parseICPRow));
});

// ── Pipeline Run Config ─────────────────────────────────────────────

router.get('/pipeline', authenticate, (_req: AuthRequest, res: Response) => {
  res.json(getSetting('pipeline', getDefaultPipelineConfig()));
});

router.put('/pipeline', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const before = getSetting('pipeline', getDefaultPipelineConfig());
  saveSetting('pipeline', req.body, req.user!.id);

  logActivity({
    userId: req.user!.id,
    entityType: 'setting',
    entityId: 'pipeline',
    entityTitle: 'Pipeline Config',
    action: 'updated',
    snapshot: before,
  });

  res.json({ success: true });
});

// ── Prompt Config ───────────────────────────────────────────────────

router.get('/prompts', authenticate, (_req: AuthRequest, res: Response) => {
  res.json(getSetting('prompts', getDefaultPromptConfig()));
});

router.put('/prompts', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const before = getSetting('prompts', getDefaultPromptConfig());
  saveSetting('prompts', req.body, req.user!.id);

  logActivity({
    userId: req.user!.id,
    entityType: 'setting',
    entityId: 'prompts',
    entityTitle: 'Prompt Config',
    action: 'updated',
    snapshot: before,
  });

  res.json({ success: true });
});

// ── Helpers ─────────────────────────────────────────────────────────

function saveSetting(key: string, value: any, userId: string) {
  getDb().prepare(
    'INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?,?,?,datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime(\'now\')'
  ).run(key, JSON.stringify(value), userId);
}

function getSetting(key: string, defaultValue: any): any {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  if (!row) return defaultValue;
  try { return JSON.parse(row.value); } catch { return defaultValue; }
}

function parseICPRow(row: any) {
  return {
    ...row,
    segments: JSON.parse(row.segments),
    verticals: JSON.parse(row.verticals),
    tech_signals: JSON.parse(row.tech_signals),
    competitors: JSON.parse(row.competitors),
    success_stories: JSON.parse(row.success_stories || '{}'),
  };
}


function getDefaultPipelineConfig() {
  return {
    leads_per_segment: 5,
    min_candidates_per_segment: 8,
    min_score_threshold: 40,
    prefer_score_threshold: 60,
    cooldown_days: 180,
    model: 'claude-opus-4-6@default',
    max_tokens_research: 16384,
    max_tokens_scoring: 2048,
    max_tokens_brief: 4096,
    concurrent_api_calls: 5,
    schedule_cron: '0 14 * * 1',
    schedule_description: 'Mondays at 7am MST (14:00 UTC)',
  };
}

function getDefaultPromptConfig() {
  return {
    research_preamble: '',
    research_additional_instructions: '',
    scoring_weight_overrides: '',
    outreach_tone: 'consultative',
    outreach_tone_description: 'Peer-to-peer, consultative, not salesy. Like a fellow engineer reaching out.',
    outreach_tones_available: ['consultative', 'direct', 'technical', 'executive', 'casual'],
    custom_scoring_criteria: '',
    brief_additional_sections: '',
  };
}

function getDefaultFunnelConfig() {
  return {
    version: 1,
    steps: [
      { id: 'discover', enabled: true, model: 'claude-haiku-4-5@20251001', max_tokens: 16384, candidate_limit: 50, source_strategy: 'search_augmented' as const, search_max_queries: 8, search_max_results_per_query: 5 },
      { id: 'qualify', enabled: true, candidate_limit: 20, qualification_criteria: [] as string[], disqualification_criteria: [] as string[] },
      { id: 'enrich', enabled: true, candidate_limit: 15 },
      { id: 'score', enabled: true, model: 'claude-opus-4-6@default', max_tokens: 2048, candidate_limit: 10 },
      { id: 'brief', enabled: true, model: 'claude-opus-4-6@default', max_tokens: 16384 },
      { id: 'audit', enabled: true, audit_quality_threshold: 60 },
    ],
  };
}

export { getDefaultICP, getDefaultPipelineConfig, getDefaultPromptConfig, getDefaultFunnelConfig, getSetting, saveSetting, getDefaultCompanyContext, getDefaultDisqualifiers, getDefaultSignalWeights, getDefaultBuyerPersonas, getDefaultSegmentDetails, getDefaultGeographies, getDefaultExcludedDomainPatterns };
export default router;
