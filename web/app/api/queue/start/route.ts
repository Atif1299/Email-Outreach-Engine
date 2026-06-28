import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { countDoNotContactInList } from '@/lib/lead-suppression'
import {
  countPriorCampaignContacts,
  getIncompleteLeadIds,
  getMaxStepOrder,
} from '@/lib/queue-schedule'
import { upsertActiveCampaign, isCampaignActive } from '@/lib/queue-active'

export const dynamic = 'force-dynamic'

async function resolveLeadIdsForCampaign(campaignId: number) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { targetBatches: true, steps: true },
  })

  if (!campaign) return { error: 'Campaign not found', status: 404 as const }
  if (campaign.steps.length === 0) return { error: 'Campaign has no steps', status: 400 as const }

  const where: { verificationStatus: string; importBatchId?: { in: number[] } } = {
    verificationStatus: 'valid',
  }
  if (campaign.targetBatches.length > 0) {
    where.importBatchId = { in: campaign.targetBatches.map((tb) => tb.importBatchId) }
  }

  const leads = await prisma.lead.findMany({ where, select: { id: true } })
  const validLeadIds = leads.map((l) => l.id)
  const maxStepOrder = getMaxStepOrder(campaign.steps)

  const [leadIds, priorCampaignContacts, doNotContactExcluded] = await Promise.all([
    getIncompleteLeadIds(campaignId, validLeadIds, maxStepOrder),
    countPriorCampaignContacts(campaignId, validLeadIds),
    countDoNotContactInList(validLeadIds),
  ])

  if (leadIds.length === 0) {
    return { error: 'No sendable leads remaining for this campaign', status: 400 as const }
  }

  return { leadIds, priorCampaignContacts, doNotContactExcluded }
}

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
