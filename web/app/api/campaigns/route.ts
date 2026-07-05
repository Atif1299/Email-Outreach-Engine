import { NextRequest, NextResponse } from 'next/server'
import prisma, { withDbRetry } from '@/lib/db'
import { normalizeBodyFormat } from '@/lib/email-html'

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

export async function GET() {
  try {
    const campaigns = await withDbRetry((db) =>
      db.campaign.findMany({
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          targetBatches: true,
        },
        orderBy: { id: 'desc' },
      })
    )

    return NextResponse.json(campaigns.map(mapCampaign))
  } catch (error) {
    console.error('Failed to list campaigns:', error)
    return NextResponse.json({ error: 'Failed to list campaigns' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        pitchBlock: body.pitchBlock || '',
        senderInfo: body.senderInfo || '',
        aiVoice: body.aiVoice || 'founder',
        outputLanguage: body.outputLanguage || 'en',
      }
    })

    // Create steps
    if (body.steps && body.steps.length > 0) {
      await prisma.campaignStep.createMany({
        data: body.steps.map((s: any, i: number) => ({
          campaignId: campaign.id,
          stepOrder: s.stepOrder || i + 1,
          delayHoursAfterPrevious: s.delayHoursAfterPrevious || 0,
          subjectTemplate: s.subjectTemplate || '',
          bodyTemplate: s.bodyTemplate || '',
          useAi: s.useAi ?? true,
          bodyFormat: normalizeBodyFormat(s.bodyFormat),
        }))
      })
    }

    // Link target batches
    if (body.targetImportBatchIds && body.targetImportBatchIds.length > 0) {
      await prisma.campaignTargetBatch.createMany({
        data: body.targetImportBatchIds.map((batchId: number) => ({
          campaignId: campaign.id,
          importBatchId: batchId,
        }))
      })
    }

    const created = await prisma.campaign.findUnique({
      where: { id: campaign.id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        targetBatches: true,
      },
    })

    if (!created) {
      return NextResponse.json({ error: 'Campaign not found after create' }, { status: 404 })
    }

    return NextResponse.json(mapCampaign(created))
  } catch (error) {
    console.error('Failed to create campaign:', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}
