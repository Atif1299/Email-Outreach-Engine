import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { resolveLeadIdsForCampaign } from '@/lib/campaign-leads'
import { upsertActiveCampaign, isCampaignActive } from '@/lib/queue-active'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId, campaignIds, force } = body

    const ids: number[] = campaignIds?.length
      ? campaignIds
      : campaignId
        ? [campaignId]
        : []

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Missing campaignId or campaignIds' }, { status: 400 })
    }

    const existing = await prisma.queueState.findUnique({ where: { id: 1 } })
    const wasRunning = existing?.running ?? false

    const results: Array<{
      campaignId: number
      leadCount?: number
      skipped?: boolean
      error?: string
    }> = []

    let totalPriorContacts = 0
    let totalDncExcluded = 0

    for (const id of ids) {
      if (isCampaignActive(existing, id) && !force) {
        results.push({ campaignId: id, skipped: true, error: 'Already active' })
        continue
      }

      const resolved = await resolveLeadIdsForCampaign(id)
      if ('error' in resolved) {
        results.push({ campaignId: id, error: resolved.error })
        continue
      }

      const { alreadyActive } = await upsertActiveCampaign(id, resolved.leadIds, {
        force: !!force,
        resetSession: !wasRunning && results.every((r) => r.skipped || r.error),
      })

      if (alreadyActive && !force) {
        results.push({ campaignId: id, skipped: true, error: 'Already active' })
        continue
      }

      totalPriorContacts += resolved.priorCampaignContacts
      totalDncExcluded += resolved.doNotContactExcluded
      results.push({ campaignId: id, leadCount: resolved.leadIds.length })
    }

    const started = results.filter((r) => r.leadCount != null)
    if (started.length === 0) {
      const firstError = results.find((r) => r.error)?.error ?? 'No campaigns started'
      return NextResponse.json({ error: firstError, results }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      results,
      leadCount: started.reduce((s, r) => s + (r.leadCount ?? 0), 0),
      warnings: {
        priorCampaignContacts: totalPriorContacts,
        doNotContactExcluded: totalDncExcluded,
      },
    })
  } catch (error) {
    console.error('Failed to start queue:', error)
    return NextResponse.json({ error: 'Failed to start queue' }, { status: 500 })
  }
}
