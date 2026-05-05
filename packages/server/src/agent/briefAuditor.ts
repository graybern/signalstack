import type { AuditResult, AuditIssue } from '../types/index.js';
import type { BriefResult, PersonaBrief } from './briefWriter.js';
import type { ResearchCandidate } from './researcher.js';
import type { ScoringResult } from './scorer.js';

interface AuditInput {
  brief: BriefResult;
  candidate: ResearchCandidate;
  score: ScoringResult;
}

const WEIGHTS: Record<string, number> = {
  structure: 12,
  pain_hypotheses: 15,
  personas: 20,
  sources: 10,
  evidence: 13,
  why_now: 10,
  competitive: 10,
  scoring_consistency: 10,
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

  const hasChampion = personas.some((p: PersonaBrief) => p.role_type === 'champion');
  if (!hasChampion) {
    issues.push({ check: 'personas', severity: 'error', message: 'Missing required champion persona' });
    score -= 8;
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

export function auditBrief(input: AuditInput, threshold: number = 60): AuditResult {
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
