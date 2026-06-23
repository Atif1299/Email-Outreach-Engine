import { NextResponse } from 'next/server'
import { loadAllFilesystemFewShots } from '@/lib/few-shot'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const defaults = loadAllFilesystemFewShots()
    return NextResponse.json(defaults)
  } catch (error) {
    console.error('Failed to load few-shot defaults:', error)
    return NextResponse.json({ error: 'Failed to load defaults' }, { status: 500 })
  }
}
