import { NextRequest, NextResponse } from 'next/server'
import { updateActiveCampaignOptions } from '@/lib/queue-active'

export const dynamic = 'force-dynamic'

/** Update per-campaign queue options (priority, followUpsOnly, dailyStep1Quota). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const campaignId = parseInt(String(body.campaignId), 10)
    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    const opts: {
      priority?: number
      followUpsOnly?: boolean
      dailyStep1Quota?: number | null
    } = {}

    if (body.priority !== undefined) {
      const priority = parseInt(String(body.priority), 10)
      if (!Number.isFinite(priority)) {
        return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
      }
      opts.priority = priority
    }
    if (body.followUpsOnly !== undefined) {
      opts.followUpsOnly = Boolean(body.followUpsOnly)
    }
    if (body.dailyStep1Quota !== undefined) {
      if (body.dailyStep1Quota === null || body.dailyStep1Quota === '') {
        opts.dailyStep1Quota = null
      } else {
        const quota = parseInt(String(body.dailyStep1Quota), 10)
        if (!Number.isFinite(quota) || quota < 0) {
          return NextResponse.json({ error: 'Invalid dailyStep1Quota' }, { status: 400 })
        }
        opts.dailyStep1Quota = quota > 0 ? quota : null
      }
    }

    const entry = await updateActiveCampaignOptions(campaignId, opts)
    if (!entry) {
      return NextResponse.json({ error: 'Campaign is not active in the queue' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      campaignId: entry.campaignId,
      priority: entry.priority ?? 0,
      followUpsOnly: Boolean(entry.followUpsOnly),
      dailyStep1Quota: entry.dailyStep1Quota ?? null,
    })
  } catch (error) {
    console.error('Failed to update campaign queue options:', error)
    return NextResponse.json({ error: 'Failed to update campaign options' }, { status: 500 })
  }
}
