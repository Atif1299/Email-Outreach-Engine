import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { parseFewShotJson, serializeFewShotJson } from '@/lib/few-shot'
import { deactivateCampaign } from '@/lib/queue-active'
import { invalidateAllCampaignStatsCache } from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

function mapCampaign(c: {
  id: number
  name: string
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  aiInstructions: string
  outputLanguage: string
  fewShotStep1Json: string
  fewShotStep2Json: string
  createdAt: Date
  steps: Array<{
    id: number
    stepOrder: number
    delayHoursAfterPrevious: number
    subjectTemplate: string
    bodyTemplate: string
    useAi: boolean
  }>
  targetBatches: Array<{ importBatchId: number }>
}) {
  return {
    id: c.id,
    name: c.name,
    pitchBlock: c.pitchBlock,
    senderInfo: c.senderInfo,
    aiVoice: c.aiVoice,
    aiInstructions: c.aiInstructions,
    outputLanguage: c.outputLanguage,
    fewShotStep1: parseFewShotJson(c.fewShotStep1Json),
    fewShotStep2: parseFewShotJson(c.fewShotStep2Json),
    createdAt: c.createdAt.toISOString(),
    targetImportBatchIds: c.targetBatches.map((tb) => tb.importBatchId),
    steps: c.steps.map((s) => ({
      id: s.id,
      stepOrder: s.stepOrder,
      delayHoursAfterPrevious: s.delayHoursAfterPrevious,
      subjectTemplate: s.subjectTemplate,
      bodyTemplate: s.bodyTemplate,
      useAi: s.useAi,
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
        aiInstructions: body.aiInstructions,
        outputLanguage: body.outputLanguage || 'en',
        fewShotStep1Json: serializeFewShotJson(body.fewShotStep1),
        fewShotStep2Json: serializeFewShotJson(body.fewShotStep2),
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

    return NextResponse.json({ success: true })
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
