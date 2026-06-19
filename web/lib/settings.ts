import prisma from '@/lib/db'

export interface PublicSettings {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpFromName: string
  smtpFromEmail: string
  sendDelayMinMs: number
  sendDelayMaxMs: number
  dailyCap: number
  hourlyCap: number
  sendTimezone: string
  sendStartHour: number
  openaiModel: string
  verificationProvider: string
  hasSmtpPassword: boolean
  hasOpenaiKey: boolean
  hasVerificationApiKey: boolean
}

export async function ensureSettings() {
  let settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: 1 } })
  }
  return settings
}

export function toPublicSettings(settings: {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpFromName: string
  smtpFromEmail: string
  sendDelayMinMs: number
  sendDelayMaxMs: number
  dailyCap: number
  hourlyCap: number
  sendTimezone: string
  sendStartHour: number
  openaiModel: string
  verificationProvider: string
  smtpPassword: string
  openaiKey: string
  verificationApiKey: string
}): PublicSettings {
  return {
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpSecure: settings.smtpSecure,
    smtpUser: settings.smtpUser,
    smtpFromName: settings.smtpFromName,
    smtpFromEmail: settings.smtpFromEmail,
    sendDelayMinMs: settings.sendDelayMinMs,
    sendDelayMaxMs: settings.sendDelayMaxMs,
    dailyCap: settings.dailyCap,
    hourlyCap: settings.hourlyCap,
    sendTimezone: settings.sendTimezone,
    sendStartHour: settings.sendStartHour,
    openaiModel: settings.openaiModel,
    verificationProvider: settings.verificationProvider,
    hasSmtpPassword: !!settings.smtpPassword,
    hasOpenaiKey: !!settings.openaiKey,
    hasVerificationApiKey: !!settings.verificationApiKey,
  }
}
