import { NextResponse } from 'next/server'

import { clearFollowUpsPause } from '@/lib/inbox-cluster-guard'

export async function POST() {
  try {
    await clearFollowUpsPause()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to resume follow-ups:', error)
    return NextResponse.json({ error: 'Failed to resume follow-ups' }, { status: 500 })
  }
}
