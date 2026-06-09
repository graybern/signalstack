import cron from 'node-cron';
import { getDb } from '../db/schema.js';
import { runCampaign } from '../agent/campaignOrchestrator.js';
import { eventBus } from '../events/eventBus.js';

export function initWatchlistScheduler() {
  cron.schedule('0 6 * * *', async () => {
    console.log('[watchlist] Running daily wake check...');
    try {
      await wakeOverdueItems();
    } catch (err) {
      console.error('[watchlist] Wake check failed:', err);
    }
  });
  console.log('[watchlist] Daily wake scheduler initialized (06:00 server time)');
}

async function wakeOverdueItems() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const items = db.prepare(`
    SELECT w.*, l.company_name, l.fit_score, l.potential_score, l.urgency_score
    FROM watch_items w
    JOIN leads l ON l.id = w.lead_id
    WHERE w.status = 'active' AND w.snooze_until <= ?
  `).all(today) as any[];

  if (items.length === 0) {
    console.log('[watchlist] No items to wake today');
    return;
  }

  let rerunCount = 0;

  for (const item of items) {
    db.prepare(
      "UPDATE watch_items SET status = 'woken', woken_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(item.id);

    let delta: { fit_score_change: number; potential_change: number; urgency_change: number } | null = null;

    if (item.rerun_on_wake) {
      rerunCount++;
      try {
        await runCampaign(item.campaign_id, null, ['enrich', 'score'], [item.lead_id], 'stage_rerun');
        const updated = db.prepare('SELECT fit_score, potential_score, urgency_score FROM leads WHERE id = ?').get(item.lead_id) as any;
        if (updated) {
          const snapshot = JSON.parse(item.score_snapshot || '{}');
          delta = {
            fit_score_change: (updated.fit_score ?? 0) - (snapshot.fit_score ?? 0),
            potential_change: (updated.potential_score ?? 0) - (snapshot.potential_score ?? 0),
            urgency_change: (updated.urgency_score ?? 0) - (snapshot.urgency_score ?? 0),
          };
          db.prepare("UPDATE watch_items SET wake_delta = ?, updated_at = datetime('now') WHERE id = ?")
            .run(JSON.stringify(delta), item.id);
        }
      } catch (err) {
        console.error(`[watchlist] Re-enrich failed for ${item.company_name}:`, err);
      }
    }

    eventBus.emit('watch.woken', {
      watch_id: item.id,
      lead_id: item.lead_id,
      company_name: item.company_name,
      delta,
    });
  }

  console.log(`[watchlist] Woke ${items.length} items, ${rerunCount} triggered re-enrichment`);
}
