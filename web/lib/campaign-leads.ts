import prisma from '@/lib/db'
import { countDoNotContactInList } from '@/lib/lead-suppression'
import {
  countPriorCampaignContacts,
  getIncompleteLeadIds,
  getMaxStepOrder,
  getPriorCampaignContactLeadIds,
} from '@/lib/queue-schedule'

export type ResolveLeadIdsResult =
  | {
    leadIds: number[]
    priorCampaignContacts: number
    doNotContactExcluded: number
    priorCampaignExcluded?: number
  }
  | { error: string; status: 404 | 400 }

export type ResolveLeadIdsOptions = {
  /** When true, drop leads already emailed in any other campaign. */
  excludePriorCampaignContacts?: boolean
}

export async function resolveLeadIdsForCampaign(
  campaignId: number,
  opts?: ResolveLeadIdsOptions
): Promise<ResolveLeadIdsResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { targetBatches: true, steps: true },
  })

  if (!campaign) return { error: 'Campaign not found', status: 404 }
  if (campaign.steps.length === 0) return { error: 'Campaign has no steps', status: 400 }

  for (const step of campaign.steps) {
    if (!step.useAi) {
      if (!step.subjectTemplate.trim() || !step.bodyTemplate.trim()) {
        return {
          error: `Step ${step.stepOrder} needs subject and body templates when AI is off`,
          status: 400,
        }
      }
    }
  }

  const where: { verificationStatus: string; importBatchId?: { in: number[] } } = {
    verificationStatus: 'valid',
  }
  if (campaign.targetBatches.length > 0) {
    where.importBatchId = { in: campaign.targetBatches.map((tb) => tb.importBatchId) }
  }

  const leads = await prisma.lead.findMany({ where, select: { id: true } })
  const validLeadIds = leads.map((l) => l.id)
  const maxStepOrder = getMaxStepOrder(campaign.steps)

  const [incompleteIds, priorCampaignContacts, doNotContactExcluded] = await Promise.all([
    getIncompleteLeadIds(campaignId, validLeadIds, maxStepOrder),
    countPriorCampaignContacts(campaignId, validLeadIds),
    countDoNotContactInList(validLeadIds),
  ])

  let leadIds = incompleteIds
  let priorCampaignExcluded = 0

  if (opts?.excludePriorCampaignContacts) {
    const priorIds = await getPriorCampaignContactLeadIds(campaignId, leadIds)
    if (priorIds.size > 0) {
      const before = leadIds.length
      leadIds = leadIds.filter((id) => !priorIds.has(id))
      priorCampaignExcluded = before - leadIds.length
    }
  }

  if (leadIds.length === 0) {
    return { error: 'No sendable leads remaining for this campaign', status: 400 }
  }

  return {
    leadIds,
    priorCampaignContacts,
    doNotContactExcluded,
    priorCampaignExcluded,
  }
}

export async function resolveSendableLeadIdsFromCandidates(
  campaignId: number,
  candidateLeadIds: number[]
): Promise<number[]> {
  if (candidateLeadIds.length === 0) return []

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { steps: true },
  })
  if (!campaign || campaign.steps.length === 0) return []

  const validLeads = await prisma.lead.findMany({
    where: {
      id: { in: candidateLeadIds },
      verificationStatus: 'valid',
    },
    select: { id: true },
  })
  const validLeadIds = validLeads.map((l) => l.id)
  if (validLeadIds.length === 0) return []

  const maxStepOrder = getMaxStepOrder(campaign.steps)
  return getIncompleteLeadIds(campaignId, validLeadIds, maxStepOrder)
}

export async function campaignTargetsBatch(
  campaignId: number,
  batchId: number
): Promise<boolean> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { targetBatches: true },
  })
  if (!campaign) return false
  if (campaign.targetBatches.length === 0) return true
  return campaign.targetBatches.some((tb) => tb.importBatchId === batchId)
}
