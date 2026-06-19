import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId, stepOrder, items } = body

    if (!campaignId || !stepOrder || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    for (const item of items) {
      await prisma.leadBodyOverride.upsert({
        where: {
          leadId_campaignId_stepOrder: {
            leadId: item.leadId,
            campaignId,
            stepOrder,
          }
        },
        create: {
          leadId: item.leadId,
          campaignId,
          stepOrder,
          subject: item.subject,
          body: item.body,
        },
        update: {
          subject: item.subject,
          body: item.body,
          updatedAt: new Date(),
        }
      })
    }

    return NextResponse.json({ success: true, saved: items.length })
  } catch (error) {
    console.error('Save overrides failed:', error)
    return NextResponse.json({ error: 'Failed to save overrides' }, { status: 500 })
  }
}
