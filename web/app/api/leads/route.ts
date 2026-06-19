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

    return NextResponse.json(leads.map(l => ({
      id: l.id,
      importBatchId: l.importBatchId,
      email: l.email,
      data: JSON.parse(l.dataJson),
      createdAt: l.createdAt.toISOString(),
      verificationStatus: l.verificationStatus,
      verificationReason: l.verificationReason,
    })))
  } catch (error) {
    console.error('Failed to list leads:', error)
    return NextResponse.json({ error: 'Failed to list leads' }, { status: 500 })
  }
}
