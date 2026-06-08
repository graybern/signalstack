import type { AuditResult, AuditIssue, ExtendedICPConfig } from '../types/index.js';
import type { BriefResult, PersonaBrief } from './briefWriter.js';
import type { ResearchCandidate } from './researcher.js';
import type { ScoringResult } from './scorer.js';
import type { TokenTracker } from './tokenTracker.js';
import { createAIClient, getAIConfig, resolveModel } from '../config/vertexConfig.js';

interface AuditInput {
  brief: BriefResult;
  candidate: ResearchCandidate;
  score: ScoringResult;
}

const WEIGHTS: Record<string, number> = {
  structure: 5,
  pain_hypotheses: 8,
  personas: 10,
  sources: 5,
  evidence: 7,
  why_now: 5,
  competitive: 5,
  scoring_consistency: 10,
  dimension_completeness: 15,
  factsheet_integrity: 15,
  timing_integrity: 10,
  cross_reference: 15,
  hallucination: 10,
  enrichment_completeness: 5,
  score_fact_alignment: 5,
};

function checkStructure(brief: BriefResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let score = WEIGHTS.structure;

  if (!brief.company_snapshot || brief.company_snapshot.length < 50) {
    issues.push({ check: 'structure', severity: 'error', message: 'Company snapshot missing or too short (<50 chars)' });
    score -= 5;
  }
  if (!brief.brief_markdown || brief.brief_markdown.length < 200) {
    issues.push({ check: 'structure', severity: 'error', message: 'Brief markdown missing or too short (<200 chars)' });
    score -= 5;
  }
  if (!brief.outreach_strategy || brief.outreach_strategy.length < 50) {
    issues.push({ check: 'structure', severity: 'warning', message: 'Outreach strategy missing or too short' });
    score -= 3;
  }
  if (!brief.tech_stack) {
    issues.push({ check: 'structure', severity: 'warning', message: 'Tech stack intel missing' });
    score -= 2;
  }

  return { score: Math.max(0, score), issues };
}

function checkPainHypotheses(brief: BriefResult, candidate: ResearchCandidate): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let score = WEIGHTS.pain_hypotheses;
  const pains = brief.pain_hypotheses || [];

  if (pains.length === 0) {
    issues.push({ check: 'pain_hypotheses', severity: 'error', message: 'No pain hypotheses generated' });
    return { score: 0, issues };
  }

  const shortClaims = pains.filter(p => !p.claim || p.claim.length < 20);
  if (shortClaims.length > 0) {
    issues.push({ check: 'pain_hypotheses', severity: 'warning', message: `${shortClaims.length} pain hypothesis claim(s) too short (<20 chars)` });
    score -= 3 * shortClaims.length;
  }

  const noEvidence = pains.filter(p => !p.evidence_strength);
  if (noEvidence.length > 0) {
    issues.push({ check: 'pain_hypotheses', severity: 'info', message: `${noEvidence.length} pain hypothesis missing evidence_strength classification` });
    score -= 2;
  }

  const isDataRich = (candidate.enrichment_source_count || 0) >= 3 && candidate.signals.length >= 5;
  if (isDataRich && pains.length < 2) {
    issues.push({ check: 'pain_hypotheses', severity: 'warning', message: 'Data-rich candidate should have 2+ pain hypotheses' });
    score -= 4;
  }

  return { score: Math.max(0, score), issues };
}

