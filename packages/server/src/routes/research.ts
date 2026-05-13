import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, requirePermission, AuthRequest } from '../auth/middleware.js';

const router = Router();

router.post('/', authenticate, requirePermission('research:execute'), async (req: AuthRequest, res: Response) => {
  const { domain, campaign_id, context } = req.body;
  if (!domain || !campaign_id) {
    return res.status(400).json({ error: 'domain and campaign_id are required' });
  }

  const db = getDb();

  const campaign = db.prepare("SELECT id, name FROM campaigns WHERE id = ? AND status = 'active'").get(campaign_id) as any;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found or archived' });

  const activeRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status IN ('pending','running') LIMIT 1"
  ).get(campaign_id) as any;
  if (activeRun) return res.status(409).json({ error: 'A run is already in progress for this campaign' });

  const normalizedDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').trim();
  if (!normalizedDomain) return res.status(400).json({ error: 'Invalid domain' });

  let lead = db.prepare(
    'SELECT id FROM leads WHERE campaign_id = ? AND domain = ?'
  ).get(campaign_id, normalizedDomain) as any;

  const isExisting = !!lead;

  if (!lead) {
    const leadId = uuid();
    const namePart = normalizedDomain.split('.')[0];
    const companyName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    db.prepare(
      `INSERT INTO leads (id, campaign_id, company_name, domain, segment, fit_score, pipeline_stage, lead_status, source_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'MM', 0, 'discovered', 'pending', 'quick_research', datetime('now'), datetime('now'))`
    ).run(leadId, campaign_id, companyName, normalizedDomain);
    lead = { id: leadId };
  }

  if (context?.trim()) {
    const row = db.prepare('SELECT candidate_data FROM leads WHERE id = ?').get(lead.id) as any;
    const existing = row?.candidate_data ? JSON.parse(row.candidate_data) : {};
    const header = `## Pre-Research Context\n${context.trim()}`;
    existing.notes = existing.notes ? `${header}\n\n${existing.notes}` : header;
    db.prepare('UPDATE leads SET candidate_data = ? WHERE id = ?')
      .run(JSON.stringify(existing), lead.id);
  }

  const { runCampaign } = await import('../agent/campaignOrchestrator.js');
  const steps = ['enrich', 'score', 'brief', 'audit'];

  const runPromise = runCampaign(campaign_id, req.user!.id, steps, [lead.id], 'quick_research');
  runPromise.catch(err => {
    console.error('[quick-research] Failed:', err);
  });

  await new Promise(resolve => setTimeout(resolve, 50));
  const newRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(campaign_id) as any;

  res.json({
    status: 'started',
    run_id: newRun?.id || null,
    lead_id: lead.id,
    domain: normalizedDomain,
    is_existing: isExisting,
  });
});

router.get('/history', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const runs = db.prepare(
    `SELECT pr.id, pr.status, pr.campaign_id, pr.target_lead_ids, pr.started_at, pr.completed_at, pr.estimated_cost, pr.lead_count, pr.error_message, pr.created_at, pr.steps_run,
            c.name as campaign_name,
            u.display_name as triggered_by_name
     FROM pipeline_runs pr
     LEFT JOIN campaigns c ON c.id = pr.campaign_id
     LEFT JOIN users u ON u.id = pr.triggered_by
     WHERE pr.run_type = 'quick_research'
     ORDER BY pr.created_at DESC LIMIT 50`
  ).all() as any[];

  const enriched = runs.map(run => {
    let leadInfo = null;
    if (run.target_lead_ids) {
      try {
        const leadIds = JSON.parse(run.target_lead_ids);
        if (leadIds.length > 0) {
          leadInfo = db.prepare(
            'SELECT id, company_name, domain, fit_score, fit_score_label, segment FROM leads WHERE id = ?'
          ).get(leadIds[0]) as any;
        }
      } catch {}
    }
    return { ...run, lead: leadInfo };
  });

  res.json(enriched);
});

export default router;
