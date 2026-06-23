import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { Prisma } from '@prisma/client'

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
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        {
          error:
            'Database connection failed. Neon may be waking from auto-suspend — retry in a few seconds, or run `npx prisma db execute --stdin` from web/ to wake it.',
        },
        { status: 503 }
      )
    }
    console.error('Failed to list batches:', error)
    return NextResponse.json({ error: 'Failed to list batches' }, { status: 500 })
  }
}
