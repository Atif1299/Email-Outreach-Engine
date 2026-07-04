import { NextResponse } from 'next/server'
import { syncInbox } from '@/lib/inbox-sync'
import { withPrismaRetry } from '@/lib/prisma-retry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  try {
    const result = await withPrismaRetry(() => syncInbox())
    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Inbox sync failed'
    console.error('Manual inbox sync failed:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
