import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { normalizeBodyFormat } from '@/lib/email-html'
import { deactivateCampaign } from '@/lib/queue-active'
import { invalidateAllCampaignStatsCache } from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

function mapCampaign(c: {
  id: number
  name: string
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  outputLanguage: string
  createdAt: Date
  steps: Array<{
    id: number
    stepOrder: number
    delayHoursAfterPrevious: number
    subjectTemplate: string
    bodyTemplate: string
    useAi: boolean
    bodyFormat: string
  }>
  targetBatches: Array<{ importBatchId: number }>
}) {
  return {
    id: c.id,
    name: c.name,
    pitchBlock: c.pitchBlock,
    senderInfo: c.senderInfo,
    aiVoice: c.aiVoice,
    outputLanguage: c.outputLanguage,
    createdAt: c.createdAt.toISOString(),
    targetImportBatchIds: c.targetBatches.map((tb) => tb.importBatchId),
    steps: c.steps.map((s) => ({
      id: s.id,
      stepOrder: s.stepOrder,
      delayHoursAfterPrevious: s.delayHoursAfterPrevious,
      subjectTemplate: s.subjectTemplate,
      bodyTemplate: s.bodyTemplate,
      useAi: s.useAi,
      bodyFormat: normalizeBodyFormat(s.bodyFormat),
    })),
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        targetBatches: true,
      }
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json(mapCampaign(campaign))
  } catch (error) {
    console.error('Failed to get campaign:', error)
    return NextResponse.json({ error: 'Failed to get campaign' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    const body = await request.json()

    await prisma.campaign.update({
      where: { id },
      data: {
        name: body.name,
        pitchBlock: body.pitchBlock,
        senderInfo: body.senderInfo,
        aiVoice: body.aiVoice,
        outputLanguage: body.outputLanguage || 'en',
      }
    })

    // Update steps - delete existing and recreate
    await prisma.campaignStep.deleteMany({ where: { campaignId: id } })
    if (body.steps && body.steps.length > 0) {
      await prisma.campaignStep.createMany({
        data: body.steps.map((s: any, i: number) => ({
          campaignId: id,
          stepOrder: s.stepOrder || i + 1,
          delayHoursAfterPrevious: s.delayHoursAfterPrevious || 0,
          subjectTemplate: s.subjectTemplate || '',
          bodyTemplate: s.bodyTemplate || '',
          useAi: s.useAi ?? true,
          bodyFormat: normalizeBodyFormat(s.bodyFormat),
        }))
      })
    }

    // Update target batches
    await prisma.campaignTargetBatch.deleteMany({ where: { campaignId: id } })
    if (body.targetImportBatchIds && body.targetImportBatchIds.length > 0) {
      await prisma.campaignTargetBatch.createMany({
        data: body.targetImportBatchIds.map((batchId: number) => ({
          campaignId: id,
          importBatchId: batchId,
        }))
      })
    }

    const updated = await prisma.campaign.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        targetBatches: true,
      },
    })

    if (!updated) {
      return NextResponse.json({ error: 'Campaign not found after update' }, { status: 404 })
    }

    return NextResponse.json(mapCampaign(updated))
  } catch (error) {
    console.error('Failed to update campaign:', error)
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    await deactivateCampaign(id)
    await prisma.campaign.delete({ where: { id } })
    invalidateAllCampaignStatsCache()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete campaign:', error)
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 })
  }
}
