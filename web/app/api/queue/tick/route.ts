import { NextResponse } from 'next/server'
import { processQueueBatch } from '@/lib/queue-processor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Process at most one queued email. Call sequentially — never in parallel. */
export async function POST() {
  try {
    const result = await processQueueBatch(1)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Queue tick failed:', error)
    return NextResponse.json({ error: 'Queue tick failed' }, { status: 500 })
  }
}
