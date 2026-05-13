import { getDb } from '../db/schema.js';

export interface FeedbackContext {
  feedbackCount: number;
  scoring_adjustments: string;
  known_bad_patterns: string;
  effective_personas: string;
  messaging_guidance: string;
  competitive_intel: string;
}

const MIN_FEEDBACK_THRESHOLD = 5;

export function buildFeedbackContext(campaignId: string): FeedbackContext | null {
  const db = getDb();

  const feedbackRows = db.prepare(`
    SELECT lf.verdict, lf.reason, l.fit_score, l.segment, l.company_name,
           fod.effective_persona, fod.effective_channel, fod.effective_angle,
           fod.competitor_lost_to, fod.loss_reason, fod.bad_fit_reasons,
           fod.why_they_bought, fod.deal_value
    FROM lead_feedback lf
    JOIN leads l ON lf.lead_id = l.id
    LEFT JOIN feedback_outcome_details fod ON fod.feedback_id = lf.id
    WHERE l.campaign_id = ?
    ORDER BY lf.created_at DESC
  `).all(campaignId) as any[];

  if (feedbackRows.length < MIN_FEEDBACK_THRESHOLD) return null;

  const verdictGroups: Record<string, any[]> = {};
  for (const row of feedbackRows) {
    if (!verdictGroups[row.verdict]) verdictGroups[row.verdict] = [];
    verdictGroups[row.verdict].push(row);
  }

  const scoringAdjustments = buildScoringAdjustments(feedbackRows, verdictGroups);
  const knownBadPatterns = buildBadPatterns(verdictGroups);
  const effectivePersonas = buildPersonaInsights(verdictGroups);
  const messagingGuidance = buildMessagingGuidance(verdictGroups);
  const competitiveIntel = buildCompetitiveIntel(verdictGroups);

  return {
    feedbackCount: feedbackRows.length,
    scoring_adjustments: scoringAdjustments,
    known_bad_patterns: knownBadPatterns,
    effective_personas: effectivePersonas,
    messaging_guidance: messagingGuidance,
    competitive_intel: competitiveIntel,
  };
}

function buildScoringAdjustments(allRows: any[], groups: Record<string, any[]>): string {
  const positiveVerdicts = ['good_fit_booked', 'good_fit_response', 'closed_won'];
  const negativeVerdicts = ['bad_fit', 'closed_lost'];

  const positive = allRows.filter(r => positiveVerdicts.includes(r.verdict));
  const negative = allRows.filter(r => negativeVerdicts.includes(r.verdict));

  const lines: string[] = [];

  if (positive.length > 0) {
    const avgPositiveScore = Math.round(positive.reduce((s, r) => s + (r.fit_score || 0), 0) / positive.length);
    lines.push(`Leads with positive outcomes averaged a score of ${avgPositiveScore}/100 (${positive.length} leads).`);
  }
  if (negative.length > 0) {
    const avgNegativeScore = Math.round(negative.reduce((s, r) => s + (r.fit_score || 0), 0) / negative.length);
    lines.push(`Leads with negative outcomes averaged a score of ${avgNegativeScore}/100 (${negative.length} leads).`);
  }

  if (positive.length > 0 && negative.length > 0) {
    const avgPos = positive.reduce((s, r) => s + (r.fit_score || 0), 0) / positive.length;
    const avgNeg = negative.reduce((s, r) => s + (r.fit_score || 0), 0) / negative.length;
    const gap = Math.round(avgPos - avgNeg);
    if (gap < 10) {
      lines.push(`The score gap between positive and negative outcomes is only ${gap} points — scoring may need calibration.`);
    }
  }

  // Segment performance
  const segmentStats: Record<string, { positive: number; negative: number; total: number }> = {};
  for (const row of allRows) {
    if (!row.segment) continue;
    if (!segmentStats[row.segment]) segmentStats[row.segment] = { positive: 0, negative: 0, total: 0 };
    segmentStats[row.segment].total++;
    if (positiveVerdicts.includes(row.verdict)) segmentStats[row.segment].positive++;
    if (negativeVerdicts.includes(row.verdict)) segmentStats[row.segment].negative++;
  }
  for (const [seg, s] of Object.entries(segmentStats)) {
    if (s.total >= 3) {
      const rate = Math.round((s.positive / s.total) * 100);
      if (rate >= 60) lines.push(`${seg} segment has a ${rate}% positive outcome rate (${s.positive}/${s.total}).`);
      if (rate <= 25 && s.negative >= 2) lines.push(`${seg} segment has a ${rate}% positive outcome rate — most leads are bad fits.`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'Insufficient data for scoring adjustments.';
}

function buildBadPatterns(groups: Record<string, any[]>): string {
  const badFits = groups['bad_fit'] || [];
  const lines: string[] = [];

  if (badFits.length === 0) return 'No bad-fit patterns identified yet.';

  // Aggregate structured bad-fit reasons
  const reasonCounts: Record<string, number> = {};
  for (const row of badFits) {
    if (row.bad_fit_reasons) {
      try {
        const reasons = JSON.parse(row.bad_fit_reasons) as string[];
        for (const r of reasons) {
          reasonCounts[r] = (reasonCounts[r] || 0) + 1;
        }
      } catch {}
    }
    if (row.reason) {
      // Count free-text reasons by presence
      const lower = row.reason.toLowerCase();
      if (lower.includes('small') || lower.includes('size')) reasonCounts['too_small'] = (reasonCounts['too_small'] || 0) + 1;
      if (lower.includes('vertical') || lower.includes('industry')) reasonCounts['wrong_vertical'] = (reasonCounts['wrong_vertical'] || 0) + 1;
    }
  }

  const REASON_LABELS: Record<string, string> = {
    wrong_segment: 'wrong segment', too_small: 'too small', too_large: 'too large',
    wrong_vertical: 'wrong vertical', wrong_geo: 'wrong geography', no_budget: 'no budget',
    wrong_product_fit: 'wrong product fit', already_has_competitor: 'already uses a competitor',
  };

  const sorted = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sorted.slice(0, 3)) {
    if (count >= 2) {
      lines.push(`${count} of ${badFits.length} bad fits were due to "${REASON_LABELS[reason] || reason}".`);
    }
  }

  if (lines.length === 0 && badFits.length >= 3) {
    lines.push(`${badFits.length} leads marked as bad fit — review common characteristics to tighten discovery criteria.`);
  }

  return lines.length > 0 ? lines.join('\n') : 'No recurring bad-fit patterns found.';
}

function buildPersonaInsights(groups: Record<string, any[]>): string {
  const positiveVerdicts = ['good_fit_booked', 'closed_won', 'good_fit_response'];
  const lines: string[] = [];

  const personaCounts: Record<string, number> = {};
  const channelCounts: Record<string, number> = {};
  let total = 0;

  for (const verdict of positiveVerdicts) {
    for (const row of (groups[verdict] || [])) {
      total++;
      if (row.effective_persona) personaCounts[row.effective_persona] = (personaCounts[row.effective_persona] || 0) + 1;
      if (row.effective_channel) channelCounts[row.effective_channel] = (channelCounts[row.effective_channel] || 0) + 1;
    }
  }

  if (total === 0) return 'No positive outcome data with persona details yet.';

  const PERSONA_LABELS: Record<string, string> = {
    champion: 'Champion (Director/Sr. Manager)', economic_buyer: 'Economic Buyer (VP/CISO)',
    executive_sponsor: 'Executive Sponsor (CTO/CIO)',
  };

  for (const [persona, count] of Object.entries(personaCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / total) * 100);
    lines.push(`${PERSONA_LABELS[persona] || persona} was effective in ${pct}% of positive outcomes (${count}/${total}).`);
  }

  for (const [channel, count] of Object.entries(channelCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / total) * 100);
    if (count >= 2) lines.push(`${channel} channel produced ${pct}% of positive responses (${count}/${total}).`);
  }

  return lines.length > 0 ? lines.join('\n') : 'Not enough persona/channel data from positive outcomes.';
}

