import { NextRequest, NextResponse } from 'next/server'
import { markLeadsDoNotContact, removeLeadFromQueue } from '@/lib/lead-suppression'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const leadIds: number[] = body.leadIds

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds array required' }, { status: 400 })
    }

    await markLeadsDoNotContact(leadIds, 'manual', 'ui')

    for (const leadId of leadIds) {
      await removeLeadFromQueue(leadId)
    }

    return NextResponse.json({ success: true, count: leadIds.length })
  } catch (error) {
    console.error('Failed to suppress leads:', error)
    return NextResponse.json({ error: 'Failed to suppress leads' }, { status: 500 })
  }
}
