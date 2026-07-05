import { NextResponse } from 'next/server'
import { listActiveAiBulkJobs } from '@/lib/ai-bulk-processor'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const jobs = await listActiveAiBulkJobs()
    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('List active AI bulk jobs failed:', error)
    return NextResponse.json({ error: 'Failed to list active jobs' }, { status: 500 })
  }
}
