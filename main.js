const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')
const nodemailer = require('nodemailer')
const OpenAI = require('openai')
const Papa = require('papaparse')
const XLSX = require('xlsx')
const { verifyEmail, verifyEmailLocal, verifyMany, isHardBounceError } = require('./verify')
const { buildBodyMessages, buildSubjectMessages } = require('./aiPrompts')

// === CONFIG ===
const APP_NAME = 'Email Outreach'
let mainWindow = null
let db = null

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const ALLOWED_OPENAI_MODELS = new Set(['gpt-4o-mini', 'gpt-4.1-mini'])

function normalizeOpenaiModel(model) {
  return typeof model === 'string' && ALLOWED_OPENAI_MODELS.has(model) ? model : DEFAULT_OPENAI_MODEL
}

const DEFAULT_SETTINGS = {
  smtp: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: '',
    fromName: '',
    fromEmail: ''
  },
  sendDelayMinMs: 15000,
  sendDelayMaxMs: 45000,
  dailyCap: 50,
  openaiModel: DEFAULT_OPENAI_MODEL,
  verificationProvider: 'none'
}

// === DATABASE ===
function getDb() {
  if (db) return db
  const userData = app.getPath('userData')
  const file = path.join(userData, 'outreach.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db) {
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
      sender_info TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS lead_body_overrides (
      lead_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      body TEXT NOT NULL,
      subject TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (lead_id, campaign_id, step_order),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS lead_merge_previews (
      lead_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      preview_text TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (lead_id, campaign_id, step_order),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS campaign_target_batches (
      campaign_id INTEGER NOT NULL,
      import_batch_id INTEGER NOT NULL,
      PRIMARY KEY (campaign_id, import_batch_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_leads_import_batch ON leads(import_batch_id);
  `)
  runLeadVerificationMigrations(db)
  runCampaignAiMigrations(db)
}

function runCampaignAiMigrations(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(campaigns)').all().map(c => c.name))
  if (!cols.has('ai_voice')) {
    db.exec(`ALTER TABLE campaigns ADD COLUMN ai_voice TEXT NOT NULL DEFAULT 'founder'`)
  }
  if (!cols.has('ai_instructions')) {
    db.exec(`ALTER TABLE campaigns ADD COLUMN ai_instructions TEXT NOT NULL DEFAULT ''`)
  }
}

function runLeadVerificationMigrations(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(leads)').all().map(c => c.name))
  if (!cols.has('verification_status')) {
    db.exec(`ALTER TABLE leads ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending'`)
  }
  if (!cols.has('verification_reason')) {
    db.exec(`ALTER TABLE leads ADD COLUMN verification_reason TEXT`)
  }
  if (!cols.has('verified_at')) {
    db.exec(`ALTER TABLE leads ADD COLUMN verified_at TEXT`)
  }
  if (!cols.has('verification_method')) {
    db.exec(`ALTER TABLE leads ADD COLUMN verification_method TEXT`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_verification_status ON leads(verification_status)`)
}

// DB: Import Batches
function insertImportBatch(filename) {
  const r = getDb().prepare('INSERT INTO import_batches (filename, created_at) VALUES (?, ?)').run(filename, new Date().toISOString())
  return Number(r.lastInsertRowid)
}

function listImportBatchesWithCounts() {
  return getDb().prepare(`
    SELECT b.id, b.filename, b.created_at, COUNT(l.id) AS lead_count
    FROM import_batches b LEFT JOIN leads l ON l.import_batch_id = b.id
    GROUP BY b.id ORDER BY b.id DESC
  `).all()
}

function deleteImportBatch(batchId) {
  const db = getDb()
  const soleTargetCampaigns = db.prepare(`
    SELECT campaign_id FROM campaign_target_batches
    WHERE import_batch_id = ? AND campaign_id IN (
      SELECT campaign_id FROM campaign_target_batches GROUP BY campaign_id HAVING COUNT(*) = 1
    )
  `).all(batchId)
  const deletedCampaignIds = soleTargetCampaigns.map(r => r.campaign_id)
  const run = db.transaction(() => {
    const delCampaign = db.prepare('DELETE FROM campaigns WHERE id = ?')
    for (const id of deletedCampaignIds) delCampaign.run(id)
    const leadResult = db.prepare('DELETE FROM leads WHERE import_batch_id = ?').run(batchId)
    db.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId)
    return { deletedLeads: leadResult.changes, deletedCampaigns: deletedCampaignIds.length }
  })
  const { deletedLeads, deletedCampaigns } = run()
  return { deletedLeads, deletedCampaigns, deletedCampaignIds }
}

const LEAD_SELECT = 'id, import_batch_id, email, data_json, created_at, verification_status, verification_reason, verified_at, verification_method'

// DB: Leads
function insertLead(importBatchId, email, data, verification) {
  const status = verification?.status ?? 'pending'
  const reason = verification?.reason ?? null
  const verifiedAt = verification?.verifiedAt ?? null
  const method = verification?.method ?? null
  const r = getDb().prepare(`
    INSERT INTO leads (import_batch_id, email, data_json, created_at, verification_status, verification_reason, verified_at, verification_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(importBatchId, email, JSON.stringify(data), new Date().toISOString(), status, reason, verifiedAt, method)
  return Number(r.lastInsertRowid)
}

function updateLeadVerification(id, verification) {
  getDb().prepare(`
    UPDATE leads SET verification_status = ?, verification_reason = ?, verified_at = ?, verification_method = ?
    WHERE id = ?
  `).run(verification.status, verification.reason ?? null, verification.verifiedAt ?? new Date().toISOString(), verification.method ?? null, id)
}

function listLeads(opts) {
  const db = getDb()
  const search = opts?.search?.trim()
  const batchId = opts?.importBatchId
  const status = opts?.verificationStatus?.trim()
  const conditions = []
  const params = []
  if (batchId != null) {
    conditions.push('import_batch_id = ?')
    params.push(batchId)
  }
  if (status) {
    conditions.push('verification_status = ?')
    params.push(status)
  }
  if (search) {
    const q = `%${search.toLowerCase()}%`
    conditions.push('(LOWER(email) LIKE ? OR LOWER(data_json) LIKE ?)')
    params.push(q, q)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.prepare(`SELECT ${LEAD_SELECT} FROM leads ${where} ORDER BY id DESC`).all(...params)
}

function listLeadVerificationStats(opts) {
  const db = getDb()
  const batchId = opts?.importBatchId
  let sql = `SELECT verification_status, COUNT(*) as c FROM leads`
  const params = []
  if (batchId != null) {
    sql += ' WHERE import_batch_id = ?'
    params.push(batchId)
  }
  sql += ' GROUP BY verification_status'
  const rows = db.prepare(sql).all(...params)
  const stats = { valid: 0, invalid: 0, risky: 0, pending: 0, unknown: 0, total: 0 }
  for (const r of rows) {
    const key = r.verification_status || 'pending'
    if (stats[key] !== undefined) stats[key] = r.c
    stats.total += r.c
  }
  return stats
}

function getLead(id) {
  return getDb().prepare(`SELECT ${LEAD_SELECT} FROM leads WHERE id = ?`).get(id)
}

function deleteLead(id) {
  getDb().prepare('DELETE FROM leads WHERE id = ?').run(id)
}

function leadEmailExistsLower(emailLower) {
  const row = getDb().prepare('SELECT 1 as x FROM leads WHERE LOWER(email) = ? LIMIT 1').get(emailLower)
  return row != null
}

// DB: Campaigns
const CAMPAIGN_SELECT = 'id, name, pitch_block, sender_info, ai_voice, ai_instructions, created_at'

function listCampaigns() {
  return getDb().prepare(`SELECT ${CAMPAIGN_SELECT} FROM campaigns ORDER BY id DESC`).all()
}

function getCampaign(id) {
  return getDb().prepare(`SELECT ${CAMPAIGN_SELECT} FROM campaigns WHERE id = ?`).get(id)
}

function createCampaign(name, pitchBlock, senderInfo, aiVoice, aiInstructions) {
  const r = getDb().prepare('INSERT INTO campaigns (name, pitch_block, sender_info, ai_voice, ai_instructions, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    name, pitchBlock, senderInfo, aiVoice || 'founder', aiInstructions || '', new Date().toISOString()
  )
  return Number(r.lastInsertRowid)
}

function updateCampaign(id, name, pitchBlock, senderInfo, aiVoice, aiInstructions) {
  getDb().prepare('UPDATE campaigns SET name = ?, pitch_block = ?, sender_info = ?, ai_voice = ?, ai_instructions = ? WHERE id = ?').run(
    name, pitchBlock, senderInfo, aiVoice || 'founder', aiInstructions || '', id
  )
}

function deleteCampaign(id) {
  getDb().prepare('DELETE FROM campaigns WHERE id = ?').run(id)
}

// DB: Campaign Steps
function listSteps(campaignId) {
  return getDb().prepare(`SELECT id, campaign_id, step_order, delay_hours_after_previous, subject_template, body_template, use_ai FROM campaign_steps WHERE campaign_id = ? ORDER BY step_order`).all(campaignId)
}

function replaceSteps(campaignId, steps) {
  const db = getDb()
  const del = db.prepare('DELETE FROM campaign_steps WHERE campaign_id = ?')
  const ins = db.prepare(`INSERT INTO campaign_steps (campaign_id, step_order, delay_hours_after_previous, subject_template, body_template, use_ai) VALUES (?, ?, ?, ?, ?, ?)`)
  db.transaction(() => {
    del.run(campaignId)
    for (const s of steps) {
      ins.run(campaignId, s.step_order, s.delay_hours_after_previous, s.subject_template, s.body_template, s.use_ai ? 1 : 0)
    }
  })()
}

// DB: Campaign Target Batches
function getCampaignTargetBatchIds(campaignId) {
  return getDb().prepare('SELECT import_batch_id FROM campaign_target_batches WHERE campaign_id = ? ORDER BY import_batch_id').all(campaignId).map(r => r.import_batch_id)
}

function replaceCampaignTargetBatches(campaignId, importBatchIds) {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM campaign_target_batches WHERE campaign_id = ?').run(campaignId)
    const ins = db.prepare('INSERT INTO campaign_target_batches (campaign_id, import_batch_id) VALUES (?, ?)')
    for (const bid of importBatchIds) ins.run(campaignId, bid)
  })()
}

function listAllLeadIdsForCampaignTargets(campaignId) {
  const db = getDb()
  const n = db.prepare('SELECT COUNT(*) as c FROM campaign_target_batches WHERE campaign_id = ?').get(campaignId)
  if (n.c === 0) {
    return db.prepare('SELECT id FROM leads ORDER BY id').all().map(r => r.id)
  }
  return db.prepare(`
    SELECT DISTINCT l.id FROM leads l
    INNER JOIN campaign_target_batches t ON t.import_batch_id = l.import_batch_id
    WHERE t.campaign_id = ? AND l.import_batch_id IS NOT NULL ORDER BY l.id
  `).all(campaignId).map(r => r.id)
}

function listLeadIdsForCampaignTargets(campaignId) {
  const db = getDb()
  const n = db.prepare('SELECT COUNT(*) as c FROM campaign_target_batches WHERE campaign_id = ?').get(campaignId)
  if (n.c === 0) {
    return db.prepare(`SELECT id FROM leads WHERE verification_status = 'valid' ORDER BY id`).all().map(r => r.id)
  }
  return db.prepare(`
    SELECT DISTINCT l.id FROM leads l
    INNER JOIN campaign_target_batches t ON t.import_batch_id = l.import_batch_id
    WHERE t.campaign_id = ? AND l.import_batch_id IS NOT NULL AND l.verification_status = 'valid'
    ORDER BY l.id
  `).all(campaignId).map(r => r.id)
}

function getCampaignLeadVerificationStats(campaignId) {
  const allIds = listAllLeadIdsForCampaignTargets(campaignId)
  const sendable = listLeadIdsForCampaignTargets(campaignId).length
  return { total: allIds.length, sendable, blocked: allIds.length - sendable }
}

// DB: Lead Sends
function getLastSend(leadId, campaignId) {
  return getDb().prepare(`SELECT id, lead_id, campaign_id, step_order, subject, body_snippet, sent_at, error FROM lead_sends WHERE lead_id = ? AND campaign_id = ? AND error IS NULL ORDER BY step_order DESC, sent_at DESC LIMIT 1`).get(leadId, campaignId)
}

function insertSend(leadId, campaignId, stepOrder, subject, bodySnippet, error) {
  getDb().prepare(`INSERT INTO lead_sends (lead_id, campaign_id, step_order, subject, body_snippet, sent_at, error) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(leadId, campaignId, stepOrder, subject, bodySnippet, new Date().toISOString(), error)
}

function countSendsToday() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const row = getDb().prepare(`SELECT COUNT(*) as c FROM lead_sends WHERE error IS NULL AND sent_at >= ?`).get(start.toISOString())
  return row.c
}

function getCampaignSendProgress(campaignId) {
  const db = getDb()
  const leadCount = listLeadIdsForCampaignTargets(campaignId).length
  const steps = listSteps(campaignId)
  const stepCount = steps.length
  const maxStep = stepCount > 0 ? Math.max(...steps.map(s => s.step_order)) : 0
  const emailsSent = db.prepare(`SELECT COUNT(*) as c FROM lead_sends WHERE campaign_id = ? AND error IS NULL`).get(campaignId).c
  const leadsStarted = db.prepare(`SELECT COUNT(DISTINCT lead_id) as c FROM lead_sends WHERE campaign_id = ? AND error IS NULL`).get(campaignId).c
  let leadsCompleted = 0
  if (maxStep > 0 && leadCount > 0) {
    leadsCompleted = db.prepare(`SELECT COUNT(*) as c FROM (SELECT lead_id, MAX(step_order) as mx FROM lead_sends WHERE campaign_id = ? AND error IS NULL GROUP BY lead_id HAVING mx >= ?)`).get(campaignId, maxStep).c
  }
  return { campaignId, leadCount, stepCount, emailsSent, leadsStarted, leadsCompleted }
}

// DB: Body Overrides
function getLeadBodyOverride(leadId, campaignId, stepOrder) {
  const row = getDb().prepare(`SELECT body FROM lead_body_overrides WHERE lead_id = ? AND campaign_id = ? AND step_order = ?`).get(leadId, campaignId, stepOrder)
  return row?.body
}

function getLeadSubjectOverride(leadId, campaignId, stepOrder) {
  const row = getDb().prepare(`SELECT subject FROM lead_body_overrides WHERE lead_id = ? AND campaign_id = ? AND step_order = ?`).get(leadId, campaignId, stepOrder)
  const s = row?.subject?.trim()
  return s && s.length > 0 ? s : undefined
}

function replaceLeadBodyOverrides(campaignId, stepOrder, items) {
  const db = getDb()
  const ins = db.prepare(`INSERT INTO lead_body_overrides (lead_id, campaign_id, step_order, body, subject, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(lead_id, campaign_id, step_order) DO UPDATE SET body = excluded.body, subject = COALESCE(excluded.subject, lead_body_overrides.subject), updated_at = excluded.updated_at`)
  db.transaction(() => {
    const now = new Date().toISOString()
    for (const { leadId, body, subject } of items) {
      ins.run(leadId, campaignId, stepOrder, body, subject ?? null, now)
    }
  })()
}

function clearLeadBodyOverridesForStep(campaignId, stepOrder) {
  getDb().prepare(`DELETE FROM lead_body_overrides WHERE campaign_id = ? AND step_order = ?`).run(campaignId, stepOrder)
}

function listStepSavedContent(campaignId, stepOrder) {
  const db = getDb()
  const aiRows = db.prepare(`SELECT lead_id, body, subject FROM lead_body_overrides WHERE campaign_id = ? AND step_order = ?`).all(campaignId, stepOrder)
  const mergeRows = db.prepare(`SELECT lead_id, preview_text FROM lead_merge_previews WHERE campaign_id = ? AND step_order = ?`).all(campaignId, stepOrder)
  return {
    aiBodies: aiRows.map(r => ({ leadId: r.lead_id, body: r.body, subject: r.subject?.trim() || undefined })),
    mergePreviews: mergeRows.map(r => ({ leadId: r.lead_id, previewText: r.preview_text }))
  }
}

function upsertLeadMergePreview(leadId, campaignId, stepOrder, previewText) {
  getDb().prepare(`INSERT INTO lead_merge_previews (lead_id, campaign_id, step_order, preview_text, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lead_id, campaign_id, step_order) DO UPDATE SET preview_text = excluded.preview_text, updated_at = excluded.updated_at`).run(leadId, campaignId, stepOrder, previewText, new Date().toISOString())
}

// === SETTINGS ===
function settingsPath() {
  return path.join(app.getPath('userData'), 'outreach-settings.json')
}

function readSettingsFile() {
  const p = settingsPath()
  if (!fs.existsSync(p)) {
    return { ...DEFAULT_SETTINGS, smtpPasswordEnc: null, openaiKeyEnc: null, verificationApiKeyEnc: null }
  }
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    let sendDelayMinMs = DEFAULT_SETTINGS.sendDelayMinMs
    let sendDelayMaxMs = DEFAULT_SETTINGS.sendDelayMaxMs
    if (typeof j.sendDelayMinMs === 'number' && typeof j.sendDelayMaxMs === 'number') {
      sendDelayMinMs = j.sendDelayMinMs
      sendDelayMaxMs = j.sendDelayMaxMs
    } else if (typeof j.sendDelayMs === 'number') {
      sendDelayMinMs = j.sendDelayMs
      sendDelayMaxMs = j.sendDelayMs
    }
    return {
      smtp: { ...DEFAULT_SETTINGS.smtp, ...j.smtp },
      sendDelayMinMs,
      sendDelayMaxMs,
      dailyCap: typeof j.dailyCap === 'number' ? j.dailyCap : DEFAULT_SETTINGS.dailyCap,
      openaiModel: normalizeOpenaiModel(j.openaiModel),
      verificationProvider: typeof j.verificationProvider === 'string' ? j.verificationProvider : DEFAULT_SETTINGS.verificationProvider,
      smtpPasswordEnc: j.smtpPasswordEnc ?? null,
      openaiKeyEnc: j.openaiKeyEnc ?? null,
      verificationApiKeyEnc: j.verificationApiKeyEnc ?? null
    }
  } catch {
    return { ...DEFAULT_SETTINGS, smtpPasswordEnc: null, openaiKeyEnc: null, verificationApiKeyEnc: null }
  }
}

function writeSettingsFile(data) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(data, null, 2), 'utf8')
}

function decrypt(enc) {
  if (!enc) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(enc, 'base64').toString('utf8')
  }
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return ''
  }
}

function encrypt(plain) {
  if (!plain) return null
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(plain, 'utf8').toString('base64')
  }
  return safeStorage.encryptString(plain).toString('base64')
}

function loadSettings() {
  const f = readSettingsFile()
  return {
    smtp: f.smtp,
    sendDelayMinMs: f.sendDelayMinMs,
    sendDelayMaxMs: f.sendDelayMaxMs,
    dailyCap: f.dailyCap,
    openaiModel: f.openaiModel,
    verificationProvider: f.verificationProvider || 'none'
  }
}

function saveSettings(s) {
  const f = readSettingsFile()
  writeSettingsFile({
    smtp: s.smtp,
    sendDelayMinMs: s.sendDelayMinMs,
    sendDelayMaxMs: s.sendDelayMaxMs,
    dailyCap: s.dailyCap,
    openaiModel: normalizeOpenaiModel(s.openaiModel),
    verificationProvider: s.verificationProvider || 'none',
    smtpPasswordEnc: f.smtpPasswordEnc,
    openaiKeyEnc: f.openaiKeyEnc,
    verificationApiKeyEnc: f.verificationApiKeyEnc
  })
}

function getSmtpPassword() {
  return decrypt(readSettingsFile().smtpPasswordEnc)
}

function setSmtpPassword(password) {
  const f = readSettingsFile()
  f.smtpPasswordEnc = encrypt(password)
  writeSettingsFile(f)
}

function getOpenaiKey() {
  return decrypt(readSettingsFile().openaiKeyEnc)
}

function setOpenaiKey(key) {
  const f = readSettingsFile()
  f.openaiKeyEnc = encrypt(key)
  writeSettingsFile(f)
}

function getVerificationApiKey() {
  return decrypt(readSettingsFile().verificationApiKeyEnc)
}

function setVerificationApiKey(key) {
  const f = readSettingsFile()
  f.verificationApiKeyEnc = encrypt(key)
  writeSettingsFile(f)
}

function getVerificationOptions(useApi = false) {
  const f = readSettingsFile()
  const apiKey = getVerificationApiKey()
  const provider = f.verificationProvider || 'none'
  return {
    useApi: useApi && provider === 'zerobounce' && !!apiKey,
    apiKey,
    provider
  }
}

function emitVerifyProgress(current, total) {
  mainWindow?.webContents.send('verify:progress', { current, total })
}

async function verifyAndSaveLead(leadId, email, useApi) {
  const result = await verifyEmail(email, getVerificationOptions(useApi))
  updateLeadVerification(leadId, result)
  return result
}

async function verifyLeadIds(leadIds, useApi) {
  let current = 0
  const counts = { valid: 0, invalid: 0, risky: 0, pending: 0, unknown: 0 }
  for (const id of leadIds) {
    const row = getLead(id)
    if (!row) continue
    const result = await verifyAndSaveLead(id, row.email, useApi)
    counts[result.status] = (counts[result.status] || 0) + 1
    current++
    emitVerifyProgress(current, leadIds.length)
  }
  return { verified: leadIds.length, counts }
}

// === SMTP ===
function assertGmailSmtpUsername(settings) {
  const host = settings.smtp.host.toLowerCase()
  const user = settings.smtp.user.trim()
  if (!host.includes('gmail.com') || !user) return
  if (!user.includes('@')) {
    throw new Error('Gmail SMTP requires Username to be your full Gmail address (e.g. you@gmail.com). Put your brand name in "From name", not in Username.')
  }
}

function enhanceSmtpError(err, settings) {
  const base = err instanceof Error ? err.message : String(err)
  const code = err?.code || ''
  const host = settings.smtp.host.toLowerCase()
  const user = settings.smtp.user.trim()
  const authFail = code === 'EAUTH' || /535|Invalid login|authentication failed|BadCredentials/i.test(base)
  if (authFail && host.includes('gmail.com')) {
    let hint = '\n\nFor Gmail: use an App Password (Google Account → Security → App passwords), not your normal Google password. App passwords require 2-Step Verification.'
    if (user && !user.includes('@')) {
      hint = '\n\nSet SMTP Username to your full Gmail address. "From name" is only the display name recipients see.'
    }
    return new Error(base + hint)
  }
  return err instanceof Error ? err : new Error(base)
}

async function sendMail(settings, to, subject, text, html, passwordOverride) {
  assertGmailSmtpUsername(settings)
  const user = settings.smtp.user.trim()
  const pass = (passwordOverride?.trim() || getSmtpPassword())?.trim() || undefined
  const auth = user ? { user, pass } : undefined
  const transporter = nodemailer.createTransport({
    host: settings.smtp.host.trim(),
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth
  })
  const from = settings.smtp.fromName && settings.smtp.fromEmail
    ? `${settings.smtp.fromName} <${settings.smtp.fromEmail}>`
    : settings.smtp.fromEmail || user
  return transporter.sendMail({
    from,
    to,
    subject,
    text,
    html: html ?? text.replace(/\n/g, '<br/>')
  })
}

async function verifySmtp(settings, passwordOverride) {
  assertGmailSmtpUsername(settings)
  const user = settings.smtp.user.trim()
  const pass = (passwordOverride?.trim() || getSmtpPassword())?.trim() || undefined
  const auth = user ? { user, pass } : undefined
  const transporter = nodemailer.createTransport({
    host: settings.smtp.host.trim(),
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth
  })
  await transporter.verify()
}

// === AI ===
async function generateEmailBody(model, pitchBlock, senderInfo, lead, email, previous, stepOrder, baseTemplate, opts = {}) {
  const key = getOpenaiKey()
  if (!key) throw new Error('OpenAI API key is not set in Settings')
  const client = new OpenAI.default({ apiKey: key })
  const ctx = buildContext(lead, pitchBlock, senderInfo, previous, stepOrder)
  const mergedPreview = renderTemplate(baseTemplate, ctx)
  const leadFull = { ...lead, email: email || lead.email || '' }
  const messages = buildBodyMessages({
    lead: leadFull,
    pitchBlock,
    senderInfo,
    previous,
    stepOrder,
    mergedPreview,
    aiVoice: opts.aiVoice || 'founder',
    aiInstructions: opts.aiInstructions || opts.customInstructions || ''
  })
  const res = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.65,
    max_tokens: 550
  })
  const text = res.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('Empty response from OpenAI')
  return text
}

async function generateSubjectLine(model, pitchBlock, senderInfo, lead, subjectTemplate, bodySoFar, opts = {}) {
  const key = getOpenaiKey()
  if (!key) throw new Error('OpenAI API key is not set in Settings')
  const client = new OpenAI.default({ apiKey: key })
  const messages = buildSubjectMessages({
    lead,
    pitchBlock,
    subjectTemplate,
    bodySoFar,
    aiVoice: opts.aiVoice || 'founder',
    aiInstructions: opts.aiInstructions || opts.customInstructions || ''
  })
  const res = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 60
  })
  const text = res.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '')
  if (!text) throw new Error('Empty subject from OpenAI')
  return text.slice(0, 100)
}

// === TEMPLATE ===
function buildContext(lead, pitchBlock, senderInfo, previous, stepOrder) {
  return {
    ...lead,
    pitch_block: pitchBlock,
    sender_info: senderInfo,
    previous_subject: previous?.subject ?? '',
    previous_sent_at: previous?.sent_at ?? '',
    previous_body_snippet: previous?.body_snippet ?? '',
    step_index: String(stepOrder),
    unsubscribe_note: 'Reply STOP to opt out of further emails.'
  }
}

function renderTemplate(template, ctx) {
  let result = template
  for (const [key, value] of Object.entries(ctx)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g')
    result = result.replace(regex, value ?? '')
  }
  return result.trim()
}

// === PARSE FILE ===
function parseFileBuffer(filePath) {
  const ext = filePath.toLowerCase().split('.').pop()
  if (ext === 'csv') return parseCsv(filePath)
  if (ext === 'xlsx' || ext === 'xls') return parseXlsx(filePath)
  throw new Error('Unsupported file type. Use .csv, .xlsx, or .xls')
}

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const result = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => String(h).trim() })
  if (result.errors.length) {
    const fatal = result.errors.find(e => e.type === 'Quotes' || e.type === 'FieldMismatch')
    if (fatal) throw new Error(fatal.message)
  }
  const headers = result.meta.fields?.filter(Boolean).map(h => String(h).trim()) ?? []
  const rows = (result.data || []).map(row => normalizeRow(row, headers))
  return { headers, rows }
}

function parseXlsx(filePath) {
  const buf = fs.readFileSync(filePath)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Empty workbook')
  const sheet = wb.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  if (!json.length) return { headers: [], rows: [] }
  const headers = Object.keys(json[0]).map(k => String(k).trim())
  const rows = json.map(row => normalizeRow(row, headers))
  return { headers, rows }
}

function normalizeRow(row, headers) {
  const out = {}
  for (const h of headers) {
    const v = row[h]
    out[h] = v === undefined || v === null ? '' : String(v).trim()
  }
  return out
}

function guessMapping(headers) {
  const lower = s => s.toLowerCase().replace(/\s+/g, '_')
  const normHeaders = headers.map(h => ({ raw: h, n: lower(h) }))
  const pairs = [
    ['linkedin_url', 'linkedin_url'], ['email', 'email'], ['phone', 'phone'],
    ['name', 'name'], ['first_name', 'first_name'], ['last_name', 'last_name'],
    ['current_employer', 'current_employer'], ['current_title', 'current_title'],
    ['industry', 'industry'], ['location', 'location'],
    ['linkedin_handle', 'linkedin_handle'], ['company_size', 'company_size']
  ]
  const mapping = {}
  for (const [canonical, hint] of pairs) {
    const found = normHeaders.find(x => x.n === hint || x.n.includes(hint) || x.raw.toLowerCase() === hint.replace(/_/g, ' '))
    if (found) mapping[canonical] = found.raw
  }
  return mapping
}

function applyMapping(rows, mapping) {
  const keys = Object.keys(mapping).filter(k => mapping[k])
  return rows.map(row => {
    const out = {}
    for (const k of keys) {
      const src = mapping[k]
      out[k] = src ? (row[src] ?? '') : ''
    }
    return out
  })
}

function hasValidEmail(email) {
  const e = (email || '').trim()
  if (!e || !e.includes('@')) return false
  const [local, domain] = e.split('@')
  if (!local || !domain || !domain.includes('.')) return false
  return true
}

function filterLeadsWithEmail(leads) {
  return leads.filter(l => hasValidEmail(l.email ?? ''))
}

function dedupeLeadsByEmail(leads) {
  const seen = new Set()
  const out = []
  for (const l of leads) {
    const k = (l.email ?? '').trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(l)
  }
  return out
}

// === SEND QUEUE ===
const FAILURE_BACKOFF_MS = 60000
const MAX_CONSECUTIVE_FAILURES = 3

let queueState = {
  running: false,
  paused: false,
  lastError: null,
  processedInSession: 0,
  failedInSession: 0,
  consecutiveFailures: 0,
  activeCampaignId: null,
  activeLeadIds: [],
  skippedLeadIds: new Set()
}

function isHardDeliverabilityFailure(msg) {
  return /550|552|554|spam|blocked|rejected|EAUTH|Message blocked|High probability of spam/i.test(msg)
}

function queueStatusPayload(currentJob = null) {
  return {
    running: queueState.running,
    paused: queueState.paused,
    lastError: queueState.lastError,
    processedInSession: queueState.processedInSession,
    failedInSession: queueState.failedInSession,
    consecutiveFailures: queueState.consecutiveFailures,
    sendsToday: countSendsToday(),
    currentJob
  }
}

function emitStatus(currentJob = null) {
  mainWindow?.webContents.send('queue:status', queueStatusPayload(currentJob))
}

function getQueueStatus() {
  return queueStatusPayload(null)
}

function computeDueJobs(campaignId, leadIds) {
  const steps = listSteps(campaignId)
  if (!steps.length) return []
  const sorted = [...steps].sort((a, b) => a.step_order - b.step_order)
  const jobs = []
  const now = Date.now()
  for (const leadId of leadIds) {
    if (queueState.skippedLeadIds.has(leadId)) continue
    const last = getLastSend(leadId, campaignId)
    if (!last) {
      jobs.push({ leadId, campaignId, stepOrder: sorted[0].step_order })
      continue
    }
    const next = sorted.find(s => s.step_order === last.step_order + 1)
    if (!next) continue
    const lastTs = new Date(last.sent_at).getTime()
    const need = lastTs + next.delay_hours_after_previous * 3600 * 1000
    if (now >= need) {
      jobs.push({ leadId, campaignId, stepOrder: next.step_order })
    }
  }
  return jobs.sort((a, b) => a.leadId - b.leadId || a.stepOrder - b.stepOrder)
}

function getPreviousSendForStep(leadId, campaignId, stepOrder) {
  if (stepOrder <= 1) return undefined
  return getDb().prepare(`SELECT subject, body_snippet, sent_at FROM lead_sends WHERE lead_id = ? AND campaign_id = ? AND step_order = ? AND error IS NULL`).get(leadId, campaignId, stepOrder - 1)
}

async function renderStepForLead(campaignId, stepOrder, leadId, useAi) {
  const campaign = getCampaign(campaignId)
  if (!campaign) throw new Error('Campaign not found')
  const steps = listSteps(campaignId)
  const step = steps.find(s => s.step_order === stepOrder)
  if (!step) throw new Error('Step not found')
  const stepUseAi = !!step.use_ai
  const row = getLead(leadId)
  if (!row) throw new Error('Lead not found')
  const lead = JSON.parse(row.data_json)
  const aiOpts = { aiVoice: campaign.ai_voice || 'founder', aiInstructions: campaign.ai_instructions || '' }
  const prev = getPreviousSendForStep(leadId, campaignId, stepOrder)
  const prevCtx = prev ? { subject: prev.subject, sent_at: prev.sent_at, body_snippet: prev.body_snippet } : undefined
  const ctx = buildContext(lead, campaign.pitch_block, campaign.sender_info, prevCtx, stepOrder)
  const settings = loadSettings()
  const storedBody = getLeadBodyOverride(leadId, campaignId, stepOrder)
  if (storedBody !== undefined) {
    const storedSubject = getLeadSubjectOverride(leadId, campaignId, stepOrder)
    let subject = storedSubject ?? renderTemplate(step.subject_template, ctx)
    if (!storedSubject && stepUseAi) {
      try {
        subject = await generateSubjectLine(settings.openaiModel, campaign.pitch_block, campaign.sender_info, lead, subject, storedBody, aiOpts)
      } catch { /* keep merged subject */ }
    }
    return { subject, body: storedBody }
  }
  const useAiFinal = useAi ?? stepUseAi
  let body
  if (useAiFinal) {
    body = await generateEmailBody(settings.openaiModel, campaign.pitch_block, campaign.sender_info, lead, row.email, prevCtx, stepOrder, step.body_template, aiOpts)
  } else {
    body = renderTemplate(step.body_template, ctx)
  }
  let subject = renderTemplate(step.subject_template, ctx)
  if (useAiFinal) {
    try {
      subject = await generateSubjectLine(settings.openaiModel, campaign.pitch_block, campaign.sender_info, lead, subject, body, aiOpts)
    } catch { /* keep merged subject */ }
  }
  return { subject, body }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function randomSendDelayMs(settings) {
  const lo = Math.min(settings.sendDelayMinMs, settings.sendDelayMaxMs)
  const hi = Math.max(settings.sendDelayMinMs, settings.sendDelayMaxMs)
  if (hi <= 0) return 0
  return Math.floor(Math.random() * (hi - lo + 1)) + lo
}

async function processOne(job) {
  const settings = loadSettings()
  if (countSendsToday() >= settings.dailyCap) {
    queueState.lastError = `Daily cap (${settings.dailyCap}) reached`
    emitStatus()
    throw new Error(queueState.lastError)
  }
  const leadRow = getLead(job.leadId)
  if (!leadRow) {
    queueState.lastError = 'Lead missing'
    throw new Error(queueState.lastError)
  }
  if (leadRow.verification_status !== 'valid') {
    queueState.skippedLeadIds.add(job.leadId)
    throw new Error(`Lead not verified (${leadRow.verification_status})`)
  }
  const { subject, body } = await renderStepForLead(job.campaignId, job.stepOrder, job.leadId)
  const email = leadRow.email
  await sendMail(loadSettings(), email, subject, body)
  const snippet = body.slice(0, 500)
  insertSend(job.leadId, job.campaignId, job.stepOrder, subject, snippet, null)
  queueState.processedInSession += 1
  queueState.consecutiveFailures = 0
  queueState.lastError = null
}

async function startQueue(campaignId, leadIds) {
  if (queueState.running) return
  queueState.running = true
  queueState.paused = false
  queueState.lastError = null
  queueState.processedInSession = 0
  queueState.failedInSession = 0
  queueState.consecutiveFailures = 0
  queueState.skippedLeadIds.clear()
  queueState.activeCampaignId = campaignId
  queueState.activeLeadIds = [...leadIds]
  emitStatus()
  runLoop()
}

function pauseQueue() {
  queueState.paused = true
  emitStatus()
}

function resumeQueue() {
  queueState.paused = false
  emitStatus()
}

function stopQueue() {
  queueState.running = false
  queueState.paused = false
  queueState.activeCampaignId = null
  queueState.activeLeadIds = []
  queueState.skippedLeadIds.clear()
  emitStatus()
}

async function runLoop() {
  const settings = loadSettings()
  while (queueState.running) {
    if (queueState.paused) {
      await sleep(500)
      continue
    }
    if (!queueState.activeCampaignId || !queueState.activeLeadIds.length) {
      stopQueue()
      break
    }
    if (countSendsToday() >= settings.dailyCap) {
      queueState.lastError = `Daily cap (${settings.dailyCap}) reached — resume tomorrow`
      emitStatus()
      await sleep(5000)
      continue
    }
    const jobs = computeDueJobs(queueState.activeCampaignId, queueState.activeLeadIds)
    if (jobs.length === 0) {
      await sleep(3000)
      continue
    }
    const job = jobs[0]
    try {
      emitStatus({ leadId: job.leadId, stepOrder: job.stepOrder, email: getLead(job.leadId)?.email ?? '' })
      await processOne(job)
      emitStatus()
      await sleep(randomSendDelayMs(settings))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      queueState.lastError = msg
      queueState.failedInSession += 1
      let renderedSubject = ''
      try {
        renderedSubject = (await renderStepForLead(job.campaignId, job.stepOrder, job.leadId)).subject
      } catch { /* ignore */ }
      if (isHardDeliverabilityFailure(msg) || isHardBounceError(msg)) {
        queueState.consecutiveFailures += 1
        queueState.skippedLeadIds.add(job.leadId)
        if (isHardBounceError(msg)) {
          updateLeadVerification(job.leadId, {
            status: 'invalid',
            reason: 'hard_bounce',
            method: 'send',
            verifiedAt: new Date().toISOString()
          })
        }
        if (queueState.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          queueState.paused = true
          queueState.lastError = 'Paused: 3 delivery failures in a row — check spam score, slow down sends, or verify your lead list.'
        }
      } else {
        queueState.consecutiveFailures += 1
      }
      try {
        const leadRow = getLead(job.leadId)
        if (leadRow) {
          insertSend(job.leadId, job.campaignId, job.stepOrder, renderedSubject || '(unknown subject)', '', msg)
        }
      } catch { /* ignore */ }
      emitStatus()
      const delay = Math.max(randomSendDelayMs(settings), FAILURE_BACKOFF_MS)
      await sleep(delay)
    }
  }
}

// === IPC HANDLERS ===
function registerIpcHandlers() {
  ipcMain.handle('openImportDialog', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx', 'xls'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  ipcMain.handle('parsePreview', async (_, filePath) => {
    const parsed = parseFileBuffer(filePath)
    const mapping = guessMapping(parsed.headers)
    return { filename: path.basename(filePath), headers: parsed.headers, previewRows: parsed.rows.slice(0, 25), mapping, totalRows: parsed.rows.length }
  })

  ipcMain.handle('importCommit', async (_, payload) => {
    stopQueue()
    const parsed = parseFileBuffer(payload.filePath)
    const mapped = applyMapping(parsed.rows, payload.mapping)
    const filtered = filterLeadsWithEmail(mapped)
    const unique = dedupeLeadsByEmail(filtered)
    const batchId = insertImportBatch(path.basename(payload.filePath))
    const leadIds = []
    const counts = { valid: 0, invalid: 0, risky: 0, pending: 0, unknown: 0 }
    let skippedExistingInApp = 0
    for (const row of unique) {
      const email = row.email.trim().toLowerCase()
      if (leadEmailExistsLower(email)) {
        skippedExistingInApp += 1
        continue
      }
      const verification = await verifyEmailLocal(row.email.trim())
      const id = insertLead(batchId, row.email.trim(), row, verification)
      leadIds.push(id)
      counts[verification.status] = (counts[verification.status] || 0) + 1
    }
    return {
      imported: leadIds.length,
      skippedNoEmail: mapped.length - filtered.length,
      duplicatesSkipped: filtered.length - unique.length,
      skippedExistingInApp,
      importBatchId: batchId,
      leadIds,
      verification: counts
    }
  })

  ipcMain.handle('batchesList', async () => {
    return listImportBatchesWithCounts().map(b => ({ id: b.id, filename: b.filename, created_at: b.created_at, leadCount: b.lead_count }))
  })

  ipcMain.handle('batchDelete', async (_, batchId) => {
    stopQueue()
    return deleteImportBatch(batchId)
  })

  ipcMain.handle('leadsList', async (_, opts) => {
    const rows = listLeads(opts)
    return rows.map(r => ({
      id: r.id,
      import_batch_id: r.import_batch_id,
      email: r.email,
      created_at: r.created_at,
      verification_status: r.verification_status || 'pending',
      verification_reason: r.verification_reason,
      verified_at: r.verified_at,
      verification_method: r.verification_method,
      data: JSON.parse(r.data_json)
    }))
  })

  ipcMain.handle('leadsVerificationStats', async (_, opts) => listLeadVerificationStats(opts))

  ipcMain.handle('verifyBatch', async (_, payload) => {
    const useApi = !!payload.useApi
    const rows = listLeads({ importBatchId: payload.importBatchId })
    const leadIds = rows
      .filter(r => ['pending', 'unknown', 'risky'].includes(r.verification_status || 'pending'))
      .map(r => r.id)
    return verifyLeadIds(leadIds, useApi)
  })

  ipcMain.handle('verifyLeads', async (_, payload) => {
    return verifyLeadIds(payload.leadIds || [], !!payload.useApi)
  })

  ipcMain.handle('campaignLeadVerificationStats', async (_, campaignId) => getCampaignLeadVerificationStats(campaignId))

  ipcMain.handle('leadDelete', async (_, id) => {
    deleteLead(id)
    return true
  })

  ipcMain.handle('leadIdsForCampaign', async (_, campaignId) => listLeadIdsForCampaignTargets(campaignId))

  ipcMain.handle('campaignsList', async () => {
    return listCampaigns().map(c => ({ ...c, targetImportBatchIds: getCampaignTargetBatchIds(c.id) }))
  })

  ipcMain.handle('campaignGet', async (_, id) => {
    const c = getCampaign(id)
    if (!c) return null
    const steps = listSteps(id).map(s => ({ ...s, use_ai: !!s.use_ai }))
    return {
      ...c,
      ai_voice: c.ai_voice || 'founder',
      ai_instructions: c.ai_instructions || '',
      steps,
      targetImportBatchIds: getCampaignTargetBatchIds(id)
    }
  })

  ipcMain.handle('campaignSave', async (_, payload) => {
    let id = payload.id
    const senderInfo = payload.sender_info ?? ''
    const aiVoice = payload.ai_voice || 'founder'
    const aiInstructions = payload.ai_instructions ?? ''
    if (id) {
      updateCampaign(id, payload.name, payload.pitch_block, senderInfo, aiVoice, aiInstructions)
    } else {
      id = createCampaign(payload.name, payload.pitch_block, senderInfo, aiVoice, aiInstructions)
    }
    replaceSteps(id, payload.steps)
    replaceCampaignTargetBatches(id, payload.targetImportBatchIds ?? [])
    return id
  })

  ipcMain.handle('campaignDelete', async (_, id) => {
    deleteCampaign(id)
    return true
  })

  ipcMain.handle('campaignSendProgress', async (_, campaignId) => getCampaignSendProgress(campaignId))

  ipcMain.handle('settingsGet', async () => loadSettings())

  ipcMain.handle('settingsSave', async (_, payload) => {
    saveSettings(payload.settings)
    if (payload.smtpPassword?.length > 0) setSmtpPassword(payload.smtpPassword)
    if (payload.openaiKey?.length > 0) setOpenaiKey(payload.openaiKey)
    if (payload.verificationApiKey?.length > 0) setVerificationApiKey(payload.verificationApiKey)
    return true
  })

  ipcMain.handle('smtpTest', async (_, payload) => {
    const testAddress = typeof payload === 'string' ? payload : payload.testAddress
    const smtpPassword = typeof payload === 'string' ? undefined : payload.smtpPassword
    const passTry = smtpPassword?.length > 0 ? smtpPassword : undefined
    const s = loadSettings()
    try {
      await verifySmtp(s, passTry)
      if (testAddress?.includes('@')) {
        await sendMail(s, testAddress.trim(), 'Outreach test', 'This is a test email from Email Outreach.', undefined, passTry)
      }
      return true
    } catch (e) {
      throw enhanceSmtpError(e, s)
    }
  })

  ipcMain.handle('preview', async (_, req) => renderStepForLead(req.campaignId, req.stepOrder, req.leadId, req.useAiOverride))

  ipcMain.handle('aiGenerate', async (_, req) => {
    const camp = getCampaign(req.campaignId)
    if (!camp) throw new Error('Campaign not found')
    const steps = listSteps(req.campaignId)
    const step = steps.find(s => s.step_order === req.stepOrder)
    if (!step) throw new Error('Step not found')
    const row = getLead(req.leadId)
    if (!row) throw new Error('Lead not found')
    const lead = JSON.parse(row.data_json)
    const settings = loadSettings()
    const prevRow = getDb().prepare(`SELECT subject, body_snippet, sent_at FROM lead_sends WHERE lead_id = ? AND campaign_id = ? AND step_order = ? AND error IS NULL`).get(req.leadId, req.campaignId, req.stepOrder - 1)
    const prevCtx = prevRow ? { subject: prevRow.subject, sent_at: prevRow.sent_at, body_snippet: prevRow.body_snippet } : undefined
    const aiOpts = {
      aiVoice: camp.ai_voice || 'founder',
      aiInstructions: camp.ai_instructions || req.customInstructions || ''
    }
    const body = await generateEmailBody(settings.openaiModel, camp.pitch_block, camp.sender_info, lead, row.email, prevCtx, req.stepOrder, step.body_template, aiOpts)
    const ctx = buildContext(lead, camp.pitch_block, camp.sender_info, prevCtx, req.stepOrder)
    const mergedSubject = renderTemplate(step.subject_template, ctx)
    let subject = mergedSubject
    try {
      subject = await generateSubjectLine(settings.openaiModel, camp.pitch_block, camp.sender_info, lead, mergedSubject, body, aiOpts)
    } catch { /* keep merged subject */ }
    return { body, subject }
  })

  ipcMain.handle('applyBodyOverrides', async (_, payload) => {
    replaceLeadBodyOverrides(payload.campaignId, payload.stepOrder, payload.items)
    return { saved: payload.items.length }
  })

  ipcMain.handle('clearStepOverrides', async (_, payload) => {
    clearLeadBodyOverridesForStep(payload.campaignId, payload.stepOrder)
    return true
  })

  ipcMain.handle('listStepSavedContent', async (_, payload) => listStepSavedContent(payload.campaignId, payload.stepOrder))

  ipcMain.handle('saveMergePreview', async (_, payload) => {
    upsertLeadMergePreview(payload.leadId, payload.campaignId, payload.stepOrder, payload.previewText)
    return true
  })

  ipcMain.handle('queueStart', async (_, payload) => {
    startQueue(payload.campaignId, payload.leadIds)
    return true
  })

  ipcMain.handle('queuePause', async () => { pauseQueue(); return true })
  ipcMain.handle('queueResume', async () => { resumeQueue(); return true })
  ipcMain.handle('queueStop', async () => { stopQueue(); return true })
  ipcMain.handle('queueStatus', async () => getQueueStatus())

  ipcMain.handle('computeDue', async (_, payload) => computeDueJobs(payload.campaignId, payload.leadIds))
}

// === WINDOW ===
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.loadFile('index.html')
  mainWindow.on('closed', () => { mainWindow = null })
}

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window-close', () => mainWindow?.close())

// === APP LIFECYCLE ===
app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
