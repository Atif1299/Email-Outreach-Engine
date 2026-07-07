import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { processUnsubscribe, unsubscribeConfirmationHtml } from '@/lib/unsubscribe'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token'

export const dynamic = 'force-dynamic'

async function handleUnsubscribe(token: string, source: string) {
  const payload = verifyUnsubscribeToken(token)
  if (!payload) {
    return { status: 400 as const, body: 'Invalid or expired unsubscribe link.' }
  }

  const lead = await prisma.lead.findUnique({
    where: { id: payload.leadId },
    select: { doNotContact: true },
  })
  if (!lead) {
    return { status: 404 as const, body: 'Lead not found.' }
  }

  if (lead.doNotContact) {
    return { status: 200 as const, already: true }
  }

  const result = await processUnsubscribe(payload, source)
  if (!result.ok) {
    return { status: 500 as const, body: result.error }
  }

  return { status: 200 as const, already: false }
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('t')
  if (!token) {
    return new NextResponse('Missing unsubscribe token.', { status: 400 })
  }

  const result = await handleUnsubscribe(token, 'link')
  if (result.status !== 200) {
    return new NextResponse(result.body, { status: result.status })
  }

  return new NextResponse(unsubscribeConfirmationHtml(result.already), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** RFC 8058 one-click unsubscribe (Gmail POST). */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('t')
  if (!token) {
    return new NextResponse(null, { status: 400 })
  }

  const result = await handleUnsubscribe(token, 'one-click')
  if (result.status === 200) {
    return new NextResponse(null, { status: 200 })
  }
  if (result.status === 400) {
    return new NextResponse(null, { status: 400 })
  }
  return new NextResponse(null, { status: 500 })
}
