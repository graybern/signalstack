import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { authenticate, requireOperator, AuthRequest } from '../auth/middleware.js';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const { search, page = '1', limit = '100', campaign_id } = req.query;
  const db = getDb();
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

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

  if (search) {
    const pattern = `%${search}%`;
    const total = (db.prepare('SELECT COUNT(*) as c FROM exclusions WHERE company_name LIKE ? OR domain LIKE ?').get(pattern, pattern) as any).c;
    const rows = db.prepare('SELECT * FROM exclusions WHERE company_name LIKE ? OR domain LIKE ? ORDER BY company_name LIMIT ? OFFSET ?').all(pattern, pattern, parseInt(limit as string), offset);
    return res.json({ exclusions: rows, total });
  }

  const total = (db.prepare('SELECT COUNT(*) as c FROM exclusions').get() as any).c;
  const rows = db.prepare('SELECT * FROM exclusions ORDER BY company_name LIMIT ? OFFSET ?').all(parseInt(limit as string), offset);
  res.json({ exclusions: rows, total });
});

router.post('/', authenticate, requireOperator, (req: AuthRequest, res: Response) => {
  const { company_name, domain, industry, reason } = req.body;
  if (!company_name) return res.status(400).json({ error: 'company_name required' });

  const id = uuid();
  getDb().prepare(
    'INSERT INTO exclusions (id, company_name, domain, industry, reason, added_by) VALUES (?,?,?,?,?,?)'
  ).run(id, company_name, domain || null, industry || null, reason || null, req.user!.id);

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
  const result = getDb().prepare('DELETE FROM exclusions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

export default router;
