import { getDb } from '../db/schema.js';
import { eventBus, SignalStackEvent } from '../events/eventBus.js';

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

async function postToSlack(webhookUrl: string, payload: any): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function buildCompletedMessage(campaignName: string, campaignId: string, runId: string): any {
  const db = getDb();
  const leads = db.prepare(
    'SELECT company_name, employee_count, fit_score, segment, why_now, pain_hypotheses, competitive_displacement, outreach_strategy FROM leads WHERE run_id = ? ORDER BY fit_score DESC'
  ).all(runId) as any[];

  const topLeads = leads.slice(0, Math.max(3, Math.min(5, leads.length)));
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.fit_score, 0) / leads.length) : 0;
  const segments = leads.reduce((acc: Record<string, number>, l: any) => { acc[l.segment] = (acc[l.segment] || 0) + 1; return acc; }, {});
  const segmentSummary = Object.entries(segments).map(([s, c]) => `${c} ${s}`).join(', ');

  const leadBlocks = topLeads.map((l: any) => {
    const whyNow = safeJsonParse(l.why_now, []);
    const pains = safeJsonParse(l.pain_hypotheses, []);
    const competitive = safeJsonParse(l.competitive_displacement, {});
    const outreach = safeJsonParse(l.outreach_strategy, {});
    const signalCount = whyNow.length + pains.length;
    const stars = scoreToStars(l.fit_score);
    const topSignal = whyNow[0] || '';
    const pitch = outreach.one_line_pitch || '';
    const displaces = (competitive.likely_current || []).filter(Boolean).join(', ');
    const empLabel = l.employee_count ? `${l.employee_count.toLocaleString()} emp` : '';

    let text = `*${stars} ${l.company_name}* (${l.segment}${empLabel ? ', ' + empLabel : ''}) · ${signalCount} signals`;
    if (topSignal) text += `\n>_Why now:_ ${topSignal}`;
    if (pitch) text += `\n>_Angle:_ ${pitch}`;
    if (displaces) text += `\n>_Displaces:_ ${displaces}`;
    return { type: 'section', text: { type: 'mrkdwn', text } };
  });

  const remaining = leads.length - topLeads.length;
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `✅ Campaign "${campaignName}" — ${leads.length} new leads` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Avg ${scoreToStars(avgScore)} | ${segmentSummary}` }],
    },
    { type: 'divider' },
    ...leadBlocks,
  ];

  if (remaining > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `+ ${remaining} more leads in dashboard` }],
    });
  }

  return { blocks };
}

function buildFailedMessage(campaignName: string, error: string): any {
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `❌ Campaign "${campaignName}" — run failed` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: error || 'Pipeline run failed. Check the dashboard for details.' },
      },
    ],
  };
}

function buildCancelledMessage(campaignName: string): any {
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🚫 Campaign "${campaignName}" — run cancelled` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Pipeline run was manually cancelled.' },
      },
    ],
  };
}

function getWebhookUrl(campaignId: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT slack_webhook_url FROM campaigns WHERE id = ?').get(campaignId) as any;
  return row?.slack_webhook_url || null;
}

export function initSlackNotifier() {
  eventBus.on('campaign.completed', (event: SignalStackEvent<'campaign.completed'>) => {
    const url = getWebhookUrl(event.data.campaign_id);
    if (!url) return;
    const payload = buildCompletedMessage(event.data.campaign_name, event.data.campaign_id, event.data.run_id);
    postToSlack(url, payload).then(ok => {
      if (!ok) console.error(`[slack] Failed to post to webhook for campaign ${event.data.campaign_id}`);
    });
  });

  eventBus.on('campaign.failed', (event: SignalStackEvent<'campaign.failed'>) => {
    const url = getWebhookUrl(event.data.campaign_id);
    if (!url) return;
    const payload = buildFailedMessage(event.data.campaign_name, event.data.error);
    postToSlack(url, payload);
  });

  eventBus.on('campaign.cancelled', (event: SignalStackEvent<'campaign.cancelled'>) => {
    const url = getWebhookUrl(event.data.campaign_id);
    if (!url) return;
    const payload = buildCancelledMessage(event.data.campaign_name);
    postToSlack(url, payload);
  });

  console.log('[slack] Slack notifier initialized');
}

export async function sendTestSlackMessage(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as any;
  if (!campaign) return { ok: false, error: 'Campaign not found' };
  if (!campaign.slack_webhook_url) return { ok: false, error: 'No Slack webhook URL configured' };

  const lastRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).get(campaignId) as any;

  let payload: any;
  if (lastRun) {
    payload = buildCompletedMessage(campaign.name, campaignId, lastRun.id);
  } else {
    payload = {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🔔 Test — Campaign "${campaign.name}"` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'Slack webhook is connected! Notifications will appear here when campaign runs complete.' },
        },
      ],
    };
  }

  const ok = await postToSlack(campaign.slack_webhook_url, payload);
  return ok ? { ok: true } : { ok: false, error: 'Failed to post to Slack webhook URL. Check the URL is correct.' };
}
