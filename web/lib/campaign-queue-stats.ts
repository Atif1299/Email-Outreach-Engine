import prisma from '@/lib/db'
import { countDoNotContactInList } from '@/lib/lead-suppression'
import {
  findActiveEntry,
  isCampaignActive,
  type QueueStateLike,
} from '@/lib/queue-active'
import { withPrismaRetry } from '@/lib/prisma-retry'
import {
  computeDueJobs,
  countPriorCampaignContacts,
  getMaxStepOrder,
  isDelayElapsed,
  loadBlockedLeadIds,
  loadLastSuccessfulSends,
} from '@/lib/queue-schedule'

export async function computeCampaignQueueStats(
  campaignId: number,
  queueState: QueueStateLike | null
) {
  return withPrismaRetry(() => computeCampaignQueueStatsInner(campaignId, queueState))
}

async function computeCampaignQueueStatsInner(
  campaignId: number,
  queueState: QueueStateLike | null
) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      steps: true,
      targetBatches: true,
    },
  })

  if (!campaign) return null

  const where: { importBatchId?: { in: number[] } } = {}
  if (campaign.targetBatches.length > 0) {
    where.importBatchId = { in: campaign.targetBatches.map((tb) => tb.importBatchId) }
  }

  const leads = await prisma.lead.findMany({
    where,
    select: { id: true, verificationStatus: true },
  })
  const sendable = leads.filter((l) => l.verificationStatus === 'valid').length
  const blocked = leads.length - sendable

  const validLeadIds = leads.filter((l) => l.verificationStatus === 'valid').map((l) => l.id)
  const maxStepOrder = getMaxStepOrder(campaign.steps)

  const sends = await prisma.leadSend.findMany({
    where: { campaignId, error: null, subject: { notIn: ['SENDING', 'FAILED'] } },
    select: { leadId: true, stepOrder: true },
  })

  const lastSendsByLead = await loadLastSuccessfulSends(campaignId, validLeadIds)
  const blockedLeadIds = await loadBlockedLeadIds(campaignId, validLeadIds)

  const activeEntry = findActiveEntry(queueState, campaignId)
  const skippedLeadIds = new Set<number>()
  if (activeEntry) {
    activeEntry.skippedLeadIds.forEach((id) => skippedLeadIds.add(id))
  }

  const isActiveInQueue = isCampaignActive(queueState, campaignId)
  /** Due-now counts only leads still in the running queue session; all other metrics are campaign-wide. */
  const schedulingLeadIds =
    isActiveInQueue && activeEntry && activeEntry.leadIds.length > 0
      ? activeEntry.leadIds
      : validLeadIds

  const lastSendsForScheduling = new Map<number, { stepOrder: number; sentAt: Date }>()
  for (const leadId of schedulingLeadIds) {
    const last = lastSendsByLead.get(leadId)
    if (last) lastSendsForScheduling.set(leadId, last)
  }

  const blockedForScheduling = await loadBlockedLeadIds(campaignId, schedulingLeadIds)

  const dueJobs = computeDueJobs(
    schedulingLeadIds,
    campaign.steps,
    lastSendsForScheduling,
    skippedLeadIds,
    blockedForScheduling
  )

  const leadsStarted = new Set(sends.map((s) => s.leadId)).size
  const leadsCompleted = validLeadIds.filter((id) => {
    const s = lastSendsByLead.get(id)
    return s != null && s.stepOrder >= maxStepOrder
  }).length
  const queueRemaining =
    isActiveInQueue && activeEntry ? activeEntry.leadIds.length : 0

  const sendsByStep = new Map<number, number>()
  for (const send of sends) {
    sendsByStep.set(send.stepOrder, (sendsByStep.get(send.stepOrder) || 0) + 1)
  }

  const dueByStep = new Map<number, number>()
  for (const job of dueJobs) {
    dueByStep.set(job.stepOrder, (dueByStep.get(job.stepOrder) || 0) + 1)
  }

  const sortedSteps = [...campaign.steps].sort((a, b) => a.stepOrder - b.stepOrder)
  let waitingOnDelay = 0
  let notStarted = 0
  let followUpEligible = 0

  for (const leadId of validLeadIds) {
    if (blockedLeadIds.has(leadId) || skippedLeadIds.has(leadId)) continue

    const last = lastSendsByLead.get(leadId)
    if (!last) {
      notStarted++
      continue
    }

    if (last.stepOrder >= maxStepOrder) continue

    if (last.stepOrder >= 1) followUpEligible++

    const nextStepOrder = last.stepOrder + 1
    const nextStep = sortedSteps.find((s) => s.stepOrder === nextStepOrder)
    if (nextStep && !isDelayElapsed(last, nextStep)) {
      waitingOnDelay++
    }
  }

  const step1Sent = sendsByStep.get(1) || 0
  const followUpSent = sends.filter((s) => s.stepOrder > 1).length
  const followUpDue = dueJobs.filter((j) => j.stepOrder > 1).length
  const blockedEngaged = blockedLeadIds.size

  const stepBreakdown = sortedSteps.map((step) => ({
    stepOrder: step.stepOrder,
    label: step.stepOrder === 1 ? 'Step 1' : `Follow-up ${step.stepOrder - 1}`,
    sent: sendsByStep.get(step.stepOrder) || 0,
    due: dueByStep.get(step.stepOrder) || 0,
  }))

  const [repliedCount, unsubscribedCount, outOfOfficeCount, priorCampaignContacts, doNotContactExcluded, openedCount] =
    await Promise.all([
      prisma.leadCampaignEngagement.count({
        where: { campaignId, status: 'replied' },
      }),
      prisma.leadCampaignEngagement.count({
        where: { campaignId, status: 'unsubscribed' },
      }),
      prisma.leadCampaignEngagement.count({
        where: { campaignId, status: 'out_of_office' },
      }),
      countPriorCampaignContacts(campaignId, validLeadIds),
      countDoNotContactInList(validLeadIds),
      prisma.leadSend.count({
        where: {
          campaignId,
          openedAt: { not: null },
          error: null,
          subject: { notIn: ['SENDING', 'FAILED'] },
        },
      }),
    ])

  return {
    campaignId,
    campaignName: campaign.name,
    isActiveCampaign: isCampaignActive(queueState, campaignId),
    sendable,
    blocked,
    stepCount: campaign.steps.length,
    emailsSent: sends.length,
    leadsStarted,
    leadsCompleted,
    queueRemaining,
    dueNow: dueJobs.length,
    repliedCount,
    unsubscribedCount,
    outOfOfficeCount,
    priorCampaignContacts,
    doNotContactExcluded,
    step1: { sent: step1Sent, eligible: sendable },
    followUps: { sent: followUpSent, due: followUpDue, eligible: followUpEligible },
    waitingOnDelay,
    notStarted,
    blockedEngaged,
    stepBreakdown,
    openedCount,
  }
}
