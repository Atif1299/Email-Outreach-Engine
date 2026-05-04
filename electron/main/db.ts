import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import type { LeadData } from '../../src/shared/types'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  const userData = app.getPath('userData')
  const file = path.join(userData, 'outreach.db')
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  _db = db
  return db
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_batch_id INTEGER,
      email TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pitch_block TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      delay_hours_after_previous REAL NOT NULL DEFAULT 0,
      subject_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      use_ai INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE (campaign_id, step_order)
    );
    CREATE TABLE IF NOT EXISTS lead_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body_snippet TEXT,
      sent_at TEXT NOT NULL,
      error TEXT,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lead_sends_lead ON lead_sends(lead_id, campaign_id);
  `)
  const campaignCols = db.prepare('PRAGMA table_info(campaigns)').all() as { name: string }[]
  if (!campaignCols.some((c) => c.name === 'sender_info')) {
    db.exec(`ALTER TABLE campaigns ADD COLUMN sender_info TEXT NOT NULL DEFAULT ''`)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_body_overrides (
      lead_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (lead_id, campaign_id, step_order),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
  `)
}

export function insertImportBatch(filename: string): number {
  const db = getDb()
  const created = new Date().toISOString()
  const r = db
    .prepare('INSERT INTO import_batches (filename, created_at) VALUES (?, ?)')
    .run(filename, created)
  return Number(r.lastInsertRowid)
}

export function insertLead(
  importBatchId: number | null,
  email: string,
  data: LeadData
): number {
  const db = getDb()
  const r = db
    .prepare(
      'INSERT INTO leads (import_batch_id, email, data_json, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(
      importBatchId,
      email,
      JSON.stringify(data),
      new Date().toISOString(),
    )
  return Number(r.lastInsertRowid)
}

