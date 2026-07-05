'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Campaign, CampaignStep, Batch } from '@/app/dashboard/page'
import { OUTPUT_LANGUAGES } from '@/lib/output-languages'
import { BRIEF_PLACEHOLDER } from '@/lib/pitch-block'
import { mergeTags } from '@/lib/merge-tags'
import { buildPreviewHtml, normalizeBodyFormat, resolvePreviewBodyFormat } from '@/lib/email-html'
import EmailInboxPreview from '@/components/dashboard/EmailInboxPreview'
import { InlineHint, useButtonFlash, useInlineHint } from '@/components/dashboard/useStepFeedback'

interface Props {
  campaigns: Campaign[]
  batches: Batch[]
  selectedCampaignId: number | null
  leadsBatchFilter: number | null
  onSelectCampaign: (id: number | null) => void
  onCampaignsChanged: () => void
  onNextStep: () => void
}

const MIN_BRIEF_LENGTH = 40

type StepViewTab = 'plain' | 'html' | 'preview'

interface PreviewLeadSource {
  id?: number
  data: Record<string, string>
  email: string
  label: string
  isSample: boolean
}

interface StepAiPreview {
  subject: string
  body: string
  bodyFormat: 'plain' | 'html'
  htmlPreview: string
}

const SAMPLE_LEAD: PreviewLeadSource = {
  email: 'john@example.com',
  data: {
    first_name: 'John',
    last_name: 'Doe',
    current_employer: 'Acme Corp',
    current_title: 'CEO',
    industry: 'Technology',
    location: 'New York',
  },
  label: 'John Doe',
  isSample: true,
}

function getStepViewTab(
  stepIndex: number,
  step: CampaignStep,
  stepViewTab: Record<number, StepViewTab>
): StepViewTab {
  return stepViewTab[stepIndex] ?? ((step.bodyFormat || 'plain') === 'html' ? 'html' : 'plain')
}

function buildStepAiPreviewCacheKey(
  step: CampaignStep,
  draft: Campaign,
  previewLeadId: number,
  priorSteps?: Array<{ stepOrder: number; subject: string; body: string }>
): string {
  const priorPart =
    priorSteps?.map((p) => `${p.stepOrder}::${p.subject}::${p.body}`).join('||') ?? ''
  return [
    previewLeadId,
    draft.id,
    step.stepOrder,
    step.useAi,
    step.subjectTemplate,
    step.bodyTemplate,
    step.bodyFormat || 'plain',
    draft.pitchBlock,
    draft.outputLanguage,
    priorPart,
  ].join(':::')
}

function buildPriorStepsFromPreviews(
  steps: CampaignStep[],
  previews: Record<number, StepAiPreview | null>,
  upToIndex: number
): Array<{ stepOrder: number; subject: string; body: string }> {
  const out: Array<{ stepOrder: number; subject: string; body: string }> = []
  for (let j = 0; j < upToIndex; j++) {
    const preview = previews[j]
    if (!preview) continue
    out.push({
      stepOrder: steps[j].stepOrder,
      subject: preview.subject,
      body: preview.body,
    })
  }
  return out
}

