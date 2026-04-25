import cron, { ScheduledTask } from 'node-cron';
import { getDb } from '../db/schema.js';
import { runCampaign } from '../agent/campaignOrchestrator.js';

const activeTasks = new Map<string, ScheduledTask>();

export function initCampaignScheduler() {
  const db = getDb();
  const campaigns = db.prepare(
    "SELECT id, name, schedule_cron FROM campaigns WHERE status = 'active' AND schedule_enabled = 1 AND schedule_cron IS NOT NULL"
  ).all() as { id: string; name: string; schedule_cron: string }[];

  for (const campaign of campaigns) {
    registerCampaignCron(campaign.id, campaign.name, campaign.schedule_cron);
  }

  if (campaigns.length > 0) {
    console.log(`[scheduler] Registered ${campaigns.length} campaign cron jobs`);
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
