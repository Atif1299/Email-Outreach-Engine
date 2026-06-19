import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const batchId = searchParams.get('batchId')
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    const where: any = {}
    if (batchId) where.importBatchId = parseInt(batchId, 10)
    if (status) where.verificationStatus = status
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { dataJson: { contains: search, mode: 'insensitive' } },
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

    const engagementWhere: { leadId: { in: number[] }; status: { in: string[] }; campaignId?: number } = {
      leadId: { in: leadIds },
      status: { in: ['replied', 'unsubscribed'] },
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

    return NextResponse.json(leads.map(l => ({
      id: l.id,
      importBatchId: l.importBatchId,
      email: l.email,
      data: JSON.parse(l.dataJson),
      createdAt: l.createdAt.toISOString(),
      verificationStatus: l.verificationStatus,
      verificationReason: l.verificationReason,
      engagementStatus: engagementByLead.get(l.id) || null,
    })))
  } catch (error) {
    console.error('Failed to list leads:', error)
    return NextResponse.json({ error: 'Failed to list leads' }, { status: 500 })
  }
}
