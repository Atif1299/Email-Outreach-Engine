import { NextRequest, NextResponse } from 'next/server'
import { stopAiBulkJob } from '@/lib/ai-bulk-processor'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const jobId = body.jobId != null ? parseInt(String(body.jobId), 10) : undefined
    const campaignId = body.campaignId != null ? parseInt(String(body.campaignId), 10) : undefined
    const stepOrder = body.stepOrder != null ? parseInt(String(body.stepOrder), 10) : undefined

    if (jobId == null && (campaignId == null || stepOrder == null)) {
      return NextResponse.json({ error: 'Missing jobId or campaignId/stepOrder' }, { status: 400 })
    }

    await stopAiBulkJob({ jobId, campaignId, stepOrder })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Stop AI bulk job failed:', error)
    return NextResponse.json({ error: 'Failed to stop bulk AI job' }, { status: 500 })
  }
}
