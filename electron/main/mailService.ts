import nodemailer from 'nodemailer'
import type { AppSettings } from '../../src/shared/types'
import { getSmtpPassword } from './settingsStore'

function smtpUser(settings: AppSettings): string {
  return settings.smtp.user.trim()
}

function smtpPasswordForAuth(override?: string): string | undefined {
  const raw =
    override !== undefined && override.length > 0 ? override : getSmtpPassword()
  const t = raw?.trim()
  return t && t.length > 0 ? t : undefined
}

function smtpAuth(settings: AppSettings, passwordOverride?: string) {
  const user = smtpUser(settings)
  if (!user) return undefined
  const pass = smtpPasswordForAuth(passwordOverride)
  return { user, pass: pass || undefined }
}

/** Gmail rejects AUTH when Username is a label instead of the mailbox email. */
export function assertGmailSmtpUsername(settings: AppSettings): void {
  const host = settings.smtp.host.toLowerCase()
  const user = smtpUser(settings)
  if (!host.includes('gmail.com') || !user) return
  if (!user.includes('@')) {
    throw new Error(
      'Gmail SMTP requires Username to be your full Gmail address (e.g. you@gmail.com). Put your brand name in "From name", not in Username.',
    )
  }
}

export function enhanceSmtpError(err: unknown, settings: AppSettings): Error {
  const base =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: string }).code)
      : ''
  const host = settings.smtp.host.toLowerCase()
  const user = smtpUser(settings)

  const authFail =
    code === 'EAUTH' ||
    /535|Invalid login|authentication failed|BadCredentials/i.test(base)

  if (authFail && host.includes('gmail.com')) {
    let hint =
      '\n\nFor Gmail: use an App Password (Google Account → Security → App passwords), not your normal Google password. App passwords require 2-Step Verification.'
    if (user && !user.includes('@')) {
      hint =
        '\n\nSet SMTP Username to your full Gmail address. "From name" is only the display name recipients see.'
    }
    return new Error(base + hint)
  }

  return err instanceof Error ? err : new Error(base)
}

export async function sendMail(
  settings: AppSettings,
  to: string,
  subject: string,
  text: string,
  html?: string,
  passwordOverride?: string,
) {
  assertGmailSmtpUsername(settings)
  const auth = smtpAuth(settings, passwordOverride)
  const transporter = nodemailer.createTransport({
    host: settings.smtp.host.trim(),
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: auth ?? undefined,
  })
  const user = smtpUser(settings)
  const from =
    settings.smtp.fromName && settings.smtp.fromEmail
      ? `${settings.smtp.fromName} <${settings.smtp.fromEmail}>`
      : settings.smtp.fromEmail || user
  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html: html ?? text.replace(/\n/g, '<br/>'),
  })
  return info
}

export async function verifySmtp(settings: AppSettings, passwordOverride?: string) {
  assertGmailSmtpUsername(settings)
  const auth = smtpAuth(settings, passwordOverride)
  const transporter = nodemailer.createTransport({
    host: settings.smtp.host.trim(),
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: auth ?? undefined,
  })
  await transporter.verify()
}
