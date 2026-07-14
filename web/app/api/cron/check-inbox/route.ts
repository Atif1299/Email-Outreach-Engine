import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/queue-cron'
import { syncInbox } from '@/lib/inbox-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handleCron(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ ok: 0, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncInbox()
    // Cap payload — cron-job.org fails when response exceeds ~64KB
    return NextResponse.json({
      ok: 1,
      checked: result.checked,
      matched: result.matched,
      replied: result.replied,
      unsubscribed: result.unsubscribed,
      bounces: result.bounces,
      skipped: result.skipped,
      accounts: result.accountsSynced,
      errors: result.errors.slice(0, 3).map((e) => e.slice(0, 120)),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Inbox sync failed'
    return NextResponse.json(
      { ok: 0, error: message.slice(0, 200) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request)
}

export async function POST(request: NextRequest) {
  return handleCron(request)
}
