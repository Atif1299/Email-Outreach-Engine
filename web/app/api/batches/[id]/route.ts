import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    const queueState = await prisma.queueState.findUnique({ where: { id: 1 } })
    if (queueState?.running) {
      const activeLeadIds = JSON.parse(queueState.activeLeadIdsJson || '[]') as number[]
      if (activeLeadIds.length > 0) {
        const leadsInBatch = await prisma.lead.count({
          where: { id: { in: activeLeadIds }, importBatchId: id },
        })
        if (leadsInBatch > 0) {
          await prisma.queueState.update({
            where: { id: 1 },
            data: {
              running: false,
              paused: false,
              lastError: 'Queue stopped: import batch was deleted',
              processingLockUntil: null,
            },
          })
        }
      }
    }

    const existing = await prisma.importBatch.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ success: true, alreadyDeleted: true })
    }

    await prisma.lead.deleteMany({ where: { importBatchId: id } })
    await prisma.importBatch.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ success: true, alreadyDeleted: true })
    }
    console.error('Failed to delete batch:', error)
    return NextResponse.json({ error: 'Failed to delete batch' }, { status: 500 })
  }
}
