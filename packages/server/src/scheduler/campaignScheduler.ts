import cron, { ScheduledTask } from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { runCampaign } from '../agent/campaignOrchestrator.js';

const activeTasks = new Map<string, ScheduledTask>();

export function initCampaignScheduler() {
  const db = getDb();
  const campaigns = db.prepare(
    "SELECT id, name, schedule_cron FROM campaigns WHERE status = 'active' AND schedule_enabled = 1 AND schedule_cron IS NOT NULL"
  ).all() as { id: string; name: string; schedule_cron: string }[];

  for (const campaign of campaigns) {
    detectMissedRuns(campaign.id, campaign.name, campaign.schedule_cron);
    registerCampaignCron(campaign.id, campaign.name, campaign.schedule_cron);
  }

  if (campaigns.length > 0) {
    console.log(`[scheduler] Registered ${campaigns.length} campaign cron jobs`);
  }
}

function detectMissedRuns(campaignId: string, campaignName: string, cronExpression: string) {
  const db = getDb();

  const lastRun = db.prepare(
    `SELECT created_at FROM pipeline_runs
     WHERE campaign_id = ? AND status != 'missed'
     ORDER BY created_at DESC LIMIT 1`
  ).get(campaignId) as { created_at: string } | undefined;

  const since = lastRun
    ? new Date(lastRun.created_at + 'Z')
    : null;

  if (!since) return;

  try {
    const now = new Date();
    const expr = CronExpressionParser.parse(cronExpression, {
      currentDate: since,
      endDate: now,
    });

    const missed: Date[] = [];
    try {
      while (true) {
        const next = expr.next();
        if (next.toDate() >= now) break;
        missed.push(next.toDate());
      }
    } catch {
      // Iterator exhausted — no more dates in range
    }

    if (missed.length === 0) return;

    const existingMissed = db.prepare(
      `SELECT created_at FROM pipeline_runs
       WHERE campaign_id = ? AND status = 'missed'`
    ).all(campaignId) as { created_at: string }[];
    const existingTimes = new Set(existingMissed.map(r => r.created_at));

    const insert = db.prepare(
      `INSERT INTO pipeline_runs (id, campaign_id, triggered_by, status, run_type, started_at, completed_at, error_message, created_at)
       VALUES (?, ?, NULL, 'missed', 'campaign', ?, ?, ?, ?)`
    );

    let inserted = 0;
    for (const missedAt of missed) {
      const iso = missedAt.toISOString().replace('T', ' ').replace('Z', '');
      if (existingTimes.has(iso)) continue;
      insert.run(uuid(), campaignId, iso, iso, 'Server was not running at scheduled time', iso);
      inserted++;
    }

    if (inserted > 0) {
      console.warn(`[scheduler] Recorded ${inserted} missed run(s) for "${campaignName}" since ${since.toISOString()}`);
    }
  } catch (err) {
    console.error(`[scheduler] Failed to detect missed runs for "${campaignName}":`, err);
  }
}

export function registerCampaignCron(campaignId: string, campaignName: string, cronExpression: string) {
  // Remove existing task if any
  unregisterCampaignCron(campaignId);

  if (!cron.validate(cronExpression)) {
    console.warn(`[scheduler] Invalid cron expression for campaign "${campaignName}": ${cronExpression}`);
    return;
  }

  const task = cron.schedule(cronExpression, async () => {
    console.log(`[scheduler] Campaign "${campaignName}" (${campaignId}) triggered by schedule at ${new Date().toISOString()}`);
    try {
      await runCampaign(campaignId, 'system');
      console.log(`[scheduler] Campaign "${campaignName}" scheduled run completed`);
    } catch (err) {
      console.error(`[scheduler] Campaign "${campaignName}" scheduled run failed:`, err);
    }
  });

  activeTasks.set(campaignId, task);
  console.log(`[scheduler] Registered cron for "${campaignName}": ${cronExpression}`);
}

export function unregisterCampaignCron(campaignId: string) {
  const existing = activeTasks.get(campaignId);
  if (existing) {
    existing.stop();
    activeTasks.delete(campaignId);
  }
}

export function getScheduledCampaigns(): { id: string; name: string; schedule_cron: string }[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, name, schedule_cron FROM campaigns WHERE status = 'active' AND schedule_enabled = 1 AND schedule_cron IS NOT NULL"
  ).all() as { id: string; name: string; schedule_cron: string }[];
}
