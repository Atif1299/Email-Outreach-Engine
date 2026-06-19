import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function POST() {
  try {
    await prisma.queueState.update({
      where: { id: 1 },
      data: { paused: true, updatedAt: new Date() }
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to pause queue:', error)
    return NextResponse.json({ error: 'Failed to pause queue' }, { status: 500 })
  }
}
