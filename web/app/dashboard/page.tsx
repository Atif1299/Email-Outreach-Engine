'use client'

import { useState, useEffect } from 'react'
import StepConnect from '@/components/dashboard/StepConnect'
import StepImport from '@/components/dashboard/StepImport'
import StepLeads from '@/components/dashboard/StepLeads'
import StepCampaign from '@/components/dashboard/StepCampaign'
import StepPreview from '@/components/dashboard/StepPreview'
import StepQueue from '@/components/dashboard/StepQueue'
import StepReplies from '@/components/dashboard/StepReplies'

export interface SmtpAccountStatus {
  id: number
  email: string
  label: string
  enabled: boolean
  hasPassword?: boolean
  sendsToday: number
  sendsThisHour: number
  exhaustedUntil: string | null
  exhaustReason: string | null
  lastInboxCheckedAt: string | null
  lastInboxError: string | null
  warmupDay?: number | null
  warmupDailyCap?: number | null
  warmupEnabled?: boolean
}

export interface Settings {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpFromName: string
  sendDelayMinMs: number
  sendDelayMaxMs: number
  dailyCap: number
  dailyStep1Cap: number
  dailyFollowUpCap: number
  hourlyCap: number
  sendTimezone: string
  sendStartHour: number
  openaiModel: string
  aiProvider: string
  geminiModel: string
  verificationProvider: string
  hasOpenaiKey: boolean
  hasGeminiApiKey: boolean
  hasVerificationApiKey: boolean
  smtpAccounts: SmtpAccountStatus[]
  /** @deprecated legacy fields */
  smtpUser?: string
  smtpFromEmail?: string
  hasSmtpPassword?: boolean
}

export interface Batch {
  id: number
  filename: string
  createdAt: string
  leadCount: number
}

export interface Lead {
  id: number
  importBatchId: number | null
  email: string
  data: Record<string, string>
  createdAt: string
  verificationStatus: string
  verificationReason: string | null
  doNotContact?: boolean
  engagementStatus?: string | null
}

export interface Campaign {
  id: number
  name: string
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  outputLanguage: string
  createdAt: string
  targetImportBatchIds: number[]
  steps: CampaignStep[]
}

export interface CampaignStep {
  id?: number
  stepOrder: number
  delayHoursAfterPrevious: number
  subjectTemplate: string
  bodyTemplate: string
  useAi: boolean
  bodyFormat?: 'plain' | 'html'
}

export interface QueueStatus {
  running: boolean
  paused: boolean
  activeCampaignId?: number | null
  activeCampaignIds?: number[]
  activeCampaigns?: Array<{ campaignId: number; name: string; remainingLeads: number }>
  aggregateDueNow?: number
  lastError: string | null
  processedInSession: number
  failedInSession: number
  sendsToday: number
  failedSendsToday?: number
  dailyCap?: number
  hourlyCap?: number
  perInboxDailyCap?: number
  perInboxHourlyCap?: number
  enabledSmtpCount?: number
  smtpAccounts?: SmtpAccountStatus[]
  sendsThisHour?: number
  capReached?: boolean
  hourCapReached?: boolean
  outsideWindow?: boolean
  useCronWorker?: boolean
  stepTypeCapsEnabled?: boolean
  step1SentToday?: number
  followUpSentToday?: number
  dailyStep1Cap?: number
  dailyFollowUpCap?: number
  currentJob: {
    campaignId?: number
    campaignName?: string
    leadId: number
    stepOrder: number | null
    email: string
    status?: 'sending' | 'completing' | 'waiting_delay'
  } | null
}

const NAV_STEPS = [
  { id: 0, icon: '⚙', label: 'Connect' },
  { id: 1, icon: '1', label: 'Import' },
  { id: 2, icon: '2', label: 'Leads' },
  { id: 3, icon: '3', label: 'Campaign' },
  { id: 4, icon: '4', label: 'Preview' },
  { id: 5, icon: '5', label: 'Queue' },
  { id: 6, icon: '6', label: 'Replies' },
] as const

