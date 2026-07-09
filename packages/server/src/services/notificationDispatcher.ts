import crypto from 'crypto';
import { getDb } from '../db/schema.js';
import { eventBus, SignalStackEvent } from '../events/eventBus.js';
import type { NotificationDestination } from '../types/index.js';

function safeJsonParse(val: string | null, fallback: any): any {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function scoreToStars(score: number): string {
  if (score >= 90) return '★★★★★';
  if (score >= 75) return '★★★★';
  if (score >= 60) return '★★★';
  if (score >= 40) return '★★';
  return '★';
}

function getDestinations(campaignId: string): NotificationDestination[] {
  const db = getDb();
  const row = db.prepare('SELECT notification_destinations FROM campaigns WHERE id = ?').get(campaignId) as any;
  return safeJsonParse(row?.notification_destinations, []);
}

function getEnabledDestinations(campaignId: string): NotificationDestination[] {
  return getDestinations(campaignId).filter(d => d.enabled && d.type !== 'rss');
}

function getCampaignBaseUrl(campaignId: string): string {
  const db = getDb();
  const row = db.prepare('SELECT notification_base_url FROM campaigns WHERE id = ?').get(campaignId) as any;
  return (row?.notification_base_url || '').replace(/\/$/, '');
}

function runLink(baseUrl: string, runId: string): string {
  if (!baseUrl) return '';
  return `${baseUrl}/runs/${runId}`;
}

function campaignRunsLink(baseUrl: string, campaignId: string): string {
  if (!baseUrl) return '';
  return `${baseUrl}/campaigns/${campaignId}?tab=runs`;
}

// ── Lead data helpers ────────────────────────────────────────────

interface LeadSummary {
  id: string;
  company_name: string;
  segment: string;
  employee_count: number | null;
  fit_score: number;
  signal_count: number;
  top_signal: string;
  pitch: string;
  displaces: string;
  potential_score: number | null;
  urgency_score: number | null;
  icp_fit_score: number | null;
  timing_score: number | null;
  data_confidence: string | null;
  scoring_version: number | null;
}

function mapLeadRow(l: any): LeadSummary {
  const whyNow = safeJsonParse(l.why_now, []);
  const pains = safeJsonParse(l.pain_hypotheses, []);
  const competitive = safeJsonParse(l.competitive_displacement, {});
  const outreach = safeJsonParse(l.outreach_strategy, {});
  return {
    id: l.id,
    company_name: l.company_name,
    segment: l.segment,
    employee_count: l.employee_count,
    fit_score: l.fit_score,
    signal_count: whyNow.length + pains.length,
    top_signal: whyNow[0] || '',
    pitch: outreach.one_line_pitch || '',
    displaces: (competitive.likely_current || []).filter(Boolean).join(', '),
    potential_score: l.potential_score,
    urgency_score: l.urgency_score,
    icp_fit_score: l.icp_fit_score,
    timing_score: l.timing_score,
    data_confidence: l.data_confidence,
    scoring_version: l.scoring_version,
  };
}

const LEAD_SUMMARY_COLS = `id, company_name, employee_count, fit_score, segment, why_now, pain_hypotheses,
     competitive_displacement, outreach_strategy, potential_score, urgency_score,
     icp_fit_score, timing_score, data_confidence, scoring_version`;

function getLeadSummaries(runId: string): LeadSummary[] {
  const db = getDb();
  let leads = db.prepare(
    `SELECT ${LEAD_SUMMARY_COLS} FROM leads WHERE run_id = ? ORDER BY fit_score DESC`
  ).all(runId) as any[];

  if (leads.length === 0) {
    const run = db.prepare('SELECT target_lead_ids FROM pipeline_runs WHERE id = ?').get(runId) as any;
    if (run?.target_lead_ids) {
      const ids: string[] = safeJsonParse(run.target_lead_ids, []);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        leads = db.prepare(
          `SELECT ${LEAD_SUMMARY_COLS} FROM leads WHERE id IN (${placeholders}) ORDER BY fit_score DESC`
        ).all(...ids) as any[];
      }
    }
  }

  return leads.map(mapLeadRow);
}