function checkPersonas(brief: BriefResult, candidate: ResearchCandidate): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let score = WEIGHTS.personas;
  const personas = brief.personas || [];

  if (personas.length === 0) {
    issues.push({ check: 'personas', severity: 'error', message: 'No personas generated' });
    return { score: 0, issues };
  }

  const hasChampion = personas.some((p: PersonaBrief) => p.role_type === 'technical_champion' || p.role_type === 'champion');
  if (!hasChampion) {
    issues.push({ check: 'personas', severity: 'error', message: 'Missing required technical_champion persona' });
    score -= 8;
  }

  if (personas.length > 4) {
    issues.push({ check: 'personas', severity: 'warning', message: `Too many personas (${personas.length}) — Persona Pyramid allows max 4` });
    score -= 4;
  }

  const sponsorCount = personas.filter((p: PersonaBrief) => p.role_type === 'executive_sponsor').length;
  if (sponsorCount > 1) {
    issues.push({ check: 'personas', severity: 'warning', message: `Multiple executive sponsors (${sponsorCount}) — max 1 allowed` });
    score -= 3;
  }

  const hokCount = personas.filter((p: PersonaBrief) => p.role_type === 'hands_on_keyboard').length;
  if (hokCount > 1) {
    issues.push({ check: 'personas', severity: 'warning', message: `Multiple hands_on_keyboard personas (${hokCount}) — max 1 allowed` });
    score -= 3;
  }

  const allLowConfidence = personas.every((p: PersonaBrief) => (p as any).confidence === 'low');
  if (allLowConfidence && personas.length > 0) {
    issues.push({ check: 'personas', severity: 'warning', message: 'All personas are low-confidence — expected at least one medium or high' });
    score -= 3;
  }

  const cSuiteCount = personas.filter((p: PersonaBrief) =>
    /^(CTO|CIO|CISO|CEO|CFO|COO|CPO|CMO)\b/i.test(p.title || '')
  ).length;
  if (cSuiteCount >= 3) {
    issues.push({ check: 'personas', severity: 'warning', message: `Anti-pattern: ${cSuiteCount} C-suite personas — champions should be Director/Manager level` });
    score -= 4;
  }

  for (const p of personas) {
    const msg = p.outreach_message || '';
    if (msg.length < 100) {
      issues.push({ check: 'personas', severity: 'warning', message: `${p.role_type} outreach message too short (${msg.length} chars, expect 100+)` });
      score -= 3;
    }

    const points = p.talking_points ? (typeof p.talking_points === 'string' ? JSON.parse(p.talking_points) : p.talking_points) : [];
    if (!Array.isArray(points) || points.length < 2) {
      issues.push({ check: 'personas', severity: 'info', message: `${p.role_type} has fewer than 2 talking points` });
      score -= 2;
    }
  }

  const isDataRich = (candidate.enrichment_source_count || 0) >= 3 && candidate.signals.length >= 5;
  if (isDataRich) {
    const genericPersonas = personas.filter((p: PersonaBrief) => !p.name && !p.title);
    if (genericPersonas.length === personas.length) {
      issues.push({ check: 'personas', severity: 'warning', message: 'All personas are generic despite rich data — expected named individuals' });
      score -= 4;
    }
  }

  return { score: Math.max(0, score), issues };
}

function checkSources(brief: BriefResult, candidate: ResearchCandidate): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let score = WEIGHTS.sources;
  const citations = brief.source_citations || [];

  if (citations.length === 0) {
    issues.push({ check: 'sources', severity: 'error', message: 'No source citations in brief' });
    return { score: 0, issues };
  }

  const enrichSources = candidate.enrichment_source_count || 0;
  if (enrichSources > 0 && citations.length < enrichSources) {
    issues.push({ check: 'sources', severity: 'info', message: `Brief cites ${citations.length} sources but ${enrichSources} enrichment sources were available` });
    score -= 3;
  }

  if (!candidate.domain_validated && enrichSources === 0) {
    issues.push({ check: 'sources', severity: 'warning', message: 'No domain validation and no enrichment sources — data quality is unverified' });
    score -= 4;
  }

  return { score: Math.max(0, score), issues };
}

function checkEvidence(brief: BriefResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let score = WEIGHTS.evidence;
  const pains = brief.pain_hypotheses || [];
  const citations = brief.source_citations || [];

  const confirmed = pains.filter(p => p.evidence_strength === 'confirmed');
  if (confirmed.length > 0 && citations.length === 0) {
    issues.push({ check: 'evidence', severity: 'error', message: `${confirmed.length} "confirmed" pain hypothesis but zero source citations` });
    score -= 10;
  }

  const techStack = brief.tech_stack;
  if (techStack?.vpn_product?.confidence === 'high' && citations.length === 0) {
    issues.push({ check: 'evidence', severity: 'warning', message: 'High-confidence VPN product detection with no source citations' });
    score -= 5;
  }

  return { score: Math.max(0, score), issues };
}

function checkWhyNow(brief: BriefResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let score = WEIGHTS.why_now;
  const triggers = brief.why_now || [];

  if (triggers.length === 0) {
    issues.push({ check: 'why_now', severity: 'warning', message: 'No why-now triggers identified' });
    return { score: 0, issues };
  }

  const generic = triggers.filter(t => t.length < 20);
  if (generic.length > 0) {
    issues.push({ check: 'why_now', severity: 'info', message: `${generic.length} why-now trigger(s) too short — may be generic` });
    score -= 3;
  }

  return { score: Math.max(0, score), issues };
}

