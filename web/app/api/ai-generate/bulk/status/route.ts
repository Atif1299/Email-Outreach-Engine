import { NextRequest, NextResponse } from 'next/server'
import { getAiBulkJobStatus } from '@/lib/ai-bulk-processor'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = parseInt(searchParams.get('campaignId') || '0', 10)
    const stepOrder = parseInt(searchParams.get('stepOrder') || '1', 10)

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    const result = await getAiBulkJobStatus(campaignId, stepOrder)
    return NextResponse.json(result)
  } catch (error) {
    console.error('AI bulk status failed:', error)
    return NextResponse.json({ error: 'Failed to get bulk AI status' }, { status: 500 })
  }
}