function getTriggeredByLabel(triggeredBy: string | undefined): string {
  if (!triggeredBy || triggeredBy === 'system') return 'System';
  if (triggeredBy === 'scheduled' || triggeredBy === 'cron') return 'Scheduled';
  const db = getDb();
  const user = db.prepare('SELECT display_name, email FROM users WHERE id = ?').get(triggeredBy) as any;
  if (user) return user.display_name || user.email?.split('@')[0] || 'Unknown';
  return triggeredBy;
}

function stripMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
}

function truncate(text: string, maxLen: number): string {
  const clean = stripMarkdown(text);
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' — '));
  if (lastBreak > maxLen * 0.4) return cut.slice(0, lastBreak + 1).trim();
  return cut.trim() + '…';
}

function shortDisplaces(displaces: string): string {
  return displaces
    .split(',')
    .map(s => s.replace(/\s*\([^)]*\)/g, '').replace(/\s*—\s*.*/g, '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

function formatScoreDisplay(l: LeadSummary): string {
  if (l.scoring_version === 2 && l.potential_score != null) {
    const parts = [`${l.fit_score} (P:${l.potential_score} U:${l.urgency_score ?? '?'})`];
    if (l.data_confidence) parts.push(`Data:${l.data_confidence}`);
    return parts.join(' · ');
  }
  return scoreToStars(l.fit_score);
}

function formatLeadLine(l: LeadSummary): string {
  const score = formatScoreDisplay(l);
  const empLabel = l.employee_count ? `, ${l.employee_count.toLocaleString()} emp` : '';
  let line = `${score} *${l.company_name}* (${l.segment}${empLabel}) · ${l.signal_count} signals`;
  if (l.top_signal) line += `\nWhy now: ${truncate(l.top_signal, 120)}`;
  if (l.displaces) line += `\nDisplaces: ${shortDisplaces(l.displaces)}`;
  return line;
}

function leadStats(leads: LeadSummary[]) {
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.fit_score, 0) / leads.length) : 0;
  const hasV2 = leads.some(l => l.scoring_version === 2 && l.potential_score != null);
  const avgPotential = hasV2 ? Math.round(leads.reduce((s, l) => s + (l.potential_score || 0), 0) / leads.length) : null;
  const avgUrgency = hasV2 ? Math.round(leads.reduce((s, l) => s + (l.urgency_score || 0), 0) / leads.length) : null;
  const avgScoreDisplay = hasV2 ? `${avgScore} (P:${avgPotential} U:${avgUrgency})` : scoreToStars(avgScore);
  const segments = leads.reduce((acc: Record<string, number>, l) => { acc[l.segment] = (acc[l.segment] || 0) + 1; return acc; }, {});
  const segmentSummary = Object.entries(segments).map(([s, c]) => `${c} ${s}`).join(', ');
  return { avgScore, avgScoreDisplay, segmentSummary };
}

function rerunLabel(runType?: string): string {
  return runType && runType.includes('rerun') ? ' (Rerun)' : '';
}

// ── Generic webhook payloads (flat key-value, formerly "slack") ──

function buildGenericCompleted(campaignName: string, campaignId: string, runId: string, link: string, runType?: string): any {
  const leads = getLeadSummaries(runId);
  const topLeads = leads.slice(0, 5);
  const { avgScore, segmentSummary } = leadStats(leads);
  const remaining = leads.length - topLeads.length;

  return {
    status: 'completed',
    campaign: campaignName,
    headline: `✅ ${leads.length} new leads${rerunLabel(runType)} · Avg ${scoreToStars(avgScore)} · ${segmentSummary}`,
    summary: link || '',
    lead_count: String(leads.length),
    top_leads: topLeads.map(formatLeadLine).join('\n\n') + (remaining > 0 ? `\n\n+ ${remaining} more in dashboard` : ''),
    link,
  };
}

function buildGenericFailed(campaignName: string, error: string, link: string, runType?: string): any {
  return {
    status: 'failed',
    campaign: campaignName,
    headline: `❌ Run failed${rerunLabel(runType)}`,
    summary: error || 'Pipeline run failed. Check the dashboard for details.',
    lead_count: '0',
    top_leads: '',
    link,
  };
}

function buildGenericCancelled(campaignName: string, link: string, runType?: string): any {
  return {
    status: 'cancelled',
    campaign: campaignName,
    headline: `🚫 Run cancelled${rerunLabel(runType)}`,
    summary: 'Pipeline run was manually cancelled.',
    lead_count: '0',
    top_leads: '',
    link,
  };
}

