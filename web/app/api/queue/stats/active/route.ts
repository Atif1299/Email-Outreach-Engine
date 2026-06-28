import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getActiveCampaignIds } from '@/lib/queue-active'
import { computeCampaignQueueStats } from '@/lib/campaign-queue-stats'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const queueState = await prisma.queueState.findUnique({ where: { id: 1 } })
    const campaignIds = getActiveCampaignIds(queueState)

    const stats = await Promise.all(
      campaignIds.map((id) => computeCampaignQueueStats(id, queueState))
    )

    return NextResponse.json({
      campaigns: stats.filter(Boolean),
      aggregateDueNow: stats.reduce((sum, s) => sum + (s?.dueNow ?? 0), 0),
    })
  } catch (error) {
    console.error('Failed to get active campaign stats:', error)
    return NextResponse.json({ error: 'Failed to get active campaign stats' }, { status: 500 })
  }
}
