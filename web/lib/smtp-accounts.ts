import type { SmtpAccount } from '@prisma/client'
import nodemailer from 'nodemailer'
import prisma from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import {
  countSuccessfulSendsForAccountSince,
  getDayStartInTimezone,
  type SendLimitSettings,
} from '@/lib/send-limits'
import { assertGmailSmtpUsername } from '@/lib/smtp'
import type { DeliveryHaltReason } from '@/lib/verify'

const EXHAUST_DURATION_MS: Record<DeliveryHaltReason, number> = {
  gmail_rate_limit: 2 * 60 * 60 * 1000,
  message_blocked: 24 * 60 * 60 * 1000,
  auth_failure: 24 * 60 * 60 * 1000,
}

export interface PublicSmtpAccount {
  id: number
  email: string
  label: string
  enabled: boolean
  sortOrder: number
  hasPassword: boolean
  exhaustedUntil: string | null
  exhaustReason: string | null
  sendsToday: number
  sendsThisHour: number
  warmupDay: number | null
  warmupDailyCap: number | null
  lastInboxCheckedAt: string | null
  lastInboxError: string | null
}

export type AccountSendGateResult =
  | { allowed: true }
  | {
    allowed: false
    reason: 'exhausted' | 'daily_cap' | 'hourly_cap' | 'disabled' | 'no_password'
    message: string
  }

export type ResolveAccountResult =
  | { status: 'ok'; account: SmtpAccount; newlyAssigned: boolean }
  | {
    status: 'unavailable'
    reason: 'no_accounts' | 'assigned_unavailable' | 'all_unavailable'
    message: string
  }

async function migrateLegacySmtpSettings() {
  const settings = await ensureSettings()
  const existingCount = await prisma.smtpAccount.count()
  if (existingCount > 0) return

  const email = (settings.smtpFromEmail || settings.smtpUser || '').trim().toLowerCase()
  if (!email || !settings.smtpPassword) return

  await prisma.smtpAccount.create({
    data: {
      email,
      password: settings.smtpPassword,
      label: 'Primary',
      enabled: true,
      sortOrder: 0,
    },
  })
}

export async function ensureSmtpAccounts() {
  await migrateLegacySmtpSettings()
  return prisma.smtpAccount.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
}

