import { NextRequest, NextResponse } from 'next/server'
import { updateEngagementStatus, type EngagementStatus } from '@/lib/replies'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { items, status } = body as {
      items: Array<{ leadId: number; campaignId: number }>
      status: EngagementStatus
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items' }, { status: 400 })
    }

    if (!['replied', 'unsubscribed', 'out_of_office', 'active'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    let updated = 0
    for (const item of items) {
      const result = await updateEngagementStatus({
        leadId: item.leadId,
        campaignId: item.campaignId,
        status,
      })
      if (result.ok) updated++
    }

    return NextResponse.json({ success: true, updated })
  } catch (error) {
    console.error('Failed bulk update:', error)
    return NextResponse.json({ error: 'Failed bulk update' }, { status: 500 })
  }
}
