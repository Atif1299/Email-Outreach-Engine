import { NextResponse } from 'next/server'
import { processQueueBatch } from '@/lib/queue-processor'
import { withPrismaRetry } from '@/lib/prisma-retry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Process one batch of queued emails (one per available inbox). Call sequentially — never in parallel. */
export async function POST() {
  try {
    const result = await withPrismaRetry(() => processQueueBatch(), { retries: 2, baseDelayMs: 400 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Queue tick failed:', error)
    return NextResponse.json({ error: 'Queue tick failed' }, { status: 500 })
  }
}