export async function getEnabledSmtpAccounts(): Promise<SmtpAccount[]> {
  await migrateLegacySmtpSettings()
  return prisma.smtpAccount.findMany({
    where: { enabled: true, password: { not: '' } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
}

function isExhausted(account: SmtpAccount, now = new Date()): boolean {
  return !!account.exhaustedUntil && account.exhaustedUntil > now
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function getWarmupDay(account: SmtpAccount, now = new Date()): number | null {
  if (!account.warmupStartedAt) return null
  return Math.floor((now.getTime() - account.warmupStartedAt.getTime()) / MS_PER_DAY) + 1
}

export function getWarmupDailyCap(account: SmtpAccount, userDailyCap: number, now = new Date()): number {
  if (!account.warmupStartedAt) return userDailyCap
  const day = getWarmupDay(account, now) ?? 1
  if (day <= 3) return Math.min(userDailyCap, 15)
  if (day <= 7) return Math.min(userDailyCap, 30)
  return userDailyCap
}

export async function evaluateAccountSendGate(
  account: SmtpAccount,
  limitSettings: SendLimitSettings,
  now = new Date()
): Promise<AccountSendGateResult> {
  if (!account.enabled) {
    return { allowed: false, reason: 'disabled', message: `${account.email} is disabled` }
  }
  if (!account.password) {
    return { allowed: false, reason: 'no_password', message: `${account.email} has no app password` }
  }
  if (isExhausted(account, now)) {
    return {
      allowed: false,
      reason: 'exhausted',
      message: `${account.email} cooling down until ${account.exhaustedUntil!.toISOString()}`,
    }
  }

  const dayStart = getDayStartInTimezone(limitSettings.sendTimezone, now)
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const effectiveDailyCap = getWarmupDailyCap(account, limitSettings.dailyCap, now)

  const [sendsToday, sendsThisHour] = await Promise.all([
    countSuccessfulSendsForAccountSince(account.id, dayStart),
    countSuccessfulSendsForAccountSince(account.id, hourAgo),
  ])

  if (sendsToday >= effectiveDailyCap) {
    const warmupDay = getWarmupDay(account, now)
    const warmupNote = warmupDay && warmupDay <= 7 ? ` (warmup day ${warmupDay})` : ''
    return {
      allowed: false,
      reason: 'daily_cap',
      message: `${account.email} reached daily cap (${effectiveDailyCap})${warmupNote}`,
    }
  }

  if (sendsThisHour >= limitSettings.hourlyCap) {
    return {
      allowed: false,
      reason: 'hourly_cap',
      message: `${account.email} reached hourly cap (${limitSettings.hourlyCap}/hr)`,
    }
  }

  return { allowed: true }
}

async function getAccountSendCounts(accountId: number, limitSettings: SendLimitSettings) {
  const now = new Date()
  const dayStart = getDayStartInTimezone(limitSettings.sendTimezone, now)
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const [sendsToday, sendsThisHour] = await Promise.all([
    countSuccessfulSendsForAccountSince(accountId, dayStart),
    countSuccessfulSendsForAccountSince(accountId, hourAgo),
  ])
  return { sendsToday, sendsThisHour }
}

export async function toPublicSmtpAccount(
  account: SmtpAccount,
  limitSettings: SendLimitSettings
): Promise<PublicSmtpAccount> {
  const { sendsToday, sendsThisHour } = await getAccountSendCounts(account.id, limitSettings)
  const warmupDay = getWarmupDay(account)
  const warmupDailyCap = warmupDay ? getWarmupDailyCap(account, limitSettings.dailyCap) : null
  return {
    id: account.id,
    email: account.email,
    label: account.label,
    enabled: account.enabled,
    sortOrder: account.sortOrder,
    hasPassword: !!account.password,
    exhaustedUntil: account.exhaustedUntil?.toISOString() ?? null,
    exhaustReason: account.exhaustReason,
    sendsToday,
    sendsThisHour,
    warmupDay,
    warmupDailyCap,
    lastInboxCheckedAt: account.lastInboxCheckedAt?.toISOString() ?? null,
    lastInboxError: account.lastInboxError,
  }
}

export async function pickBestAvailableAccount(
  limitSettings: SendLimitSettings,
  excludeIds: Set<number> = new Set()
): Promise<SmtpAccount | null> {
  const accounts = await getEnabledSmtpAccounts()
  const candidates: { account: SmtpAccount; sendsToday: number }[] = []

  for (const account of accounts) {
    if (excludeIds.has(account.id)) continue
    const gate = await evaluateAccountSendGate(account, limitSettings)
    if (!gate.allowed) continue
    const { sendsToday } = await getAccountSendCounts(account.id, limitSettings)
    candidates.push({ account, sendsToday })
  }

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    if (a.sendsToday !== b.sendsToday) return a.sendsToday - b.sendsToday
    const aUsed = a.account.lastUsedAt?.getTime() ?? 0
    const bUsed = b.account.lastUsedAt?.getTime() ?? 0
    if (aUsed !== bUsed) return aUsed - bUsed
    return a.account.sortOrder - b.account.sortOrder
  })

  return candidates[0].account
}

export async function hasAnySendReadyAccount(limitSettings: SendLimitSettings): Promise<boolean> {
  const picked = await pickBestAvailableAccount(limitSettings)
  return picked !== null
}

export async function getLeadSmtpAssignment(leadId: number, campaignId: number) {
  return prisma.leadSmtpAssignment.findUnique({
    where: { leadId_campaignId: { leadId, campaignId } },
    include: { smtpAccount: true },
  })
}

export async function assignLeadToAccount(leadId: number, campaignId: number, smtpAccountId: number) {
  await prisma.leadSmtpAssignment.upsert({
    where: { leadId_campaignId: { leadId, campaignId } },
    create: { leadId, campaignId, smtpAccountId },
    update: { smtpAccountId, assignedAt: new Date() },
  })
}

export async function resolveAccountForSend(opts: {
  leadId: number
  campaignId: number
  stepOrder: number
  limitSettings: SendLimitSettings
  excludeIds?: Set<number>
}): Promise<ResolveAccountResult> {
  const accounts = await getEnabledSmtpAccounts()
  if (accounts.length === 0) {
    return {
      status: 'unavailable',
      reason: 'no_accounts',
      message: 'No SMTP accounts configured — add Gmail accounts in Connect.',
    }
  }

  const assignment = await getLeadSmtpAssignment(opts.leadId, opts.campaignId)
  const excludeIds = opts.excludeIds ?? new Set<number>()

  if (assignment?.smtpAccount && opts.stepOrder > 1) {
    const account = assignment.smtpAccount
    if (!account.enabled || !account.password) {
      return {
        status: 'unavailable',
        reason: 'assigned_unavailable',
        message: `Assigned inbox ${account.email} is unavailable for follow-up — re-enable or wait for cooldown.`,
      }
    }
    const gate = await evaluateAccountSendGate(account, opts.limitSettings)
    if (!gate.allowed) {
      return {
        status: 'unavailable',
        reason: 'assigned_unavailable',
        message: gate.message,
      }
    }
    return { status: 'ok', account, newlyAssigned: false }
  }

  if (assignment?.smtpAccount && opts.stepOrder === 1) {
    const account = assignment.smtpAccount
    if (account.enabled && account.password && !excludeIds.has(account.id)) {
      const gate = await evaluateAccountSendGate(account, opts.limitSettings)
      if (gate.allowed) {
        return { status: 'ok', account, newlyAssigned: false }
      }
    }
  }

  const picked = await pickBestAvailableAccount(opts.limitSettings, excludeIds)
  if (!picked) {
    return {
      status: 'unavailable',
      reason: 'all_unavailable',
      message: 'All SMTP inboxes are at cap or cooling down — wait and resume later.',
    }
  }

  return { status: 'ok', account: picked, newlyAssigned: opts.stepOrder === 1 }
}

export async function markAccountExhausted(accountId: number, reason: DeliveryHaltReason) {
  const until = new Date(Date.now() + EXHAUST_DURATION_MS[reason])
  await prisma.smtpAccount.update({
    where: { id: accountId },
    data: {
      exhaustedUntil: until,
      exhaustReason: reason,
    },
  })
}

export async function touchAccountUsed(accountId: number) {
  const account = await prisma.smtpAccount.findUnique({ where: { id: accountId } })
  await prisma.smtpAccount.update({
    where: { id: accountId },
    data: {
      lastUsedAt: new Date(),
      ...(!account?.warmupStartedAt ? { warmupStartedAt: new Date() } : {}),
    },
  })
}

export function createAccountTransporter(
  account: SmtpAccount,
  settings: { smtpHost: string; smtpPort: number; smtpSecure: boolean }
) {
  const user = account.email.trim()
  assertGmailSmtpUsername({ host: settings.smtpHost, user })
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: { user, pass: account.password },
  })
}

