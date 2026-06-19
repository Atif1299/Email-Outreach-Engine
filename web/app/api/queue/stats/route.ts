import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { computeDueJobs, getMaxStepOrder, loadEngagedLeadIds, loadLastSuccessfulSends } from '@/lib/queue-schedule'

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
      where: { campaignId, error: null, subject: { not: 'SENDING' } },
      select: { leadId: true, stepOrder: true },
    })

    const lastSendsByLead = await loadLastSuccessfulSends(campaignId, validLeadIds)
    const skippedLeadIds = new Set<number>()
    const engagedLeadIds = await loadEngagedLeadIds(campaignId, validLeadIds)

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
      engagedLeadIds
    )
    const leadsStarted = lastSendsByLead.size
    const leadsCompleted = [...lastSendsByLead.values()].filter((s) => s.stepOrder >= maxStepOrder).length

    const [repliedCount, unsubscribedCount] = await Promise.all([
      prisma.leadCampaignEngagement.count({
        where: { campaignId, status: 'replied' },
      }),
      prisma.leadCampaignEngagement.count({
        where: { campaignId, status: 'unsubscribed' },
      }),
    ])

    return NextResponse.json({
      sendable,
      blocked,
      stepCount: campaign.steps.length,
      emailsSent: sends.length,
      leadsStarted,
      leadsCompleted,
      dueNow: dueJobs.length,
      repliedCount,
      unsubscribedCount,
    })
  } catch (error) {
    console.error('Failed to get campaign stats:', error)
    return NextResponse.json({ error: 'Failed to get campaign stats' }, { status: 500 })
  }
}
