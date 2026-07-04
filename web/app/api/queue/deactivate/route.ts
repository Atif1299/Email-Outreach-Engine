import { NextRequest, NextResponse } from 'next/server'
import { deactivateCampaign } from '@/lib/queue-active'
import { invalidateAllCampaignStatsCache } from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId } = body

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    await deactivateCampaign(parseInt(String(campaignId), 10))
    invalidateAllCampaignStatsCache()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to deactivate campaign:', error)
    return NextResponse.json({ error: 'Failed to deactivate campaign' }, { status: 500 })
  }
}
