import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, SmtpSettings } from '../../src/shared/types'

const defaults: AppSettings = {
  smtp: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: '',
    fromName: '',
    fromEmail: '',
  },
  sendDelayMinMs: 2000,
  sendDelayMaxMs: 5000,
  dailyCap: 400,
  openaiModel: 'gpt-4o-mini',
}

type FileShape = {
  smtp: SmtpSettings
  sendDelayMinMs: number
  sendDelayMaxMs: number
  dailyCap: number
  openaiModel: string
  /** Legacy single delay; migrated to min=max on read */
  sendDelayMs?: number
  smtpPasswordEnc: string | null
  openaiKeyEnc: string | null
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'outreach-settings.json')
}

function readFile(): FileShape {
  const p = settingsPath()
  if (!fs.existsSync(p)) {
    return {
      ...defaults,
      smtpPasswordEnc: null,
      openaiKeyEnc: null,
    }
  }
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw) as Partial<FileShape>
    let sendDelayMinMs = defaults.sendDelayMinMs
    let sendDelayMaxMs = defaults.sendDelayMaxMs
    if (typeof j.sendDelayMinMs === 'number' && typeof j.sendDelayMaxMs === 'number') {
      sendDelayMinMs = j.sendDelayMinMs
      sendDelayMaxMs = j.sendDelayMaxMs
    } else if (typeof j.sendDelayMs === 'number') {
      sendDelayMinMs = j.sendDelayMs
      sendDelayMaxMs = j.sendDelayMs
    }
    return {
      smtp: { ...defaults.smtp, ...j.smtp },
      sendDelayMinMs,
      sendDelayMaxMs,
      dailyCap: typeof j.dailyCap === 'number' ? j.dailyCap : defaults.dailyCap,
      openaiModel: typeof j.openaiModel === 'string' ? j.openaiModel : defaults.openaiModel,
      smtpPasswordEnc: j.smtpPasswordEnc ?? null,
      openaiKeyEnc: j.openaiKeyEnc ?? null,
    }
  } catch {
    return {
      ...defaults,
      sendDelayMinMs: defaults.sendDelayMinMs,
      sendDelayMaxMs: defaults.sendDelayMaxMs,
      smtpPasswordEnc: null,
      openaiKeyEnc: null,
    }
  }
}

function writeFile(data: FileShape) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(data, null, 2), 'utf8')
}

function decrypt(enc: string | null): string {
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

function encrypt(plain: string): string | null {
  if (!plain) return null
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(plain, 'utf8').toString('base64')
  }
  return safeStorage.encryptString(plain).toString('base64')
}

export function loadSettings(): AppSettings {
  const f = readFile()
  return {
    smtp: f.smtp,
    sendDelayMinMs: f.sendDelayMinMs,
    sendDelayMaxMs: f.sendDelayMaxMs,
    dailyCap: f.dailyCap,
    openaiModel: f.openaiModel,
  }
}

export function saveSettings(s: AppSettings) {
  const f = readFile()
  writeFile({
    smtp: s.smtp,
    sendDelayMinMs: s.sendDelayMinMs,
    sendDelayMaxMs: s.sendDelayMaxMs,
    dailyCap: s.dailyCap,
    openaiModel: s.openaiModel,
    smtpPasswordEnc: f.smtpPasswordEnc,
    openaiKeyEnc: f.openaiKeyEnc,
  })
}

export function getSmtpPassword(): string {
  const f = readFile()
  return decrypt(f.smtpPasswordEnc)
}

export function setSmtpPassword(password: string) {
  const f = readFile()
  f.smtpPasswordEnc = encrypt(password)
  writeFile(f)
}

export function getOpenaiKey(): string {
  const f = readFile()
  return decrypt(f.openaiKeyEnc)
}

export function setOpenaiKey(key: string) {
  const f = readFile()
  f.openaiKeyEnc = encrypt(key)
  writeFile(f)
}
