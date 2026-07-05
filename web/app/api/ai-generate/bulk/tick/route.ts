import { NextResponse } from 'next/server'
import { processAiBulkTick } from '@/lib/ai-bulk-processor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  try {
    const result = await processAiBulkTick()
    return NextResponse.json(result)
  } catch (error) {
    console.error('AI bulk tick failed:', error)
    return NextResponse.json({ error: 'AI bulk tick failed' }, { status: 500 })
  }
}
