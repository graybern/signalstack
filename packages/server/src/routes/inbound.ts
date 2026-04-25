/**
 * Inbound Lead Import Routes
 *
 * POST /upload       — CSV file upload (admin)
 * POST /single       — Single lead entry (admin)
 * POST /webhook      — External webhook (API key auth)
 * GET  /imports      — List past imports (member)
 * GET  /imports/:id  — Import detail + leads (member)
 * PUT  /leads/:id/status — Update lead lifecycle status (member)
 */

import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, AuthRequest } from '../auth/middleware.js';
import { processInboundImport } from '../agent/inboundOrchestrator.js';
import { eventBus } from '../events/eventBus.js';
import type { InboundLeadInput, SourceType, LeadStatus } from '../types/index.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── CSV column mapping ──────────────────────────────────────────
const COLUMN_MAP: Record<string, keyof InboundLeadInput> = {
  company_name: 'company_name',
  company: 'company_name',
  name: 'company_name',
  organization: 'company_name',
  domain: 'domain',
  website: 'domain',
  url: 'domain',
  segment: 'segment',
  contact_name: 'contact_name',
  contact: 'contact_name',
  contact_email: 'contact_email',
  email: 'contact_email',
  contact_title: 'contact_title',
  title: 'contact_title',
  job_title: 'contact_title',
  notes: 'notes',
  comments: 'notes',
  source: 'source',
};

function parseCSV(buffer: Buffer): Record<string, string>[] {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase().replace(/\s+/g, '_'));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < values.length; j++) {
      row[headers[j]] = values[j].trim();
    }
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function mapRow(row: Record<string, string>): InboundLeadInput | null {
  const mapped: Partial<InboundLeadInput> = {};

  for (const [rawCol, value] of Object.entries(row)) {
    const col = rawCol.toLowerCase().replace(/\s+/g, '_');
    const field = COLUMN_MAP[col];
    if (field && value) {
      (mapped as any)[field] = value;
    }
  }

  if (!mapped.company_name) return null;

  // Clean domain
  if (mapped.domain) {
    mapped.domain = mapped.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  }

  // Validate segment
  if (mapped.segment && !['ENT', 'MM', 'SMB'].includes(mapped.segment.toUpperCase())) {
    delete mapped.segment;
  } else if (mapped.segment) {
    mapped.segment = mapped.segment.toUpperCase() as 'ENT' | 'MM' | 'SMB';
  }

  return mapped as InboundLeadInput;
}

function createShellLead(
  input: InboundLeadInput,
  importId: string,
  runId: string,
  sourceType: SourceType
): string {
  const db = getDb();
  const leadId = uuid();

  db.prepare(`
    INSERT INTO leads (
      id, run_id, import_id, company_name, domain, segment,
      fit_score, fit_score_label, source_type, lead_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 'Pending', ?, 'imported', datetime('now'))
  `).run(
    leadId,
    runId,
    importId,
    input.company_name,
    input.domain || null,
    input.segment || 'MM',
    sourceType
  );

  return leadId;
}

