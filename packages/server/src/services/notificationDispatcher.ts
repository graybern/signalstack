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

// ── Lead data helpers ────────────────────────────────────────────

interface LeadSummary {
  company_name: string;
  segment: string;
  employee_count: number | null;
  fit_score: number;
  signal_count: number;
  top_signal: string;
  pitch: string;
  displaces: string;
}

function getLeadSummaries(runId: string): LeadSummary[] {
  const db = getDb();
  const leads = db.prepare(
    'SELECT company_name, employee_count, fit_score, segment, why_now, pain_hypotheses, competitive_displacement, outreach_strategy FROM leads WHERE run_id = ? ORDER BY fit_score DESC'
  ).all(runId) as any[];

  return leads.map(l => {
    const whyNow = safeJsonParse(l.why_now, []);
    const pains = safeJsonParse(l.pain_hypotheses, []);
    const competitive = safeJsonParse(l.competitive_displacement, {});
    const outreach = safeJsonParse(l.outreach_strategy, {});
    return {
      company_name: l.company_name,
      segment: l.segment,
      employee_count: l.employee_count,
      fit_score: l.fit_score,
      signal_count: whyNow.length + pains.length,
      top_signal: whyNow[0] || '',
      pitch: outreach.one_line_pitch || '',
      displaces: (competitive.likely_current || []).filter(Boolean).join(', '),
    };
  });
}

// ── Slack Block Kit payloads ─────────────────────────────────────

function buildSlackCompleted(campaignName: string, runId: string): any {
  const leads = getLeadSummaries(runId);
  const topLeads = leads.slice(0, Math.max(3, Math.min(5, leads.length)));
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.fit_score, 0) / leads.length) : 0;
  const segments = leads.reduce((acc: Record<string, number>, l) => { acc[l.segment] = (acc[l.segment] || 0) + 1; return acc; }, {});
  const segmentSummary = Object.entries(segments).map(([s, c]) => `${c} ${s}`).join(', ');

  const leadBlocks = topLeads.map(l => {
    const stars = scoreToStars(l.fit_score);
    const empLabel = l.employee_count ? `${l.employee_count.toLocaleString()} emp` : '';
    let text = `*${stars} ${l.company_name}* (${l.segment}${empLabel ? ', ' + empLabel : ''}) · ${l.signal_count} signals`;
    if (l.top_signal) text += `\n>_Why now:_ ${l.top_signal}`;
    if (l.pitch) text += `\n>_Angle:_ ${l.pitch}`;
    if (l.displaces) text += `\n>_Displaces:_ ${l.displaces}`;
    return { type: 'section', text: { type: 'mrkdwn', text } };
  });

  const remaining = leads.length - topLeads.length;
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `✅ Campaign "${campaignName}" — ${leads.length} new leads` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Avg ${scoreToStars(avgScore)} | ${segmentSummary}` }] },
    { type: 'divider' },
    ...leadBlocks,
  ];

  if (remaining > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `+ ${remaining} more leads in dashboard` }] });
  }

  return { blocks };
}

function buildSlackFailed(campaignName: string, error: string): any {
  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `❌ Campaign "${campaignName}" — run failed` } },
      { type: 'section', text: { type: 'mrkdwn', text: error || 'Pipeline run failed. Check the dashboard for details.' } },
    ],
  };
}

function buildSlackCancelled(campaignName: string): any {
  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🚫 Campaign "${campaignName}" — run cancelled` } },
      { type: 'section', text: { type: 'mrkdwn', text: 'Pipeline run was manually cancelled.' } },
    ],
  };
}

