import { NextRequest, NextResponse } from 'next/server'
import { runAiBulkCron } from '@/lib/ai-bulk-processor'
import { CRON_QUEUE_BUDGET_MS, isAuthorizedCron } from '@/lib/queue-cron'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handleCron(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ ok: 0, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const aiBulkResult = await runAiBulkCron(CRON_QUEUE_BUDGET_MS)
    return NextResponse.json({
      ok: 1,
      status: typeof aiBulkResult === 'object' && aiBulkResult && 'status' in aiBulkResult
        ? String((aiBulkResult as { status?: string }).status ?? 'ok')
        : 'ok',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI bulk processing failed'
    return NextResponse.json(
      { ok: 0, error: message.slice(0, 200) },
      { status: 500 }
    )
  }
}

/** Optional separate cron for Preview bulk AI (not bundled with send queue). */
export async function GET(request: NextRequest) {
  return handleCron(request)
}

export async function POST(request: NextRequest) {
  return handleCron(request)
}
