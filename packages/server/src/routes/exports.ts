import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, AuthRequest } from '../auth/middleware.js';
import { generateSummaryCSV, generateDetailedCSV } from '../services/sfExport.js';
import { generateSegmentMarkdown } from '../services/markdown.js';
import { generateRSS } from '../services/rss.js';

const router = Router();

function getLatestRunLeads() {
  const db = getDb();
  const latestRun = db.prepare(
    "SELECT id, created_at FROM pipeline_runs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).get() as any;
  if (!latestRun) return { run: null, leads: [] };

  const leads = db.prepare(
    `SELECT l.*,
      (SELECT json_group_array(json_object('id',p.id,'role_type',p.role_type,'name',p.name,'title',p.title,'linkedin_url',p.linkedin_url,'department',p.department,'outreach_angle',p.outreach_angle,'talking_points',p.talking_points,'outreach_message',p.outreach_message))
       FROM personas p WHERE p.lead_id = l.id) as personas_json
     FROM leads l WHERE l.run_id = ? ORDER BY l.segment, l.fit_score DESC`
  ).all(latestRun.id);

  return { run: latestRun, leads };
}

router.get('/csv/summary', authenticate, (_req: AuthRequest, res: Response) => {
  const { run, leads } = getLatestRunLeads();
  if (!run) return res.status(404).json({ error: 'No completed pipeline runs' });

  const csv = generateSummaryCSV(leads);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="signalstack-summary-${run.created_at.slice(0, 10)}.csv"`);
  res.send(csv);
});

router.get('/csv/detailed', authenticate, (_req: AuthRequest, res: Response) => {
  const { run, leads } = getLatestRunLeads();
  if (!run) return res.status(404).json({ error: 'No completed pipeline runs' });

  const csv = generateDetailedCSV(leads);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="signalstack-detailed-${run.created_at.slice(0, 10)}.csv"`);
  res.send(csv);
});

router.get('/markdown/:segment', authenticate, (req: AuthRequest, res: Response) => {
  const segment = req.params.segment.toUpperCase();
  if (!['ENT', 'MM', 'SMB'].includes(segment)) {
    return res.status(400).json({ error: 'Segment must be ENT, MM, or SMB' });
  }

  const { run, leads } = getLatestRunLeads();
  if (!run) return res.status(404).json({ error: 'No completed pipeline runs' });

  const segmentLeads = leads.filter((l: any) => l.segment === segment);
  const md = generateSegmentMarkdown(segment, segmentLeads, run.created_at.slice(0, 10));

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="signalstack-${segment}-${run.created_at.slice(0, 10)}.md"`);
  res.send(md);
});

router.get('/rss', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const runs = db.prepare(
    "SELECT * FROM pipeline_runs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 30"
  ).all();

  const rss = generateRSS(runs);
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(rss);
});

// ── POST /custom — Configurable export with field selection ───
router.post('/custom', authenticate, (req: AuthRequest, res: Response) => {
  const { format = 'csv', fields, filters } = req.body;
  const db = getDb();

  const allFields = [
    'company_name', 'domain', 'segment', 'fit_score', 'fit_score_label', 'confidence',
    'hq_location', 'employee_count', 'founded_year', 'funding_stage', 'total_funding',
    'current_feedback', 'next_outreach_date', 'signal_count', 'source_type', 'lead_status',
    'why_now', 'outreach_strategy', 'brief_markdown', 'created_at',
  ];

  const selectedFields = Array.isArray(fields) && fields.length > 0
    ? fields.filter((f: string) => allFields.includes(f))
    : allFields;

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.campaign_id) { conditions.push('l.campaign_id = ?'); params.push(filters.campaign_id); }
  if (filters?.segment) { conditions.push('l.segment = ?'); params.push(filters.segment); }
  if (filters?.feedback) { conditions.push('l.current_feedback = ?'); params.push(filters.feedback); }
  if (filters?.min_score) { conditions.push('l.fit_score >= ?'); params.push(filters.min_score); }
  if (filters?.max_score) { conditions.push('l.fit_score <= ?'); params.push(filters.max_score); }
  if (filters?.date_from) { conditions.push('l.created_at >= ?'); params.push(filters.date_from); }
  if (filters?.date_to) { conditions.push('l.created_at <= ?'); params.push(filters.date_to + ' 23:59:59'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const selectCols = selectedFields.map(f => `l.${f}`).join(', ');

  const leads = db.prepare(
    `SELECT ${selectCols}, c.name as campaign_name
     FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id
     ${where} ORDER BY l.fit_score DESC`
  ).all(...params) as any[];

  const outputFields = selectedFields.includes('campaign_id') || !selectedFields.includes('campaign_name')
    ? selectedFields
    : [...selectedFields, 'campaign_name'];

  if (format === 'json') {
    const filtered = leads.map(l => {
      const obj: Record<string, any> = {};
      for (const f of outputFields) obj[f] = l[f] ?? null;
      return obj;
    });
    return res.json({ leads: filtered, count: filtered.length, fields: outputFields });
  }

  if (format === 'markdown') {
    const header = `# Lead Export\n\nGenerated: ${new Date().toISOString().slice(0, 10)}\nTotal: ${leads.length} leads\n\n`;
    const rows = leads.map(l => outputFields.map(f => `- **${f}**: ${l[f] ?? '—'}`).join('\n')).join('\n\n---\n\n');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.md"`);
    return res.send(header + rows);
  }

  // CSV
  const header = outputFields.join(',');
  const csvRows = leads.map(l => outputFields.map(f => {
    const val = l[f];
    if (val == null) return '';
    const str = String(val);
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(','));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header, ...csvRows].join('\n'));
});