export default function DashboardPage() {
  const [currentStep, setCurrentStep] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set())
  const [leadsBatchFilter, setLeadsBatchFilter] = useState<number | null>(null)
  const [leadsStatusFilter, setLeadsStatusFilter] = useState('')
  const [leadsEngagementFilter, setLeadsEngagementFilter] = useState('')
  const [leadsSearch, setLeadsSearch] = useState('')
  const [leadsReloadToken, setLeadsReloadToken] = useState(0)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null)
  const [previewCampaignId, setPreviewCampaignId] = useState<number | null>(null)
  const [queueCampaignId, setQueueCampaignId] = useState<number | null>(null)
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    running: false,
    paused: false,
    lastError: null,
    processedInSession: 0,
    failedInSession: 0,
    sendsToday: 0,
    currentJob: null,
  })

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  // Load data when step changes
  useEffect(() => {
    if (currentStep === 1) loadBatches()
    if (currentStep === 2) loadBatches()
    if (currentStep === 3) { loadBatches(); loadCampaigns() }
    if (currentStep === 4) loadCampaigns()
    if (currentStep === 5) { loadCampaigns(); loadQueueStatus() }
    if (currentStep === 6) loadCampaigns()
  }, [currentStep])

  // Load leads whenever filters change (abort stale requests)
  useEffect(() => {
    if (currentStep !== 2) return

    const params = new URLSearchParams()
    if (leadsBatchFilter != null) params.set('batchId', String(leadsBatchFilter))
    if (leadsStatusFilter) params.set('status', leadsStatusFilter)
    if (leadsEngagementFilter) params.set('engagement', leadsEngagementFilter)
    if (leadsSearch) params.set('search', leadsSearch)

    const controller = new AbortController()

      ; (async () => {
        try {
          const res = await fetch(`/api/leads?${params}`, { signal: controller.signal })
          if (res.ok) {
            const data = await res.json()
            setLeads(data)
          }
        } catch (e) {
          if ((e as Error).name !== 'AbortError') {
            console.error('Failed to load leads:', e)
          }
        }
      })()

    return () => controller.abort()
  }, [currentStep, leadsBatchFilter, leadsStatusFilter, leadsEngagementFilter, leadsSearch, leadsReloadToken])

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  async function loadBatches() {
    try {
      const res = await fetch('/api/batches')
      if (res.ok) {
        const data = await res.json()
        setBatches(data)
      }
    } catch (e) {
      console.error('Failed to load batches:', e)
    }
  }

  function refreshLeads() {
    setLeadsReloadToken((t) => t + 1)
  }

  function proceedWithBatch() {
    if (selectedBatchId) {
      setLeadsBatchFilter(selectedBatchId)
      setCurrentStep(2)
    }
  }

  async function loadCampaigns() {
    try {
      const res = await fetch('/api/campaigns')
      if (res.ok) {
        const data = await res.json()
        setCampaigns(data)
      }
    } catch (e) {
      console.error('Failed to load campaigns:', e)
    }
  }

  async function loadQueueStatus() {
    try {
      const res = await fetch('/api/queue')
      if (res.ok) {
        const data = await res.json()
        setQueueStatus(data)
      }
    } catch (e) {
      console.error('Failed to load queue status:', e)
    }
  }

  return (
    <div className="dashboard-page">
      <div className="shell">
        {/* Title Bar */}
        <header className="titlebar">
          <div className="titlebar-left">
            <div className="app-mark" aria-hidden="true">✉</div>
            <div>
              <h1 className="app-title">Email Outreach</h1>
              <p className="app-tagline">Import, personalize, and send cold emails</p>
            </div>
          </div>
          <nav className="steps steps--titlebar" aria-label="Dashboard steps">
            {NAV_STEPS.map((step) => (
              <button
                key={step.id}
                type="button"
                className={`step ${currentStep === step.id ? 'is-active' : ''}`}
                onClick={() => setCurrentStep(step.id)}
              >
                <span className="step-num">{step.icon}</span>
                <span className="step-text">{step.label}</span>
              </button>
            ))}
          </nav>
          <div className="titlebar-right">
            <a
              href="/"
              className="btn btn-outline btn-sm"
              style={{ textDecoration: 'none' }}
            >
              ← Back to Home
            </a>
          </div>
        </header>

        {/* Main Work Area */}
        <main className="workarea">
          <div className="stepper">
            {/* Step Content */}
            {currentStep === 0 && (
              <StepConnect
                settings={settings}
                onSettingsSaved={loadSettings}
              />
            )}

            {currentStep === 1 && (
              <StepImport
                batches={batches}
                selectedBatchId={selectedBatchId}
                onSelectBatch={setSelectedBatchId}
                onBatchesChanged={loadBatches}
                onProceedWithBatch={proceedWithBatch}
              />
            )}

            {currentStep === 2 && (
              <StepLeads
                leads={leads}
                batches={batches}
                selectedLeadIds={selectedLeadIds}
                leadsBatchFilter={leadsBatchFilter}
                leadsStatusFilter={leadsStatusFilter}
                leadsEngagementFilter={leadsEngagementFilter}
                leadsSearch={leadsSearch}
                onSelectLeadIds={setSelectedLeadIds}
                onBatchFilterChange={setLeadsBatchFilter}
                onStatusFilterChange={setLeadsStatusFilter}
                onEngagementFilterChange={setLeadsEngagementFilter}
                onSearchChange={setLeadsSearch}
                onLeadsChanged={refreshLeads}
                onNextStep={() => setCurrentStep(3)}
              />
            )}

            {currentStep === 3 && (
              <StepCampaign
                campaigns={campaigns}
                batches={batches}
                selectedCampaignId={selectedCampaignId}
                leadsBatchFilter={leadsBatchFilter}
                onSelectCampaign={setSelectedCampaignId}
                onCampaignsChanged={loadCampaigns}
                onNextStep={() => {
                  if (selectedCampaignId) {
                    setPreviewCampaignId(selectedCampaignId)
                    setCurrentStep(4)
                  }
                }}
              />
            )}

            {currentStep === 4 && (
              <StepPreview
                campaigns={campaigns}
                previewCampaignId={previewCampaignId}
                onPreviewCampaignChange={setPreviewCampaignId}
                onNextStep={() => {
                  if (previewCampaignId) {
                    setQueueCampaignId(previewCampaignId)
                    setCurrentStep(5)
                  }
                }}
              />
            )}

            {currentStep === 5 && (
              <StepQueue
                campaigns={campaigns}
                queueCampaignId={queueCampaignId}
                queueStatus={queueStatus}
                onQueueCampaignChange={setQueueCampaignId}
                onQueueStatusChange={setQueueStatus}
                onCampaignsChanged={loadCampaigns}
                onBackToPreview={() => setCurrentStep(4)}
              />
            )}

            {currentStep === 6 && <StepReplies campaigns={campaigns} />}
          </div>
        </main>
      </div>
    </div>
  )
}
