import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { REPLY_LIST_STATUSES } from '@/lib/replies'
import { resolveInboxesForEngagements } from '@/lib/reply-inbox'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaignId')
    const status = searchParams.get('status')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const where: {
      status?: string | { in: string[] }
      campaignId?: number
      OR?: Array<{ repliedAt?: { gte?: Date; lte?: Date }; unsubscribedAt?: { gte?: Date; lte?: Date } }>
    } = {
      status: status && REPLY_LIST_STATUSES.includes(status as (typeof REPLY_LIST_STATUSES)[number])
        ? status
        : { in: [...REPLY_LIST_STATUSES] },
    }

    if (campaignId) where.campaignId = parseInt(campaignId, 10)

    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom) : undefined
      const to = dateTo ? new Date(dateTo) : undefined
      where.OR = [
        {
          repliedAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        },
        {
          unsubscribedAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        },
      ]
    }

    const [rows, total] = await Promise.all([
      prisma.leadCampaignEngagement.findMany({
        where,
        include: {
          lead: { select: { id: true, email: true, doNotContact: true } },
          campaign: { select: { id: true, name: true } },
          inboxAccount: { select: { id: true, email: true, label: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.leadCampaignEngagement.count({ where }),
    ])

    const inboxMap = await resolveInboxesForEngagements(
      rows.map((r) => ({
        leadId: r.leadId,
        campaignId: r.campaignId,
        inboxAccountId: r.inboxAccountId,
      }))
    )

    return NextResponse.json({
      replies: rows.map((r) => {
        const key = `${r.leadId}-${r.campaignId}`
        const inbox = r.inboxAccount
          ? {
            inboxAccountId: r.inboxAccount.id,
            inboxEmail: r.inboxAccount.email,
            inboxLabel: r.inboxAccount.label || null,
          }
          : inboxMap.get(key) ?? {
            inboxAccountId: null,
            inboxEmail: null,
            inboxLabel: null,
          }
        return {
          leadId: r.leadId,
          campaignId: r.campaignId,
          status: r.status,
          replySubject: r.replySubject,
          replySnippet: r.replySnippet,
          repliedAt: r.repliedAt?.toISOString() ?? null,
          unsubscribedAt: r.unsubscribedAt?.toISOString() ?? null,
          detectedVia: r.detectedVia,
          updatedAt: r.updatedAt.toISOString(),
          leadEmail: r.lead.email,
          doNotContact: r.lead.doNotContact,
          campaignName: r.campaign.name,
          ...inbox,
        }
      }),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to list replies:', error)
    return NextResponse.json({ error: 'Failed to list replies' }, { status: 500 })
  }
}
