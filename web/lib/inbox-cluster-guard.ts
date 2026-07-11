import prisma from '@/lib/db'

import type { DeliveryHaltReason } from '@/lib/verify'

const BLOCK_WINDOW_MS = 24 * 60 * 60 * 1000

/** After a single inbox block, pause follow-ups on that inbox only. */
const SINGLE_BLOCK_FOLLOW_UP_PAUSE_MS = 24 * 60 * 60 * 1000

const CLUSTER_FOLLOW_UP_PAUSE_MS = 24 * 60 * 60 * 1000

const CLUSTER_HALT_REASONS: DeliveryHaltReason[] = ['message_blocked', 'gmail_rate_limit']

type PauseableAccount = { followUpsPausedUntil?: Date | null }

/**
 * React to a Gmail block/rate-limit on one inbox.
 *
 * Single block: pause follow-ups only on the affected inbox (step 1 continues everywhere).
 * Two+ blocks in 24h: pause entire queue + global follow-up pause (cluster signal).
 */
export async function recordInboxClusterEvent(accountId: number, reason: DeliveryHaltReason) {
  if (!CLUSTER_HALT_REASONS.includes(reason)) return

  const now = new Date()
  const since = new Date(now.getTime() - BLOCK_WINDOW_MS)

  const accountPauseUntil = new Date(now.getTime() + SINGLE_BLOCK_FOLLOW_UP_PAUSE_MS)
  await prisma.smtpAccount.update({
    where: { id: accountId },
    data: { followUpsPausedUntil: accountPauseUntil },
  })

  const recentBlocks = await prisma.smtpAccount.count({
    where: {
      exhaustReason: { in: CLUSTER_HALT_REASONS },
      healthChangedAt: { gte: since },
    },
  })

  const queueUpdate: Record<string, unknown> = {
    updatedAt: now,
  }

  if (recentBlocks >= 2) {
    queueUpdate.paused = true
    queueUpdate.clusterBreakerUntil = new Date(now.getTime() + CLUSTER_FOLLOW_UP_PAUSE_MS)
    queueUpdate.followUpsPausedUntil = new Date(now.getTime() + CLUSTER_FOLLOW_UP_PAUSE_MS)
    queueUpdate.lastError =
      'Cluster protection: multiple Gmail blocks in 24h — pause sending, review deliverability, then resume.'
  }

  await prisma.queueState.update({
    where: { id: 1 },
    data: queueUpdate,
  })
}

export async function applyClusterResumeFollowUpPause() {
  const now = new Date()
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state?.clusterBreakerUntil) return

  const followUpsPausedUntil = new Date(
    Math.max(now.getTime() + CLUSTER_FOLLOW_UP_PAUSE_MS, state.followUpsPausedUntil?.getTime() ?? 0)
  )

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      clusterBreakerUntil: null,
      followUpsPausedUntil,
      updatedAt: now,
    },
  })
}

export function isAccountFollowUpsPaused(
  account: PauseableAccount | null | undefined,
  now = new Date()
): boolean {
  if (!account?.followUpsPausedUntil) return false
  return account.followUpsPausedUntil > now
}

export function isFollowUpsPaused(
  state: { followUpsPausedUntil?: Date | null; clusterBreakerUntil?: Date | null } | null,
  now = new Date()
): boolean {
  if (!state) return false
  if (state.clusterBreakerUntil && state.clusterBreakerUntil > now) return true
  if (state.followUpsPausedUntil && state.followUpsPausedUntil > now) return true
  return false
}

export type FollowUpPauseStatus = {
  /** Global queue pause or any inbox has follow-ups paused */
  paused: boolean
  /** Queue-level pause (cluster / legacy global flag) */
  globalPaused: boolean
  globalPausedUntil: Date | null
  pausedInboxCount: number
  inboxPausedUntil: Date | null
  /** Latest expiry across global + inbox pauses — for UI countdown */
  resumeAt: Date | null
}

export async function getFollowUpPauseStatus(
  state: { followUpsPausedUntil?: Date | null; clusterBreakerUntil?: Date | null } | null,
  now = new Date()
): Promise<FollowUpPauseStatus> {
  const globalPaused = isFollowUpsPaused(state, now)
  let globalPausedUntil: Date | null = null
  if (globalPaused) {
    if (state?.clusterBreakerUntil && state.clusterBreakerUntil > now) {
      globalPausedUntil = state.clusterBreakerUntil
    } else if (state?.followUpsPausedUntil && state.followUpsPausedUntil > now) {
      globalPausedUntil = state.followUpsPausedUntil
    }
  }

  const pausedInboxes = await prisma.smtpAccount.findMany({
    where: { followUpsPausedUntil: { gt: now } },
    select: { followUpsPausedUntil: true },
  })

  const pausedInboxCount = pausedInboxes.length
  const inboxPausedUntil = pausedInboxes.reduce<Date | null>((latest, row) => {
    const until = row.followUpsPausedUntil
    if (!until) return latest
    if (!latest || until > latest) return until
    return latest
  }, null)

  const resumeAt = [globalPausedUntil, inboxPausedUntil]
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

  return {
    paused: globalPaused || pausedInboxCount > 0,
    globalPaused,
    globalPausedUntil,
    pausedInboxCount,
    inboxPausedUntil,
    resumeAt,
  }
}

export function isClusterBreakerActive(
  state: { clusterBreakerUntil?: Date | null; lastError?: string | null; paused?: boolean } | null,
  now = new Date()
): boolean {
  if (!state) return false
  if (state.clusterBreakerUntil && state.clusterBreakerUntil > now) return true
  return !!(
    state.paused &&
    state.lastError?.includes('Cluster protection')
  )
}

/** Clear global and per-inbox follow-up pause (operator override). */
export async function clearFollowUpsPause() {
  const now = new Date()
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })

  const clusterStillActive =
    state?.clusterBreakerUntil != null && state.clusterBreakerUntil > now

  await prisma.$transaction([
    prisma.queueState.update({
      where: { id: 1 },
      data: {
        followUpsPausedUntil: null,
        ...(clusterStillActive ? {} : { clusterBreakerUntil: null }),
        updatedAt: now,
      },
    }),
    prisma.smtpAccount.updateMany({
      data: { followUpsPausedUntil: null },
    }),
  ])
}

/** Null out expired pause timestamps (cosmetic DB cleanup). */
export async function clearExpiredFollowUpPauses(now = new Date()) {
  await prisma.smtpAccount.updateMany({
    where: { followUpsPausedUntil: { lte: now } },
    data: { followUpsPausedUntil: null },
  })

  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state) return

  const data: Record<string, unknown> = { updatedAt: now }
  let changed = false

  if (state.followUpsPausedUntil && state.followUpsPausedUntil <= now) {
    data.followUpsPausedUntil = null
    changed = true
  }
  if (state.clusterBreakerUntil && state.clusterBreakerUntil <= now) {
    data.clusterBreakerUntil = null
    changed = true
  }

  if (changed) {
    await prisma.queueState.update({ where: { id: 1 }, data })
  }
}

export function countGmailClusterAccounts(accounts: Array<{ email: string; enabled?: boolean }>): number {
  return accounts.filter((a) => a.enabled !== false && /@gmail\.com$/i.test(a.email.trim())).length
}