function buildMergedStepPreview(
  step: CampaignStep,
  draft: Campaign,
  lead: PreviewLeadSource
) {
  const pitch = draft.pitchBlock.trim()
  const sender = draft.senderInfo?.trim() || ''
  const bodyFormat = normalizeBodyFormat(step.bodyFormat)
  const leadData = { ...lead.data, email: lead.email }
  const mergedSubject = mergeTags(step.subjectTemplate, leadData, pitch, sender)
  const mergedBody = mergeTags(step.bodyTemplate, leadData, pitch, sender)
  const effectiveFormat = resolvePreviewBodyFormat(mergedBody, bodyFormat)
  return {
    mergedSubject,
    mergedBody,
    htmlPreview: buildPreviewHtml(mergedBody, effectiveFormat),
    bodyFormat: effectiveFormat,
  }
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function AutoResizeTextarea({
  value,
  onChange,
  className = 'input textarea textarea--fit',
  placeholder,
  rows,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  className?: string
  placeholder?: string
  rows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 60)}px`
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  return (
    <textarea
      ref={ref}
      className={className}
      placeholder={placeholder}
      rows={rows}
      value={value}
      onChange={(e) => {
        onChange(e)
        requestAnimationFrame(resize)
      }}
    />
  )
}

function stepLabel(stepOrder: number): string {
  if (stepOrder <= 1) return 'Email 1'
  return `Follow-up ${stepOrder - 1}`
}

function defaultStep(stepOrder: number): CampaignStep {
  return {
    stepOrder,
    delayHoursAfterPrevious: stepOrder <= 1 ? 0 : 72,
    subjectTemplate: '',
    bodyTemplate: '',
    useAi: true,
    bodyFormat: 'plain',
  }
}

function prepareDraftForSave(draft: Campaign): Campaign {
  const pitchBlock = draft.pitchBlock.trim()
  return {
    ...draft,
    pitchBlock,
  }
}

function validateDraft(draft: Campaign): string | null {
  if (draft.pitchBlock.trim().length < MIN_BRIEF_LENGTH) {
    return `Campaign brief needs at least ${MIN_BRIEF_LENGTH} characters`
  }
  for (const step of draft.steps) {
    if (!step.useAi) {
      if (!step.subjectTemplate.trim() || !step.bodyTemplate.trim()) {
        return `Step ${step.stepOrder} needs subject and body templates when AI is off`
      }
    }
  }
  return null
}

export default function StepCampaign({
  campaigns,
  batches,
  selectedCampaignId,
  leadsBatchFilter,
  onSelectCampaign,
  onCampaignsChanged,
  onNextStep,
}: Props) {
  const [activeTab, setActiveTab] = useState<'brief' | 'sequence'>('brief')
  const [draft, setDraft] = useState<Campaign | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestingPitch, setSuggestingPitch] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [stepViewTab, setStepViewTab] = useState<Record<number, StepViewTab>>({})
  const [previewLead, setPreviewLead] = useState<PreviewLeadSource | null>(null)
  const [senderFrom, setSenderFrom] = useState({ email: 'sender@example.com', name: 'Sender' })
  const [aiPreviews, setAiPreviews] = useState<Record<number, StepAiPreview | null>>({})
  const [aiPreviewLoading, setAiPreviewLoading] = useState<Record<number, boolean>>({})
  const [aiPreviewError, setAiPreviewError] = useState<Record<number, string>>({})
  const [previewAllLoading, setPreviewAllLoading] = useState(false)
  const [testSendTo, setTestSendTo] = useState('')
  const [testSendLoading, setTestSendLoading] = useState<Record<number, boolean>>({})
  const [testSendSent, setTestSendSent] = useState<Record<number, boolean>>({})
  const testSendSentTimerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const saveFlash = useButtonFlash()
  const { hint: briefHint, showHint: showBriefHint } = useInlineHint()
  const { hint: listHint, showHint: showListHint } = useInlineHint()
  const savedOutputLanguageRef = useRef<string | null>(null)
  const skipNextLoadRef = useRef(false)
  const aiPreviewCacheRef = useRef<Record<number, string>>({})
  const aiPreviewsRef = useRef<Record<number, StepAiPreview | null>>({})
  const previewAbortRef = useRef<Record<number, AbortController>>({})
  const draftRef = useRef<Campaign | null>(null)
  const previewLeadRef = useRef<PreviewLeadSource | null>(null)

  useEffect(() => {
    aiPreviewsRef.current = aiPreviews
  }, [aiPreviews])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    previewLeadRef.current = previewLead
  }, [previewLead])

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  useEffect(() => {
    if (selectedCampaignId) {
      if (skipNextLoadRef.current) {
        skipNextLoadRef.current = false
        return
      }
      loadCampaign(selectedCampaignId)
    } else {
      setDraft(null)
    }
  }, [selectedCampaignId])

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((settings) => {
        const firstSmtp = settings.smtpAccounts?.[0]
        setSenderFrom({
          email: firstSmtp?.email || 'sender@example.com',
          name: settings.smtpFromName || firstSmtp?.label || 'Sender',
        })
      })
      .catch(() => { })
  }, [])

  useEffect(() => {
    if (activeTab !== 'sequence' || !draft) return

    const batchId = draft.targetImportBatchIds[0] || leadsBatchFilter
    const controller = new AbortController()

      ; (async () => {
        try {
          const params = new URLSearchParams()
          if (batchId) params.set('batchId', String(batchId))
          const res = await fetch(`/api/leads?${params}`, { signal: controller.signal })
          if (!res.ok) {
            setPreviewLead(SAMPLE_LEAD)
            return
          }
          const leads = await res.json()
          if (!Array.isArray(leads) || leads.length === 0) {
            setPreviewLead(SAMPLE_LEAD)
            return
          }
          const sorted = [...leads].sort((a: { id: number }, b: { id: number }) => a.id - b.id)
          const first = sorted[0]
          const data = (first.data || {}) as Record<string, string>
          setPreviewLead({
            id: first.id,
            data,
            email: first.email || '',
            label: [data.first_name, data.last_name].filter(Boolean).join(' ') || first.email || 'Lead',
            isSample: false,
          })
        } catch (e) {
          if ((e as Error).name !== 'AbortError') {
            setPreviewLead(SAMPLE_LEAD)
          }
        }
      })()

    return () => controller.abort()
  }, [activeTab, draft?.targetImportBatchIds, leadsBatchFilter])

  const previewInFlightRef = useRef<Record<number, Promise<void>>>({})

  const fetchStepPreview = useCallback(async (stepIndex: number, options?: { force?: boolean }) => {
    const inFlight = previewInFlightRef.current[stepIndex]
    if (inFlight && !options?.force) {
      return inFlight
    }

    const run = (async () => {
      try {
        const currentDraft = draftRef.current
        const lead = previewLeadRef.current
        if (!currentDraft || !lead?.id || lead.isSample) return

        const step = currentDraft.steps[stepIndex]
        if (!step?.useAi) return

        const priorSteps = buildPriorStepsFromPreviews(
          currentDraft.steps,
          aiPreviewsRef.current,
          stepIndex
        )

        const cacheKey = buildStepAiPreviewCacheKey(step, currentDraft, lead.id, priorSteps)
        if (
          !options?.force &&
          aiPreviewCacheRef.current[step.stepOrder] === cacheKey &&
          aiPreviewsRef.current[stepIndex]
        ) {
          return
        }

        previewAbortRef.current[stepIndex]?.abort()
        const controller = new AbortController()
        previewAbortRef.current[stepIndex] = controller

        setAiPreviewLoading((prev) => ({ ...prev, [stepIndex]: true }))
        setAiPreviewError((prev) => ({ ...prev, [stepIndex]: '' }))

        const pitch = currentDraft.pitchBlock.trim()
        const res = await fetch('/api/preview/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            leadId: lead.id,
            campaignId: currentDraft.id || undefined,
            campaign: {
              pitchBlock: pitch,
              senderInfo: currentDraft.senderInfo?.trim() || '',
              aiVoice: currentDraft.aiVoice,
              outputLanguage: currentDraft.outputLanguage,
            },
            step: {
              stepOrder: step.stepOrder,
              subjectTemplate: step.subjectTemplate,
              bodyTemplate: step.bodyTemplate,
              useAi: step.useAi,
              bodyFormat: step.bodyFormat,
            },
            priorSteps,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setAiPreviewError((prev) => ({
            ...prev,
            [stepIndex]: (err as { error?: string }).error || 'AI preview failed',
          }))
          setAiPreviews((prev) => ({ ...prev, [stepIndex]: null }))
          return
        }

        const data = await res.json()
        const previewFormat = resolvePreviewBodyFormat(
          data.body || '',
          normalizeBodyFormat(data.bodyFormat ?? step.bodyFormat)
        )
        aiPreviewCacheRef.current[step.stepOrder] = cacheKey
        const previewResult: StepAiPreview = {
          subject: data.subject || '',
          body: data.body || '',
          bodyFormat: previewFormat,
          htmlPreview:
            data.htmlPreview || buildPreviewHtml(data.body || '', previewFormat),
        }
        aiPreviewsRef.current = { ...aiPreviewsRef.current, [stepIndex]: previewResult }
        setAiPreviews((prev) => ({
          ...prev,
          [stepIndex]: previewResult,
        }))

        for (let j = stepIndex + 1; j < currentDraft.steps.length; j++) {
          delete aiPreviewCacheRef.current[currentDraft.steps[j].stepOrder]
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return
        }
        setAiPreviewError((prev) => ({ ...prev, [stepIndex]: 'AI preview failed' }))
        setAiPreviews((prev) => ({ ...prev, [stepIndex]: null }))
      } finally {
        setAiPreviewLoading((prev) => ({ ...prev, [stepIndex]: false }))
        delete previewInFlightRef.current[stepIndex]
      }
    })()

    previewInFlightRef.current[stepIndex] = run
    return run
  }, [])

  const ensureStepPreviewChain = useCallback(
    async (stepIndex: number, options?: { force?: boolean }) => {
      const currentDraft = draftRef.current
      if (!currentDraft) return

      for (let j = 0; j < stepIndex; j++) {
        if (currentDraft.steps[j]?.useAi && !aiPreviewsRef.current[j]) {
          await fetchStepPreview(j)
        }
      }
      await fetchStepPreview(stepIndex, options)
    },
    [fetchStepPreview]
  )

  const previewAllSteps = useCallback(async () => {
    const currentDraft = draftRef.current
    const lead = previewLeadRef.current
    if (!currentDraft || !lead?.id || lead.isSample) return

    for (let i = 0; i < currentDraft.steps.length; i++) {
      if (currentDraft.steps[i].useAi) {
        await fetchStepPreview(i, { force: true })
      }
    }
  }, [fetchStepPreview])

  const sendStepTestEmail = useCallback(
    async (
      stepIndex: number,
      preview: { subject: string; body: string; bodyFormat: 'plain' | 'html' }
    ) => {
      const to = testSendTo.trim()
      if (!to.includes('@')) return

      setTestSendLoading((prev) => ({ ...prev, [stepIndex]: true }))
      setTestSendSent((prev) => ({ ...prev, [stepIndex]: false }))

      try {
        const res = await fetch('/api/preview/send-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toEmail: to,
            subject: preview.subject,
            body: preview.body,
            bodyFormat: preview.bodyFormat,
          }),
        })
        if (!res.ok) return

        setTestSendSent((prev) => ({ ...prev, [stepIndex]: true }))
        const existing = testSendSentTimerRef.current[stepIndex]
        if (existing) clearTimeout(existing)
        testSendSentTimerRef.current[stepIndex] = setTimeout(() => {
          setTestSendSent((prev) => ({ ...prev, [stepIndex]: false }))
        }, 2500)
      } catch {
        /* ignore */
      } finally {
        setTestSendLoading((prev) => ({ ...prev, [stepIndex]: false }))
      }
    },
    [testSendTo]
  )

  const renderPreviewFooter = (
    stepIndex: number,
    hint: React.ReactNode,
    preview: { subject: string; body: string; bodyFormat: 'plain' | 'html' }
  ) => (
    <div className="step-item-preview-footer">
      <p className="step-item-preview-hint">{hint}</p>
      <div className="step-item-preview-send-test">
        <input
          type="email"
          className="input step-item-preview-send-input"
          placeholder="Send test to…"
          value={testSendTo}
          onChange={(e) => setTestSendTo(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={!!testSendLoading[stepIndex]}
          onClick={() => void sendStepTestEmail(stepIndex, preview)}
        >
          {testSendLoading[stepIndex]
            ? 'Sending…'
            : testSendSent[stepIndex]
              ? 'Sent'
              : 'Send test'}
        </button>
      </div>
    </div>
  )

  const stepsPreviewSignature = (draft?.steps ?? [])
    .map(
      (s) =>
        `${s.stepOrder}:${s.useAi}:${s.subjectTemplate}:${s.bodyTemplate}:${s.bodyFormat}:${draft?.pitchBlock}:${draft?.outputLanguage}`
    )
    .join('|')

  useEffect(() => {
    if (!draft || !previewLead?.id || previewLead.isSample || activeTab !== 'sequence') return

    draft.steps.forEach((step, i) => {
      const viewTab = getStepViewTab(i, step, stepViewTab)
      if (viewTab === 'preview' && step.useAi) {
        void ensureStepPreviewChain(i)
      }
    })
  }, [
    activeTab,
    stepsPreviewSignature,
    previewLead?.id,
    previewLead?.isSample,
    stepViewTab,
    ensureStepPreviewChain,
  ])

  async function loadCampaign(id: number) {
    aiPreviewCacheRef.current = {}
    setAiPreviews({})
    setAiPreviewLoading({})
    setAiPreviewError({})
    try {
      const res = await fetch(`/api/campaigns/${id}`)
      if (res.ok) {
        const data = await res.json()
        setDraft({
          ...data,
          steps: (data.steps || []).map((s: CampaignStep) => ({
            ...s,
            bodyFormat: s.bodyFormat || 'plain',
          })),
        })
        savedOutputLanguageRef.current = data.outputLanguage || 'en'
      }
    } catch (e) {
      console.error('Failed to load campaign:', e)
    }
  }

  function newCampaign() {
    onSelectCampaign(null)
    setDraft({
      id: 0,
      name: 'New Campaign',
      pitchBlock: '',
      senderInfo: '',
      aiVoice: 'founder',
      outputLanguage: 'en',
      createdAt: new Date().toISOString(),
      targetImportBatchIds: leadsBatchFilter ? [leadsBatchFilter] : [],
      steps: [defaultStep(1)],
    })
    setActiveTab('brief')
  }

  async function saveCampaign() {
    if (!draft) return
    const validationError = validateDraft(draft)
    if (validationError) {
      showBriefHint(validationError, 'warn')
      return
    }

    setSaving(true)
    const payload = prepareDraftForSave(draft)

    try {
      const method = draft.id ? 'PUT' : 'POST'
      const url = draft.id ? `/api/campaigns/${draft.id}` : '/api/campaigns'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const saved = await res.json()
        const leadId = previewLead?.id ?? 0
        const isNewCampaign = !draft.id

        const merged: Campaign = {
          ...draft,
          ...saved,
          steps: (saved.steps || draft.steps).map((s: CampaignStep) => ({
            ...s,
            bodyFormat: s.bodyFormat || 'plain',
          })),
        }

        for (const step of merged.steps) {
          const idx = merged.steps.findIndex((s) => s.stepOrder === step.stepOrder)
          const priorSteps = buildPriorStepsFromPreviews(
            merged.steps,
            aiPreviewsRef.current,
            idx
          )
          const newKey = buildStepAiPreviewCacheKey(step, merged, leadId, priorSteps)
          if (aiPreviewCacheRef.current[step.stepOrder] !== newKey) {
            delete aiPreviewCacheRef.current[step.stepOrder]
          }
        }

        if (isNewCampaign) {
          skipNextLoadRef.current = true
          onSelectCampaign(saved.id)
        }

        setDraft(merged)
        savedOutputLanguageRef.current = saved.outputLanguage || draft.outputLanguage || 'en'
        onCampaignsChanged()
        saveFlash.flashDone()
      } else {
        saveFlash.flashError()
      }
    } catch {
      saveFlash.flashError()
    }
    setSaving(false)
  }

  async function deleteCampaign(id: number) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }

    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      if (res.ok) {
        if (selectedCampaignId === id) {
          onSelectCampaign(null)
          setDraft(null)
        }
        onCampaignsChanged()
        showListHint('Deleted', 'ok')
      } else {
        showListHint('Delete failed', 'err')
      }
    } catch {
      showListHint('Delete failed', 'err')
    }
    setConfirmDeleteId(null)
  }

  async function suggestBrief() {
    const batchId = draft?.targetImportBatchIds?.[0]
    if (!batchId) return
    setSuggestingPitch(true)

    try {
      const res = await fetch('/api/ai-generate/pitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          existingPitch: draft?.pitchBlock,
          aiVoice: draft?.aiVoice,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        setDraft(prev => prev ? { ...prev, pitchBlock: result.pitchBlock } : null)
        showBriefHint('Brief updated', 'ok')
      } else {
        showBriefHint('Failed', 'err')
      }
    } catch {
      showBriefHint('Failed', 'err')
    }
    setSuggestingPitch(false)
  }

  function addStep() {
    if (!draft) return
    const newStepOrder = draft.steps.length + 1
    setDraft({
      ...draft,
      steps: [...draft.steps, defaultStep(newStepOrder)],
    })
  }

  function removeStep(index: number) {
    if (!draft || index === 0) return
    const newSteps = draft.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i + 1 }))
    setDraft({ ...draft, steps: newSteps })
  }

  function setStepView(index: number, tab: StepViewTab) {
    setStepViewTab((prev) => ({ ...prev, [index]: tab }))
  }

  function updateStep(index: number, field: keyof CampaignStep, value: CampaignStep[keyof CampaignStep]) {
    if (!draft) return
    const newSteps = [...draft.steps]
    newSteps[index] = { ...newSteps[index], [field]: value }
    setDraft({ ...draft, steps: newSteps })
  }

  const briefTooShort = (draft?.pitchBlock.trim().length ?? 0) < MIN_BRIEF_LENGTH

  return (
    <section className="step-view">
      <div className="step-body split">
        <div className="queue">
          <div className="queue-head">
            <div className="queue-head-row">
              <div className="queue-title">
                Campaigns
                <InlineHint hint={listHint} />
              </div>
              <div className="queue-sub">{campaigns.length} campaigns</div>
            </div>
          </div>
          <div className="queue-list">
            {campaigns.length === 0 ? (
              <div className="queue-item">
                <div className="queue-item-title" style={{ color: 'var(--dim)' }}>No campaigns yet</div>
              </div>
            ) : (
              campaigns.map(c => (
                <div
                  key={c.id}
                  className={`queue-item-with-delete ${c.id === selectedCampaignId ? 'is-selected' : ''}`}
                >
                  <div className="queue-item-content" onClick={() => onSelectCampaign(c.id)}>
                    <div className="queue-item-title">{c.name}</div>
                    <div className="queue-item-meta">{formatDate(c.createdAt)}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-delete-item"
                    onClick={(e) => { e.stopPropagation(); deleteCampaign(c.id) }}
                    title={confirmDeleteId === c.id ? 'Confirm delete' : 'Delete'}
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="queue-footer">
            <button type="button" className="btn btn-outline btn-full" onClick={newCampaign}>
              + New Campaign
            </button>
          </div>
        </div>

        <div className="editor campaign-editor">
          <div className="editor-head">
            <div className="editor-head-row">
              <div>
                <div className="editor-title">{draft?.name || 'Select a campaign'}</div>
                <div className="editor-sub">{draft?.createdAt ? formatDate(draft.createdAt) : ''}</div>
              </div>
              {draft && (
                <button
                  type="button"
                  className="btn primary btn-sm"
                  onClick={saveCampaign}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : saveFlash.flash === 'done' ? 'Saved' : saveFlash.flash === 'error' ? 'Failed' : 'Save'}
                </button>
              )}
            </div>
          </div>

          {draft && (
            <div className="campaign-form">
              <div className="campaign-top-row">
                <input
                  type="text"
                  className="input campaign-name-input"
                  placeholder="Campaign name..."
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <div className="campaign-tabs">
                  <button
                    type="button"
                    className={`tab-btn ${activeTab === 'brief' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('brief')}
                  >
                    Brief
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${activeTab === 'sequence' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('sequence')}
                  >
                    Sequence
                  </button>
                </div>
              </div>

              {activeTab === 'brief' && (
                <div className="tab-content">
                  <div className="campaign-overview-row">
                    <div className="field">
                      <label className="mini-label">Target Batch</label>
                      <select
                        className="input"
                        value={draft.targetImportBatchIds[0] || ''}
                        onChange={(e) => setDraft({
                          ...draft,
                          targetImportBatchIds: e.target.value ? [parseInt(e.target.value)] : []
                        })}
                      >
                        <option value="">All leads</option>
                        {batches.map(b => (
                          <option key={b.id} value={b.id}>{b.filename}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field field-mini">
                      <label className="mini-label">AI Voice</label>
                      <select
                        className="input"
                        value={draft.aiVoice}
                        onChange={(e) => setDraft({ ...draft, aiVoice: e.target.value })}
                      >
                        <option value="founder">Founder (I built…)</option>
                        <option value="company">Company (We help…)</option>
                      </select>
                    </div>
                    <div className="field field-mini">
                      <label className="mini-label">Email language</label>
                      <select
                        className="input"
                        value={draft.outputLanguage || 'en'}
                        onChange={(e) => setDraft({ ...draft, outputLanguage: e.target.value })}
                      >
                        {OUTPUT_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="field-hint" style={{ marginTop: '-0.35rem', marginBottom: '0.65rem' }}>
                    Write the brief in English; AI writes emails in the language above.
                    {draft.id > 0 &&
                      savedOutputLanguageRef.current != null &&
                      (draft.outputLanguage || 'en') !== savedOutputLanguageRef.current && (
                        <> Regenerate previews — saved overrides are still in the previous language.</>
                      )}
                  </p>

                  <div className="field field-grow">
                    <div className="pitch-block-head">
                      <label className="mini-label">
                        Campaign brief
                        <InlineHint hint={briefHint} />
                      </label>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={!draft.targetImportBatchIds[0] || suggestingPitch}
                        onClick={suggestBrief}
                      >
                        {suggestingPitch ? 'Analyzing...' : 'Suggest from leads'}
                      </button>
                    </div>
                    <AutoResizeTextarea
                      value={draft.pitchBlock}
                      onChange={(e) => setDraft({ ...draft, pitchBlock: e.target.value })}
                      placeholder={BRIEF_PLACEHOLDER}
                      rows={12}
                    />
                    {briefTooShort && (
                      <p className="field-hint inline-hint inline-hint--warn">
                        Add a brief description ({MIN_BRIEF_LENGTH}+ characters) so AI can personalize emails.
                      </p>
                    )}
                    <p className="field-hint">
                      Include what you sell, who it&apos;s for, pain, offer, and tone. Put sign-off in each step template where it belongs. Select a target batch to use Suggest from leads.
                    </p>
                  </div>

                  <div className="merge-tags">
                    <div className="mini-label">Merge tags (manual templates only)</div>
                    <div className="tags-list">
                      <code>{'{{first_name}}'}</code>
                      <code>{'{{current_employer}}'}</code>
                      <code>{'{{current_title}}'}</code>
                      <code>{'{{industry}}'}</code>
                      <code>{'{{pitch_block}}'}</code>
                      <code>{'{{sender_info}}'}</code>
                      <code>{'{{sender_name}}'}</code>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'sequence' && (
                <div className="tab-content">
                  <div className="sequences-header">
                    <div>
                      <div className="mini-label">Email sequence</div>
                      <p className="field-hint">
                        AI on: merges your templates and fills missing lead fields. AI off: manual merge only.
                      </p>
                    </div>
                    <div className="sequences-header-actions">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={previewAllLoading || previewLead?.isSample !== false}
                        onClick={async () => {
                          setPreviewAllLoading(true)
                          try {
                            await previewAllSteps()
                          } finally {
                            setPreviewAllLoading(false)
                          }
                        }}
                      >
                        {previewAllLoading ? 'Previewing…' : 'Preview all steps'}
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={addStep}>
                        + Add follow-up
                      </button>
                    </div>
                  </div>

                  <div className="steps-list">
                    {draft.steps.map((step, i) => {
                      const viewTab = getStepViewTab(i, step, stepViewTab)
                      const mergedPreview =
                        previewLead && draft
                          ? buildMergedStepPreview(step, draft, previewLead)
                          : null

                      return (
                        <div key={i} className="step-item">
                          <div className="step-item-head">
                            <span className="step-item-title">{stepLabel(step.stepOrder)}</span>
                            {i > 0 && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => removeStep(i)}
                              >
                                ×
                              </button>
                            )}
                          </div>

                          <div className="step-item-toolbar">
                            <div className="field">
                              <label className="mini-label">Subject template</label>
                              <input
                                type="text"
                                className="input"
                                placeholder={
                                  step.useAi
                                    ? 'Optional — AI generates subject if blank'
                                    : '{{first_name}}, quick question about…'
                                }
                                value={step.subjectTemplate}
                                onChange={(e) => updateStep(i, 'subjectTemplate', e.target.value)}
                              />
                            </div>
                            <div className="step-item-toolbar-controls">
                              <div className="field step-item-option-delay">
                                <label className="mini-label">Delay (hours)</label>
                                <input
                                  type="number"
                                  className="input"
                                  value={step.delayHoursAfterPrevious}
                                  disabled={i === 0}
                                  onChange={(e) =>
                                    updateStep(i, 'delayHoursAfterPrevious', parseFloat(e.target.value) || 0)
                                  }
                                />
                              </div>
                              <div className="field step-item-option-format">
                                <label className="mini-label">Body format</label>
                                <div className="step-format-tabs" role="group" aria-label="Body format">
                                  <button
                                    type="button"
                                    className={`step-format-tab ${viewTab === 'plain' ? 'is-active' : ''}`}
                                    onClick={() => {
                                      updateStep(i, 'bodyFormat', 'plain')
                                      setStepView(i, 'plain')
                                    }}
                                  >
                                    Plain
                                  </button>
                                  <button
                                    type="button"
                                    className={`step-format-tab ${viewTab === 'html' ? 'is-active' : ''}`}
                                    onClick={() => {
                                      updateStep(i, 'bodyFormat', 'html')
                                      setStepView(i, 'html')
                                    }}
                                  >
                                    HTML
                                  </button>
                                  <button
                                    type="button"
                                    className={`step-format-tab ${viewTab === 'preview' ? 'is-active' : ''}`}
                                    onClick={() => setStepView(i, 'preview')}
                                  >
                                    Preview
                                  </button>
                                </div>
                              </div>
                              <div className="field step-item-ai-field">
                                <label className="mini-label">Generate with AI</label>
                                <button
                                  type="button"
                                  className={`btn btn-outline btn-sm step-item-ai-btn ${step.useAi ? 'step-item-ai-btn--on' : 'step-item-ai-btn--off'}`}
                                  onClick={() => updateStep(i, 'useAi', !step.useAi)}
                                >
                                  <span
                                    className={`step-item-ai-dot ${step.useAi ? 'step-item-ai-dot--on' : 'step-item-ai-dot--off'}`}
                                  />
                                  {step.useAi ? 'Enabled' : 'Enable'}
                                </button>
                              </div>
                            </div>
                          </div>

                          {viewTab === 'preview' ? (
                            <div className="field step-item-preview-wrap">
                              <label className="mini-label">Body template</label>
                              {step.useAi ? (
                                previewLead?.isSample ? (
                                  <p className="step-item-preview-hint">
                                    Import leads into your target batch to preview AI personalization for a real lead.
                                  </p>
                                ) : aiPreviewLoading[i] && !aiPreviews[i] ? (
                                  <p className="step-item-preview-hint">Generating AI preview for first lead…</p>
                                ) : aiPreviewError[i] && !aiPreviews[i] ? (
                                  <p className="step-item-preview-hint">{aiPreviewError[i]}</p>
                                ) : aiPreviews[i] && previewLead ? (
                                  <div className="step-item-preview">
                                    <EmailInboxPreview
                                      subject={aiPreviews[i]!.subject}
                                      body={aiPreviews[i]!.body}
                                      bodyFormat={aiPreviews[i]!.bodyFormat}
                                      htmlPreview={aiPreviews[i]!.htmlPreview}
                                      fromEmail={senderFrom.email}
                                      fromName={senderFrom.name}
                                      toName={previewLead.label}
                                      toEmail={previewLead.email}
                                    />
                                    {renderPreviewFooter(
                                      i,
                                      <>
                                        {aiPreviewLoading[i] ? 'Refreshing… · ' : ''}
                                        {aiPreviews[i]!.bodyFormat === 'html' ? 'HTML format' : 'Plain text format'}
                                        {' · '}
                                        First lead — {previewLead.label}
                                        {' · '}
                                        <button
                                          type="button"
                                          className="step-item-preview-refresh"
                                          onClick={() => void ensureStepPreviewChain(i, { force: true })}
                                        >
                                          Refresh preview
                                        </button>
                                      </>,
                                      {
                                        subject: aiPreviews[i]!.subject,
                                        body: aiPreviews[i]!.body,
                                        bodyFormat: aiPreviews[i]!.bodyFormat,
                                      }
                                    )}
                                  </div>
                                ) : (
                                  <p className="step-item-preview-hint">
                                    Open Preview to generate email for the first lead.
                                  </p>
                                )
                              ) : !step.bodyTemplate.trim() && !step.subjectTemplate.trim() ? (
                                <p className="step-item-preview-hint">
                                  Add a subject or body template to preview.
                                </p>
                              ) : mergedPreview && previewLead ? (
                                <div className="step-item-preview">
                                  <EmailInboxPreview
                                    subject={mergedPreview.mergedSubject}
                                    body={mergedPreview.mergedBody}
                                    bodyFormat={mergedPreview.bodyFormat}
                                    htmlPreview={mergedPreview.htmlPreview}
                                    fromEmail={senderFrom.email}
                                    fromName={senderFrom.name}
                                    toName={previewLead.label}
                                    toEmail={previewLead.email}
                                  />
                                  {renderPreviewFooter(
                                    i,
                                    <>
                                      {mergedPreview.bodyFormat === 'html' ? 'HTML format' : 'Plain text format'}
                                      {' · '}
                                      {previewLead.isSample
                                        ? 'Preview uses sample data — variables like {{first_name}} → John'
                                        : `Preview uses first lead — {{first_name}} → ${previewLead.data.first_name || previewLead.label}`}
                                    </>,
                                    {
                                      subject: mergedPreview.mergedSubject,
                                      body: mergedPreview.mergedBody,
                                      bodyFormat: mergedPreview.bodyFormat,
                                    }
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="field">
                              <label className="mini-label">Body template</label>
                              <AutoResizeTextarea
                                placeholder={
                                  (step.bodyFormat || 'plain') === 'html'
                                    ? '<p>Hi {{first_name}},</p><p>...</p>'
                                    : 'Body with merge tags like {{first_name}}, {{pitch_block}}, {{sender_info}}...'
                                }
                                value={step.bodyTemplate}
                                onChange={(e) => updateStep(i, 'bodyTemplate', e.target.value)}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="step-footer">
        <div className="footer-left">
          <span className="footer-text">
            {selectedCampaign ? `Campaign: ${selectedCampaign.name}` : ''}
          </span>
        </div>
        <div className="footer-right">
          <button
            type="button"
            className="btn primary"
            disabled={!selectedCampaignId || briefTooShort}
            onClick={onNextStep}
          >
            Next: Preview →
          </button>
        </div>
      </footer>
    </section>
  )
}