export function formatFromAddress(fromName: string, account: SmtpAccount): string {
  const email = account.email.trim()
  return fromName ? `${fromName} <${email}>` : email
}

export interface SmtpAccountInput {
  id?: number
  email: string
  password?: string
  label?: string
  enabled?: boolean
  sortOrder?: number
}

export async function saveSmtpAccounts(accounts: SmtpAccountInput[]) {
  const normalized = accounts
    .map((a, index) => ({
      id: a.id,
      email: a.email.trim().toLowerCase(),
      password: a.password?.trim(),
      label: (a.label || '').trim(),
      enabled: a.enabled ?? true,
      sortOrder: a.sortOrder ?? index,
    }))
    .filter((a) => a.email)

  const keptIds = new Set<number>()

  for (const account of normalized) {
    if (account.id) {
      const update: Record<string, unknown> = {
        email: account.email,
        label: account.label,
        enabled: account.enabled,
        sortOrder: account.sortOrder,
      }
      if (account.password) update.password = account.password

      await prisma.smtpAccount.update({
        where: { id: account.id },
        data: update,
      })
      keptIds.add(account.id)
    } else {
      const created = await prisma.smtpAccount.create({
        data: {
          email: account.email,
          password: account.password || '',
          label: account.label,
          enabled: account.enabled,
          sortOrder: account.sortOrder,
        },
      })
      keptIds.add(created.id)
    }
  }

  const existing = await prisma.smtpAccount.findMany({ select: { id: true } })
  const removeIds = existing.map((a) => a.id).filter((id) => !keptIds.has(id))

  if (removeIds.length > 0) {
    await prisma.smtpAccount.updateMany({
      where: { id: { in: removeIds } },
      data: { enabled: false },
    })
  }
}
