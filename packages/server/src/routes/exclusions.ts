import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireOperator, AuthRequest } from '../auth/middleware.js';
import { logActivity } from '../services/activityLog.js';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const { search, page = '1', limit = '50', campaign_id, category } = req.query;
  const db = getDb();
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const offset = (pageNum - 1) * limitNum;

  // If campaign_id provided, return merged exclusions (global + campaign adds - exemptions)
  if (campaign_id) {
    const campaign = db.prepare('SELECT exclusion_config FROM campaigns WHERE id = ?').get(campaign_id as string) as any;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const globalExclusions = db.prepare('SELECT * FROM exclusions ORDER BY company_name').all() as any[];
    const config = campaign.exclusion_config ? JSON.parse(campaign.exclusion_config) : null;

    if (!config) {
      return res.json({ exclusions: globalExclusions, total: globalExclusions.length });
    }

    const exemptSet = new Set(config.exemptions || []);
    const filtered = globalExclusions.filter((e: any) => !exemptSet.has(e.id));
    const additions = (config.additions || []).map((a: any, i: number) => ({
      id: `campaign_add_${i}`,
      ...a,
      source: 'campaign',
    }));
    const merged = [...filtered, ...additions];
    return res.json({ exclusions: merged, total: merged.length });
  }

  const conditions: string[] = [];
  const params: any[] = [];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push('(company_name LIKE ? OR domain LIKE ?)');
    params.push(pattern, pattern);
  }

  if (category && category !== 'all') {
    conditions.push('category = ?');
    params.push(category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as c FROM exclusions ${where}`).get(...params) as any).c;
  const rows = db.prepare(`SELECT * FROM exclusions ${where} ORDER BY company_name LIMIT ? OFFSET ?`).all(...params, limitNum, offset);
  const totalPages = Math.ceil(total / limitNum);

  const allCategories = (db.prepare('SELECT DISTINCT category FROM exclusions WHERE category IS NOT NULL').all() as any[])
    .map(r => r.category);

  res.json({ exclusions: rows, total, page: pageNum, limit: limitNum, totalPages, categories: allCategories });
});

router.post('/', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const { company_name, domain, industry, reason } = req.body;
  if (!company_name) return res.status(400).json({ error: 'company_name required' });

  const id = uuid();
  const db = getDb();
  db.prepare(
    'INSERT INTO exclusions (id, company_name, domain, industry, reason, added_by) VALUES (?,?,?,?,?,?)'
  ).run(id, company_name, domain || null, industry || null, reason || null, req.user!.id);

  logActivity({
    userId: req.user!.id,
    entityType: 'exclusion',
    entityId: id,
    entityTitle: company_name,
    action: 'created',
    snapshot: { company_name, domain, industry, reason },
  });

  res.status(201).json({ id, company_name });
});

router.post('/import', authenticate, requireOperator, upload.single('file'), (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file required' });

  const content = req.file.buffer.toString('utf-8');
  let records: any[];
  try {
    records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err: any) {
    return res.status(400).json({ error: `CSV parse error: ${err.message}` });
  }

  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO exclusions (id, company_name, domain, industry, employees, reason, added_by) VALUES (?,?,?,?,?,?,?)'
  );

  let imported = 0;
  const tx = db.transaction(() => {
    for (const row of records) {
      const companyName = row['Account Name'] || row['company_name'] || row['Company'];
      if (!companyName) continue;

      const domain = row['domain'] || row['Website'] || null;
      const industry = row['Industry'] || null;
      const employees = row['Employees'] || row['Employee Count'] || null;

      insert.run(uuid(), companyName, domain, industry, employees, 'CSV import', req.user!.id);
      imported++;
    }
  });
  tx();

  res.json({ imported, total_rows: records.length });
});

router.delete('/:id', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM exclusions WHERE id = ?').get(req.params.id) as any;
  const result = db.prepare('DELETE FROM exclusions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

  if (existing) {
    logActivity({
      userId: req.user!.id,
      entityType: 'exclusion',
      entityId: req.params.id,
      entityTitle: existing.company_name,
      action: 'deleted',
      snapshot: existing,
    });
  }

  res.json({ success: true });
});

export default router;
