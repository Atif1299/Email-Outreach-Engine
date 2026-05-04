import nodemailer from 'nodemailer'
import type { AppSettings } from '../../src/shared/types'
import { getSmtpPassword } from './settingsStore'

export async function sendMail(
  settings: AppSettings,
  to: string,
  subject: string,
  text: string,
  html?: string,
) {
  const pass = getSmtpPassword()
  const transporter = nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: settings.smtp.user
      ? {
        user: settings.smtp.user,
        pass: pass || undefined,
      }
      : undefined,
  })
  const from =
    settings.smtp.fromName && settings.smtp.fromEmail
      ? `${settings.smtp.fromName} <${settings.smtp.fromEmail}>`
      : settings.smtp.fromEmail || settings.smtp.user
  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html: html ?? text.replace(/\n/g, '<br/>'),
  })
  return info
}

export async function verifySmtp(settings: AppSettings) {
  const pass = getSmtpPassword()
  const transporter = nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: settings.smtp.user
      ? {
        user: settings.smtp.user,
        pass: pass || undefined,
      }
      : undefined,
  })
  await transporter.verify()
}
