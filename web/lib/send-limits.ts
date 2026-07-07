import prisma from '@/lib/db'

export interface SendLimitSettings {
  sendDelayMinMs: number
  sendDelayMaxMs: number
  dailyCap: number
  dailyStep1Cap: number
  dailyFollowUpCap: number
  maxFollowUpRatio: number
  hourlyCap: number
  sendTimezone: string
  sendStartHour: number
}

export type SendGateResult =
  | { allowed: true }
  | {
    allowed: false
    status: 'throttled' | 'outside_window' | 'daily_cap' | 'hourly_cap' | 'step1_cap' | 'follow_up_cap'
    message: string
    nextSendAllowedAt?: Date
    sendsToday?: number
    sendsThisHour?: number
    cap?: number
  }

export function isStepTypeCapsEnabled(settings: SendLimitSettings): boolean {
  return settings.dailyStep1Cap > 0 && settings.dailyFollowUpCap > 0
}

function resolveDefaultStepCaps(dailyCap: number, enabledAccountCount: number) {
  const total = dailyCap * Math.max(enabledAccountCount, 1)
  const dailyStep1Cap = Math.floor(total * 0.7)
  const dailyFollowUpCap = total - dailyStep1Cap
  return { dailyStep1Cap, dailyFollowUpCap }
}

export function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const p of formatter.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const hourRaw = parts.hour === '24' ? '0' : parts.hour
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(hourRaw),
    minute: Number(parts.minute),
  }
}

