import { getDb } from '../db/schema.js';
import { v4 as uuid } from 'uuid';
import Database from 'better-sqlite3';

export type ExportMode = 'config' | 'full';
export type ImportMode = 'replace' | 'merge';

interface ExportMetadata {
  version: string;
  exported_at: string;
  export_mode: ExportMode;
  app_version: string;
  table_counts: Record<string, number>;
}

interface ExportPayload {
  metadata: ExportMetadata;
  users: any[];
  app_settings: any[];
  icp_config: any[];
  campaigns: any[];
  exclusions: any[];
  import_templates: any[];
  export_pipelines: any[];
  webhook_subscriptions: any[];
  dashboard_preferences: any[];
  // Data tables (only in full mode)
  pipeline_runs?: any[];
  leads?: any[];
  personas?: any[];
  lead_feedback?: any[];
  recommendations_ledger?: any[];
  inbound_imports?: any[];
  // Audit (only in full mode)
  run_activity_log?: any[];
  activity_log?: any[];
  ai_recommendations?: any[];
}

interface ImportResult {
  mode: ImportMode;
  tables_processed: string[];
  row_counts: Record<string, { inserted: number; updated: number; skipped: number }>;
  warnings: string[];
}

function dumpTable(db: Database.Database, table: string): any[] {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

export function exportData(mode: ExportMode): ExportPayload {
  const db = getDb();

  const payload: ExportPayload = {
    metadata: {
      version: '1',
      exported_at: new Date().toISOString(),
      export_mode: mode,
      app_version: '1.0.0',
      table_counts: {},
    },
    users: dumpTable(db, 'users'),
    app_settings: dumpTable(db, 'app_settings'),
    icp_config: dumpTable(db, 'icp_config'),
    campaigns: dumpTable(db, 'campaigns'),
    exclusions: dumpTable(db, 'exclusions'),
    import_templates: dumpTable(db, 'import_templates'),
    export_pipelines: dumpTable(db, 'export_pipelines'),
    webhook_subscriptions: dumpTable(db, 'webhook_subscriptions'),
    dashboard_preferences: dumpTable(db, 'dashboard_preferences'),
  };

  if (mode === 'full') {
    payload.pipeline_runs = dumpTable(db, 'pipeline_runs');
    payload.leads = dumpTable(db, 'leads');
    payload.personas = dumpTable(db, 'personas');
    payload.lead_feedback = dumpTable(db, 'lead_feedback');
    payload.recommendations_ledger = dumpTable(db, 'recommendations_ledger');
    payload.inbound_imports = dumpTable(db, 'inbound_imports');
    payload.run_activity_log = dumpTable(db, 'run_activity_log');
    payload.activity_log = dumpTable(db, 'activity_log');
    payload.ai_recommendations = dumpTable(db, 'ai_recommendations');
  }

  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'metadata' && Array.isArray(value)) {
      payload.metadata.table_counts[key] = value.length;
    }
  }

  return payload;
}

const CONFIG_TABLES = [
  'users',
  'app_settings',
  'icp_config',
  'campaigns',
  'exclusions',
  'import_templates',
  'export_pipelines',
  'webhook_subscriptions',
  'dashboard_preferences',
] as const;

const DATA_TABLES = [
  'pipeline_runs',
  'leads',
  'personas',
  'lead_feedback',
  'recommendations_ledger',
  'inbound_imports',
  'run_activity_log',
  'activity_log',
  'ai_recommendations',
] as const;

// Insertion order matters for FK constraints
const IMPORT_ORDER = [
  'users',
  'app_settings',
  'icp_config',
  'campaigns',
  'exclusions',
  'import_templates',
  'export_pipelines',
  'webhook_subscriptions',
  'dashboard_preferences',
  'pipeline_runs',
  'inbound_imports',
  'leads',
  'personas',
  'lead_feedback',
  'recommendations_ledger',
  'run_activity_log',
  'activity_log',
  'ai_recommendations',
];

// Deletion order (reverse of FK dependencies)
const DELETE_ORDER = [
  'ai_recommendations',
  'activity_log',
  'run_activity_log',
  'recommendations_ledger',
  'lead_feedback',
  'personas',
  'leads',
  'inbound_imports',
  'pipeline_runs',
  'dashboard_preferences',
  'webhook_subscriptions',
  'export_pipelines',
  'import_templates',
  'exclusions',
  'campaigns',
  'icp_config',
  'app_settings',
  'invites',
  'users',
];

// Natural keys for merge upsert — how we identify "same" records across instances
const NATURAL_KEYS: Record<string, string[]> = {
  users: ['email'],
  app_settings: ['key'],
  icp_config: ['id'],
  campaigns: ['name'],
  exclusions: ['company_name', 'domain'],
  import_templates: ['name'],
  export_pipelines: ['name'],
  webhook_subscriptions: ['url'],
  dashboard_preferences: ['user_id'],
  pipeline_runs: ['id'],
  leads: ['id'],
  personas: ['id'],
  lead_feedback: ['lead_id', 'user_id'],
  recommendations_ledger: ['company_name'],
  inbound_imports: ['id'],
  run_activity_log: ['id'],
  activity_log: ['id'],
  ai_recommendations: ['id'],
};

function getTableColumns(db: Database.Database, table: string): string[] {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.map(c => c.name);
}