// ── POST /upload — CSV upload ──────────────────────────────────
router.post('/upload', authenticate, requireMember, upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const db = getDb();
  const importId = uuid();
  const runId = uuid();

  try {
    const rows = parseCSV(req.file.buffer);
    if (rows.length === 0) return res.status(400).json({ error: 'CSV has no data rows' });

    const leads: InboundLeadInput[] = [];
    for (const row of rows) {
      const mapped = mapRow(row);
      if (mapped) leads.push(mapped);
    }

    if (leads.length === 0) return res.status(400).json({ error: 'No valid leads found in CSV. Ensure a "company_name" or "company" column exists.' });

    // Create pipeline run
    db.prepare(
      "INSERT INTO pipeline_runs (id, triggered_by, status, started_at, created_at) VALUES (?, ?, 'running', datetime('now'), datetime('now'))"
    ).run(runId, req.user!.id);

    // Create import record
    db.prepare(
      "INSERT INTO inbound_imports (id, filename, source_type, row_count, created_by) VALUES (?, ?, 'inbound_csv', ?, ?)"
    ).run(importId, req.file.originalname, leads.length, req.user!.id);

    // Create shell leads
    for (const lead of leads) {
      createShellLead(lead, importId, runId, 'inbound_csv');
    }

    // Fire-and-forget processing
    processInboundImport(importId).catch(err => {
      console.error('[inbound] Background processing error:', err);
    });

    res.json({
      import_id: importId,
      run_id: runId,
      lead_count: leads.length,
      status: 'processing',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /single — Single lead entry ──────────────────────────
router.post('/single', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const input = req.body as InboundLeadInput;
  if (!input.company_name) return res.status(400).json({ error: 'company_name is required' });

  const db = getDb();
  const importId = uuid();
  const runId = uuid();

  // Clean domain
  if (input.domain) {
    input.domain = input.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  }

  // Create pipeline run
  db.prepare(
    "INSERT INTO pipeline_runs (id, triggered_by, status, started_at, created_at) VALUES (?, ?, 'running', datetime('now'), datetime('now'))"
  ).run(runId, req.user!.id);

  // Create import record
  db.prepare(
    "INSERT INTO inbound_imports (id, source_type, row_count, created_by) VALUES (?, 'inbound_manual', 1, ?)"
  ).run(importId, req.user!.id);

  // Create shell lead
  createShellLead(input, importId, runId, 'inbound_manual');

  // Fire-and-forget processing
  processInboundImport(importId).catch(err => {
    console.error('[inbound] Background processing error:', err);
  });

  res.json({
    import_id: importId,
    run_id: runId,
    lead_count: 1,
    status: 'processing',
  });
});

// ── POST /webhook — External webhook ──────────────────────────
router.post('/webhook', async (req, res: Response) => {
  // API key auth (not JWT)
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) return res.status(401).json({ error: 'Missing x-api-key header' });

  const db = getDb();
  const storedKey = db.prepare("SELECT value FROM app_settings WHERE key = 'webhook_api_key'").get() as { value: string } | undefined;
  if (!storedKey || JSON.parse(storedKey.value) !== apiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const body = req.body;
  const leads: InboundLeadInput[] = Array.isArray(body) ? body : [body];

  const validLeads = leads.filter(l => l.company_name);
  if (validLeads.length === 0) return res.status(400).json({ error: 'No valid leads (company_name required)' });

  const importId = uuid();
  const runId = uuid();

  // Create pipeline run (no user for webhook)
  db.prepare(
    "INSERT INTO pipeline_runs (id, status, started_at, created_at) VALUES (?, 'running', datetime('now'), datetime('now'))"
  ).run(runId);

  // Create import record
  db.prepare(
    "INSERT INTO inbound_imports (id, source_type, row_count) VALUES (?, 'inbound_webhook', ?)"
  ).run(importId, validLeads.length);

  // Create shell leads
  for (const lead of validLeads) {
    if (lead.domain) {
      lead.domain = lead.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    }
    createShellLead(lead, importId, runId, 'inbound_webhook');
  }

  // Fire-and-forget
  processInboundImport(importId).catch(err => {
    console.error('[inbound] Webhook processing error:', err);
  });

  res.json({
    import_id: importId,
    lead_count: validLeads.length,
    status: 'processing',
  });
});

// ── GET /imports — List imports ────────────────────────────────
router.get('/imports', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const imports = db
    .prepare('SELECT * FROM inbound_imports ORDER BY created_at DESC LIMIT 50')
    .all();
  res.json(imports);
});

// ── GET /imports/:id — Import detail with leads ────────────────
router.get('/imports/:id', authenticate, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM inbound_imports WHERE id = ?').get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Import not found' });

  const leads = db
    .prepare('SELECT * FROM leads WHERE import_id = ? ORDER BY fit_score DESC')
    .all(req.params.id);

  res.json({ import: imp, leads });
});

