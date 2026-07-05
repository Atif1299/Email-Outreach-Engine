import { NextRequest, NextResponse } from 'next/server'
import { startAiBulkJob, processAiBulkTick } from '@/lib/ai-bulk-processor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const campaignId = parseInt(String(body.campaignId), 10)
    const stepOrder = parseInt(String(body.stepOrder ?? 1), 10)
    const regenerateAll = Boolean(body.regenerateAll)
    const leadIds = Array.isArray(body.leadIds)
      ? body.leadIds.map((id: unknown) => parseInt(String(id), 10)).filter((n: number) => !Number.isNaN(n))
      : undefined

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    const job = await startAiBulkJob({ campaignId, stepOrder, regenerateAll, leadIds })

    void processAiBulkTick().catch((error) => {
      console.error('Initial AI bulk tick failed:', error)
    })

    return NextResponse.json({ job })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start bulk AI job'
    console.error('Start AI bulk job failed:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
