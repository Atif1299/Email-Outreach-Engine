import prisma from '@/lib/db'
import type { DeliveryHaltReason } from '@/lib/verify'

const BLOCK_WINDOW_MS = 24 * 60 * 60 * 1000
const OTHER_INBOX_RECOVERY_MS = 48 * 60 * 60 * 1000
const FOLLOW_UP_PAUSE_MS = 72 * 60 * 60 * 1000
const CLUSTER_FOLLOW_UP_PAUSE_MS = 24 * 60 * 60 * 1000

const CLUSTER_HALT_REASONS: DeliveryHaltReason[] = ['message_blocked', 'gmail_rate_limit']

export async function recordInboxClusterEvent(accountId: number, reason: DeliveryHaltReason) {
  if (!CLUSTER_HALT_REASONS.includes(reason)) return

  const now = new Date()
  const followUpsPausedUntil = new Date(now.getTime() + FOLLOW_UP_PAUSE_MS)

  await prisma.smtpAccount.updateMany({
    where: {
      id: { not: accountId },
      enabled: true,
    },
    data: {
      healthStatus: 'recovery',
      healthChangedAt: now,
      recoveryUntil: new Date(now.getTime() + OTHER_INBOX_RECOVERY_MS),
      warmupEnabled: true,
    },
  })

  const since = new Date(now.getTime() - BLOCK_WINDOW_MS)
  const recentBlocks = await prisma.smtpAccount.count({
    where: {
      exhaustReason: { in: CLUSTER_HALT_REASONS },
      healthChangedAt: { gte: since },
    },
  })

  const queueUpdate: Record<string, unknown> = {
    followUpsPausedUntil,
    updatedAt: now,
  }

  if (recentBlocks >= 2) {
    queueUpdate.paused = true
    queueUpdate.clusterBreakerUntil = new Date(now.getTime() + CLUSTER_FOLLOW_UP_PAUSE_MS)
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

export function isFollowUpsPaused(
  state: { followUpsPausedUntil?: Date | null; clusterBreakerUntil?: Date | null } | null,
  now = new Date()
): boolean {
  if (!state) return false
  if (state.clusterBreakerUntil && state.clusterBreakerUntil > now) return true
  if (state.followUpsPausedUntil && state.followUpsPausedUntil > now) return true
  return false
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

export function countGmailClusterAccounts(accounts: Array<{ email: string; enabled?: boolean }>): number {
  return accounts.filter((a) => a.enabled !== false && /@gmail\.com$/i.test(a.email.trim())).length
}