function buildSlackTest(campaignName: string, runId?: string): any {
  if (runId) return buildSlackCompleted(campaignName, runId);
  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🔔 Test — Campaign "${campaignName}"` } },
      { type: 'section', text: { type: 'mrkdwn', text: 'Slack webhook is connected! Notifications will appear here when campaign runs complete.' } },
    ],
  };
}

// ── Generic webhook payloads ─────────────────────────────────────

function buildWebhookCompleted(campaignName: string, campaignId: string, runId: string, leadCount: number, cost: number): any {
  const leads = getLeadSummaries(runId).slice(0, 10);
  return {
    event: 'campaign.completed',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    run: { id: runId, lead_count: leadCount, estimated_cost: cost },
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

function buildWebhookFailed(campaignName: string, campaignId: string, runId: string, error: string): any {
  return {
    event: 'campaign.failed',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    run: { id: runId },
    error,
  };
}

function buildWebhookCancelled(campaignName: string, campaignId: string, runId: string): any {
  return {
    event: 'campaign.cancelled',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    run: { id: runId },
  };
}

function buildWebhookTest(campaignName: string, campaignId: string, runId?: string): any {
  if (runId) return buildWebhookCompleted(campaignName, campaignId, runId, 0, 0);
  return {
    event: 'test',
    timestamp: new Date().toISOString(),
    campaign: { id: campaignId, name: campaignName },
    message: 'Webhook is connected. Notifications will be sent when campaign runs complete.',
  };
}

// ── Teams Adaptive Card payloads ─────────────────────────────────

function buildTeamsCompleted(campaignName: string, runId: string): any {
  const leads = getLeadSummaries(runId);
  const topLeads = leads.slice(0, 5);
  const facts = topLeads.map(l => ({
    title: `${scoreToStars(l.fit_score)} ${l.company_name}`,
    value: `${l.segment} · ${l.signal_count} signals${l.top_signal ? ' · ' + l.top_signal : ''}`,
  }));

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: `✅ Campaign "${campaignName}" — ${leads.length} new leads` },
          { type: 'FactSet', facts },
        ],
      },
    }],
  };
}

function buildTeamsFailed(campaignName: string, error: string): any {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', size: 'Medium', weight: 'Bolder', color: 'Attention', text: `❌ Campaign "${campaignName}" — run failed` },
          { type: 'TextBlock', wrap: true, text: error || 'Pipeline run failed. Check the dashboard for details.' },
        ],
      },
    }],
  };
}

function buildTeamsCancelled(campaignName: string): any {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: `🚫 Campaign "${campaignName}" — run cancelled` },
        ],
      },
    }],
  };
}

function buildTeamsTest(campaignName: string, runId?: string): any {
  if (runId) return buildTeamsCompleted(campaignName, runId);
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: `🔔 Test — Campaign "${campaignName}"` },
          { type: 'TextBlock', wrap: true, text: 'Teams webhook is connected! Notifications will appear here when campaign runs complete.' },
        ],
      },
    }],
  };
}

// ── Delivery ─────────────────────────────────────────────────────

async function deliver(dest: NotificationDestination, payload: any): Promise<{ ok: boolean; error?: string }> {
  if (dest.type === 'rss') return { ok: false, error: 'RSS is pull-based, not deliverable' };

  try {
    let url: string;
    let method = 'POST';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (dest.type === 'slack') {
      url = dest.config.webhook_url;
    } else if (dest.type === 'teams') {
      url = dest.config.webhook_url;
    } else {
      url = dest.config.url;
      method = dest.config.method || 'POST';
      if (dest.config.headers) Object.assign(headers, dest.config.headers);
      if (dest.config.secret) {
        const body = JSON.stringify(payload);
        const sig = crypto.createHmac('sha256', dest.config.secret).update(body).digest('hex');
        headers['X-SignalStack-Signature'] = sig;
      }
    }

    const body = JSON.stringify(payload);
    const res = await fetch(url, { method, headers, body });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Request failed' };
  }
}

// ── Fan-out dispatcher ───────────────────────────────────────────

type EventType = 'completed' | 'failed' | 'cancelled';

function buildPayload(dest: NotificationDestination, eventType: EventType, data: any): any {
  const { campaign_name, campaign_id, run_id } = data;

  if (dest.type === 'slack') {
    if (eventType === 'completed') return buildSlackCompleted(campaign_name, run_id);
    if (eventType === 'failed') return buildSlackFailed(campaign_name, data.error);
    return buildSlackCancelled(campaign_name);
  }

  if (dest.type === 'teams') {
    if (eventType === 'completed') return buildTeamsCompleted(campaign_name, run_id);
    if (eventType === 'failed') return buildTeamsFailed(campaign_name, data.error);
    return buildTeamsCancelled(campaign_name);
  }

  // webhook
  if (eventType === 'completed') return buildWebhookCompleted(campaign_name, campaign_id, run_id, data.lead_count, data.estimated_cost);
  if (eventType === 'failed') return buildWebhookFailed(campaign_name, campaign_id, run_id, data.error);
  return buildWebhookCancelled(campaign_name, campaign_id, run_id);
}

async function fanOut(campaignId: string, eventType: EventType, data: any) {
  const destinations = getEnabledDestinations(campaignId);
  if (destinations.length === 0) return;

  const results = await Promise.allSettled(
    destinations.map(dest => {
      const payload = buildPayload(dest, eventType, data);
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

  console.log('[notifications] Notification dispatcher initialized');
}

export async function sendTestNotification(campaignId: string, destinationId: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as any;
  if (!campaign) return { ok: false, error: 'Campaign not found' };

  const destinations: NotificationDestination[] = safeJsonParse(campaign.notification_destinations, []);
  const dest = destinations.find(d => d.id === destinationId);
  if (!dest) return { ok: false, error: 'Destination not found' };

  const lastRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).get(campaignId) as any;

  let payload: any;
  if (dest.type === 'rss') return { ok: true };

  if (dest.type === 'slack') {
    payload = buildSlackTest(campaign.name, lastRun?.id);
  } else if (dest.type === 'teams') {
    payload = buildTeamsTest(campaign.name, lastRun?.id);
  } else {
    payload = buildWebhookTest(campaign.name, campaignId, lastRun?.id);
  }

  return deliver(dest, payload);
}
