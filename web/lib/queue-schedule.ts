import prisma from '@/lib/db'
import { loadDoNotContactLeadIds } from '@/lib/lead-suppression'

export const ENGAGED_STATUSES = ['replied', 'unsubscribed'] as const
export const BLOCKED_ENGAGEMENT_STATUSES = ['replied', 'unsubscribed', 'out_of_office'] as const

export interface CampaignStepLike {
  stepOrder: number
  delayHoursAfterPrevious: number
}

export interface DueJob {
  leadId: number
  stepOrder: number
}

export interface LeadSendLike {
  leadId: number
  stepOrder: number
  sentAt: Date
  error: string | null
}

export function getMaxStepOrder(steps: CampaignStepLike[]): number {
  return Math.max(...steps.map((s) => s.stepOrder), 0)
}

export function getNextStepOrder(lastSend: { stepOrder: number } | null): number {
  return (lastSend?.stepOrder || 0) + 1
}

export function isDelayElapsed(
  lastSend: { sentAt: Date } | null,
  nextStep: CampaignStepLike,
  now = Date.now()
): boolean {
  if (!lastSend || nextStep.delayHoursAfterPrevious <= 0) return true
  const delayMs = nextStep.delayHoursAfterPrevious * 60 * 60 * 1000
  return now - new Date(lastSend.sentAt).getTime() >= delayMs
}

export function computeDueJobs(
  leadIds: number[],
  steps: CampaignStepLike[],
  lastSendsByLead: Map<number, { stepOrder: number; sentAt: Date }>,
  skippedLeadIds: Set<number>,
  blockedLeadIds: Set<number> = new Set(),
  now = Date.now()
): DueJob[] {
  if (steps.length === 0) return []

  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const jobs: DueJob[] = []

  for (const leadId of leadIds) {
    if (skippedLeadIds.has(leadId) || blockedLeadIds.has(leadId)) continue

    const last = lastSendsByLead.get(leadId)
    const nextStepOrder = getNextStepOrder(last ?? null)
    const nextStep = sorted.find((s) => s.stepOrder === nextStepOrder)
    if (!nextStep) continue

    if (last && !isDelayElapsed(last, nextStep, now)) continue

    jobs.push({ leadId, stepOrder: nextStepOrder })
  }

  return jobs.sort((a, b) => a.leadId - b.leadId || a.stepOrder - b.stepOrder)
}

export async function loadLastSuccessfulSends(
  campaignId: number,
  leadIds: number[]
): Promise<Map<number, { stepOrder: number; sentAt: Date }>> {
  const map = new Map<number, { stepOrder: number; sentAt: Date }>()
  if (leadIds.length === 0) return map

  const sends = await prisma.leadSend.findMany({
    where: {
      campaignId,
      leadId: { in: leadIds },
      error: null,
      subject: { notIn: ['SENDING', 'FAILED'] },
    },
    orderBy: { stepOrder: 'desc' },
    select: { leadId: true, stepOrder: true, sentAt: true },
  })

  for (const send of sends) {
    if (!map.has(send.leadId)) {
      map.set(send.leadId, { stepOrder: send.stepOrder, sentAt: send.sentAt })
    }
  }

  return map
}

export function getLeadQueueStatus(
  leadId: number,
  steps: CampaignStepLike[],
  lastSend: { stepOrder: number; sentAt: Date } | null,
  skippedLeadIds: Set<number>,
  blockedLeadIds: Set<number> = new Set(),
  now = Date.now()
): 'completing' | 'waiting_delay' | 'sending' | 'skipped' {
  if (skippedLeadIds.has(leadId) || blockedLeadIds.has(leadId)) return 'skipped'

  const nextStepOrder = getNextStepOrder(lastSend)
  const nextStep = steps.find((s) => s.stepOrder === nextStepOrder)
  if (!nextStep) return 'completing'

  if (lastSend && !isDelayElapsed(lastSend, nextStep, now)) return 'waiting_delay'

  return 'sending'
}

export async function loadEngagedLeadIds(
  campaignId: number,
  leadIds: number[]
): Promise<Set<number>> {
  const engaged = new Set<number>()
  if (leadIds.length === 0) return engaged

  const rows = await prisma.leadCampaignEngagement.findMany({
    where: {
      campaignId,
      leadId: { in: leadIds },
      status: { in: [...BLOCKED_ENGAGEMENT_STATUSES] },
    },
    select: { leadId: true },
  })

  for (const row of rows) engaged.add(row.leadId)
  return engaged
}

/** Campaign engagement + global do-not-contact. */
export async function loadBlockedLeadIds(
  campaignId: number,
  leadIds: number[]
): Promise<Set<number>> {
  const [engaged, dnc] = await Promise.all([
    loadEngagedLeadIds(campaignId, leadIds),
    loadDoNotContactLeadIds(leadIds),
  ])
  return new Set([...engaged, ...dnc])
}

export async function getIncompleteLeadIds(
  campaignId: number,
  validLeadIds: number[],
  maxStepOrder: number
): Promise<number[]> {
  if (validLeadIds.length === 0) return []

  const [lastSends, blocked] = await Promise.all([
    loadLastSuccessfulSends(campaignId, validLeadIds),
    loadBlockedLeadIds(campaignId, validLeadIds),
  ])

  return validLeadIds.filter((leadId) => {
    if (blocked.has(leadId)) return false
    const last = lastSends.get(leadId)
    return getNextStepOrder(last ?? null) <= maxStepOrder
  })
}

export async function countPriorCampaignContacts(
  campaignId: number,
  leadIds: number[]
): Promise<number> {
  if (leadIds.length === 0) return 0

  const rows = await prisma.leadSend.findMany({
    where: {
      leadId: { in: leadIds },
      campaignId: { not: campaignId },
      error: null,
      subject: { notIn: ['SENDING', 'FAILED'] },
    },
    select: { leadId: true },
    distinct: ['leadId'],
  })

  return rows.length
}

/** Lead IDs that already received a successful send in any other campaign. */
export async function getPriorCampaignContactLeadIds(
  campaignId: number,
  leadIds: number[]
): Promise<Set<number>> {
  if (leadIds.length === 0) return new Set()

  const rows = await prisma.leadSend.findMany({
    where: {
      leadId: { in: leadIds },
      campaignId: { not: campaignId },
      error: null,
      subject: { notIn: ['SENDING', 'FAILED'] },
    },
    select: { leadId: true },
    distinct: ['leadId'],
  })

  return new Set(rows.map((r) => r.leadId))
}