function checkCompetitive(brief: BriefResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let score = WEIGHTS.competitive;
  const cd = brief.competitive_displacement;

  if (!cd) {
    issues.push({ check: 'competitive', severity: 'warning', message: 'No competitive displacement analysis' });
    return { score: 0, issues };
  }

  const wedge = cd.twingate_wedge || [];
  if (wedge.length === 0) {
    issues.push({ check: 'competitive', severity: 'warning', message: 'No product wedge points identified' });
    score -= 8;
  }

  if ((cd.likely_current || []).length === 0) {
    issues.push({ check: 'competitive', severity: 'info', message: 'No likely current solutions identified' });
    score -= 4;
  }

  return { score: Math.max(0, score), issues };
}

const SCORE_CATEGORY_MAX: Record<string, number> = {
  segment_scale_fit: 20,
  why_now_triggers: 15,
  remote_access_pain: 20,
  displacement_wedge: 20,
  vertical_playbook: 15,
  buyer_access_readiness: 10,
};

function scoreToExpectedLabel(fitScore: number): string {
  if (fitScore >= 85) return '5 stars';
  if (fitScore >= 70) return '4 stars';
  if (fitScore >= 55) return '3 stars';
  if (fitScore >= 35) return '2 stars';
  return '1 star';
}

function checkScoringConsistency(score: ScoringResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let pts = WEIGHTS.scoring_consistency;
  const bd = score.score_breakdown;

  if (!bd) {
    issues.push({ check: 'scoring_consistency', severity: 'error', message: 'Score breakdown missing entirely' });
    return { score: 0, issues };
  }

  if (bd.total != null && Math.abs(bd.total - score.fit_score) > 2) {
    issues.push({ check: 'scoring_consistency', severity: 'error', message: `Score breakdown total (${bd.total}) doesn't match fit_score (${score.fit_score})` });
    pts -= 4;
  }

  const expectedLabel = scoreToExpectedLabel(score.fit_score);
  if (score.fit_score_label && score.fit_score_label !== expectedLabel) {
    issues.push({ check: 'scoring_consistency', severity: 'warning', message: `Star label "${score.fit_score_label}" doesn't match score ${score.fit_score} (expected "${expectedLabel}")` });
    pts -= 2;
  }

  for (const [cat, max] of Object.entries(SCORE_CATEGORY_MAX)) {
    const catData = (bd as any)[cat];
    if (!catData) continue;
    if (catData.points > max) {
      issues.push({ check: 'scoring_consistency', severity: 'error', message: `${cat} points (${catData.points}) exceed max (${max})` });
      pts -= 3;
    }
    if (catData.points > 0 && (!catData.evidence || catData.evidence.length === 0)) {
      issues.push({ check: 'scoring_consistency', severity: 'warning', message: `${cat} awarded ${catData.points} points but has no evidence` });
      pts -= 1;
    }
  }

  return { score: Math.max(0, pts), issues };
}

// ── New v2 checks ────────────────────────────────────────────────────

function checkDimensionCompleteness(score: ScoringResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let pts = WEIGHTS.dimension_completeness;

  if (!score.dimensions) {
    if (score.scoring_version === 2) {
      issues.push({ check: 'dimension_completeness', severity: 'error', message: 'Scoring version 2 but dimensions missing' });
      return { score: 0, issues };
    }
    return { score: pts, issues };
  }

  const dims = score.dimensions;
  if (dims.icp_fit == null) { issues.push({ check: 'dimension_completeness', severity: 'error', message: 'icp_fit dimension missing' }); pts -= 3; }
  if (dims.timing == null) { issues.push({ check: 'dimension_completeness', severity: 'error', message: 'timing dimension missing' }); pts -= 3; }
  if (!dims.data_confidence) { issues.push({ check: 'dimension_completeness', severity: 'error', message: 'data_confidence grade missing' }); pts -= 2; }
  if (dims.reachability == null) { issues.push({ check: 'dimension_completeness', severity: 'warning', message: 'reachability dimension missing' }); pts -= 2; }
  if (!dims.verdict) { issues.push({ check: 'dimension_completeness', severity: 'warning', message: 'verdict not generated' }); pts -= 2; }

  if (!score.fact_sheet) {
    issues.push({ check: 'dimension_completeness', severity: 'error', message: 'FactSheet missing from scoring result' });
    pts -= 3;
  }

  return { score: Math.max(0, pts), issues };
}

