import cron from 'node-cron';
import { config } from '../config.js';
import { runPipeline } from '../agent/orchestrator.js';

export function initScheduler() {
  if (!config.cronEnabled) {
    console.log('Cron scheduler disabled');
    return;
  }

  cron.schedule(config.cronSchedule, async () => {
    console.log(`[CRON] Pipeline run triggered at ${new Date().toISOString()}`);
    try {
      await runPipeline('system');
      console.log('[CRON] Pipeline run completed');
    } catch (err) {
      console.error('[CRON] Pipeline run failed:', err);
    }
  });

  console.log(`Cron scheduler active: ${config.cronSchedule}`);
}
