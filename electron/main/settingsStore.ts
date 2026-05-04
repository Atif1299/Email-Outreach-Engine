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
  sendDelayMs: 3000,
  dailyCap: 400,
  openaiModel: 'gpt-4o-mini',
}

type FileShape = {
  smtp: SmtpSettings
  sendDelayMs: number
  dailyCap: number
  openaiModel: string
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
    return {
      smtp: { ...defaults.smtp, ...j.smtp },
      sendDelayMs: typeof j.sendDelayMs === 'number' ? j.sendDelayMs : defaults.sendDelayMs,
      dailyCap: typeof j.dailyCap === 'number' ? j.dailyCap : defaults.dailyCap,
      openaiModel: typeof j.openaiModel === 'string' ? j.openaiModel : defaults.openaiModel,
      smtpPasswordEnc: j.smtpPasswordEnc ?? null,
      openaiKeyEnc: j.openaiKeyEnc ?? null,
    }
  } catch {
    return {
      ...defaults,
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
    sendDelayMs: f.sendDelayMs,
    dailyCap: f.dailyCap,
    openaiModel: f.openaiModel,
  }
}

export function saveSettings(s: AppSettings) {
  const f = readFile()
  writeFile({
    smtp: s.smtp,
    sendDelayMs: s.sendDelayMs,
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