function checkFactsheetIntegrity(score: ScoringResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let pts = WEIGHTS.factsheet_integrity;

  if (!score.fact_sheet) return { score: pts, issues };
  const fs = score.fact_sheet;

  const confirmedVpn = fs.vpn_products_detected.filter(v => v.confidence === 'confirmed');
  if (confirmedVpn.length > 0 && fs.facts_from_enrichment === 0) {
    issues.push({ check: 'factsheet_integrity', severity: 'error', message: `${confirmedVpn.length} "confirmed" VPN product(s) but facts_from_enrichment is 0` });
    pts -= 8;
  }

  const confirmedComp = fs.competitor_products_detected.filter(c => c.confidence === 'confirmed');
  if (confirmedComp.length > 0 && fs.facts_from_enrichment === 0) {
    issues.push({ check: 'factsheet_integrity', severity: 'error', message: `"confirmed" competitor products but no enrichment facts` });
    pts -= 5;
  }

  if (fs.employee_count_confirmed && fs.employee_count_range === 'unknown') {
    issues.push({ check: 'factsheet_integrity', severity: 'error', message: 'employee_count_confirmed=true but range is "unknown" — impossible state' });
    pts -= 5;
  }

  if (fs.active_evaluation_evidence.some(e => e.confidence === 'confirmed') && fs.facts_from_enrichment === 0) {
    issues.push({ check: 'factsheet_integrity', severity: 'error', message: '"confirmed" active evaluation but no enrichment sources' });
    pts -= 5;
  }

  return { score: Math.max(0, pts), issues };
}

function checkTimingIntegrity(score: ScoringResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let pts = WEIGHTS.timing_integrity;

  if (!score.dimensions || !score.fact_sheet) return { score: pts, issues };
  const dims = score.dimensions;
  const fs = score.fact_sheet;

  if (dims.timing > 25) {
    const hasNonModelSignal = [
      ...fs.active_evaluation_evidence.filter(e => e.confidence !== 'model_knowledge'),
      ...fs.funding_events,
      ...fs.hiring_signals,
      ...fs.leadership_changes,
    ].length > 0;

    if (!hasNonModelSignal) {
      issues.push({ check: 'timing_integrity', severity: 'error', message: `Timing score ${dims.timing} > 25 but all signals are model_knowledge — gate violation` });
      pts -= 8;
    }
  }

  if (dims.timing > 60) {
    const hasRecent = [
      ...fs.funding_events.filter(f => f.recency === 'recent'),
      ...fs.hiring_signals.filter(h => h.recency === 'recent'),
      ...fs.leadership_changes.filter(l => l.recency === 'recent'),
      ...fs.active_evaluation_evidence.filter(e => e.confidence === 'confirmed'),
    ].length > 0;

    if (!hasRecent) {
      issues.push({ check: 'timing_integrity', severity: 'error', message: `Timing score ${dims.timing} > 60 but no "recent" signals found` });
      pts -= 6;
    }
  }

  return { score: Math.max(0, pts), issues };
}

