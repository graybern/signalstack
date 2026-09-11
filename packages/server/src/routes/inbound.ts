/**
 * Inbound Lead Import Routes
 *
 * POST /upload       — CSV file upload (admin)
 * POST /single       — Single lead entry (admin)
 * POST /webhook      — External webhook (API key auth)
 * POST /ingest       — Software SDR batch push (API key auth) — rich payload with contacts, signals, metadata
 * GET  /imports      — List past imports (member)
 * GET  /imports/:id  — Import detail + leads (member)
 * PUT  /leads/:id/status — Update lead lifecycle status (member)
 */

import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import { getDb } from '../db/schema.js';
import { authenticate, requireMember, hashApiKey, AuthRequest } from '../auth/middleware.js';
import { processInboundImport } from '../agent/inboundOrchestrator.js';
import { eventBus } from '../events/eventBus.js';
import type { InboundLeadInput, SourceType, LeadStatus, SdrIngestPayload, SdrAccount, SdrContact, SdrIngestResult } from '../types/index.js';

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

// ── POST /webhook — External webhook (rewired to campaign orchestrator) ──
router.post('/webhook', async (req, res: Response) => {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) return res.status(401).json({ error: 'Missing x-api-key header' });

  const db = getDb();
  const storedKey = db.prepare("SELECT value FROM app_settings WHERE key = 'webhook_api_key'").get() as { value: string } | undefined;
  if (!storedKey || JSON.parse(storedKey.value) !== apiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const body = req.body;
  // Support both { leads: [...], campaign_id? } and bare array formats
  const rawLeads: InboundLeadInput[] = Array.isArray(body) ? body : (Array.isArray(body.leads) ? body.leads : [body]);
  const requestCampaignId = body.campaign_id as string | undefined;

  const validLeads = rawLeads.filter(l => l.company_name);
  if (validLeads.length === 0) return res.status(400).json({ error: 'No valid leads (company_name required)' });

  // Resolve campaign: request override > default setting
  let campaignId = requestCampaignId;
  if (!campaignId) {
    const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'webhook_default_campaign'").get() as { value: string } | undefined;
    if (setting) {
      try { campaignId = JSON.parse(setting.value); } catch { campaignId = setting.value; }
    }
  }

  if (!campaignId) {
    return res.status(400).json({ error: 'No campaign_id provided and no default campaign configured. Set a default campaign in Connect > Webhook settings.' });
  }

  const campaign = db.prepare("SELECT id, name FROM campaigns WHERE id = ? AND status = 'active'").get(campaignId) as any;
  if (!campaign) return res.status(400).json({ error: 'Campaign not found or not active' });

  // Check for active run conflict
  const activeRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status IN ('pending','running') LIMIT 1"
  ).get(campaignId) as any;
  if (activeRun) return res.status(409).json({ error: 'A run is already in progress for this campaign' });

  // Create leads associated with the campaign
  const leadIds: string[] = [];
  for (const lead of validLeads) {
    const domain = lead.domain?.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase() || null;

    // Upsert: skip if domain already exists in campaign
    if (domain) {
      const existing = db.prepare('SELECT id FROM leads WHERE campaign_id = ? AND domain = ?').get(campaignId, domain) as any;
      if (existing) { leadIds.push(existing.id); continue; }
    }

    const leadId = uuid();
    db.prepare(
      `INSERT INTO leads (id, campaign_id, company_name, domain, segment, fit_score, pipeline_stage, lead_status, source_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'discovered', 'pending', 'webhook_research', datetime('now'), datetime('now'))`
    ).run(leadId, campaignId, lead.company_name, domain, lead.segment?.toUpperCase() || 'MM');
    leadIds.push(leadId);
  }

  // Run through campaign orchestrator
  const { runCampaign } = await import('../agent/campaignOrchestrator.js');
  const steps = ['enrich', 'score', 'brief', 'audit'];

  const runPromise = runCampaign(campaignId, null, steps, leadIds, 'webhook_research');
  runPromise.catch(err => {
    console.error('[inbound] Webhook processing error:', err);
  });

  await new Promise(resolve => setTimeout(resolve, 50));
  const newRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(campaignId) as any;

  res.json({
    run_id: newRun?.id || null,
    lead_count: leadIds.length,
    campaign_id: campaignId,
    campaign_name: campaign.name,
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

// ── POST /ingest — Software SDR batch push ───────────────────
// Accepts rich lead payloads from Software SDR with contacts, signals, and qualification metadata.
// Routes leads through a target campaign's pipeline (qualify → enrich → score → brief → audit).

const INGEST_MAX_ACCOUNTS = 100;
const INGEST_MAX_CONTACTS_PER_ACCOUNT = 10;
const INGEST_MAX_SIGNALS_PER_ACCOUNT = 50;

function mapSdrRoleFit(func?: string, seniority?: string): 'technical_champion' | 'economic_buyer' | 'hands_on_keyboard' | 'executive_sponsor' | 'champion' {
  const f = (func || '').toLowerCase();
  const s = (seniority || '').toLowerCase();
  const tokens = `${f} ${s}`.split(/[\s_/,]+/);
  if (tokens.some(t => ['cto', 'cio', 'cso', 'ciso', 'c_suite', 'csuite'].includes(t))) return 'executive_sponsor';
  if (['vp', 'vice_president', 'svp'].some(t => tokens.includes(t) || s.includes(t))) return 'economic_buyer';
  if (['security', 'infrastructure', 'networking', 'it'].some(t => f.includes(t)) && ['director', 'senior_manager', 'head', 'manager'].some(t => s.includes(t))) return 'technical_champion';
  if (['engineering', 'devops', 'sre', 'platform'].some(t => f.includes(t))) return 'hands_on_keyboard';
  return 'technical_champion';
}

function mapSdrConfidence(score?: number, passesChecks?: boolean): 'high' | 'medium' | 'low' {
  if (passesChecks && score != null && score >= 70) return 'high';
  if (passesChecks || (score != null && score >= 40)) return 'medium';
  return 'low';
}

router.post('/ingest', async (req, res: Response) => {
  // Auth: x-api-key header
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) return res.status(401).json({ error: 'Missing x-api-key header' });

  const db = getDb();

  // Check API key against api_keys table (scoped keys) or app_settings fallback
  const keyHash = hashApiKey(apiKey);
  const apiKeyRow = db.prepare(
    "SELECT id, user_id, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(keyHash) as any;

  let authedUserId: string | null = null;
  if (apiKeyRow) {
    const scopes: string[] = JSON.parse(apiKeyRow.scopes || '[]');
    if (!scopes.includes('leads:write')) {
      return res.status(403).json({ error: 'API key missing required scope: leads:write' });
    }
    authedUserId = apiKeyRow.user_id;
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(apiKeyRow.id);
  } else {
    // Fallback: check app_settings webhook_api_key
    const storedKey = db.prepare("SELECT value FROM app_settings WHERE key = 'webhook_api_key'").get() as { value: string } | undefined;
    if (!storedKey || JSON.parse(storedKey.value) !== apiKey) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
  }

  // Parse and validate payload
  const body = req.body as SdrIngestPayload;
  if (body.schema_version && body.schema_version !== '1.0') {
    console.warn(`[ingest] Unknown schema_version "${body.schema_version}" — processing with v1.0 logic`);
  }
  if (!body.accounts || !Array.isArray(body.accounts)) {
    return res.status(400).json({ error: 'accounts[] array is required' });
  }
  if (body.accounts.length === 0) {
    return res.status(400).json({ error: 'accounts[] must not be empty' });
  }
  if (body.accounts.length > INGEST_MAX_ACCOUNTS) {
    return res.status(400).json({ error: `Max ${INGEST_MAX_ACCOUNTS} accounts per batch` });
  }

  // Validate each account has required fields
  const errors: { domain: string; error: string }[] = [];
  const validAccounts: SdrAccount[] = [];
  for (const acct of body.accounts) {
    if (!acct.domain) {
      errors.push({ domain: acct.company_name || '(unknown)', error: 'domain is required' });
      continue;
    }
    if (!acct.company_name) {
      errors.push({ domain: acct.domain, error: 'company_name is required' });
      continue;
    }
    // Clean domain
    acct.domain = acct.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    // Enforce per-account limits
    if (acct.contacts && acct.contacts.length > INGEST_MAX_CONTACTS_PER_ACCOUNT) {
      acct.contacts = acct.contacts.slice(0, INGEST_MAX_CONTACTS_PER_ACCOUNT);
    }
    if (acct.signals && acct.signals.length > INGEST_MAX_SIGNALS_PER_ACCOUNT) {
      acct.signals = acct.signals.slice(0, INGEST_MAX_SIGNALS_PER_ACCOUNT);
    }
    validAccounts.push(acct);
  }

  if (validAccounts.length === 0) {
    return res.status(400).json({ error: 'No valid accounts in batch', errors });
  }

  // Resolve campaign
  let campaignId = body.campaign_id;
  if (!campaignId) {
    const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'webhook_default_campaign'").get() as { value: string } | undefined;
    if (setting) {
      try { campaignId = JSON.parse(setting.value); } catch { campaignId = setting.value; }
    }
  }
  if (!campaignId) {
    return res.status(400).json({ error: 'No campaign_id provided and no default campaign configured' });
  }

  const campaign = db.prepare("SELECT id, name FROM campaigns WHERE id = ? AND status = 'active'").get(campaignId) as any;
  if (!campaign) return res.status(400).json({ error: 'Campaign not found or not active' });

  // Check for active run conflict
  const activeRun = db.prepare(
    "SELECT id FROM pipeline_runs WHERE campaign_id = ? AND status IN ('pending','running') LIMIT 1"
  ).get(campaignId) as any;
  if (activeRun) return res.status(409).json({ error: 'A run is already in progress for this campaign', run_id: activeRun.id });

  // Load exclusions and customer profiles for dedup
  const exclusionDomains = new Set(
    (db.prepare("SELECT domain FROM exclusions WHERE domain IS NOT NULL").all() as any[]).map(e => e.domain.toLowerCase())
  );
  const customerDomains = new Set(
    (db.prepare("SELECT domain FROM customer_profiles WHERE domain IS NOT NULL").all() as any[]).map(c => c.domain.toLowerCase())
  );

  // Create import record for tracking
  const importId = uuid();
  db.prepare(
    "INSERT INTO inbound_imports (id, source_type, row_count, created_by, created_at) VALUES (?, 'inbound_webhook', ?, ?, datetime('now'))"
  ).run(importId, validAccounts.length, authedUserId);

  // Process each account: create/update leads + personas
  const leadIds: string[] = [];
  let accountsNew = 0;
  let accountsUpdated = 0;
  let accountsSkipped = 0;

  for (const acct of validAccounts) {
    // Skip excluded domains
    if (exclusionDomains.has(acct.domain)) {
      accountsSkipped++;
      continue;
    }
    // Skip existing customers
    if (customerDomains.has(acct.domain)) {
      accountsSkipped++;
      continue;
    }
    // Check for Twingate mention → auto-exclude
    const hasTwingateMention = acct.signals?.some(s =>
      s.description.toLowerCase().includes('twingate') || s.category === 'twingate_mention'
    );
    if (hasTwingateMention) {
      db.prepare(
        "INSERT OR IGNORE INTO exclusions (id, company_name, domain, reason, category, created_at) VALUES (?, ?, ?, 'Twingate mention detected by Software SDR', 'existing_customers', datetime('now'))"
      ).run(uuid(), acct.company_name, acct.domain);
      accountsSkipped++;
      continue;
    }

    // Build candidate_data JSON (pipeline-compatible format)
    const candidateData = {
      signals: (acct.signals || []).map(s => s.description),
      sources: (acct.signals || []).filter(s => s.source_url).map(s => s.source_url!),
      notes: acct.justification || '',
    };

    // SDR metadata stored in dedicated column (survives pipeline overwrites)
    const sdrMetadata = {
      sdr_score: acct.sdr_score,
      icp_tier: acct.icp_tier,
      archetype: acct.archetype,
      qualification: acct.qualification,
      ats_source: acct.ats_source,
      batch_id: body.batch_id,
      ingested_at: new Date().toISOString(),
      signals_raw: acct.signals || [],
    };

    // Enrichment metadata — registers Software SDR as a data source for provenance tracking
    const enrichmentMetadata = {
      sources_responded: ['software_sdr'],
      sources_failed: [] as string[],
      sources_available: ['software_sdr'],
      field_completeness: {
        employee_count: !!acct.employee_count,
        hq_location: !!acct.hq_location,
        founded_year: !!acct.founded_year,
        funding_stage: !!acct.funding_stage,
        website: !!acct.domain,
        linkedin_url: !!acct.linkedin_company_url,
      },
      field_sources: {
        ...(acct.employee_count ? { employee_count: ['software_sdr'] } : {}),
        ...(acct.hq_location ? { hq_location: ['software_sdr'] } : {}),
        ...(acct.founded_year ? { founded_year: ['software_sdr'] } : {}),
        ...(acct.funding_stage ? { funding_stage: ['software_sdr'] } : {}),
        ...(acct.domain ? { website: ['software_sdr'] } : {}),
        ...(acct.linkedin_company_url ? { linkedin_url: ['software_sdr'] } : {}),
      } as Record<string, string[]>,
      corroboration_count: 0,
    };

    // Determine segment
    let segment = acct.segment;
    if (!segment && acct.employee_count) {
      if (acct.employee_count >= 651) segment = 'ENT';
      else if (acct.employee_count >= 351) segment = 'MM';
      else segment = 'SMB';
    }

    // Upsert: check if domain already exists in this campaign
    const existingLead = db.prepare(
      'SELECT id, candidate_data FROM leads WHERE campaign_id = ? AND domain = ?'
    ).get(campaignId, acct.domain) as any;

    let leadId: string;
    if (existingLead) {
      leadId = existingLead.id;
      // Merge new signals into existing candidate_data
      let existingData: any = {};
      try { existingData = JSON.parse(existingLead.candidate_data || '{}'); } catch {}
      const mergedSignals = [...new Set([...(existingData.signals || []), ...candidateData.signals])];
      const mergedSources = [...new Set([...(existingData.sources || []), ...candidateData.sources])];
      const mergedData = {
        ...existingData,
        signals: mergedSignals,
        sources: mergedSources,
        notes: candidateData.notes || existingData.notes,
      };

      db.prepare(
        `UPDATE leads SET
          candidate_data = ?, sdr_ingest_metadata = ?, enrichment_metadata = ?,
          employee_count = COALESCE(?, employee_count),
          hq_location = COALESCE(?, hq_location), segment = COALESCE(?, segment),
          linkedin_company_url = COALESCE(?, linkedin_company_url),
          pipeline_stage = 'discovered', updated_at = datetime('now')
        WHERE id = ?`
      ).run(
        JSON.stringify(mergedData), JSON.stringify(sdrMetadata), JSON.stringify(enrichmentMetadata),
        acct.employee_count || null, acct.hq_location || null,
        segment || null, acct.linkedin_company_url || null,
        leadId
      );
      accountsUpdated++;
    } else {
      leadId = uuid();
      db.prepare(
        `INSERT INTO leads (
          id, campaign_id, company_name, domain, segment, employee_count, hq_location,
          founded_year, funding_stage, linkedin_company_url,
          fit_score, pipeline_stage, lead_status, source_type, candidate_data, sdr_ingest_metadata, enrichment_metadata,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'discovered', 'imported', 'inbound_webhook', ?, ?, ?, datetime('now'), datetime('now'))`
      ).run(
        leadId, campaignId, acct.company_name, acct.domain,
        segment || 'MM', acct.employee_count || null, acct.hq_location || null,
        acct.founded_year || null, acct.funding_stage || null,
        acct.linkedin_company_url || null,
        JSON.stringify(candidateData), JSON.stringify(sdrMetadata), JSON.stringify(enrichmentMetadata)
      );
      accountsNew++;
    }

    leadIds.push(leadId);

    // Create personas from contacts
    if (acct.contacts?.length) {
      // Clear existing personas for this lead if updating
      if (existingLead) {
        db.prepare('DELETE FROM personas WHERE lead_id = ?').run(leadId);
      }

      for (const contact of acct.contacts) {
        if (!contact.name) continue;
        const roleType = mapSdrRoleFit(contact.function, contact.seniority);
        const confidence = mapSdrConfidence(contact.score, contact.passes_checks);
        const socialSignals = contact.relationship
          ? JSON.stringify({ relationship: contact.relationship, sdr_score: contact.score })
          : null;

        db.prepare(
          `INSERT INTO personas (id, lead_id, role_type, confidence, name, title, linkedin_url, outreach_angle, social_signals, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          uuid(), leadId, roleType, confidence,
          contact.name, contact.title || null, contact.linkedin_url || null,
          contact.function ? `${contact.function} / ${contact.seniority || 'unknown'}` : null,
          socialSignals,
        );
      }
    }
  }

  // Update import record
  db.prepare(
    "UPDATE inbound_imports SET processed_count = ?, qualified_count = ?, status = 'completed', completed_at = datetime('now') WHERE id = ?"
  ).run(leadIds.length, accountsNew + accountsUpdated, importId);

  // Run through campaign orchestrator if we have leads to process
  let runId: string | null = null;
  if (leadIds.length > 0) {
    const { runCampaign } = await import('../agent/campaignOrchestrator.js');
    const steps = ['qualify', 'enrich', 'score', 'brief', 'audit'];

    const runPromise = runCampaign(campaignId, authedUserId, steps, leadIds, 'webhook_research');
    runPromise.catch(err => {
      console.error('[ingest] Software SDR batch processing error:', err);
    });

    // Wait briefly for run record to be created
    await new Promise(resolve => setTimeout(resolve, 100));
    const newRun = db.prepare(
      "SELECT id FROM pipeline_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(campaignId) as any;
    runId = newRun?.id || null;
  }

  const result: SdrIngestResult = {
    batch_id: body.batch_id || importId,
    run_id: runId,
    campaign_id: campaignId,
    accounts_received: body.accounts.length,
    accounts_new: accountsNew,
    accounts_updated: accountsUpdated,
    accounts_skipped: accountsSkipped,
    status: leadIds.length > 0 ? 'processing' : 'queued',
    errors: errors.length > 0 ? errors : undefined,
  };

  console.log(`[ingest] Software SDR batch: ${accountsNew} new, ${accountsUpdated} updated, ${accountsSkipped} skipped → campaign "${campaign.name}" (${campaignId})`);

  res.json(result);
});

export default router;
