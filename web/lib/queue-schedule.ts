import prisma from '@/lib/db'

export const ENGAGED_STATUSES = ['replied', 'unsubscribed'] as const

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
  engagedLeadIds: Set<number> = new Set(),
  now = Date.now()
): DueJob[] {
  if (steps.length === 0) return []

  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const maxStep = getMaxStepOrder(sorted)
  const jobs: DueJob[] = []

  for (const leadId of leadIds) {
    if (skippedLeadIds.has(leadId) || engagedLeadIds.has(leadId)) continue

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
    where: { campaignId, leadId: { in: leadIds }, error: null },
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
  engagedLeadIds: Set<number> = new Set(),
  now = Date.now()
): 'completing' | 'waiting_delay' | 'sending' | 'skipped' {
  if (skippedLeadIds.has(leadId) || engagedLeadIds.has(leadId)) return 'skipped'

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
      status: { in: [...ENGAGED_STATUSES] },
    },
    select: { leadId: true },
  })

  for (const row of rows) engaged.add(row.leadId)
  return engaged
}

export async function getIncompleteLeadIds(
  campaignId: number,
  validLeadIds: number[],
  maxStepOrder: number
): Promise<number[]> {
  if (validLeadIds.length === 0) return []

  const [lastSends, engaged] = await Promise.all([
    loadLastSuccessfulSends(campaignId, validLeadIds),
    loadEngagedLeadIds(campaignId, validLeadIds),
  ])

  return validLeadIds.filter((leadId) => {
    if (engaged.has(leadId)) return false
    const last = lastSends.get(leadId)
    return getNextStepOrder(last ?? null) <= maxStepOrder
  })
}