function checkCrossReference(brief: BriefResult, score: ScoringResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let pts = WEIGHTS.cross_reference;

  if (!score.fact_sheet) return { score: pts, issues };
  const fs = score.fact_sheet;
  const briefText = (brief.brief_markdown || '') + ' ' + (brief.company_snapshot || '');
  const briefLower = briefText.toLowerCase();

  // Check for customer name-drops in brief
  const customerNamePatterns = [
    /\b(epic games|riot games|2k games|snyk|hashicorp|confluent|cyera)\b/i,
    /\bcustomer[s]?\s+(like|such as|including)\s+/i,
    /\b(deployed at|used by|adopted by|powers|trusted by)\s+[A-Z]/,
  ];
  for (const pattern of customerNamePatterns) {
    if (pattern.test(briefText)) {
      issues.push({ check: 'cross_reference', severity: 'error', message: `Brief contains customer name-drop or case study reference: ${pattern.source.substring(0, 40)}` });
      pts -= 5;
    }
  }

  // Check VPN products mentioned in brief match FactSheet
  const fsVpnProducts = fs.vpn_products_detected.map(v => v.product.toLowerCase());
  const vpnMentionPatterns = [/cisco anyconnect/i, /globalprotect/i, /forticlient/i, /pulse secure/i, /ivanti/i, /openvpn/i];
  for (const pattern of vpnMentionPatterns) {
    const match = briefLower.match(pattern);
    if (match && !fsVpnProducts.some(p => p.includes(match[0].toLowerCase()))) {
      issues.push({ check: 'cross_reference', severity: 'warning', message: `Brief mentions VPN "${match[0]}" not in FactSheet` });
      pts -= 3;
    }
  }

  // Check persona names match FactSheet contacts
  if (brief.personas) {
    const fsNames = new Set(fs.named_contacts.map(c => c.name?.toLowerCase()).filter(Boolean));
    for (const p of brief.personas) {
      if (p.name && !fsNames.has(p.name.toLowerCase())) {
        issues.push({ check: 'cross_reference', severity: 'warning', message: `Persona "${p.name}" not found in FactSheet named_contacts` });
        pts -= 2;
      }
    }
  }

  return { score: Math.max(0, pts), issues };
}

function checkHallucination(brief: BriefResult, candidate: ResearchCandidate): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let pts = WEIGHTS.hallucination;
  const srcCount = candidate.enrichment_source_count || 0;
  const isThinData = srcCount === 0 || (srcCount <= 1 && candidate.signals.length < 3);

  if (!isThinData) return { score: pts, issues };

  const briefText = (brief.brief_markdown || '') + ' ' + (brief.company_snapshot || '');

  // Check for assertive language in thin-data context
  const assertivePatterns = [
    /actively evaluating/i,
    /currently exploring/i,
    /planning to replace/i,
    /recently adopted/i,
    /known to use/i,
    /confirmed.{0,20}usage/i,
  ];

  for (const pattern of assertivePatterns) {
    if (pattern.test(briefText)) {
      issues.push({ check: 'hallucination', severity: 'error', message: `Assertive claim in thin-data context: "${pattern.source}"` });
      pts -= 3;
    }
  }

  // Check why-now claims without citations in thin data
  const whyNow = brief.why_now || [];
  const citationPattern = /\[\d+\]/;
  const unsourcedClaims = whyNow.filter(w => !citationPattern.test(w));
  if (unsourcedClaims.length > 0) {
    issues.push({ check: 'hallucination', severity: 'warning', message: `${unsourcedClaims.length} why-now claim(s) without [N] source citations in thin-data context` });
    pts -= Math.min(5, unsourcedClaims.length * 2);
  }

  return { score: Math.max(0, pts), issues };
}

function checkEnrichmentCompleteness(candidate: ResearchCandidate): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let pts = WEIGHTS.enrichment_completeness;

  const srcCount = candidate.enrichment_source_count || 0;
  if (srcCount === 0) {
    issues.push({ check: 'enrichment_completeness', severity: 'warning', message: 'No enrichment sources — research incomplete' });
    pts -= 3;
  }

  if (!candidate.domain_validated) {
    issues.push({ check: 'enrichment_completeness', severity: 'info', message: 'Domain not validated via DNS/HTTP' });
    pts -= 1;
  }

  if (candidate.signals.length === 0) {
    issues.push({ check: 'enrichment_completeness', severity: 'warning', message: 'Zero signals identified' });
    pts -= 2;
  }

  return { score: Math.max(0, pts), issues };
}

function checkScoreFactAlignment(score: ScoringResult): { score: number; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  let pts = WEIGHTS.score_fact_alignment;

  if (!score.dimensions || !score.fact_sheet) return { score: pts, issues };
  const dims = score.dimensions;
  const fs = score.fact_sheet;

  // High ICP fit but no data
  if (dims.icp_fit >= 60 && fs.employee_count_range === 'unknown' && !fs.engineering_team_evidence && fs.remote_workforce_evidence === 'none') {
    issues.push({ check: 'score_fact_alignment', severity: 'error', message: `ICP fit ${dims.icp_fit} >= 60 but no employee range, no engineering evidence, no remote workforce evidence` });
    pts -= 3;
  }

  // High reachability but no contacts
  if (dims.reachability >= 50 && fs.named_contacts.length === 0) {
    issues.push({ check: 'score_fact_alignment', severity: 'error', message: `Reachability ${dims.reachability} >= 50 but zero named contacts` });
    pts -= 3;
  }

  // High data confidence but few enrichment facts
  if (dims.data_confidence_score >= 65 && fs.facts_from_enrichment <= 1) {
    issues.push({ check: 'score_fact_alignment', severity: 'warning', message: `Data confidence score ${dims.data_confidence_score} >= 65 but only ${fs.facts_from_enrichment} enrichment facts` });
    pts -= 2;
  }

  return { score: Math.max(0, pts), issues };
}

