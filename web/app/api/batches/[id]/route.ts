import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { parseActiveCampaigns, persistActiveCampaigns, serializeActiveCampaigns } from '@/lib/queue-active'

export const dynamic = 'force-dynamic'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    const queueState = await prisma.queueState.findUnique({ where: { id: 1 } })
    if (queueState?.running) {
      const entries = parseActiveCampaigns(queueState)
      const batchLeadIds = await prisma.lead.findMany({
        where: { importBatchId: id },
        select: { id: true },
      })
      const batchLeadIdSet = new Set(batchLeadIds.map((l) => l.id))

      let touched = false
      const nextEntries = entries
        .map((entry) => {
          const newLeadIds = entry.leadIds.filter((leadId) => !batchLeadIdSet.has(leadId))
          if (newLeadIds.length !== entry.leadIds.length) touched = true
          return { ...entry, leadIds: newLeadIds }
        })
        .filter((e) => e.leadIds.length > 0)

      if (touched) {
        if (nextEntries.length === 0) {
          await persistActiveCampaigns([])
          await prisma.queueState.update({
            where: { id: 1 },
            data: {
              paused: false,
              lastError: 'Queue stopped: import batch was deleted',
              processingLockUntil: null,
            },
          })
        } else {
          await prisma.queueState.update({
            where: { id: 1 },
            data: {
              activeCampaignsJson: serializeActiveCampaigns(nextEntries),
              lastError: 'Queue updated: import batch was deleted',
              processingLockUntil: null,
              updatedAt: new Date(),
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