// ── GET /pipelines — List export pipeline configs ─────────────
router.get('/pipelines', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const pipelines = db.prepare('SELECT * FROM export_pipelines ORDER BY created_at DESC').all();
  res.json(pipelines.map((p: any) => ({
    ...p,
    events: p.events ? JSON.parse(p.events) : [],
    field_mapping: p.field_mapping ? JSON.parse(p.field_mapping) : null,
    filters: p.filters ? JSON.parse(p.filters) : null,
  })));
});

// ── POST /pipelines — Create export pipeline ──────────────────
router.post('/pipelines', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const { name, webhook_url, events, field_mapping, filters, schedule_cron } = req.body;
  if (!name || !webhook_url) return res.status(400).json({ error: 'name and webhook_url are required' });

  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO export_pipelines (id, name, webhook_url, events, field_mapping, filters, schedule_cron, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, name, webhook_url,
    events ? JSON.stringify(events) : '["lead.created"]',
    field_mapping ? JSON.stringify(field_mapping) : null,
    filters ? JSON.stringify(filters) : null,
    schedule_cron || null,
    req.user!.id
  );

  res.json({ id, name, webhook_url });
});

// ── PUT /pipelines/:id — Update export pipeline ──────────────
router.put('/pipelines/:id', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const { name, webhook_url, events, field_mapping, filters, schedule_cron, schedule_enabled, active } = req.body;
  const db = getDb();

  const existing = db.prepare('SELECT id FROM export_pipelines WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Pipeline not found' });

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (webhook_url !== undefined) { updates.push('webhook_url = ?'); params.push(webhook_url); }
  if (events !== undefined) { updates.push('events = ?'); params.push(JSON.stringify(events)); }
  if (field_mapping !== undefined) { updates.push('field_mapping = ?'); params.push(JSON.stringify(field_mapping)); }
  if (filters !== undefined) { updates.push('filters = ?'); params.push(JSON.stringify(filters)); }
  if (schedule_cron !== undefined) { updates.push('schedule_cron = ?'); params.push(schedule_cron); }
  if (schedule_enabled !== undefined) { updates.push('schedule_enabled = ?'); params.push(schedule_enabled ? 1 : 0); }
  if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE export_pipelines SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ success: true });
});

// ── DELETE /pipelines/:id — Delete export pipeline ────────────
router.delete('/pipelines/:id', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM export_pipelines WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Pipeline not found' });
  res.json({ success: true });
});

export default router;