function buildMessagingGuidance(groups: Record<string, any[]>): string {
  const lines: string[] = [];

  // Collect effective angles from won/booked deals
  const angles: string[] = [];
  const whyBought: string[] = [];
  for (const row of [...(groups['closed_won'] || []), ...(groups['good_fit_booked'] || [])]) {
    if (row.effective_angle) angles.push(row.effective_angle);
    if (row.why_they_bought) whyBought.push(row.why_they_bought);
  }

  if (angles.length > 0) {
    lines.push(`Messaging angles that worked: ${angles.slice(0, 3).map(a => `"${a}"`).join(', ')}.`);
  }
  if (whyBought.length > 0) {
    lines.push(`Reasons customers bought: ${whyBought.slice(0, 3).map(w => `"${w}"`).join(', ')}.`);
  }

  // Collect loss reasons to identify messaging to avoid
  const lostReasons: string[] = [];
  for (const row of (groups['closed_lost'] || [])) {
    if (row.loss_reason) lostReasons.push(row.loss_reason);
    if (row.reason) lostReasons.push(row.reason);
  }

  if (lostReasons.length > 0) {
    const reasonCounts: Record<string, number> = {};
    for (const r of lostReasons) reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    const topLossReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (topLossReasons.length > 0) {
      lines.push(`Common loss reasons: ${topLossReasons.map(([r, c]) => `${r} (${c}x)`).join(', ')} — adjust messaging to preempt these objections.`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'Not enough closed deal data for messaging guidance.';
}

function buildCompetitiveIntel(groups: Record<string, any[]>): string {
  const lines: string[] = [];

  const competitorWins: Record<string, number> = {};
  const competitorLosses: Record<string, number> = {};

  // Wins — what competitors were displaced
  for (const row of (groups['closed_won'] || [])) {
    // Wins don't have competitor_lost_to, but we can note the pattern
  }

  // Losses — what competitors we lost to
  for (const row of (groups['closed_lost'] || [])) {
    if (row.competitor_lost_to) {
      competitorLosses[row.competitor_lost_to] = (competitorLosses[row.competitor_lost_to] || 0) + 1;
    }
  }

  for (const [comp, count] of Object.entries(competitorLosses).sort((a, b) => b[1] - a[1])) {
    lines.push(`Lost ${count} deal(s) to ${comp} — consider adjusting competitive displacement strategy against this competitor.`);
  }

  const wonCount = (groups['closed_won'] || []).length;
  const lostCount = (groups['closed_lost'] || []).length;
  if (wonCount > 0 && lostCount > 0) {
    const winRate = Math.round((wonCount / (wonCount + lostCount)) * 100);
    lines.push(`Overall win rate: ${winRate}% (${wonCount} won, ${lostCount} lost).`);
  }

  return lines.length > 0 ? lines.join('\n') : 'Not enough competitive outcome data yet.';
}
