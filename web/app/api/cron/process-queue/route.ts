import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { isAuthorizedCron, runQueueCron } from '@/lib/queue-cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handleCron(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runQueueCron()
    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Processing failed'
    await prisma.queueState.update({
      where: { id: 1 },
      data: { lastError: message },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Vercel Cron + external schedulers (cron-job.org, etc.) */
export async function GET(request: NextRequest) {
  return handleCron(request)
}

export async function POST(request: NextRequest) {
  return handleCron(request)
}