function buildGenericMissed(campaignName: string, missedCount: number, missedTimes: string[], link: string): any {
  const mostRecent = missedTimes.length > 0 ? new Date(missedTimes[missedTimes.length - 1]).toLocaleString() : '';
  return {
    status: 'missed',
    campaign: campaignName,
    headline: `⚠️ ${missedCount} missed scheduled run${missedCount !== 1 ? 's' : ''}`,
    summary: `Server was not running at scheduled time. Most recent: ${mostRecent}`,
    lead_count: '0',
    top_leads: '',
    link,
  };
}

function buildGenericTest(campaignName: string, campaignId: string, link: string, runId?: string): any {
  if (runId) return buildGenericCompleted(campaignName, campaignId, runId, link);
  return {
    status: 'test',
    campaign: campaignName,
    headline: '🔔 Webhook connected',
    summary: 'Notifications will appear here when campaign runs complete.',
    lead_count: '0',
    top_leads: '',
    link,
  };
}

// ── Slack incoming webhook payloads (attachments format) ─────────

function slackAttachment(color: string, pretext: string, fields: { title: string; value: string; short: boolean }[], link: string, linkLabel?: string, ts?: number, text?: string): any {
  const fallbackText = text || pretext.replace(/:[a-z_]+:/g, '').replace(/\*/g, '').trim();
  const attachment: any = { color, pretext, fields, footer: 'SignalStack', ts: ts || Math.floor(Date.now() / 1000) };
  if (link) {
    const label = linkLabel || 'View in Dashboard';
    attachment.fields = [...fields, { title: '', value: `<${link}|${label}>`, short: false }];
  }
  return { text: fallbackText, attachments: [attachment] };
}

function isResearchRun(runType?: string): boolean {
  return runType === 'quick_research' || runType === 'batch_research' || runType === 'webhook_research';
}

function leadLink(baseUrl: string, leadId: string): string {
  if (!baseUrl) return '';
  return `${baseUrl}/leads/${leadId}`;
}

function buildSlackCompleted(campaignName: string, campaignId: string, runId: string, baseUrl: string, runType?: string, triggeredBy?: string): any {
  const leads = getLeadSummaries(runId);
  const topLeads = leads.slice(0, 5);
  const { avgScoreDisplay, segmentSummary } = leadStats(leads);
  const remaining = leads.length - topLeads.length;

  const topLeadLines = topLeads.map(l => formatLeadLine(l)).join('\n');
  const topLeadValue = topLeadLines + (remaining > 0 ? `\n_+ ${remaining} more in dashboard_` : '');

  const rerun = rerunLabel(runType);
  const isResearch = isResearchRun(runType);
  const emoji = isResearch ? ':mag:' : ':white_check_mark:';
  const label = isResearch ? 'Research Complete' : `Campaign Complete${rerun}`;
  const headline = isResearch && leads.length === 1
    ? `${emoji} *${label}: ${leads[0].company_name}* (${campaignName})`
    : `${emoji} *${label}: ${campaignName}*`;

  const topNames = topLeads.slice(0, 3).map(l => l.company_name).join(', ');
  const previewText = isResearch && leads.length === 1
    ? `Research: ${leads[0].company_name} — Score ${formatScoreDisplay(leads[0])}`
    : `${campaignName} — ${leads.length} leads (avg ${avgScoreDisplay}). Top: ${topNames}`;

  const triggeredByLabel = getTriggeredByLabel(triggeredBy);

  const fields: { title: string; value: string; short: boolean }[] = [
    { title: 'Leads', value: String(leads.length), short: true },
    { title: 'Avg Score', value: avgScoreDisplay, short: true },
    { title: 'Segments', value: segmentSummary || 'None', short: true },
    { title: 'Triggered by', value: triggeredByLabel, short: true },
  ];
  fields.push({ title: 'Top Leads', value: topLeadValue || 'None', short: false });

  const isSingleResearch = isResearch && leads.length === 1;
  const link = isSingleResearch ? leadLink(baseUrl, leads[0].id) : runLink(baseUrl, runId);
  const linkLabel = isSingleResearch ? 'View Lead' : 'View Leads';

  return slackAttachment('#36a64f', headline, fields, link, linkLabel, undefined, previewText);
}

