import prisma from '@/lib/db'

export interface SendLimitSettings {
  sendDelayMinMs: number
  sendDelayMaxMs: number
  dailyCap: number
  hourlyCap: number
  sendTimezone: string
  sendStartHour: number
}

export type SendGateResult =
  | { allowed: true }
  | {
    allowed: false
    status: 'throttled' | 'outside_window' | 'daily_cap' | 'hourly_cap'
    message: string
    nextSendAllowedAt?: Date
    sendsToday?: number
    sendsThisHour?: number
    cap?: number
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

export async function countSuccessfulSendsSince(since: Date): Promise<number> {
  return prisma.leadSend.count({
    where: {
      sentAt: { gte: since },
      error: null,
      subject: { not: 'SENDING' },
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

export async function evaluateSendGate(
  settings: SendLimitSettings,
  nextSendAllowedAt: Date | null | undefined,
  now = new Date()
): Promise<SendGateResult> {
  if (nextSendAllowedAt && now < nextSendAllowedAt) {
    return {
      allowed: false,
      status: 'throttled',
      message: `Waiting between sends — next email after ${nextSendAllowedAt.toISOString()}`,
      nextSendAllowedAt,
    }
  }

  if (!isWithinSendWindow(settings, now)) {
    return {
      allowed: false,
      status: 'outside_window',
      message: `Outside send window — resumes daily at ${formatResumeTime(settings)}`,
    }
  }

  const dayStart = getDayStartInTimezone(settings.sendTimezone, now)
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  const [sendsToday, sendsThisHour] = await Promise.all([
    countSuccessfulSendsSince(dayStart),
    countSuccessfulSendsSince(hourAgo),
  ])

  if (sendsToday >= settings.dailyCap) {
    return {
      allowed: false,
      status: 'daily_cap',
      message: `Daily cap (${settings.dailyCap}) reached — remaining leads continue tomorrow at ${formatResumeTime(settings)}`,
      sendsToday,
      cap: settings.dailyCap,
    }
  }

  if (sendsThisHour >= settings.hourlyCap) {
    const oldest = await getOldestSendSince(hourAgo)
    const nextSendAllowedAt = oldest
      ? new Date(oldest.sentAt.getTime() + 60 * 60 * 1000)
      : new Date(now.getTime() + 15 * 60 * 1000)

    return {
      allowed: false,
      status: 'hourly_cap',
      message: `Hourly cap (${settings.hourlyCap}/hr) reached — pausing until next slot`,
      sendsThisHour,
      cap: settings.hourlyCap,
      nextSendAllowedAt,
    }
  }

  return { allowed: true }
}

export function toSendLimitSettings(settings: {
  sendDelayMinMs: number
  sendDelayMaxMs: number
  dailyCap: number
  hourlyCap: number
  sendTimezone: string
  sendStartHour: number
}): SendLimitSettings {
  return {
    sendDelayMinMs: settings.sendDelayMinMs,
    sendDelayMaxMs: settings.sendDelayMaxMs,
    dailyCap: settings.dailyCap,
    hourlyCap: settings.hourlyCap,
    sendTimezone: settings.sendTimezone || 'Asia/Karachi',
    sendStartHour: settings.sendStartHour ?? 12,
  }
}
