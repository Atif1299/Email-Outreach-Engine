import { NextRequest, NextResponse } from 'next/server'
import { parseFile, guessColumnMapping } from '@/lib/parser'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const rows = await parseFile(file)
    const headers = rows.length > 0 ? Object.keys(rows[0]) : []
    const mapping = guessColumnMapping(headers)

    return NextResponse.json({
      filename: file.name,
      headers,
      previewRows: rows.slice(0, 5),
      mapping,
      totalRows: rows.length,
    })
  } catch (error) {
    console.error('Preview failed:', error)
    return NextResponse.json({ error: 'Failed to parse file' }, { status: 500 })
  }
}
