import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { CRON_QUEUE_BUDGET_MS, isAuthorizedCron, runQueueCron } from '@/lib/queue-cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Default maxBatches=1 stays under ~30s external cron timeouts when AI renders inline.
 * Override with QUEUE_CRON_MAX_BATCHES (e.g. 2) only after measuring send latency.
 */
function resolveMaxBatches(): number {
  const raw = process.env.QUEUE_CRON_MAX_BATCHES
  if (!raw) return 1
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 5) : 1
}

/** Tiny responses — cron-job.org aborts above ~64KB (cold-start HTML trips this). */
function tinyOk(body: Record<string, string | number>) {
  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function handleCron(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ ok: 0, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const queueResult = await runQueueCron({
      maxRuntimeMs: CRON_QUEUE_BUDGET_MS,
      maxBatches: resolveMaxBatches(),
    })
    return tinyOk({
      ok: 1,
      status: queueResult.status,
      processed: queueResult.processed,
      failed: queueResult.failed,
      remaining: queueResult.remaining,
      batches: queueResult.batches,
      ms: queueResult.ranMs,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Processing failed'
    await prisma.queueState.update({
      where: { id: 1 },
      data: { lastError: message.slice(0, 500) },
    })
    return NextResponse.json(
      { ok: 0, error: message.slice(0, 200) },
      { status: 500 }
    )
  }
}

/** Vercel Cron + external schedulers (cron-job.org, etc.) — send queue only. */
export async function GET(request: NextRequest) {
  return handleCron(request)
}

export async function POST(request: NextRequest) {
  return handleCron(request)
}