function buildSlackFailed(campaignName: string, error: string, link: string, runType?: string, triggeredBy?: string): any {
  const rerun = rerunLabel(runType);
  const truncatedError = truncate(error || 'Pipeline run failed', 80);
  return slackAttachment('#E01E5A', `:x: *Campaign Failed${rerun}: ${campaignName}*`, [
    { title: 'Error', value: error || 'Pipeline run failed. Check the dashboard for details.', short: false },
    { title: 'Triggered by', value: getTriggeredByLabel(triggeredBy), short: true },
    { title: 'Time', value: new Date().toLocaleString(), short: true },
  ], link, 'View Run', undefined, `${campaignName} failed: ${truncatedError}`);
}

function buildSlackCancelled(campaignName: string, link: string, runType?: string, triggeredBy?: string): any {
  const rerun = rerunLabel(runType);
  return slackAttachment('#FF9900', `:no_entry_sign: *Campaign Cancelled${rerun}: ${campaignName}*`, [
    { title: 'Status', value: 'Manually cancelled', short: true },
    { title: 'Triggered by', value: getTriggeredByLabel(triggeredBy), short: true },
    { title: 'Time', value: new Date().toLocaleString(), short: true },
  ], link, 'View Run', undefined, `${campaignName} cancelled`);
}

function buildSlackMissed(campaignName: string, missedCount: number, missedTimes: string[], link: string): any {
  const mostRecent = missedTimes.length > 0 ? new Date(missedTimes[missedTimes.length - 1]).toLocaleString() : 'Unknown';
  return slackAttachment('#AAAAAA', `:warning: *Missed Scheduled Runs: ${campaignName}*`, [
    { title: 'Missed Runs', value: String(missedCount), short: true },
    { title: 'Most Recent', value: mostRecent, short: true },
    { title: 'Reason', value: 'Server was not running at scheduled time', short: false },
  ], link, 'View Run History', undefined, `${missedCount} missed runs for ${campaignName}`);
}

function buildSlackTest(campaignName: string, campaignId: string, baseUrl: string, runId?: string): any {
  if (runId) return buildSlackCompleted(campaignName, campaignId, runId, baseUrl);
  const cLink = campaignRunsLink(baseUrl, campaignId);
  return slackAttachment('#4A90D9', `:bell: *Webhook Connected: ${campaignName}*`, [
    { title: 'Status', value: 'Notifications will appear here when campaign runs complete.', short: false },
  ], cLink, 'View Campaign', undefined, `Webhook connected: ${campaignName}`);
}

// ── Structured JSON webhook payloads ─────────────────────────────

function buildWebhookCompleted(campaignName: string, campaignId: string, runId: string, leadCount: number, cost: number, link: string, runType?: string): any {
  const leads = getLeadSummaries(runId).slice(0, 10);
  return {
    event: 'campaign.completed',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    run: { id: runId, lead_count: leadCount, estimated_cost: cost, run_type: runType || 'campaign' },
    link,
    leads: leads.map(l => ({
      company_name: l.company_name,
      segment: l.segment,
      employee_count: l.employee_count,
      fit_score: l.fit_score,
      signal_count: l.signal_count,
      top_signal: l.top_signal,
      pitch: l.pitch,
      displaces: l.displaces,
    })),
  };
}

function buildWebhookFailed(campaignName: string, campaignId: string, runId: string, error: string, link: string, runType?: string): any {
  return {
    event: 'campaign.failed',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    run: { id: runId, run_type: runType || 'campaign' },
    link,
    error,
  };
}

function buildWebhookCancelled(campaignName: string, campaignId: string, runId: string, link: string, runType?: string): any {
  return {
    event: 'campaign.cancelled',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    run: { id: runId, run_type: runType || 'campaign' },
    link,
  };
}

function buildWebhookMissed(campaignName: string, campaignId: string, missedCount: number, missedTimes: string[], link: string): any {
  return {
    event: 'campaign.missed',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    missed_count: missedCount,
    missed_times: missedTimes,
    link,
  };
}

function buildWebhookTest(campaignName: string, campaignId: string, link: string, runId?: string): any {
  if (runId) return buildWebhookCompleted(campaignName, campaignId, runId, 0, 0, link);
  return {
    event: 'test',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    link,
    message: 'Webhook is connected. Notifications will be sent when campaign runs complete.',
  };
}

// ── Teams Adaptive Card payloads ─────────────────────────────────