export function auditBrief(input: AuditInput, threshold: number = 78): AuditResult {
  // Scale thresholds from the old 100pt system to the new 130pt system
  if (threshold <= 100) {
    threshold = Math.round(threshold * 1.3);
  }
  const { brief, candidate, score } = input;

  const results = {
    structure: checkStructure(brief),
    pain_hypotheses: checkPainHypotheses(brief, candidate),
    personas: checkPersonas(brief, candidate),
    sources: checkSources(brief, candidate),
    evidence: checkEvidence(brief),
    why_now: checkWhyNow(brief),
    competitive: checkCompetitive(brief),
    scoring_consistency: checkScoringConsistency(score),
    dimension_completeness: checkDimensionCompleteness(score),
    factsheet_integrity: checkFactsheetIntegrity(score),
    timing_integrity: checkTimingIntegrity(score),
    cross_reference: checkCrossReference(brief, score),
    hallucination: checkHallucination(brief, candidate),
    enrichment_completeness: checkEnrichmentCompleteness(candidate),
    score_fact_alignment: checkScoreFactAlignment(score),
  };

  const totalScore = Object.values(results).reduce((sum, r) => sum + r.score, 0);
  const allIssues = Object.values(results).flatMap(r => r.issues);

  const checks: Record<string, { passed: boolean; score: number; details?: string }> = {};
  for (const [key, result] of Object.entries(results)) {
    const max = WEIGHTS[key];
    checks[key] = {
      passed: result.score >= max * 0.5,
      score: result.score,
      details: result.issues.length > 0 ? result.issues.map(i => i.message).join('; ') : undefined,
    };
  }

  return {
    score: totalScore,
    passed: totalScore >= threshold,
    issues: allIssues,
    checks,
  };
}

// ── AI-powered audit ────────────────────────────────────────────────

interface AIAuditInput {
  brief: BriefResult;
  candidate: ResearchCandidate;
  score: ScoringResult;
  icpConfig: ExtendedICPConfig;
}

function getAIAuditPrompt(icpConfig: ExtendedICPConfig): string {
  const companyName = icpConfig.company_context?.company_name || 'the company';
  const productName = icpConfig.company_context?.product_name || companyName;
  const valueProps = icpConfig.company_context?.value_props || [];
  const differentiators = icpConfig.company_context?.differentiators || [];

  return `You are a senior sales operations analyst reviewing outbound lead briefs for quality before they reach account executives.

Your job is to evaluate whether a brief is accurate, relevant, actionable, and would actually help an AE have a productive conversation.

## Product Context
${companyName}${productName !== companyName ? ` (${productName})` : ''}
${valueProps.length > 0 ? `Value Props: ${valueProps.join('; ')}` : ''}
${differentiators.length > 0 ? `Differentiators: ${differentiators.join('; ')}` : ''}

## Evaluation Criteria

Score each dimension 1-10 and provide specific feedback:

1. **relevance** (weight: 25%) — Does the pain hypothesis and outreach angle actually make sense for this specific company? Would an AE read this and think "yes, this is a real opportunity" or "this is generic filler"?

2. **accuracy** (weight: 20%) — Are claims supported by evidence? Are there any red flags (e.g., claiming confirmed facts without sources, fabricated-looking names/titles, contradictory information)?

3. **actionability** (weight: 25%) — Could an AE immediately act on this? Are the outreach messages specific enough? Do talking points reference real signals, not generic value props?

4. **persona_quality** (weight: 15%) — Are the personas realistic and well-targeted? Is the champion someone who would actually evaluate this type of solution? Are outreach messages personalized to the company?

5. **completeness** (weight: 15%) — Are there obvious gaps an AE would need to fill before reaching out? How much additional research would be needed?

## Output Format
Return a JSON object:
\`\`\`json
{
  "overall_score": 1-100,
  "verdict": "pass" | "needs_work" | "fail",
  "summary": "1-2 sentence overall assessment",
  "dimensions": {
    "relevance": { "score": 1-10, "feedback": "string" },
    "accuracy": { "score": 1-10, "feedback": "string" },
    "actionability": { "score": 1-10, "feedback": "string" },
    "persona_quality": { "score": 1-10, "feedback": "string" },
    "completeness": { "score": 1-10, "feedback": "string" }
  },
  "issues": [
    { "severity": "error|warning|info", "message": "string" }
  ],
  "strengths": ["string"]
}
\`\`\`

Return ONLY the JSON object.`;
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const jsonMatch = text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) return jsonMatch[1].trim();
  return text.trim();
}

