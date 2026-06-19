import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        targetBatches: true,
      },
      orderBy: { id: 'desc' }
    })

    return NextResponse.json(campaigns.map(c => ({
      id: c.id,
      name: c.name,
      pitchBlock: c.pitchBlock,
      senderInfo: c.senderInfo,
      aiVoice: c.aiVoice,
      aiInstructions: c.aiInstructions,
      createdAt: c.createdAt.toISOString(),
      targetImportBatchIds: c.targetBatches.map(tb => tb.importBatchId),
      steps: c.steps.map(s => ({
        id: s.id,
        stepOrder: s.stepOrder,
        delayHoursAfterPrevious: s.delayHoursAfterPrevious,
        subjectTemplate: s.subjectTemplate,
        bodyTemplate: s.bodyTemplate,
        useAi: s.useAi,
      })),
    })))
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
        aiInstructions: body.aiInstructions || '',
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

    return NextResponse.json({ id: campaign.id })
  } catch (error) {
    console.error('Failed to create campaign:', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}