function teamsCard(body: any[], link: string): any {
  const card: any = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body,
        ...(link ? {
          actions: [{ type: 'Action.OpenUrl', title: 'Open in Dashboard', url: link }],
        } : {}),
      },
    }],
  };
  return card;
}

function buildTeamsCompleted(campaignName: string, runId: string, link: string, runType?: string): any {
  const leads = getLeadSummaries(runId);
  const topLeads = leads.slice(0, 5);
  const rerun = rerunLabel(runType);
  const facts = topLeads.map(l => ({
    title: `${scoreToStars(l.fit_score)} ${l.company_name}`,
    value: `${l.segment} · ${l.signal_count} signals${l.top_signal ? ' · ' + l.top_signal : ''}`,
  }));

  return teamsCard([
    { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: `✅ Campaign "${campaignName}"${rerun} — ${leads.length} new leads` },
    { type: 'FactSet', facts },
  ], link);
}

function buildTeamsFailed(campaignName: string, error: string, link: string, runType?: string): any {
  const rerun = rerunLabel(runType);
  return teamsCard([
    { type: 'TextBlock', size: 'Medium', weight: 'Bolder', color: 'Attention', text: `❌ Campaign "${campaignName}"${rerun} — run failed` },
    { type: 'TextBlock', wrap: true, text: error || 'Pipeline run failed. Check the dashboard for details.' },
  ], link);
}

function buildTeamsCancelled(campaignName: string, link: string, runType?: string): any {
  const rerun = rerunLabel(runType);
  return teamsCard([
    { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: `🚫 Campaign "${campaignName}"${rerun} — run cancelled` },
  ], link);
}

function buildTeamsMissed(campaignName: string, missedCount: number, missedTimes: string[], link: string): any {
  const mostRecent = missedTimes.length > 0 ? new Date(missedTimes[missedTimes.length - 1]).toLocaleString() : 'Unknown';
  return teamsCard([
    { type: 'TextBlock', size: 'Medium', weight: 'Bolder', color: 'Warning', text: `⚠️ Campaign "${campaignName}" — ${missedCount} missed run${missedCount !== 1 ? 's' : ''}` },
    { type: 'FactSet', facts: [
      { title: 'Most Recent', value: mostRecent },
      { title: 'Reason', value: 'Server was not running at scheduled time' },
    ]},
  ], link);
}

function buildTeamsTest(campaignName: string, link: string, runId?: string): any {
  if (runId) return buildTeamsCompleted(campaignName, runId, link);
  return teamsCard([
    { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: `🔔 Test — Campaign "${campaignName}"` },
    { type: 'TextBlock', wrap: true, text: 'Teams webhook is connected! Notifications will appear here when campaign runs complete.' },
  ], link);
}

// ── Delivery ─────────────────────────────────────────────────────

async function deliver(dest: NotificationDestination, payload: any): Promise<{ ok: boolean; error?: string }> {
  if (dest.type === 'rss') return { ok: false, error: 'RSS is pull-based, not deliverable' };

  try {
    const url = dest.config.url;
    const method = dest.config.method || 'POST';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (dest.config.headers) Object.assign(headers, dest.config.headers);
    if (dest.config.secret) {
      const body = JSON.stringify(payload);
      const sig = crypto.createHmac('sha256', dest.config.secret).update(body).digest('hex');
      headers['X-SignalStack-Signature'] = sig;
    }

    const body = JSON.stringify(payload);
    const res = await fetch(url, { method, headers, body });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Request failed' };
  }
}

// ── Fan-out dispatcher ───────────────────────────────────────────

type EventType = 'completed' | 'failed' | 'cancelled' | 'missed';

