import type { SmtpAccount } from '@prisma/client'
import nodemailer from 'nodemailer'
import prisma, { withDbRetry } from '@/lib/db'
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
  warmupEnabled: boolean
  lastInboxCheckedAt: string | null
  lastInboxError: string | null
}

export type AccountSendGateResult =
  | { allowed: true }
  | {
    allowed: false
    reason: 'exhausted' | 'daily_cap' | 'hourly_cap' | 'disabled' | 'no_password' | 'throttled'
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
  const existingCount = await withDbRetry((db) => db.smtpAccount.count())
  if (existingCount > 0) return

  const email = (settings.smtpFromEmail || settings.smtpUser || '').trim().toLowerCase()
  if (!email || !settings.smtpPassword) return

  await withDbRetry((db) =>
    db.smtpAccount.create({
      data: {
        email,
        password: settings.smtpPassword,
        label: 'Primary',
        enabled: true,
        sortOrder: 0,
      },
    })
  )
}

export async function ensureSmtpAccounts() {
  await migrateLegacySmtpSettings()
  return withDbRetry((db) =>
    db.smtpAccount.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  )
}

export async function getEnabledSmtpAccounts(): Promise<SmtpAccount[]> {
  await migrateLegacySmtpSettings()
  return withDbRetry((db) =>
    db.smtpAccount.findMany({
      where: { enabled: true, password: { not: '' } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
  )
}

function isExhausted(account: SmtpAccount, now = new Date()): boolean {
  return !!account.exhaustedUntil && account.exhaustedUntil > now
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function getWarmupDay(account: SmtpAccount, now = new Date()): number | null {
  if (!account.warmupEnabled || !account.warmupStartedAt) return null
  return Math.floor((now.getTime() - account.warmupStartedAt.getTime()) / MS_PER_DAY) + 1
}

export function getWarmupDailyCap(account: SmtpAccount, userDailyCap: number, now = new Date()): number {
  if (!account.warmupEnabled) return userDailyCap
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

  if (account.lastUsedAt && limitSettings.sendDelayMinMs > 0) {
    const elapsed = now.getTime() - account.lastUsedAt.getTime()
    if (elapsed < limitSettings.sendDelayMinMs) {
      return {
        allowed: false,
        reason: 'throttled',
        message: `${account.email} waiting between sends`,
      }
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

async function getBatchAccountSendCounts(
  accountIds: number[],
  limitSettings: SendLimitSettings
): Promise<Map<number, { sendsToday: number; sendsThisHour: number }>> {
  if (accountIds.length === 0) return new Map()

  const now = new Date()
  const dayStart = getDayStartInTimezone(limitSettings.sendTimezone, now)
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  const [todayCounts, hourCounts] = await Promise.all([
    prisma.leadSend.groupBy({
      by: ['smtpAccountId'],
      where: {
        smtpAccountId: { in: accountIds },
        sentAt: { gte: dayStart },
        error: null,
      },
      _count: true,
    }),
    prisma.leadSend.groupBy({
      by: ['smtpAccountId'],
      where: {
        smtpAccountId: { in: accountIds },
        sentAt: { gte: hourAgo },
        error: null,
      },
      _count: true,
    }),
  ])

  const result = new Map<number, { sendsToday: number; sendsThisHour: number }>()
  for (const id of accountIds) {
    result.set(id, { sendsToday: 0, sendsThisHour: 0 })
  }
  for (const row of todayCounts) {
    if (row.smtpAccountId == null) continue
    const entry = result.get(row.smtpAccountId)
    if (entry) entry.sendsToday = row._count
  }
  for (const row of hourCounts) {
    if (row.smtpAccountId == null) continue
    const entry = result.get(row.smtpAccountId)
    if (entry) entry.sendsThisHour = row._count
  }
  return result
}

export async function toPublicSmtpAccounts(
  accounts: SmtpAccount[],
  limitSettings: SendLimitSettings
): Promise<PublicSmtpAccount[]> {
  if (accounts.length === 0) return []
  const sendCountsMap = await getBatchAccountSendCounts(accounts.map(a => a.id), limitSettings)
  return accounts.map(account => {
    const { sendsToday, sendsThisHour } = sendCountsMap.get(account.id) ?? { sendsToday: 0, sendsThisHour: 0 }
    const warmupDay = getWarmupDay(account)
    const warmupDailyCap = account.warmupEnabled && warmupDay
      ? getWarmupDailyCap(account, limitSettings.dailyCap)
      : null
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
      warmupEnabled: account.warmupEnabled,
      lastInboxCheckedAt: account.lastInboxCheckedAt?.toISOString() ?? null,
      lastInboxError: account.lastInboxError,
    }
  })
}

export async function toPublicSmtpAccount(
  account: SmtpAccount,
  limitSettings: SendLimitSettings
): Promise<PublicSmtpAccount> {
  const results = await toPublicSmtpAccounts([account], limitSettings)
  return results[0]
}

export async function pickBestAvailableAccount(
  limitSettings: SendLimitSettings,
  excludeIds: Set<number> = new Set()
): Promise<SmtpAccount | null> {
  const accounts = await getEnabledSmtpAccounts()
  const eligible: SmtpAccount[] = []

  for (const account of accounts) {
    if (excludeIds.has(account.id)) continue
    const gate = await evaluateAccountSendGate(account, limitSettings)
    if (gate.allowed) eligible.push(account)
  }

  if (eligible.length === 0) return null

  const sendCountsMap = await getBatchAccountSendCounts(
    eligible.map((a) => a.id),
    limitSettings
  )

  const candidates = eligible.map((account) => ({
    account,
    sendsToday: sendCountsMap.get(account.id)?.sendsToday ?? 0,
  }))

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

export async function countInboxesAvailableForSend(
  limitSettings: SendLimitSettings,
  excludeIds: Set<number> = new Set()
): Promise<number> {
  const accounts = await getEnabledSmtpAccounts()
  let count = 0
  for (const account of accounts) {
    if (excludeIds.has(account.id)) continue
    const gate = await evaluateAccountSendGate(account, limitSettings)
    if (gate.allowed) count++
  }
  return count
}

/** When every inbox is spacing/capped, earliest time any inbox can send again. */
export async function getNextInboxAvailableAt(
  limitSettings: SendLimitSettings,
  excludeIds: Set<number> = new Set()
): Promise<Date | null> {
  const accounts = await getEnabledSmtpAccounts()
  const now = Date.now()
  let earliest: Date | null = null

  for (const account of accounts) {
    if (excludeIds.has(account.id)) continue
    const gate = await evaluateAccountSendGate(account, limitSettings)
    if (gate.allowed) return null
    if (gate.reason === 'throttled' && account.lastUsedAt && limitSettings.sendDelayMinMs > 0) {
      const at = account.lastUsedAt.getTime() + limitSettings.sendDelayMinMs
      if (at > now && (!earliest || at < earliest.getTime())) {
        earliest = new Date(at)
      }
    }
  }

  return earliest
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
      ...(!account?.warmupStartedAt && account?.warmupEnabled ? { warmupStartedAt: new Date() } : {}),
    },
  })
}

/** Minimal fields required to open an SMTP connection. */
export type SmtpTransportAccount = Pick<SmtpAccount, 'email' | 'password'>

export function createAccountTransporter(
  account: SmtpTransportAccount,
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

/** Brand display name for outbound mail — global fromName wins over per-inbox label. */
export function resolveSenderDisplayName(
  fromName: string,
  account: SmtpAccount,
  allAccounts?: SmtpAccount[]
): string {
  const global = fromName.trim()
  if (global) return global

  const brandAccount = allAccounts?.find((a) => /visions\s*craft/i.test(a.label))
  if (brandAccount?.label.trim()) return brandAccount.label.trim()

  return account.label.trim()
}

export function formatFromAddress(
  fromName: string,
  account: SmtpAccount,
  allAccounts?: SmtpAccount[]
): string {
  const email = account.email.trim()
  const name = resolveSenderDisplayName(fromName, account, allAccounts)
  if (!name) return email
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}" <${email}>`
}

export interface SmtpAccountInput {
  id?: number
  email: string
  password?: string
  label?: string
  enabled?: boolean
  sortOrder?: number
  warmupEnabled?: boolean
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
      warmupEnabled: a.warmupEnabled ?? false,
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
        warmupEnabled: account.warmupEnabled,
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
          warmupEnabled: account.warmupEnabled,
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
