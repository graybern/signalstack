import Database from 'better-sqlite3';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';
import {
  getDefaultICP,
  getDefaultCompanyContext,
  getDefaultGeographies,
  getDefaultSegmentDetails,
  getDefaultDisqualifiers,
  getDefaultSignalWeights,
  getDefaultBuyerPersonas,
} from '../config/icpDefaults.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      role          TEXT DEFAULT 'viewer' CHECK(role IN ('superadmin','admin','operator','member','viewer')),
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invites (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      role          TEXT DEFAULT 'viewer' CHECK(role IN ('admin','operator','member','viewer')),
      token         TEXT UNIQUE NOT NULL,
      invited_by    TEXT REFERENCES users(id),
      accepted_at   TEXT,
      expires_at    TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id            TEXT PRIMARY KEY,
      triggered_by  TEXT REFERENCES users(id),
      status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
      started_at    TEXT,
      completed_at  TEXT,
      lead_count    INTEGER DEFAULT 0,
      error_message TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id                      TEXT PRIMARY KEY,
      run_id                  TEXT REFERENCES pipeline_runs(id),
      company_name            TEXT NOT NULL,
      segment                 TEXT NOT NULL CHECK(segment IN ('ENT','MM','SMB')),
      hq_location             TEXT,
      employee_count          INTEGER,
      founded_year            INTEGER,
      funding_stage           TEXT,
      total_funding           TEXT,
      investors               TEXT,
      website                 TEXT,
      fit_score               INTEGER NOT NULL,
      fit_score_label         TEXT,
      confidence              TEXT DEFAULT 'medium' CHECK(confidence IN ('low','medium','high')),
      why_now                 TEXT,
      score_breakdown         TEXT,
      pain_hypotheses         TEXT,
      tech_stack              TEXT,
      competitive_displacement TEXT,
      outreach_strategy       TEXT,
      source_citations        TEXT,
      brief_markdown          TEXT,
      created_at              TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS personas (
      id               TEXT PRIMARY KEY,
      lead_id          TEXT REFERENCES leads(id) ON DELETE CASCADE,
      role_type        TEXT NOT NULL CHECK(role_type IN ('champion','economic_buyer','executive_sponsor')),
      name             TEXT,
      title            TEXT,
      linkedin_url     TEXT,
      department       TEXT,
      tenure           TEXT,
      outreach_angle   TEXT,
      talking_points   TEXT,
      outreach_message TEXT,
      social_signals   TEXT,
      buying_signals   TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lead_feedback (
      id              TEXT PRIMARY KEY,
      lead_id         TEXT REFERENCES leads(id),
      user_id         TEXT REFERENCES users(id),
      verdict         TEXT NOT NULL CHECK(verdict IN ('bad_fit','good_fit_response','good_fit_booked','good_fit_try_again','good_fit_no_response','good_fit','not_fit')),
      reason          TEXT,
      retry_date      TEXT,
      feedback_source TEXT DEFAULT 'manual',
      created_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(lead_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS recommendations_ledger (
      id                   TEXT PRIMARY KEY,
      company_name         TEXT NOT NULL,
      domain               TEXT,
      first_recommended_at TEXT NOT NULL,
      last_recommended_at  TEXT NOT NULL,
      times_recommended    INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS exclusions (
      id           TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      domain       TEXT,
      industry     TEXT,
      employees    TEXT,
      reason       TEXT,
      category     TEXT DEFAULT 'custom' CHECK(category IN ('disqualifying_criteria','existing_customers','competitors','previous_rejections','custom')),
      added_by     TEXT REFERENCES users(id),
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS icp_config (
      id              TEXT PRIMARY KEY,
      version         INTEGER NOT NULL,
      segments        TEXT NOT NULL,
      verticals       TEXT NOT NULL,
      tech_signals    TEXT NOT NULL,
      competitors     TEXT NOT NULL,
      success_stories TEXT,
      updated_by      TEXT REFERENCES users(id),
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leads_run_id ON leads(run_id);
    CREATE INDEX IF NOT EXISTS idx_leads_segment ON leads(segment);
    CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(fit_score DESC);
    CREATE INDEX IF NOT EXISTS idx_personas_lead_id ON personas(lead_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_lead_id ON lead_feedback(lead_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_company ON recommendations_ledger(company_name);
    CREATE INDEX IF NOT EXISTS idx_ledger_last_rec ON recommendations_ledger(last_recommended_at);
    CREATE INDEX IF NOT EXISTS idx_exclusions_domain ON exclusions(domain);

    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_by  TEXT REFERENCES users(id),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT,
      pattern_thesis    TEXT NOT NULL,
      example_companies TEXT DEFAULT '[]',
      target_signals    TEXT DEFAULT '[]',
      anti_patterns     TEXT DEFAULT '[]',
      target_categories TEXT DEFAULT '[]',
      value_prop_angle  TEXT,
      target_count      INTEGER DEFAULT 12,
      status            TEXT DEFAULT 'active' CHECK(status IN ('active','archived')),
      created_by        TEXT REFERENCES users(id),
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inbound_imports (
      id              TEXT PRIMARY KEY,
      filename        TEXT,
      source_type     TEXT NOT NULL DEFAULT 'inbound_csv',
      row_count       INTEGER DEFAULT 0,
      processed_count INTEGER DEFAULT 0,
      qualified_count INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'pending',
      error_message   TEXT,
      created_by      TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      completed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id          TEXT PRIMARY KEY,
      url         TEXT NOT NULL,
      events      TEXT NOT NULL,
      secret      TEXT,
      active      INTEGER DEFAULT 1,
      created_by  TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      metadata    TEXT
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id                TEXT PRIMARY KEY,
      subscription_id   TEXT NOT NULL,
      event_type        TEXT NOT NULL,
      payload           TEXT NOT NULL,
      status            TEXT DEFAULT 'pending',
      http_status       INTEGER,
      response_body     TEXT,
      attempts          INTEGER DEFAULT 0,
      next_retry_at     TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      completed_at      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_imports_status ON inbound_imports(status);
    CREATE INDEX IF NOT EXISTS idx_imports_created ON inbound_imports(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
  `);

  // Add token tracking columns (safe to run repeatedly)
  const runColsCheck = db.prepare("PRAGMA table_info(pipeline_runs)").all() as { name: string }[];
  if (!runColsCheck.find(c => c.name === 'input_tokens')) {
    db.exec('ALTER TABLE pipeline_runs ADD COLUMN input_tokens INTEGER DEFAULT 0');
  }
  if (!runColsCheck.find(c => c.name === 'output_tokens')) {
    db.exec('ALTER TABLE pipeline_runs ADD COLUMN output_tokens INTEGER DEFAULT 0');
  }
  if (!runColsCheck.find(c => c.name === 'estimated_cost')) {
    db.exec('ALTER TABLE pipeline_runs ADD COLUMN estimated_cost REAL DEFAULT 0');
  }
  if (!runColsCheck.find(c => c.name === 'model_used')) {
    db.exec("ALTER TABLE pipeline_runs ADD COLUMN model_used TEXT");
  }
  if (!runColsCheck.find(c => c.name === 'progress_json')) {
    db.exec("ALTER TABLE pipeline_runs ADD COLUMN progress_json TEXT");
  }
  if (!runColsCheck.find(c => c.name === 'run_type')) {
    db.exec("ALTER TABLE pipeline_runs ADD COLUMN run_type TEXT DEFAULT 'pipeline'");
  }

  // Add campaign_id columns to existing tables (safe to run repeatedly)
  const cols = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
  if (!cols.find(c => c.name === 'campaign_id')) {
    db.exec('ALTER TABLE leads ADD COLUMN campaign_id TEXT');
  }
  const runCols = db.prepare("PRAGMA table_info(pipeline_runs)").all() as { name: string }[];
  if (!runCols.find(c => c.name === 'campaign_id')) {
    db.exec('ALTER TABLE pipeline_runs ADD COLUMN campaign_id TEXT');
  }
  if (!runCols.find(c => c.name === 'steps_run')) {
    db.exec("ALTER TABLE pipeline_runs ADD COLUMN steps_run TEXT");
  }

  // Migrate users table to support expanded roles (superadmin, admin, operator, member, viewer)
  // SQLite CHECK constraints can't be altered, so we recreate the table if needed
  const userTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined;
  if (userTableInfo && !userTableInfo.sql.includes('superadmin')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users_new (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name  TEXT NOT NULL,
        role          TEXT DEFAULT 'viewer' CHECK(role IN ('superadmin','admin','operator','member','viewer')),
        created_at    TEXT DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO users_new SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.pragma('foreign_keys = ON');
  }

  // User management columns: status, forced password change, last login
  const userMgmtCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userMgmtCols.find(c => c.name === 'must_change_password')) {
    db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0");
  }
  if (!userMgmtCols.find(c => c.name === 'last_login_at')) {
    db.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT");
  }
  if (!userMgmtCols.find(c => c.name === 'status')) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
  }
  if (!userMgmtCols.find(c => c.name === 'timezone')) {
    db.exec("ALTER TABLE users ADD COLUMN timezone TEXT");
  }

  // Add search_patterns column to campaigns (safe to run repeatedly)
  const campCols = db.prepare("PRAGMA table_info(campaigns)").all() as { name: string }[];
  if (!campCols.find(c => c.name === 'search_patterns')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN search_patterns TEXT DEFAULT '[]'");
  }

  // Inbound lead import columns
  const leadColsInbound = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
  if (!leadColsInbound.find(c => c.name === 'source_type')) {
    db.exec("ALTER TABLE leads ADD COLUMN source_type TEXT DEFAULT 'outbound_research'");
  }
  if (!leadColsInbound.find(c => c.name === 'lead_status')) {
    db.exec("ALTER TABLE leads ADD COLUMN lead_status TEXT DEFAULT 'scored'");
  }
  if (!leadColsInbound.find(c => c.name === 'domain')) {
    db.exec("ALTER TABLE leads ADD COLUMN domain TEXT");
  }
  if (!leadColsInbound.find(c => c.name === 'import_id')) {
    db.exec("ALTER TABLE leads ADD COLUMN import_id TEXT");
  }
  if (!leadColsInbound.find(c => c.name === 'convergence_score')) {
    db.exec("ALTER TABLE leads ADD COLUMN convergence_score INTEGER DEFAULT 0");
  }
  if (!leadColsInbound.find(c => c.name === 'convergence_details')) {
    db.exec("ALTER TABLE leads ADD COLUMN convergence_details TEXT");
  }

  // Campaign-level configuration columns (Phase 2)
  const campColsP2 = db.prepare("PRAGMA table_info(campaigns)").all() as { name: string }[];
  if (!campColsP2.find(c => c.name === 'icp_overrides')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN icp_overrides TEXT");
  }
  if (!campColsP2.find(c => c.name === 'pipeline_overrides')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN pipeline_overrides TEXT");
  }
  if (!campColsP2.find(c => c.name === 'prompt_overrides')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN prompt_overrides TEXT");
  }
  if (!campColsP2.find(c => c.name === 'source_overrides')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN source_overrides TEXT");
  }
  if (!campColsP2.find(c => c.name === 'schedule_cron')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN schedule_cron TEXT");
  }
  if (!campColsP2.find(c => c.name === 'schedule_enabled')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN schedule_enabled INTEGER DEFAULT 0");
  }
  if (!campColsP2.find(c => c.name === 'schedule_timezone')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN schedule_timezone TEXT");
  }
  if (!campColsP2.find(c => c.name === 'exclusion_config')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN exclusion_config TEXT");
  }
  if (!campColsP2.find(c => c.name === 'rss_enabled')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN rss_enabled INTEGER DEFAULT 0");
  }
  if (!campColsP2.find(c => c.name === 'funnel_config')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN funnel_config TEXT");
  }
  if (!campColsP2.find(c => c.name === 'slack_webhook_url')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN slack_webhook_url TEXT");
  }

  // Notification destinations (replaces slack_webhook_url)
  const campColsNotif = db.prepare("PRAGMA table_info(campaigns)").all() as { name: string }[];
  if (!campColsNotif.find(c => c.name === 'notification_destinations')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN notification_destinations TEXT DEFAULT '[]'");
    const withSlack = db.prepare(
      "SELECT id, slack_webhook_url, rss_enabled FROM campaigns WHERE slack_webhook_url IS NOT NULL AND slack_webhook_url != ''"
    ).all() as { id: string; slack_webhook_url: string; rss_enabled: number }[];
    for (const row of withSlack) {
      const dests: any[] = [{
        id: crypto.randomUUID(), type: 'slack', label: 'Slack', enabled: true,
        created_at: new Date().toISOString(),
        config: { webhook_url: row.slack_webhook_url },
      }];
      if (row.rss_enabled) {
        dests.push({
          id: crypto.randomUUID(), type: 'rss', label: 'RSS Feed', enabled: true,
          created_at: new Date().toISOString(),
          config: { base_url: '' },
        });
      }
      db.prepare("UPDATE campaigns SET notification_destinations = ? WHERE id = ?")
        .run(JSON.stringify(dests), row.id);
    }
    // Migrate RSS-only campaigns (no slack webhook but rss_enabled)
    const rssOnly = db.prepare(
      "SELECT id FROM campaigns WHERE rss_enabled = 1 AND (slack_webhook_url IS NULL OR slack_webhook_url = '')"
    ).all() as { id: string }[];
    for (const row of rssOnly) {
      const dests = [{
        id: crypto.randomUUID(), type: 'rss', label: 'RSS Feed', enabled: true,
        created_at: new Date().toISOString(),
        config: { base_url: '' },
      }];
      db.prepare("UPDATE campaigns SET notification_destinations = ? WHERE id = ?")
        .run(JSON.stringify(dests), row.id);
    }
  }

  // Base URL for notification links
  const campColsBaseUrl = db.prepare("PRAGMA table_info(campaigns)").all() as { name: string }[];
  if (!campColsBaseUrl.find(c => c.name === 'notification_base_url')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN notification_base_url TEXT");
    // Migrate: move RSS base_url into campaign-level field, consolidate slack/teams into webhook type
    const allCampaigns = db.prepare(
      "SELECT id, notification_destinations FROM campaigns WHERE notification_destinations IS NOT NULL AND notification_destinations != '[]'"
    ).all() as { id: string; notification_destinations: string }[];
    for (const row of allCampaigns) {
      const dests = JSON.parse(row.notification_destinations) as any[];
      let baseUrl = '';
      const migrated = dests.map((d: any) => {
        if (d.type === 'rss' && d.config?.base_url) {
          baseUrl = d.config.base_url;
          return { ...d, config: {} };
        }
        if (d.type === 'slack') {
          return { ...d, type: 'webhook', config: { url: d.config?.webhook_url || '', format: 'slack' } };
        }
        if (d.type === 'teams') {
          return { ...d, type: 'webhook', config: { url: d.config?.webhook_url || '', format: 'teams' } };
        }
        if (d.type === 'webhook' && !d.config?.format) {
          return { ...d, config: { ...d.config, format: 'json' } };
        }
        return d;
      });
      db.prepare("UPDATE campaigns SET notification_destinations = ?, notification_base_url = ? WHERE id = ?")
        .run(JSON.stringify(migrated), baseUrl || null, row.id);
    }
  }

  // Indexes on campaign_id and inbound columns (must come after ALTERs)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_runs_campaign_id ON pipeline_runs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_leads_source_type ON leads(source_type);
    CREATE INDEX IF NOT EXISTS idx_leads_lead_status ON leads(lead_status);
    CREATE INDEX IF NOT EXISTS idx_leads_import_id ON leads(import_id);
  `);

  // Phase 3: Enhanced feedback system + lead management columns
  const leadColsP3 = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
  if (!leadColsP3.find(c => c.name === 'current_feedback')) {
    db.exec("ALTER TABLE leads ADD COLUMN current_feedback TEXT");
  }
  if (!leadColsP3.find(c => c.name === 'next_outreach_date')) {
    db.exec("ALTER TABLE leads ADD COLUMN next_outreach_date TEXT");
  }
  if (!leadColsP3.find(c => c.name === 'signal_count')) {
    db.exec("ALTER TABLE leads ADD COLUMN signal_count INTEGER DEFAULT 0");
    // Backfill signal_count from source_citations for existing leads
    db.exec("UPDATE leads SET signal_count = json_array_length(source_citations) WHERE source_citations IS NOT NULL AND source_citations != ''");
  }

  // Migrate lead_feedback table to support richer verdict types
  const feedbackCols = db.prepare("PRAGMA table_info(lead_feedback)").all() as { name: string }[];
  if (!feedbackCols.find(c => c.name === 'retry_date')) {
    db.exec("ALTER TABLE lead_feedback ADD COLUMN retry_date TEXT");
  }
  if (!feedbackCols.find(c => c.name === 'feedback_source')) {
    db.exec("ALTER TABLE lead_feedback ADD COLUMN feedback_source TEXT DEFAULT 'manual'");
  }

  // Add category column to exclusions table (Phase 2 gap fix)
  const exclCols = db.prepare("PRAGMA table_info(exclusions)").all() as { name: string }[];
  if (!exclCols.find(c => c.name === 'category')) {
    db.exec("ALTER TABLE exclusions ADD COLUMN category TEXT DEFAULT 'custom'");
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_current_feedback ON leads(current_feedback)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_next_outreach ON leads(next_outreach_date)`);

  // Pipeline stage tracking — persist leads after each funnel phase
  const leadColsStage = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
  if (!leadColsStage.find(c => c.name === 'pipeline_stage')) {
    db.exec("ALTER TABLE leads ADD COLUMN pipeline_stage TEXT DEFAULT 'briefed'");
  }
  if (!leadColsStage.find(c => c.name === 'candidate_data')) {
    db.exec("ALTER TABLE leads ADD COLUMN candidate_data TEXT");
  }
  if (!leadColsStage.find(c => c.name === 'scorer_thinking')) {
    db.exec("ALTER TABLE leads ADD COLUMN scorer_thinking TEXT");
  }
  if (!leadColsStage.find(c => c.name === 'brief_thinking')) {
    db.exec("ALTER TABLE leads ADD COLUMN brief_thinking TEXT");
  }
  if (!leadColsStage.find(c => c.name === 'audit_score')) {
    db.exec("ALTER TABLE leads ADD COLUMN audit_score INTEGER");
  }
  if (!leadColsStage.find(c => c.name === 'audit_issues')) {
    db.exec("ALTER TABLE leads ADD COLUMN audit_issues TEXT");
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage ON leads(pipeline_stage)`);

  // Run activity log — persistent log of AI thinking/reasoning during runs
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_activity_log (
      id              TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL,
      campaign_id     TEXT,
      activity_type   TEXT NOT NULL,
      phase           TEXT,
      company_name    TEXT,
      title           TEXT NOT NULL,
      details         TEXT,
      error_message   TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_run ON run_activity_log(run_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON run_activity_log(created_at DESC);
  `);

  // Phase 4: Dashboard Analytics — recommendations + preferences
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_recommendations (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL,
      rationale       TEXT NOT NULL,
      data_snapshot   TEXT,
      status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','dismissed','expired')),
      created_at      TEXT DEFAULT (datetime('now')),
      acted_at        TEXT,
      acted_by        TEXT
    );

    CREATE TABLE IF NOT EXISTS dashboard_preferences (
      user_id         TEXT PRIMARY KEY REFERENCES users(id),
      layout          TEXT,
      default_filters TEXT,
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_recommendations_status ON ai_recommendations(status);
    CREATE INDEX IF NOT EXISTS idx_recommendations_created ON ai_recommendations(created_at DESC);

    CREATE TABLE IF NOT EXISTS import_templates (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL CHECK(type IN ('inbound','outbound','enrichment')),
      prompt_template TEXT,
      output_format   TEXT,
      source_config   TEXT,
      created_by      TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS export_pipelines (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      webhook_url     TEXT NOT NULL,
      events          TEXT DEFAULT '["lead.created"]',
      field_mapping   TEXT,
      filters         TEXT,
      schedule_cron   TEXT,
      schedule_enabled INTEGER DEFAULT 0,
      active          INTEGER DEFAULT 1,
      created_by      TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_import_templates_type ON import_templates(type);
    CREATE INDEX IF NOT EXISTS idx_export_pipelines_active ON export_pipelines(active);
  `);

  // Migrate pipeline_runs to support 'cancelled' status
  const runsTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pipeline_runs'").get() as { sql: string } | undefined;
  if (runsTableInfo && !runsTableInfo.sql.includes('cancelled')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_runs_new (
        id            TEXT PRIMARY KEY,
        triggered_by  TEXT REFERENCES users(id),
        status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
        started_at    TEXT,
        completed_at  TEXT,
        lead_count    INTEGER DEFAULT 0,
        error_message TEXT,
        created_at    TEXT DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO pipeline_runs_new(id, triggered_by, status, started_at, completed_at, lead_count, error_message, created_at)
        SELECT id, triggered_by, status, started_at, completed_at, lead_count, error_message, created_at FROM pipeline_runs;
      DROP TABLE pipeline_runs;
      ALTER TABLE pipeline_runs_new RENAME TO pipeline_runs;
    `);
    db.pragma('foreign_keys = ON');
    // Re-add columns that were added via ALTER after initial creation
    const newRunCols = db.prepare("PRAGMA table_info(pipeline_runs)").all() as { name: string }[];
    if (!newRunCols.find(c => c.name === 'input_tokens')) db.exec('ALTER TABLE pipeline_runs ADD COLUMN input_tokens INTEGER DEFAULT 0');
    if (!newRunCols.find(c => c.name === 'output_tokens')) db.exec('ALTER TABLE pipeline_runs ADD COLUMN output_tokens INTEGER DEFAULT 0');
    if (!newRunCols.find(c => c.name === 'estimated_cost')) db.exec('ALTER TABLE pipeline_runs ADD COLUMN estimated_cost REAL DEFAULT 0');
    if (!newRunCols.find(c => c.name === 'model_used')) db.exec("ALTER TABLE pipeline_runs ADD COLUMN model_used TEXT");
    if (!newRunCols.find(c => c.name === 'progress_json')) db.exec("ALTER TABLE pipeline_runs ADD COLUMN progress_json TEXT");
    if (!newRunCols.find(c => c.name === 'run_type')) db.exec("ALTER TABLE pipeline_runs ADD COLUMN run_type TEXT DEFAULT 'pipeline'");
    if (!newRunCols.find(c => c.name === 'campaign_id')) db.exec('ALTER TABLE pipeline_runs ADD COLUMN campaign_id TEXT');
    if (!newRunCols.find(c => c.name === 'steps_run')) db.exec("ALTER TABLE pipeline_runs ADD COLUMN steps_run TEXT");
    // Recreate indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_runs_campaign_id ON pipeline_runs(campaign_id);
    `);
  }

  // Migrate pipeline_runs to support 'missed' status
  const runsTableInfoForMissed = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pipeline_runs'").get() as { sql: string } | undefined;
  if (runsTableInfoForMissed && !runsTableInfoForMissed.sql.includes('missed')) {
    db.pragma('foreign_keys = OFF');
    const cols = db.prepare("PRAGMA table_info(pipeline_runs)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    const colList = colNames.join(', ');
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_runs_new (
        id            TEXT PRIMARY KEY,
        triggered_by  TEXT REFERENCES users(id),
        status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled','missed')),
        started_at    TEXT,
        completed_at  TEXT,
        lead_count    INTEGER DEFAULT 0,
        error_message TEXT,
        created_at    TEXT DEFAULT (datetime('now')),
        input_tokens  INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        model_used    TEXT,
        progress_json TEXT,
        run_type      TEXT DEFAULT 'pipeline',
        campaign_id   TEXT,
        steps_run     TEXT
      );
      INSERT OR IGNORE INTO pipeline_runs_new(${colList})
        SELECT ${colList} FROM pipeline_runs;
      DROP TABLE pipeline_runs;
      ALTER TABLE pipeline_runs_new RENAME TO pipeline_runs;
      CREATE INDEX IF NOT EXISTS idx_runs_campaign_id ON pipeline_runs(campaign_id);
    `);
    db.pragma('foreign_keys = ON');
  }

  // User activity log — audit trail for all entity changes
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      entity_type     TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      entity_title    TEXT,
      action          TEXT NOT NULL,
      changes         TEXT,
      snapshot        TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_actlog_user ON activity_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_actlog_entity ON activity_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_actlog_created ON activity_log(created_at DESC);
  `);

  // Add action_data column to ai_recommendations
  const recCols = db.prepare("PRAGMA table_info(ai_recommendations)").all() as { name: string }[];
  if (!recCols.find(c => c.name === 'action_data')) {
    db.exec("ALTER TABLE ai_recommendations ADD COLUMN action_data TEXT");
  }

  // Role permissions — customizable permission assignments per role
  db.exec(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role       TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (role, permission)
    );
  `);

  // API keys — user-level tokens with scoped permissions
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      name         TEXT NOT NULL,
      key_hash     TEXT NOT NULL,
      key_prefix   TEXT NOT NULL,
      scopes       TEXT NOT NULL DEFAULT '[]',
      expires_at   TEXT,
      last_used_at TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      revoked_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  `);

  seedIcpDefaults(db);
}

function seedIcpDefaults(db: Database.Database) {
  const hasIcp = db.prepare('SELECT COUNT(*) as c FROM icp_config').get() as { c: number };
  if (hasIcp.c === 0) {
    const defaults = getDefaultICP();
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO icp_config (id, version, segments, verticals, tech_signals, competitors, success_stories) VALUES (?,?,?,?,?,?,?)'
    ).run(
      id, 1,
      JSON.stringify(defaults.segments),
      JSON.stringify(defaults.verticals),
      JSON.stringify(defaults.tech_signals),
      JSON.stringify(defaults.competitors),
      JSON.stringify(defaults.success_stories || {}),
    );
  }

  const hasSettings = db.prepare("SELECT COUNT(*) as c FROM app_settings WHERE key LIKE 'icp.%'").get() as { c: number };
  if (hasSettings.c === 0) {
    const seedSetting = (key: string, value: any) => {
      db.prepare(
        "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      ).run(key, JSON.stringify(value));
    };

    seedSetting('icp.company_context', getDefaultCompanyContext());
    seedSetting('icp.geographies', getDefaultGeographies());
    seedSetting('icp.segment_details', getDefaultSegmentDetails());
    seedSetting('icp.disqualifiers', getDefaultDisqualifiers());
    seedSetting('icp.signal_weights', getDefaultSignalWeights());
    seedSetting('icp.buyer_personas', getDefaultBuyerPersonas());
  }
}
