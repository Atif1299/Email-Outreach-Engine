import prisma from '@/lib/db'

export interface PublicSettings {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpFromName: string
  sendDelayMinMs: number
  sendDelayMaxMs: number
  dailyCap: number
  dailyStep1Cap: number
  dailyFollowUpCap: number
  hourlyCap: number
  sendTimezone: string
  sendStartHour: number
  openaiModel: string
  verificationProvider: string
  hasOpenaiKey: boolean
  hasVerificationApiKey: boolean
  smtpAccounts: import('@/lib/smtp-accounts').PublicSmtpAccount[]
  /** @deprecated Legacy single-account fields kept for backward compatibility */
  smtpUser: string
  /** @deprecated */
  smtpFromEmail: string
  /** @deprecated */
  hasSmtpPassword: boolean
}

export async function ensureSettings() {
  let settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: 1 } })
  }
  return settings
}

export function toPublicSettings(
  settings: {
    smtpHost: string
    smtpPort: number
    smtpSecure: boolean
    smtpUser: string
    smtpFromName: string
    smtpFromEmail: string
    sendDelayMinMs: number
    sendDelayMaxMs: number
    dailyCap: number
    dailyStep1Cap: number
    dailyFollowUpCap: number
    hourlyCap: number
    sendTimezone: string
    sendStartHour: number
    openaiModel: string
    verificationProvider: string
    smtpPassword: string
    openaiKey: string
    verificationApiKey: string
  },
  smtpAccounts: import('@/lib/smtp-accounts').PublicSmtpAccount[]
): PublicSettings {
  return {
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpSecure: settings.smtpSecure,
    smtpFromName: settings.smtpFromName,
    sendDelayMinMs: settings.sendDelayMinMs,
    sendDelayMaxMs: settings.sendDelayMaxMs,
    dailyCap: settings.dailyCap,
    dailyStep1Cap: settings.dailyStep1Cap,
    dailyFollowUpCap: settings.dailyFollowUpCap,
    hourlyCap: settings.hourlyCap,
    sendTimezone: settings.sendTimezone,
    sendStartHour: settings.sendStartHour,
    openaiModel: settings.openaiModel,
    verificationProvider: settings.verificationProvider,
    hasOpenaiKey: !!settings.openaiKey,
    hasVerificationApiKey: !!settings.verificationApiKey,
    smtpAccounts,
    smtpUser: settings.smtpUser,
    smtpFromEmail: settings.smtpFromEmail,
    hasSmtpPassword: !!settings.smtpPassword,
  }
}
