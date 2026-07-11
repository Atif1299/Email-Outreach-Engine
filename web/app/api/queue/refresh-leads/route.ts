import { NextResponse } from 'next/server'
import { resolveLeadIdsForCampaign } from '@/lib/campaign-leads'
import { refreshActiveCampaignLeadLists } from '@/lib/queue-active'
import { invalidateAllCampaignStatsCache } from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

/** Re-resolve lead lists for all active campaigns (keeps priority / followUpsOnly / quotas). */
export async function POST() {
  try {
    const { results } = await refreshActiveCampaignLeadLists(async (campaignId) => {
      const resolved = await resolveLeadIdsForCampaign(campaignId)
      if ('error' in resolved) return { error: resolved.error }
      return { leadIds: resolved.leadIds }
    })

    invalidateAllCampaignStatsCache()

    return NextResponse.json({
      success: true,
      results,
      refreshed: results.filter((r) => r.leadCount != null).length,
    })
  } catch (error) {
    console.error('Failed to refresh queue leads:', error)
    return NextResponse.json({ error: 'Failed to refresh queue leads' }, { status: 500 })
  }
}
