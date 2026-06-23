import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { countDoNotContactInList } from '@/lib/lead-suppression'
import {
  computeDueJobs,
  countPriorCampaignContacts,
  getMaxStepOrder,
  isDelayElapsed,
  loadBlockedLeadIds,
  loadLastSuccessfulSends,
} from '@/lib/queue-schedule'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = parseInt(searchParams.get('campaignId') || '0')

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        steps: true,
        targetBatches: true,
      },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const where: { importBatchId?: { in: number[] } } = {}
    if (campaign.targetBatches.length > 0) {
      where.importBatchId = { in: campaign.targetBatches.map((tb) => tb.importBatchId) }
    }

    const leads = await prisma.lead.findMany({ where })
    const sendable = leads.filter((l) => l.verificationStatus === 'valid').length
    const blocked = leads.length - sendable

    const validLeadIds = leads.filter((l) => l.verificationStatus === 'valid').map((l) => l.id)
    const maxStepOrder = getMaxStepOrder(campaign.steps)

    const sends = await prisma.leadSend.findMany({
      where: { campaignId, error: null, subject: { notIn: ['SENDING', 'FAILED'] } },
      select: { leadId: true, stepOrder: true },
    })

    const lastSendsByLead = await loadLastSuccessfulSends(campaignId, validLeadIds)
    const skippedLeadIds = new Set<number>()
    const blockedLeadIds = await loadBlockedLeadIds(campaignId, validLeadIds)

    const queueState = await prisma.queueState.findUnique({ where: { id: 1 } })
    if (queueState?.activeCampaignId === campaignId) {
      const skipped = JSON.parse(queueState.skippedLeadIdsJson || '[]') as number[]
      skipped.forEach((id) => skippedLeadIds.add(id))
    }

    const dueJobs = computeDueJobs(
      validLeadIds,
      campaign.steps,
      lastSendsByLead,
      skippedLeadIds,
      blockedLeadIds
    )
    const leadsStarted = lastSendsByLead.size
    const leadsCompleted = [...lastSendsByLead.values()].filter((s) => s.stepOrder >= maxStepOrder).length

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

    const isActiveCampaign = queueState?.activeCampaignId === campaignId

    const [repliedCount, unsubscribedCount, priorCampaignContacts, doNotContactExcluded] =
      await Promise.all([
        prisma.leadCampaignEngagement.count({
          where: { campaignId, status: 'replied' },
        }),
        prisma.leadCampaignEngagement.count({
          where: { campaignId, status: 'unsubscribed' },
        }),
        countPriorCampaignContacts(campaignId, validLeadIds),
        countDoNotContactInList(validLeadIds),
      ])

    return NextResponse.json({
      campaignName: campaign.name,
      isActiveCampaign,
      sendable,
      blocked,
      stepCount: campaign.steps.length,
      emailsSent: sends.length,
      leadsStarted,
      leadsCompleted,
      dueNow: dueJobs.length,
      repliedCount,
      unsubscribedCount,
      priorCampaignContacts,
      doNotContactExcluded,
      step1: { sent: step1Sent, eligible: sendable },
      followUps: { sent: followUpSent, due: followUpDue, eligible: followUpEligible },
      waitingOnDelay,
      notStarted,
      blockedEngaged,
      stepBreakdown,
    })
  } catch (error) {
    console.error('Failed to get campaign stats:', error)
    return NextResponse.json({ error: 'Failed to get campaign stats' }, { status: 500 })
  }
}