function buildPayload(dest: NotificationDestination, eventType: EventType, data: any, baseUrl: string): any {
  if (dest.type === 'rss') return null;
  const { campaign_name, campaign_id, run_id, run_type, triggered_by, estimated_cost } = data;
  const format = dest.config.format || 'json';
  const rLink = run_id ? runLink(baseUrl, run_id) : '';
  const cLink = campaignRunsLink(baseUrl, campaign_id);

  if (format === 'slack') {
    if (eventType === 'completed') return buildSlackCompleted(campaign_name, campaign_id, run_id, baseUrl, run_type, triggered_by);
    if (eventType === 'failed') return buildSlackFailed(campaign_name, data.error, rLink, run_type, triggered_by);
    if (eventType === 'missed') return buildSlackMissed(campaign_name, data.missed_count, data.missed_times, cLink);
    return buildSlackCancelled(campaign_name, rLink, run_type, triggered_by);
  }

  if (format === 'generic') {
    if (eventType === 'completed') return buildGenericCompleted(campaign_name, campaign_id, run_id, rLink, run_type);
    if (eventType === 'failed') return buildGenericFailed(campaign_name, data.error, rLink, run_type);
    if (eventType === 'missed') return buildGenericMissed(campaign_name, data.missed_count, data.missed_times, cLink);
    return buildGenericCancelled(campaign_name, rLink, run_type);
  }

  if (format === 'teams') {
    if (eventType === 'completed') return buildTeamsCompleted(campaign_name, run_id, rLink, run_type);
    if (eventType === 'failed') return buildTeamsFailed(campaign_name, data.error, rLink, run_type);
    if (eventType === 'missed') return buildTeamsMissed(campaign_name, data.missed_count, data.missed_times, cLink);
    return buildTeamsCancelled(campaign_name, rLink, run_type);
  }

  // json format
  if (eventType === 'completed') return buildWebhookCompleted(campaign_name, campaign_id, run_id, data.lead_count, data.estimated_cost, rLink, run_type);
  if (eventType === 'failed') return buildWebhookFailed(campaign_name, campaign_id, run_id, data.error, rLink, run_type);
  if (eventType === 'missed') return buildWebhookMissed(campaign_name, campaign_id, data.missed_count, data.missed_times, cLink);
  return buildWebhookCancelled(campaign_name, campaign_id, run_id, rLink, run_type);
}

async function fanOut(campaignId: string, eventType: EventType, data: any) {
  const destinations = getEnabledDestinations(campaignId);
  if (destinations.length === 0) return;

  const baseUrl = getCampaignBaseUrl(campaignId);

  const results = await Promise.allSettled(
    destinations.map(dest => {
      const payload = buildPayload(dest, eventType, data, baseUrl);
      return deliver(dest, payload);
    })
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)) {
      const err = r.status === 'rejected' ? r.reason : r.value.error;
      console.error(`[notifications] Failed to deliver to "${destinations[i].label}" (${destinations[i].type}): ${err}`);
    }
  });
}

// ── Public API ───────────────────────────────────────────────────

export function initNotificationDispatcher() {
  eventBus.on('campaign.completed', (event: SignalStackEvent<'campaign.completed'>) => {
    fanOut(event.data.campaign_id, 'completed', event.data);
  });

  eventBus.on('campaign.failed', (event: SignalStackEvent<'campaign.failed'>) => {
    fanOut(event.data.campaign_id, 'failed', event.data);
  });

  eventBus.on('campaign.cancelled', (event: SignalStackEvent<'campaign.cancelled'>) => {
    fanOut(event.data.campaign_id, 'cancelled', event.data);
  });

  eventBus.on('campaign.missed', (event: SignalStackEvent<'campaign.missed'>) => {
    fanOut(event.data.campaign_id, 'missed', event.data);
  });

  console.log('[notifications] Notification dispatcher initialized');
}

export async function sendTestNotification(campaignId: string, destinationId: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as any;
  if (!campaign) return { ok: false, error: 'Campaign not found' };

  const destinations: NotificationDestination[] = safeJsonParse(campaign.notification_destinations, []);
  const dest = destinations.find(d => d.id === destinationId);
  if (!dest) return { ok: false, error: 'Destination not found' };
  if (dest.type === 'rss') return { ok: true };

  const baseUrl = getCampaignBaseUrl(campaignId);

  const lastRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).get(campaignId) as any;

  const testLink = lastRun?.id ? runLink(baseUrl, lastRun.id) : campaignRunsLink(baseUrl, campaignId);

  const format = dest.type === 'webhook' ? (dest.config.format || 'json') : 'json';
  let payload: any;
  if (format === 'slack') {
    payload = buildSlackTest(campaign.name, campaignId, baseUrl, lastRun?.id);
  } else if (format === 'generic') {
    payload = buildGenericTest(campaign.name, campaignId, testLink, lastRun?.id);
  } else if (format === 'teams') {
    payload = buildTeamsTest(campaign.name, testLink, lastRun?.id);
  } else {
    payload = buildWebhookTest(campaign.name, campaignId, testLink, lastRun?.id);
  }

  return deliver(dest, payload);
}
