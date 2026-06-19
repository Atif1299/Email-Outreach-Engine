import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function POST() {
  try {
    await prisma.queueState.update({
      where: { id: 1 },
      data: {
        paused: false,
        consecutiveFailures: 0,
        lastError: null,
        updatedAt: new Date(),
      },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to resume queue:', error)
    return NextResponse.json({ error: 'Failed to resume queue' }, { status: 500 })
  }
}
