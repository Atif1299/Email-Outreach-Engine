import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { computeCampaignQueueStats } from '@/lib/campaign-queue-stats'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = parseInt(searchParams.get('campaignId') || '0')

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    const queueState = await prisma.queueState.findUnique({ where: { id: 1 } })
    const stats = await computeCampaignQueueStats(campaignId, queueState)

    if (!stats) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('Failed to get campaign stats:', error)
    return NextResponse.json({ error: 'Failed to get campaign stats' }, { status: 500 })
  }
}