// ── POST /enrich — Enrichment-only mode for existing leads ────
router.post('/enrich', authenticate, requireMember, async (req: AuthRequest, res: Response) => {
  const { lead_ids, template_id } = req.body;

  if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
    return res.status(400).json({ error: 'lead_ids array is required' });
  }

  const db = getDb();
  const importId = uuid();
  const runId = uuid();

  // Load template config if provided
  let templateConfig: any = null;
  if (template_id) {
    templateConfig = db.prepare('SELECT * FROM import_templates WHERE id = ?').get(template_id);
  }

  // Create pipeline run
  db.prepare(
    "INSERT INTO pipeline_runs (id, triggered_by, status, started_at, created_at) VALUES (?, ?, 'running', datetime('now'), datetime('now'))"
  ).run(runId, req.user!.id);

  // Create import record
  db.prepare(
    "INSERT INTO inbound_imports (id, source_type, row_count, created_by) VALUES (?, 'inbound_manual', ?, ?)"
  ).run(importId, lead_ids.length, req.user!.id);

  // Update leads to enriching status and link to this import
  const updateLead = db.prepare('UPDATE leads SET lead_status = ?, import_id = ? WHERE id = ?');
  for (const id of lead_ids) {
    updateLead.run('enriching', importId, id);
  }

  // Fire-and-forget re-enrichment
  processInboundImport(importId).catch(err => {
    console.error('[inbound] Re-enrichment error:', err);
  });

  res.json({
    import_id: importId,
    run_id: runId,
    lead_count: lead_ids.length,
    status: 'processing',
    template: templateConfig ? templateConfig.name : null,
  });
});

// ── GET /templates — List enrichment templates ────────────────
router.get('/templates', authenticate, (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const templates = db.prepare('SELECT * FROM import_templates ORDER BY created_at DESC').all();
  res.json(templates.map((t: any) => ({
    ...t,
    output_format: t.output_format ? JSON.parse(t.output_format) : null,
    source_config: t.source_config ? JSON.parse(t.source_config) : null,
  })));
});

// ── POST /templates — Save enrichment template ────────────────
router.post('/templates', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const { name, type, prompt_template, output_format, source_config } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  if (!['inbound', 'outbound', 'enrichment'].includes(type)) {
    return res.status(400).json({ error: 'type must be inbound, outbound, or enrichment' });
  }

  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO import_templates (id, name, type, prompt_template, output_format, source_config, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, type, prompt_template || null, output_format ? JSON.stringify(output_format) : null, source_config ? JSON.stringify(source_config) : null, req.user!.id);

  res.json({ id, name, type });
});

// ── PUT /templates/:id — Update enrichment template ───────────
router.put('/templates/:id', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const { name, prompt_template, output_format, source_config } = req.body;
  const db = getDb();

  const existing = db.prepare('SELECT id FROM import_templates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (prompt_template !== undefined) { updates.push('prompt_template = ?'); params.push(prompt_template); }
  if (output_format !== undefined) { updates.push('output_format = ?'); params.push(JSON.stringify(output_format)); }
  if (source_config !== undefined) { updates.push('source_config = ?'); params.push(JSON.stringify(source_config)); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE import_templates SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ success: true });
});

// ── DELETE /templates/:id — Delete enrichment template ────────
router.delete('/templates/:id', authenticate, requireMember, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM import_templates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Template not found' });
  res.json({ success: true });
});

// ── PUT /leads/:id/status — Update lead lifecycle status ───────
router.put('/leads/:id/status', authenticate, (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const validStatuses: LeadStatus[] = [
    'imported', 'enriching', 'scored', 'qualified', 'disqualified', 'contacted', 'won', 'lost',
  ];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const db = getDb();
  const lead = db.prepare('SELECT id, company_name, lead_status FROM leads WHERE id = ?').get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const oldStatus = lead.lead_status || 'unknown';
  db.prepare('UPDATE leads SET lead_status = ? WHERE id = ?').run(status, req.params.id);

  // Emit status change event
  eventBus.emit('lead.status_changed', {
    lead_id: req.params.id,
    company_name: lead.company_name,
    old_status: oldStatus,
    new_status: status,
    changed_by: req.user?.id,
  });

  res.json({ success: true, status });
});

export default router;
