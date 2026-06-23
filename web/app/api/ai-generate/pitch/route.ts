import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { suggestPitchFromLeads } from '@/lib/ai'
import { ensureSettings } from '@/lib/settings'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { batchId, existingPitch, aiVoice } = body

    if (!batchId) {
      return NextResponse.json({ error: 'Missing batchId' }, { status: 400 })
    }

    const settings = await ensureSettings()
    const provider = (settings.aiProvider || 'openai') as 'openai' | 'gemini'
    const apiKey = provider === 'gemini' ? settings.geminiApiKey : settings.openaiKey
    const hasValidKey = !!apiKey?.trim()

    if (!hasValidKey) {
      const providerName = provider === 'gemini' ? 'Gemini' : 'OpenAI'
      return NextResponse.json({ error: `${providerName} API key not configured in Connect settings` }, { status: 400 })
    }

    const leads = await prisma.lead.findMany({
      where: { importBatchId: parseInt(batchId) },
      take: 10,
    })

    if (leads.length === 0) {
      return NextResponse.json({ error: 'No leads in batch' }, { status: 400 })
    }

    const leadsData = leads.map((l) => JSON.parse(l.dataJson))
    const model = provider === 'gemini' ? settings.geminiModel : settings.openaiModel

    const pitchBlock = await suggestPitchFromLeads({
      leadsData,
      existingPitch,
      aiVoice,
      model,
      apiKey: apiKey || '',
      provider,
    })

    return NextResponse.json({ pitchBlock })
  } catch (error) {
    console.error('Pitch suggestion failed:', error)
    return NextResponse.json({ error: 'Pitch suggestion failed' }, { status: 500 })
  }
}
