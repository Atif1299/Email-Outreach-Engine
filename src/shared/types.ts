export const LEAD_FIELD_KEYS = [
  'linkedin_url',
  'email',
  'phone',
  'name',
  'first_name',
  'last_name',
  'current_employer',
  'current_title',
  'industry',
  'location',
  'linkedin_handle',
  'company_size',
] as const

export type LeadFieldKey = (typeof LEAD_FIELD_KEYS)[number] | string

export type LeadData = Record<string, string>

export type ColumnMapping = Record<string, string>

export type SmtpSettings = {
  host: string
  port: number
  secure: boolean
  user: string
  fromName: string
  fromEmail: string
}

export type AppSettings = {
  smtp: SmtpSettings
  sendDelayMs: number
  dailyCap: number
  openaiModel: string
}

export type ImportBatch = {
  id: number
  filename: string
  created_at: string
}

export type Lead = {
  id: number
  import_batch_id: number | null
  email: string
  data: LeadData
  created_at: string
}

export type Campaign = {
  id: number
  name: string
  pitch_block: string
  created_at: string
}

export type CampaignStep = {
  id: number
  campaign_id: number
  step_order: number
  delay_hours_after_previous: number
  subject_template: string
  body_template: string
  use_ai: boolean
}

export type LeadSend = {
  id: number
  lead_id: number
  campaign_id: number
  step_order: number
  subject: string
  body_snippet: string | null
  sent_at: string
  error: string | null
}

export type QueueStatus = {
  running: boolean
  paused: boolean
  lastError: string | null
  processedInSession: number
  sendsToday: number
  currentJob: { leadId: number; stepOrder: number; email: string } | null
}

export type PreviewRequest = {
  leadId: number
  campaignId: number
  stepOrder: number
  useAiOverride?: boolean
}

export type GenerateAiRequest = PreviewRequest & { customInstructions?: string }
