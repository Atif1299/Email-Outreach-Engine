import { NextRequest, NextResponse } from 'next/server'
import { clearLeadDoNotContact, updateEngagementStatus, type EngagementStatus } from '@/lib/replies'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: EngagementStatus[] = ['replied', 'unsubscribed', 'out_of_office', 'active']

export async function PATCH(
  request: NextRequest,
  { params }: { params: { leadId: string; campaignId: string } }
) {
  try {
    const leadId = parseInt(params.leadId, 10)
    const campaignId = parseInt(params.campaignId, 10)
    if (Number.isNaN(leadId) || Number.isNaN(campaignId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await request.json()
    const { status, clearDnc } = body as { status?: EngagementStatus; clearDnc?: boolean }

    if (clearDnc) {
      await clearLeadDoNotContact(leadId)
      return NextResponse.json({ success: true })
    }

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const result = await updateEngagementStatus({ leadId, campaignId, status })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update engagement:', error)
    return NextResponse.json({ error: 'Failed to update engagement' }, { status: 500 })
  }
}
