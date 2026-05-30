import type {
  AppSettings,
  Campaign,
  CampaignStep,
  ColumnMapping,
  ImportBatchSummary,
  Lead,
  CampaignSendProgress,
  QueueStatus,
} from '@/shared/types'

export type ParsePreviewResult = {
  filename: string
  headers: string[]
  previewRows: Record<string, string>[]
  mapping: ColumnMapping
  totalRows: number
}

export type CampaignWithSteps = Campaign & {
  steps: CampaignStep[]
  targetImportBatchIds: number[]
}

export type OutreachApi = {
  openImportDialog: () => Promise<string | null>
  parsePreview: (filePath: string) => Promise<ParsePreviewResult>
  importCommit: (payload: {
    filePath: string
    mapping: ColumnMapping
  }) => Promise<{
    imported: number
    skippedNoEmail: number
    duplicatesSkipped: number
    skippedExistingInApp: number
    importBatchId: number
    leadIds: number[]
  }>
  importBatchesList: () => Promise<ImportBatchSummary[]>
  importBatchDelete: (batchId: number) => Promise<{
    deletedLeads: number
    deletedCampaigns: number
    deletedCampaignIds: number[]
  }>
  leadIdsForCampaign: (campaignId: number) => Promise<number[]>
  leadsList: (arg?: string | { search?: string; importBatchId?: number }) => Promise<Lead[]>
  leadDelete: (id: number) => Promise<boolean>
  campaignsList: () => Promise<Campaign[]>
  campaignSave: (payload: {
    id?: number
    name: string
    pitch_block: string
    sender_info: string
    targetImportBatchIds?: number[]
    steps: {
      step_order: number
      delay_hours_after_previous: number
      subject_template: string
      body_template: string
      use_ai: boolean
    }[]
  }) => Promise<number>
  campaignGet: (id: number) => Promise<CampaignWithSteps | null>
  campaignDelete: (id: number) => Promise<boolean>
  settingsGet: () => Promise<AppSettings>
  settingsSave: (payload: {
    settings: AppSettings
    smtpPassword?: string
    openaiKey?: string
  }) => Promise<boolean>
  smtpTest: (payload: { testAddress: string; smtpPassword?: string }) => Promise<boolean>
  preview: (req: {
    leadId: number
    campaignId: number
    stepOrder: number
    useAiOverride?: boolean
  }) => Promise<{ subject: string; body: string }>
  aiGenerate: (req: {
    leadId: number
    campaignId: number
    stepOrder: number
    customInstructions?: string
  }) => Promise<{ body: string }>
  applyAiBodyOverrides: (payload: {
    campaignId: number
    stepOrder: number
    items: { leadId: number; body: string }[]
  }) => Promise<{ saved: number }>
  clearStepBodyOverrides: (payload: {
    campaignId: number
    stepOrder: number
  }) => Promise<boolean>
  listStepSavedContent: (payload: {
    campaignId: number
    stepOrder: number
  }) => Promise<{
    aiBodies: { leadId: number; body: string }[]
    mergePreviews: { leadId: number; previewText: string }[]
  }>
  saveMergePreview: (payload: {
    leadId: number
    campaignId: number
    stepOrder: number
    previewText: string
  }) => Promise<boolean>
  queueStart: (payload: { campaignId: number; leadIds: number[] }) => Promise<boolean>
  queuePause: () => Promise<boolean>
  queueResume: () => Promise<boolean>
  queueStop: () => Promise<boolean>
  queueStatus: () => Promise<QueueStatus>
  campaignSendProgress: (campaignId: number) => Promise<CampaignSendProgress>
  campaignsSendProgressList: () => Promise<CampaignSendProgress[]>
  computeDue: (payload: { campaignId: number; leadIds: number[] }) => Promise<
    { leadId: number; campaignId: number; stepOrder: number }[]
  >
}

export function outreach(): OutreachApi {
  const o = window.outreach
  if (!o) throw new Error('Outreach API not available')
  return o
}
