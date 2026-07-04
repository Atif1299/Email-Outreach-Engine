import { NextRequest, NextResponse } from 'next/server'
import { getCampaignAnalytics } from '@/lib/campaign-analytics'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10)
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'Invalid campaign ID' }, { status: 400 })
    }

    const analytics = await getCampaignAnalytics(id)
    if (!analytics) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json(analytics)
  } catch (error) {
    console.error('Failed to get campaign analytics:', error)
    return NextResponse.json({ error: 'Failed to get campaign analytics' }, { status: 500 })
  }
}
