import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { resolveEngagementDisplay } from '@/lib/lead-suppression'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const batchId = searchParams.get('batchId')
    const status = searchParams.get('status')
    const engagement = searchParams.get('engagement')
    const search = searchParams.get('search')

    const where: {
      importBatchId?: number
      verificationStatus?: string
      doNotContact?: boolean
      OR?: Array<{ email: { contains: string; mode: 'insensitive' } } | { dataJson: { contains: string } }>
    } = {}

    if (batchId) where.importBatchId = parseInt(batchId, 10)
    if (status) where.verificationStatus = status
    if (engagement === 'dnc') where.doNotContact = true
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { dataJson: { contains: search } },
      ]
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 1000,
    })

    const leadIds = leads.map((l) => l.id)
    const campaignId = searchParams.get('campaignId')
      ? parseInt(searchParams.get('campaignId')!, 10)
      : null

    const engagementWhere: {
      leadId: { in: number[] }
      status: { in: string[] }
      campaignId?: number
    } = {
      leadId: { in: leadIds },
      status: { in: ['replied', 'unsubscribed', 'out_of_office'] },
    }
    if (campaignId) engagementWhere.campaignId = campaignId

    const engagements = leadIds.length
      ? await prisma.leadCampaignEngagement.findMany({
        where: engagementWhere,
        select: { leadId: true, status: true },
      })
      : []

    const engagementByLead = new Map<number, string>()
    for (const row of engagements) {
      const existing = engagementByLead.get(row.leadId)
      if (!existing || row.status === 'unsubscribed') {
        engagementByLead.set(row.leadId, row.status)
      }
    }

    let result = leads.map((l) => ({
      id: l.id,
      importBatchId: l.importBatchId,
      email: l.email,
      data: JSON.parse(l.dataJson),
      createdAt: l.createdAt.toISOString(),
      verificationStatus: l.verificationStatus,
      verificationReason: l.verificationReason,
      doNotContact: l.doNotContact,
      engagementStatus: resolveEngagementDisplay({
        doNotContact: l.doNotContact,
        campaignEngagement: engagementByLead.get(l.id) || null,
      }),
    }))

    if (engagement === 'replied' || engagement === 'unsubscribed' || engagement === 'out_of_office') {
      result = result.filter((l) => l.engagementStatus === engagement)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to list leads:', error)
    return NextResponse.json({ error: 'Failed to list leads' }, { status: 500 })
  }
}