export interface AIAuditResult {
  overall_score: number;
  verdict: 'pass' | 'needs_work' | 'fail';
  summary: string;
  dimensions: Record<string, { score: number; feedback: string }>;
  issues: AuditIssue[];
  strengths: string[];
}

export async function aiAuditBrief(
  input: AIAuditInput,
  model?: string,
  tracker?: TokenTracker
): Promise<AIAuditResult> {
  const { brief, candidate, score, icpConfig } = input;
  const aiConfig = getAIConfig();
  const client = await createAIClient();
  const auditModel = model || 'claude-haiku-4-5@20251001';

  const systemPrompt = getAIAuditPrompt(icpConfig);

  const userMessage = `Review this lead brief:

## Company: ${candidate.company_name}
- Segment: ${candidate.segment}
- Employees: ~${candidate.employee_count_estimate || 'Unknown'}
- Fit Score: ${score.fit_score}/100 (${score.confidence} confidence)

## Brief Content
**Company Snapshot:** ${brief.company_snapshot}

**Pain Hypotheses (${brief.pain_hypotheses?.length || 0}):**
${(brief.pain_hypotheses || []).map((p, i) => `${i + 1}. ${p.claim} [${p.evidence_strength || 'unknown'}]`).join('\n')}

**Why Now (${brief.why_now?.length || 0}):**
${(brief.why_now || []).map((t, i) => `${i + 1}. ${t}`).join('\n')}

**Personas (${brief.personas?.length || 0}):**
${(brief.personas || []).map(p => `- ${p.role_type}: ${p.name || '(unnamed)'} — ${p.title || '(no title)'}`).join('\n')}

**Outreach Strategy:** ${brief.outreach_strategy || '(none)'}

**Sources (${brief.source_citations?.length || 0}):**
${(brief.source_citations || []).map(s => `- [${s.type}] ${s.label}`).join('\n')}

**Tech Stack:** VPN: ${brief.tech_stack?.vpn_product?.product || 'Unknown'} (${brief.tech_stack?.vpn_product?.confidence || 'unknown'})

**Competitive Displacement:**
- Current: ${brief.competitive_displacement?.likely_current?.join(', ') || 'Unknown'}
- Wedge: ${brief.competitive_displacement?.twingate_wedge?.join('; ') || 'None identified'}

## Candidate Signals (${candidate.signals.length})
${candidate.signals.slice(0, 10).map(s => `- ${s}`).join('\n')}

Evaluate this brief.`;

  try {
    const stream = client.messages.stream({
      model: resolveModel(auditModel, aiConfig.provider),
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    } as any);
    const finalMessage = await stream.finalMessage();
    if (tracker) tracker.addUsage(finalMessage);

    const rawText = finalMessage.content.find((b: any) => b.type === 'text')?.text || '';
    const jsonStr = extractJson(rawText);
    const result = JSON.parse(jsonStr);

    return {
      overall_score: Math.min(100, Math.max(0, result.overall_score || 0)),
      verdict: result.verdict || 'needs_work',
      summary: result.summary || '',
      dimensions: result.dimensions || {},
      issues: (result.issues || []).map((i: any) => ({
        check: 'ai_review',
        severity: i.severity || 'info',
        message: i.message || '',
      })),
      strengths: result.strengths || [],
    };
  } catch (err) {
    console.error(`[aiAudit] Failed for ${candidate.company_name}:`, err);
    return {
      overall_score: 0,
      verdict: 'fail',
      summary: 'AI audit failed — review manually',
      dimensions: {},
      issues: [{ check: 'ai_review', severity: 'error', message: `AI audit error: ${err instanceof Error ? err.message : String(err)}` }],
      strengths: [],
    };
  }
}