/** Midnight in the given IANA timezone, as a UTC instant. */
export function getDayStartInTimezone(timeZone: string, now = new Date()): Date {
  const { year, month, day } = getZonedParts(now, timeZone)
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  const guessDate = new Date(utcGuess)
  const offset =
    new Date(guessDate.toLocaleString('en-US', { timeZone })).getTime() -
    new Date(guessDate.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  return new Date(utcGuess - offset)
}

export function isWithinSendWindow(settings: SendLimitSettings, now = new Date()): boolean {
  const { hour } = getZonedParts(now, settings.sendTimezone)
  return hour >= settings.sendStartHour
}

export function formatResumeTime(settings: SendLimitSettings): string {
  const h = settings.sendStartHour
  const suffix = h >= 12 ? 'PM' : 'AM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${suffix} (${settings.sendTimezone})`
}

/** Mostly 1–3 min, occasionally up to max (4 min by default). */
export function computeSendDelayMs(settings: SendLimitSettings): number {
  const min = Math.min(settings.sendDelayMinMs, settings.sendDelayMaxMs)
  const max = Math.max(settings.sendDelayMinMs, settings.sendDelayMaxMs)
  if (max <= 0) return 0

  const threeMinCap = min + 3 * 60_000
  const usualMax = Math.min(threeMinCap, max)

  if (Math.random() < 0.8 || max <= usualMax) {
    return Math.floor(Math.random() * (usualMax - min + 1)) + min
  }
  return Math.floor(Math.random() * (max - usualMax + 1)) + usualMax
}

export type SendCountFilter = {
  smtpAccountId?: number
  campaignIds?: number[]
  stepOrder?: number
}

function normalizeSendCountFilter(filter?: number | SendCountFilter): SendCountFilter | undefined {
  if (filter === undefined) return undefined
  return typeof filter === 'number' ? { smtpAccountId: filter } : filter
}

export async function countSuccessfulSendsSince(
  since: Date,
  filter?: number | SendCountFilter
): Promise<number> {
  const opts = normalizeSendCountFilter(filter)
  return prisma.leadSend.count({
    where: {
      sentAt: { gte: since },
      error: null,
      subject: { notIn: ['SENDING', 'FAILED'] },
      ...(opts?.smtpAccountId ? { smtpAccountId: opts.smtpAccountId } : {}),
      ...(opts?.campaignIds?.length ? { campaignId: { in: opts.campaignIds } } : {}),
      ...(opts?.stepOrder !== undefined ? { stepOrder: opts.stepOrder } : {}),
    },
  })
}

export async function countSuccessfulSendsSinceByStepType(
  since: Date,
  opts: { isFollowUp: boolean }
): Promise<number> {
  return prisma.leadSend.count({
    where: {
      sentAt: { gte: since },
      error: null,
      subject: { notIn: ['SENDING', 'FAILED'] },
      stepOrder: opts.isFollowUp ? { gt: 1 } : 1,
    },
  })
}

export async function countSuccessfulSendsForAccountSince(
  smtpAccountId: number,
  since: Date
): Promise<number> {
  return countSuccessfulSendsSince(since, smtpAccountId)
}

export async function countFailedSendsSince(
  since: Date,
  filter?: Pick<SendCountFilter, 'campaignIds'>
): Promise<number> {
  return prisma.leadSend.count({
    where: {
      sentAt: { gte: since },
      subject: 'FAILED',
      ...(filter?.campaignIds?.length ? { campaignId: { in: filter.campaignIds } } : {}),
    },
  })
}

export async function getOldestSendSince(since: Date) {
  return prisma.leadSend.findFirst({
    where: {
      sentAt: { gte: since },
      error: null,
      subject: { not: 'SENDING' },
    },
    orderBy: { sentAt: 'asc' },
    select: { sentAt: true },
  })
}

export async function getStepTypeSendCounts(settings: SendLimitSettings, now = new Date()) {
  const dayStart = getDayStartInTimezone(settings.sendTimezone, now)
  const [step1SentToday, followUpSentToday] = await Promise.all([
    countSuccessfulSendsSinceByStepType(dayStart, { isFollowUp: false }),
    countSuccessfulSendsSinceByStepType(dayStart, { isFollowUp: true }),
  ])
  return { step1SentToday, followUpSentToday }
}

export function isStepTypeCapAvailable(
  settings: SendLimitSettings,
  stepOrder: number,
  counts: { step1SentToday: number; followUpSentToday: number }
): boolean {
  if (!isStepTypeCapsEnabled(settings)) return true
  if (stepOrder <= 1) {
    return settings.dailyStep1Cap <= 0 || counts.step1SentToday < settings.dailyStep1Cap
  }
  return settings.dailyFollowUpCap <= 0 || counts.followUpSentToday < settings.dailyFollowUpCap
}

export async function evaluateStepTypeDailyCap(
  settings: SendLimitSettings,
  stepOrder: number,
  counts?: { step1SentToday: number; followUpSentToday: number },
  now = new Date()
): Promise<SendGateResult> {
  if (!isStepTypeCapsEnabled(settings)) return { allowed: true }

  const { step1SentToday, followUpSentToday } =
    counts ?? (await getStepTypeSendCounts(settings, now))

  if (stepOrder <= 1 && settings.dailyStep1Cap > 0 && step1SentToday >= settings.dailyStep1Cap) {
    return {
      allowed: false,
      status: 'step1_cap',
      message: `Step 1 daily cap (${settings.dailyStep1Cap}) reached — remaining Step 1 leads continue tomorrow at ${formatResumeTime(settings)}`,
      sendsToday: step1SentToday,
      cap: settings.dailyStep1Cap,
    }
  }

  if (stepOrder > 1 && settings.dailyFollowUpCap > 0 && followUpSentToday >= settings.dailyFollowUpCap) {
    return {
      allowed: false,
      status: 'follow_up_cap',
      message: `Follow-up daily cap (${settings.dailyFollowUpCap}) reached — remaining follow-ups continue tomorrow at ${formatResumeTime(settings)}`,
      sendsToday: followUpSentToday,
      cap: settings.dailyFollowUpCap,
    }
  }

  if (stepOrder > 1 && settings.maxFollowUpRatio > 0) {
    const ratio = followUpSentToday / Math.max(step1SentToday, 1)
    if (ratio > settings.maxFollowUpRatio) {
      return {
        allowed: false,
        status: 'follow_up_cap',
        message: `Follow-up ratio cap (${Math.round(settings.maxFollowUpRatio * 100)}% of step-1 sends) reached for today`,
        sendsToday: followUpSentToday,
        cap: Math.floor(step1SentToday * settings.maxFollowUpRatio),
      }
    }
  }

  return { allowed: true }
}

export async function evaluateSendGate(
  settings: SendLimitSettings,
  _nextSendAllowedAt?: Date | null,
  now = new Date()
): Promise<SendGateResult> {
  if (!isWithinSendWindow(settings, now)) {
    return {
      allowed: false,
      status: 'outside_window',
      message: `Outside send window — resumes daily at ${formatResumeTime(settings)}`,
    }
  }

  return { allowed: true }
}

/** Global cap check: true only when every enabled inbox is at its per-inbox daily cap. */
export async function evaluateGlobalDailyCap(
  settings: SendLimitSettings,
  enabledAccountCount: number,
  now = new Date()
): Promise<SendGateResult> {
  if (enabledAccountCount <= 0) {
    return {
      allowed: false,
      status: 'daily_cap',
      message: 'No SMTP accounts configured',
      cap: settings.dailyCap,
      sendsToday: 0,
    }
  }

  const dayStart = getDayStartInTimezone(settings.sendTimezone, now)
  const sendsToday = await countSuccessfulSendsSince(dayStart)
  const effectiveDailyCap = settings.dailyCap * enabledAccountCount

  if (sendsToday >= effectiveDailyCap) {
    return {
      allowed: false,
      status: 'daily_cap',
      message: `Combined daily cap (${effectiveDailyCap}) reached — remaining leads continue tomorrow at ${formatResumeTime(settings)}`,
      sendsToday,
      cap: effectiveDailyCap,
    }
  }

  return { allowed: true }
}

export function toSendLimitSettings(
  settings: {
    sendDelayMinMs: number
    sendDelayMaxMs: number
    dailyCap: number
    dailyStep1Cap?: number
    dailyFollowUpCap?: number
    maxFollowUpRatio?: number
    hourlyCap: number
    sendTimezone: string
    sendStartHour: number
  },
  enabledAccountCount = 1
): SendLimitSettings {
  let dailyStep1Cap = settings.dailyStep1Cap ?? 0
  let dailyFollowUpCap = settings.dailyFollowUpCap ?? 0
  if (dailyStep1Cap <= 0 && dailyFollowUpCap <= 0) {
    const defaults = resolveDefaultStepCaps(settings.dailyCap, enabledAccountCount)
    dailyStep1Cap = defaults.dailyStep1Cap
    dailyFollowUpCap = defaults.dailyFollowUpCap
  }
  return {
    sendDelayMinMs: settings.sendDelayMinMs,
    sendDelayMaxMs: settings.sendDelayMaxMs,
    dailyCap: settings.dailyCap,
    dailyStep1Cap,
    dailyFollowUpCap,
    maxFollowUpRatio: settings.maxFollowUpRatio ?? 0.4,
    hourlyCap: settings.hourlyCap,
    sendTimezone: settings.sendTimezone || 'Asia/Karachi',
    sendStartHour: settings.sendStartHour ?? 12,
  }
}