function buildUpsertSQL(table: string, columns: string[], naturalKeys: string[]): string {
  const placeholders = columns.map(() => '?').join(', ');
  const colList = columns.join(', ');

  if (table === 'app_settings') {
    return `INSERT INTO ${table} (${colList}) VALUES (${placeholders})
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`;
  }

  if (table === 'lead_feedback') {
    const updateCols = columns.filter(c => !naturalKeys.includes(c));
    const updateSet = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
    return `INSERT INTO ${table} (${colList}) VALUES (${placeholders})
            ON CONFLICT(lead_id, user_id) DO UPDATE SET ${updateSet}`;
  }

  if (table === 'dashboard_preferences') {
    const updateCols = columns.filter(c => c !== 'user_id');
    const updateSet = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
    return `INSERT INTO ${table} (${colList}) VALUES (${placeholders})
            ON CONFLICT(user_id) DO UPDATE SET ${updateSet}`;
  }

  // For tables with TEXT PRIMARY KEY (id), use ON CONFLICT(id)
  if (columns.includes('id')) {
    const updateCols = columns.filter(c => c !== 'id');
    const updateSet = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
    return `INSERT INTO ${table} (${colList}) VALUES (${placeholders})
            ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
  }

  return `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`;
}

function remapIds(
  payload: ExportPayload,
  table: string,
  naturalKeys: string[],
  db: Database.Database
): Map<string, string> {
  const idMap = new Map<string, string>();

  if (table !== 'users' && table !== 'campaigns') return idMap;

  const rows = (payload as any)[table] as any[];
  if (!rows) return idMap;

  for (const row of rows) {
    if (table === 'users') {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(row.email) as any;
      if (existing && existing.id !== row.id) {
        idMap.set(row.id, existing.id);
      }
    } else if (table === 'campaigns') {
      const existing = db.prepare('SELECT id FROM campaigns WHERE name = ?').get(row.name) as any;
      if (existing && existing.id !== row.id) {
        idMap.set(row.id, existing.id);
      }
    }
  }

  return idMap;
}

export function importData(payload: ExportPayload, mode: ImportMode): ImportResult {
  const db = getDb();
  const result: ImportResult = {
    mode,
    tables_processed: [],
    row_counts: {},
    warnings: [],
  };

  const allTables = [...CONFIG_TABLES, ...DATA_TABLES];
  const tablesToProcess = IMPORT_ORDER.filter(t => {
    return (payload as any)[t] !== undefined && allTables.includes(t as any);
  });

  db.pragma('foreign_keys = OFF');

  try {
    const txn = db.transaction(() => {
      // In replace mode, wipe all tables first
      if (mode === 'replace') {
        for (const table of DELETE_ORDER) {
          try {
            db.prepare(`DELETE FROM ${table}`).run();
          } catch {
            // Table may not exist yet
          }
        }
      }

      // Build ID remaps for merge mode (user email → existing user id, campaign name → existing campaign id)
      const userIdMap = mode === 'merge' ? remapIds(payload, 'users', ['email'], db) : new Map();
      const campaignIdMap = mode === 'merge' ? remapIds(payload, 'campaigns', ['name'], db) : new Map();

      for (const table of tablesToProcess) {
        const rows = (payload as any)[table] as any[];
        if (!rows || rows.length === 0) {
          result.row_counts[table] = { inserted: 0, updated: 0, skipped: 0 };
          result.tables_processed.push(table);
          continue;
        }

        const columns = getTableColumns(db, table);
        const naturalKeys = NATURAL_KEYS[table] || ['id'];

        let inserted = 0;
        let updated = 0;
        let skipped = 0;

        if (mode === 'replace') {
          // Direct insert — table was already wiped
          const placeholders = columns.map(() => '?').join(', ');
          const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);

          for (const row of rows) {
            const remapped = remapRow(row, table, columns, userIdMap, campaignIdMap);
            const values = columns.map(c => remapped[c] ?? null);
            try {
              const r = stmt.run(...values);
              if (r.changes > 0) inserted++;
              else skipped++;
            } catch (err: any) {
              result.warnings.push(`${table}: skipped row — ${err.message}`);
              skipped++;
            }
          }
        } else {
          // Merge mode — upsert
          const sql = buildUpsertSQL(table, columns, naturalKeys);
          const stmt = db.prepare(sql);

          for (const row of rows) {
            const remapped = remapRow(row, table, columns, userIdMap, campaignIdMap);
            const values = columns.map(c => remapped[c] ?? null);
            try {
              const r = stmt.run(...values);
              if (r.changes > 0) {
                // Check if it was an insert or update
                const totalBefore = db.prepare(`SELECT count(*) as cnt FROM ${table}`).get() as any;
                inserted++;
              }
            } catch (err: any) {
              result.warnings.push(`${table}: skipped row — ${err.message}`);
              skipped++;
            }
          }
        }

        result.row_counts[table] = { inserted, updated, skipped };
        result.tables_processed.push(table);
      }
    });

    txn();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  return result;
}

function remapRow(
  row: any,
  table: string,
  columns: string[],
  userIdMap: Map<string, string>,
  campaignIdMap: Map<string, string>
): any {
  const remapped = { ...row };

  // Remap user FK references
  const userFkCols = ['created_by', 'triggered_by', 'added_by', 'updated_by', 'invited_by', 'user_id', 'acted_by'];
  for (const col of userFkCols) {
    if (columns.includes(col) && remapped[col] && userIdMap.has(remapped[col])) {
      remapped[col] = userIdMap.get(remapped[col]);
    }
  }

  // Remap the user's own id
  if (table === 'users' && userIdMap.has(remapped.id)) {
    remapped.id = userIdMap.get(remapped.id);
  }

  // Remap campaign FK references
  if (columns.includes('campaign_id') && remapped.campaign_id && campaignIdMap.has(remapped.campaign_id)) {
    remapped.campaign_id = campaignIdMap.get(remapped.campaign_id);
  }
  if (table === 'campaigns' && campaignIdMap.has(remapped.id)) {
    remapped.id = campaignIdMap.get(remapped.id);
  }

  return remapped;
}
