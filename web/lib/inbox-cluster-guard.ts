import prisma from '@/lib/db'

import type { DeliveryHaltReason } from '@/lib/verify'



const BLOCK_WINDOW_MS = 24 * 60 * 60 * 1000

/** After a single inbox block, pause follow-ups only — step 1 continues on healthy inboxes. */

const SINGLE_BLOCK_FOLLOW_UP_PAUSE_MS = 24 * 60 * 60 * 1000

const CLUSTER_FOLLOW_UP_PAUSE_MS = 24 * 60 * 60 * 1000



const CLUSTER_HALT_REASONS: DeliveryHaltReason[] = ['message_blocked', 'gmail_rate_limit']



/**

 * React to a Gmail block/rate-limit on one inbox.

 *

 * Design: isolate the failing inbox (handled in markAccountExhausted). Do NOT mark

 * sibling inboxes as recovery — they are separate accounts and should keep sending.

 * Escalate only when 2+ distinct inboxes block within 24h (true cluster signal).

 */

export async function recordInboxClusterEvent(_accountId: number, reason: DeliveryHaltReason) {

  if (!CLUSTER_HALT_REASONS.includes(reason)) return



  const now = new Date()

  const since = new Date(now.getTime() - BLOCK_WINDOW_MS)



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

  } else {

    queueUpdate.followUpsPausedUntil = new Date(now.getTime() + SINGLE_BLOCK_FOLLOW_UP_PAUSE_MS)

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


