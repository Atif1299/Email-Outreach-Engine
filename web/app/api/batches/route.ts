import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  try {
    const batches = await prisma.importBatch.findMany({
      include: {
        _count: {
          select: { leads: true }
        }
      },
      orderBy: { id: 'desc' }
    })

    return NextResponse.json(batches.map(b => ({
      id: b.id,
      filename: b.filename,
      createdAt: b.createdAt.toISOString(),
      leadCount: b._count.leads,
    })))
  } catch (error) {
    console.error('Failed to list batches:', error)
    return NextResponse.json({ error: 'Failed to list batches' }, { status: 500 })
  }
}
