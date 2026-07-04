import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { serializeActiveCampaigns } from '@/lib/queue-active'
import { invalidateAllCampaignStatsCache } from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await prisma.queueState.update({
      where: { id: 1 },
      data: {
        running: false,
        paused: false,
        activeCampaignId: null,
        activeLeadIdsJson: '[]',
        skippedLeadIdsJson: '[]',
        activeCampaignsJson: serializeActiveCampaigns([]),
        processingLockUntil: null,
        updatedAt: new Date(),
      },
    })
    invalidateAllCampaignStatsCache()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to stop queue:', error)
    return NextResponse.json({ error: 'Failed to stop queue' }, { status: 500 })
  }
}
