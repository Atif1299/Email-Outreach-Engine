import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/queue-cron'

export const dynamic = 'force-dynamic'

/**
 * Tiny keep-alive for Render free tier so cron-job.org does not hit a large
 * HTML cold-start / 502 page (which fails as "output too large").
 */
async function handleCron(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return new NextResponse('unauthorized', { status: 401 })
  }
  return new NextResponse('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function GET(request: NextRequest) {
  return handleCron(request)
}

export async function POST(request: NextRequest) {
  return handleCron(request)
}