export function listLeads(search?: string) {
  const db = getDb()
  if (search && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`
    return db
      .prepare(
        `SELECT id, import_batch_id, email, data_json, created_at FROM leads
         WHERE LOWER(email) LIKE ? OR LOWER(data_json) LIKE ?
         ORDER BY id DESC`,
      )
      .all(q, q) as {
        id: number
        import_batch_id: number | null
        email: string
        data_json: string
        created_at: string
      }[]
  }
  return db
    .prepare(
      `SELECT id, import_batch_id, email, data_json, created_at FROM leads ORDER BY id DESC`,
    )
    .all() as {
      id: number
      import_batch_id: number | null
      email: string
      data_json: string
      created_at: string
    }[]
}

export function deleteLead(id: number) {
  getDb().prepare('DELETE FROM leads WHERE id = ?').run(id)
}

/** Removes all leads and their send history; clears import batch records. Next import starts clean. */
export function clearAllLeadsData() {
  const db = getDb()
  db.prepare('DELETE FROM leads').run()
  db.prepare('DELETE FROM import_batches').run()
}

export function getLead(id: number) {
  const row = getDb()
    .prepare('SELECT id, import_batch_id, email, data_json, created_at FROM leads WHERE id = ?')
    .get(id) as
    | {
      id: number
      import_batch_id: number | null
      email: string
      data_json: string
      created_at: string
    }
    | undefined
  return row
}

export function listCampaigns() {
  return getDb()
    .prepare(
      `SELECT id, name, pitch_block, sender_info, created_at FROM campaigns ORDER BY id DESC`,
    )
    .all() as {
      id: number
      name: string
      pitch_block: string
      sender_info: string
      created_at: string
    }[]
}

export function getCampaign(id: number) {
  return getDb()
    .prepare(`SELECT id, name, pitch_block, sender_info, created_at FROM campaigns WHERE id = ?`)
    .get(id) as
    | { id: number; name: string; pitch_block: string; sender_info: string; created_at: string }
    | undefined
}

export function createCampaign(name: string, pitchBlock: string, senderInfo: string) {
  const db = getDb()
  const r = db
    .prepare(
      'INSERT INTO campaigns (name, pitch_block, sender_info, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(name, pitchBlock, senderInfo, new Date().toISOString())
  return Number(r.lastInsertRowid)
}

export function updateCampaign(id: number, name: string, pitchBlock: string, senderInfo: string) {
  getDb()
    .prepare('UPDATE campaigns SET name = ?, pitch_block = ?, sender_info = ? WHERE id = ?')
    .run(name, pitchBlock, senderInfo, id)
}

export function deleteCampaign(id: number) {
  getDb().prepare('DELETE FROM campaigns WHERE id = ?').run(id)
}

export function getLeadBodyOverride(
  leadId: number,
  campaignId: number,
  stepOrder: number,
): string | undefined {
  const row = getDb()
    .prepare(
      `SELECT body FROM lead_body_overrides WHERE lead_id = ? AND campaign_id = ? AND step_order = ?`,
    )
    .get(leadId, campaignId, stepOrder) as { body: string } | undefined
  return row?.body
}

export function replaceLeadBodyOverrides(
  campaignId: number,
  stepOrder: number,
  items: { leadId: number; body: string }[],
) {
  const db = getDb()
  const ins = db.prepare(
    `INSERT INTO lead_body_overrides (lead_id, campaign_id, step_order, body, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lead_id, campaign_id, step_order) DO UPDATE SET
       body = excluded.body,
       updated_at = excluded.updated_at`,
  )
  const run = db.transaction(() => {
    const now = new Date().toISOString()
    for (const { leadId, body } of items) {
      ins.run(leadId, campaignId, stepOrder, body, now)
    }
  })
  run()
}

export function clearLeadBodyOverridesForStep(campaignId: number, stepOrder: number) {
  getDb()
    .prepare(`DELETE FROM lead_body_overrides WHERE campaign_id = ? AND step_order = ?`)
    .run(campaignId, stepOrder)
}

export function listSteps(campaignId: number) {
  return getDb()
    .prepare(
      `SELECT id, campaign_id, step_order, delay_hours_after_previous, subject_template, body_template, use_ai
       FROM campaign_steps WHERE campaign_id = ? ORDER BY step_order`,
    )
    .all(campaignId) as {
      id: number
      campaign_id: number
      step_order: number
      delay_hours_after_previous: number
      subject_template: string
      body_template: string
      use_ai: number
    }[]
}

export function replaceSteps(
  campaignId: number,
  steps: {
    step_order: number
    delay_hours_after_previous: number
    subject_template: string
    body_template: string
    use_ai: boolean
  }[],
) {
  const db = getDb()
  const del = db.prepare('DELETE FROM campaign_steps WHERE campaign_id = ?')
  const ins = db.prepare(
    `INSERT INTO campaign_steps (campaign_id, step_order, delay_hours_after_previous, subject_template, body_template, use_ai)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const run = db.transaction(() => {
    del.run(campaignId)
    for (const s of steps) {
      ins.run(
        campaignId,
        s.step_order,
        s.delay_hours_after_previous,
        s.subject_template,
        s.body_template,
        s.use_ai ? 1 : 0,
      )
    }
  })
  run()
}

export function getLastSend(leadId: number, campaignId: number) {
  return getDb()
    .prepare(
      `SELECT id, lead_id, campaign_id, step_order, subject, body_snippet, sent_at, error
       FROM lead_sends WHERE lead_id = ? AND campaign_id = ? AND error IS NULL
       ORDER BY step_order DESC, sent_at DESC LIMIT 1`,
    )
    .get(leadId, campaignId) as
    | {
      id: number
      lead_id: number
      campaign_id: number
      step_order: number
      subject: string
      body_snippet: string | null
      sent_at: string
      error: string | null
    }
    | undefined
}

export function listSendsForLeadCampaign(leadId: number, campaignId: number) {
  return getDb()
    .prepare(
      `SELECT id, lead_id, campaign_id, step_order, subject, body_snippet, sent_at, error
       FROM lead_sends WHERE lead_id = ? AND campaign_id = ? ORDER BY step_order, sent_at`,
    )
    .all(leadId, campaignId) as {
      id: number
      lead_id: number
      campaign_id: number
      step_order: number
      subject: string
      body_snippet: string | null
      sent_at: string
      error: string | null
    }[]
}

export function insertSend(
  leadId: number,
  campaignId: number,
  stepOrder: number,
  subject: string,
  bodySnippet: string,
  error: string | null,
) {
  getDb()
    .prepare(
      `INSERT INTO lead_sends (lead_id, campaign_id, step_order, subject, body_snippet, sent_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      leadId,
      campaignId,
      stepOrder,
      subject,
      bodySnippet,
      new Date().toISOString(),
      error,
    )
}

export function countSendsToday(): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM lead_sends WHERE error IS NULL AND sent_at >= ?`)
    .get(start.toISOString()) as { c: number }
  return row.c
}
