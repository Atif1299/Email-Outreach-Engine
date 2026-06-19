import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getIncompleteLeadIds, getMaxStepOrder } from '@/lib/queue-schedule'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId, force } = body

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    const existing = await prisma.queueState.findUnique({ where: { id: 1 } })
    if (existing?.running && !force) {
      if (existing.activeCampaignId === campaignId) {
        return NextResponse.json(
          { error: 'Queue is already running for this campaign' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'Queue is already running for another campaign. Stop it first or use force: true.' },
        { status: 409 }
      )
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { targetBatches: true, steps: true },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (campaign.steps.length === 0) {
      return NextResponse.json({ error: 'Campaign has no steps' }, { status: 400 })
    }

    const where: { verificationStatus: string; importBatchId?: { in: number[] } } = {
      verificationStatus: 'valid',
    }
    if (campaign.targetBatches.length > 0) {
      where.importBatchId = { in: campaign.targetBatches.map((tb) => tb.importBatchId) }
    }

    const leads = await prisma.lead.findMany({ where, select: { id: true } })
    const validLeadIds = leads.map((l) => l.id)
    const maxStepOrder = getMaxStepOrder(campaign.steps)
    const leadIds = await getIncompleteLeadIds(campaignId, validLeadIds, maxStepOrder)

    if (leadIds.length === 0) {
      return NextResponse.json({ error: 'No sendable leads remaining for this campaign' }, { status: 400 })
    }

    await prisma.queueState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        running: true,
        paused: false,
        activeCampaignId: campaignId,
        activeLeadIdsJson: JSON.stringify(leadIds),
        skippedLeadIdsJson: '[]',
        processedInSession: 0,
        failedInSession: 0,
        consecutiveFailures: 0,
        lastError: null,
        processingLockUntil: null,
        nextSendAllowedAt: null,
      },
      update: {
        running: true,
        paused: false,
        activeCampaignId: campaignId,
        activeLeadIdsJson: JSON.stringify(leadIds),
        skippedLeadIdsJson: '[]',
        processedInSession: 0,
        failedInSession: 0,
        consecutiveFailures: 0,
        lastError: null,
        processingLockUntil: null,
        nextSendAllowedAt: null,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true, leadCount: leadIds.length })
  } catch (error) {
    console.error('Failed to start queue:', error)
    return NextResponse.json({ error: 'Failed to start queue' }, { status: 500 })
  }
}
