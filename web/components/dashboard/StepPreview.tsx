'use client'

import { useState, useEffect, useRef } from 'react'
import type { Campaign } from '@/app/dashboard/page'
import { getOutputLanguageLabel } from '@/lib/output-languages'
import { looksLikeRawPitchMerge } from '@/lib/preview-utils'
import { buildPreviewHtml, normalizeBodyFormat, type BodyFormat } from '@/lib/email-html'
import EmailInboxPreview from '@/components/dashboard/EmailInboxPreview'
import { InlineHint, useButtonFlash, useInlineHint } from '@/components/dashboard/useStepFeedback'
import type { ActiveAiBulkJob } from '@/components/dashboard/useAiBulkWorker'

interface Props {
  campaigns: Campaign[]
  previewCampaignId: number | null
  activeBulkJobs: ActiveAiBulkJob[]
  isVisible?: boolean
  onPreviewCampaignChange: (id: number | null) => void
  onNextStep: () => void
}

interface PreviewLead {
  id: number
  email: string
  firstName: string
  lastName: string
  hasSaved: boolean
}

interface PreviewContent {
  subject: string
  body: string
  bodyFormat?: BodyFormat | string
  htmlPreview?: string
}

type EditorTab = 'simple' | 'html' | 'inbox'

const MERGE_TAGS = [
  'first_name',
  'last_name',
  'current_employer',
  'current_title',
  'industry',
  'location',
  'email',
  'pitch_block',
  'sender_info',
]

type OverrideItem = { leadId: number; subject: string; body: string }

export default function StepPreview({
  campaigns,
  previewCampaignId,
  activeBulkJobs,
  isVisible = true,
  onPreviewCampaignChange,
  onNextStep,
}: Props) {
  const [stepOrder, setStepOrder] = useState(1)
  const [leads, setLeads] = useState<PreviewLead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leadsError, setLeadsError] = useState<string | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null)
  const [preview, setPreview] = useState<PreviewContent | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [bulkStarting, setBulkStarting] = useState(false)
  const [bulkPhase, setBulkPhase] = useState<'generating' | 'pausing'>('generating')
  const [pauseSecondsLeft, setPauseSecondsLeft] = useState(0)
  const [bulkProgress, setBulkProgress] = useState({
    processed: 0,
    total: 0,
    generated: 0,
    failed: 0,
    skipped: 0,
  })
  const activeBulkJob = activeBulkJobs.find(
    (j) => j.campaignId === previewCampaignId && j.stepOrder === stepOrder
  )
  const bulkActive = Boolean(
    activeBulkJob && (activeBulkJob.status === 'running' || activeBulkJob.status === 'pausing')
  )
  const bulkGenerating = bulkStarting || bulkActive
  const [savedCount, setSavedCount] = useState(0)
  const [generatedOverrides, setGeneratedOverrides] = useState<OverrideItem[]>([])
  const [failedLeadIds, setFailedLeadIds] = useState<Set<number>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [confirmRegenerateAll, setConfirmRegenerateAll] = useState(false)
  const [aiProvider, setAiProvider] = useState<{ provider: string; model: string; hasKey: boolean } | null>(null)
  const [editorTab, setEditorTab] = useState<EditorTab>('simple')
  const [senderFrom, setSenderFrom] = useState({ email: 'sender@example.com', name: 'Sender' })
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const completedJobIdRef = useRef<number | null>(null)
  const hadActiveBulkJobRef = useRef(false)
  const leadsLoadGenRef = useRef(0)
  const lastSyncedGeneratedRef = useRef(0)
  const pendingGeneratedRef = useRef(0)
  const checkmarkSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const testSendSentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [testSendTo, setTestSendTo] = useState('')
  const [testSendLoading, setTestSendLoading] = useState(false)
  const [testSendSent, setTestSendSent] = useState(false)
  const saveFlash = useButtonFlash()
  const bulkFlash = useButtonFlash()
  const { hint: previewHint, showHint: showPreviewHint } = useInlineHint()

  useEffect(() => {
    if (!isVisible) return
    fetch('/api/settings')
      .then((res) => res.json())
      .then((settings) => {
        const isGemini = settings.aiProvider === 'gemini'
        setAiProvider({
          provider: isGemini ? 'Gemini' : 'OpenAI',
          model: isGemini ? settings.geminiModel : settings.openaiModel,
          hasKey: isGemini ? settings.hasGeminiApiKey : settings.hasOpenaiKey,
        })
        const firstSmtp = settings.smtpAccounts?.[0]
        setSenderFrom({
          email: firstSmtp?.email || settings.smtpFromName || 'sender@example.com',
          name: settings.smtpFromName || firstSmtp?.label || 'Sender',
        })
      })
      .catch(() => { })
  }, [isVisible])

  const selectedCampaign = campaigns.find((c) => c.id === previewCampaignId)
  const steps = selectedCampaign?.steps || []
  const currentStep = steps.find((s) => s.stepOrder === stepOrder)
  const stepBodyFormat = normalizeBodyFormat(currentStep?.bodyFormat)

  useEffect(() => {
    setEditorTab(stepBodyFormat === 'html' ? 'html' : 'simple')
  }, [stepBodyFormat, stepOrder, previewCampaignId])

  const unsavedCount = leads.filter((l) => !l.hasSaved).length

  useEffect(() => {
    if (!previewCampaignId || !isVisible) return
    lastSyncedGeneratedRef.current = 0
    void loadPreviewLeads()
  }, [previewCampaignId, stepOrder, isVisible])

  function scheduleCheckmarkSync(generated: number) {
    if (generated <= lastSyncedGeneratedRef.current) return
    pendingGeneratedRef.current = Math.max(pendingGeneratedRef.current, generated)
    if (checkmarkSyncTimerRef.current) clearTimeout(checkmarkSyncTimerRef.current)
    checkmarkSyncTimerRef.current = setTimeout(() => {
      checkmarkSyncTimerRef.current = null
      const target = pendingGeneratedRef.current
      pendingGeneratedRef.current = 0
      void loadPreviewLeads(true).then(() => {
        lastSyncedGeneratedRef.current = target
      })
    }, 800)
  }

  async function syncBulkJobStatus() {
    if (!previewCampaignId) return
    try {
      const res = await fetch(
        `/api/ai-generate/bulk/status?campaignId=${previewCampaignId}&stepOrder=${stepOrder}`
      )
      if (!res.ok) return
      const data = await res.json()
      const job = data.job as {
        id: number
        status: 'running' | 'pausing' | 'completed' | 'cancelled' | 'failed'
        total: number
        processed: number
        generated: number
        failed: number
        skipped: number
      } | null

      if (job && (job.status === 'running' || job.status === 'pausing')) {
        setBulkProgress({
          processed: job.processed,
          total: job.total,
          generated: job.generated,
          failed: job.failed,
          skipped: job.skipped,
        })
        scheduleCheckmarkSync(job.generated)
      }

      if (job?.status === 'completed' && completedJobIdRef.current !== job.id) {
        completedJobIdRef.current = job.id
        setBulkStarting(false)
        bulkFlash.flashDone()
        showPreviewHint(
          `Done: ${job.generated} generated, ${job.skipped} skipped, ${job.failed} failed`,
          job.failed > 0 ? 'warn' : 'ok'
        )
        await loadPreviewLeads()
        return
      }

      if (job?.status === 'cancelled' && completedJobIdRef.current !== job.id) {
        completedJobIdRef.current = job.id
        setBulkStarting(false)
        await loadPreviewLeads()
      }
    } catch {
      // ignore transient poll errors
    }
  }

  useEffect(() => {
    if (!activeBulkJob) {
      if (hadActiveBulkJobRef.current) {
        setBulkStarting(false)
        hadActiveBulkJobRef.current = false
        void syncBulkJobStatus()
        void loadPreviewLeads(true)
      }
      return
    }

    hadActiveBulkJobRef.current = true
    setBulkStarting(false)
    setBulkPhase(activeBulkJob.status === 'pausing' ? 'pausing' : 'generating')
    if (activeBulkJob.batchPauseUntil) {
      const sec = Math.max(
        0,
        Math.ceil((new Date(activeBulkJob.batchPauseUntil).getTime() - Date.now()) / 1000)
      )
      setPauseSecondsLeft(sec)
    } else {
      setPauseSecondsLeft(0)
    }
    setBulkProgress({
      processed: activeBulkJob.processed,
      total: activeBulkJob.total,
      generated: activeBulkJob.generated,
      failed: activeBulkJob.failed,
      skipped: activeBulkJob.skipped,
    })
    setFailedLeadIds(new Set(activeBulkJob.failedLeadIds))
    scheduleCheckmarkSync(activeBulkJob.generated)
  }, [activeBulkJob])

  useEffect(() => {
    if (!previewCampaignId || !isVisible || (!activeBulkJob && !bulkStarting)) return
    const startDelay = setTimeout(() => void syncBulkJobStatus(), 1500)
    const interval = setInterval(() => void syncBulkJobStatus(), 2000)
    return () => {
      clearTimeout(startDelay)
      clearInterval(interval)
    }
  }, [previewCampaignId, stepOrder, activeBulkJob?.id, activeBulkJob?.status, bulkStarting, isVisible])

  async function loadPreviewLeads(silent = false) {
    if (!previewCampaignId) return
    const gen = ++leadsLoadGenRef.current
    if (!silent) {
      setLeadsLoading(true)
      setLeadsError(null)
    }
    try {
      const res = await fetch(`/api/preview/leads?campaignId=${previewCampaignId}&stepOrder=${stepOrder}`)
      if (gen !== leadsLoadGenRef.current) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (!silent) {
          setLeads([])
          setSavedCount(0)
          setLeadsError(data.error || 'Failed to load leads')
        }
        return
      }
      const incoming: PreviewLead[] = data.leads || []
      setLeads((prev) => {
        if (silent && prev.length > 0) {
          const byId = new Map(incoming.map((l) => [l.id, l]))
          return prev.map((l) => {
            const fresh = byId.get(l.id)
            return fresh ? { ...l, hasSaved: fresh.hasSaved } : l
          })
        }
        return incoming
      })
      setSavedCount(data.savedCount || 0)
    } catch (e) {
      if (gen !== leadsLoadGenRef.current) return
      console.error('Failed to load preview leads:', e)
      if (!silent) {
        setLeads([])
        setSavedCount(0)
        setLeadsError('Failed to load leads — database may be busy. Try again.')
      }
    } finally {
      if (gen === leadsLoadGenRef.current && !silent) setLeadsLoading(false)
    }
  }

  async function loadPreview(leadId: number) {
    if (!previewCampaignId) return
    setSelectedLeadId(leadId)
    setLoadingPreview(true)
    setPreview(null)

    try {
      const res = await fetch(`/api/preview?leadId=${leadId}&campaignId=${previewCampaignId}&stepOrder=${stepOrder}`)
      if (res.ok) {
        const data = await res.json()
        setPreview({
          subject: data.subject,
          body: data.body,
          bodyFormat: data.bodyFormat ?? stepBodyFormat,
          htmlPreview: data.htmlPreview,
        })
      } else {
        const err = await res.json().catch(() => ({}))
        showPreviewHint(err.error || 'Preview failed', 'err')
      }
    } catch (e) {
      console.error('Failed to load preview:', e)
    }
    setLoadingPreview(false)
  }

  function applyPreview(data: PreviewContent) {
    setPreview({
      subject: data.subject,
      body: data.body,
      bodyFormat: data.bodyFormat ?? stepBodyFormat,
      htmlPreview:
        data.htmlPreview ??
        buildPreviewHtml(data.body, normalizeBodyFormat(data.bodyFormat ?? stepBodyFormat)),
    })
  }

  function markPreviewEdited(next: PreviewContent) {
    setPreview(next)
    if (selectedLeadId) {
      setGeneratedOverrides((prev) => {
        const rest = prev.filter((o) => o.leadId !== selectedLeadId)
        return [...rest, { leadId: selectedLeadId, subject: next.subject, body: next.body }]
      })
    }
  }

  function insertMergeTag(tag: string) {
    const token = `{{${tag}}}`
    const active = document.activeElement
    if (active === subjectRef.current && subjectRef.current) {
      const el = subjectRef.current
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      const nextSubject = el.value.slice(0, start) + token + el.value.slice(end)
      markPreviewEdited({
        ...(preview || { subject: '', body: '', bodyFormat: stepBodyFormat }),
        subject: nextSubject,
      })
      return
    }
    if (active === bodyRef.current && bodyRef.current) {
      const el = bodyRef.current
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      const nextBody = el.value.slice(0, start) + token + el.value.slice(end)
      markPreviewEdited({
        ...(preview || { subject: '', body: '', bodyFormat: stepBodyFormat }),
        body: nextBody,
        htmlPreview: buildPreviewHtml(nextBody, normalizeBodyFormat(preview?.bodyFormat ?? stepBodyFormat)),
      })
    }
  }

  async function saveCurrentPreview() {
    if (!selectedLeadId || !preview) return
    const ok = await saveOverrideBatch(
      [{ leadId: selectedLeadId, subject: preview.subject, body: preview.body }],
      false
    )
    if (ok) {
      setGeneratedOverrides((prev) => prev.filter((o) => o.leadId !== selectedLeadId))
      showPreviewHint('Saved', 'ok')
    }
  }

  async function sendTestEmail() {
    if (!preview) return
    const to = testSendTo.trim()
    if (!to.includes('@')) return

    setTestSendLoading(true)
    setTestSendSent(false)

    try {
      const res = await fetch('/api/preview/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: to,
          subject: preview.subject,
          body: preview.body,
          bodyFormat: preview.bodyFormat ?? stepBodyFormat,
        }),
      })
      if (!res.ok) return

      setTestSendSent(true)
      if (testSendSentTimerRef.current) clearTimeout(testSendSentTimerRef.current)
      testSendSentTimerRef.current = setTimeout(() => setTestSendSent(false), 2500)
    } catch {
      /* ignore */
    } finally {
      setTestSendLoading(false)
    }
  }

  async function generateMerge() {
    if (!selectedLeadId || !previewCampaignId) return
    setLoadingPreview(true)

    try {
      const res = await fetch(`/api/preview?leadId=${selectedLeadId}&campaignId=${previewCampaignId}&stepOrder=${stepOrder}&useAi=false`)
      if (res.ok) {
        applyPreview(await res.json())
      }
    } catch (e) {
      showPreviewHint('Preview failed', 'err')
    }
    setLoadingPreview(false)
  }

  async function generateAI() {
    if (!selectedLeadId || !previewCampaignId) return
    setAiLoading(true)

    try {
      const res = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLeadId, campaignId: previewCampaignId, stepOrder }),
      })
      if (res.ok) {
        const data = await res.json()
        applyPreview(data)
        setGeneratedOverrides((prev) => [...prev, { leadId: selectedLeadId, ...data }])
      } else {
        const err = await res.json().catch(() => ({}))
        showPreviewHint(err.error || 'AI failed', 'err')
      }
    } catch (e) {
      showPreviewHint('AI failed', 'err')
    }
    setAiLoading(false)
  }

  async function saveOverrideBatch(items: OverrideItem[], silent = true): Promise<boolean> {
    if (items.length === 0 || !previewCampaignId) return true

    try {
      const res = await fetch('/api/preview/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: previewCampaignId, stepOrder, items }),
      })
      if (res.ok) {
        if (!silent) saveFlash.flashDone()
        await loadPreviewLeads()
        return true
      }
      if (!silent) saveFlash.flashError()
    } catch (e) {
      if (!silent) saveFlash.flashError()
    }
    return false
  }

  async function saveOverrides(overrides?: OverrideItem[], silent?: boolean) {
    const toSave = overrides || generatedOverrides
    const ok = await saveOverrideBatch(toSave, silent ?? false)
    if (ok) setGeneratedOverrides([])
  }

  async function startBulkJob(regenerateAll: boolean, leadIds?: number[]) {
    if (!previewCampaignId) return

    try {
      const settingsRes = await fetch('/api/settings')
      if (settingsRes.ok) {
        const settings = await settingsRes.json()
        const isGemini = settings.aiProvider === 'gemini'
        const hasKey = isGemini ? settings.hasGeminiApiKey : settings.hasOpenaiKey
        if (!hasKey) {
          const provider = isGemini ? 'Gemini' : 'OpenAI'
          showPreviewHint(`${provider} API key required — add it in Connect first`, 'err')
          return
        }
      }
    } catch {
      showPreviewHint('Could not verify AI provider settings', 'err')
      return
    }

    try {
      setBulkStarting(true)
      setBulkPhase('generating')
      setFailedLeadIds(new Set())
      lastSyncedGeneratedRef.current = 0
      setBulkProgress({
        processed: 0,
        total: regenerateAll ? leads.length : unsavedCount,
        generated: 0,
        failed: 0,
        skipped: 0,
      })

      const res = await fetch('/api/ai-generate/bulk/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: previewCampaignId,
          stepOrder,
          regenerateAll,
          leadIds,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBulkStarting(false)
        showPreviewHint(data.error || 'Failed to start bulk AI', 'err')
        return
      }

      completedJobIdRef.current = null
      if (data.job) {
        setBulkProgress({
          processed: data.job.processed ?? 0,
          total: data.job.total ?? 0,
          generated: data.job.generated ?? 0,
          failed: data.job.failed ?? 0,
          skipped: data.job.skipped ?? 0,
        })
      }
      showPreviewHint('Bulk AI started — keeps running if you leave this page', 'ok')
      void syncBulkJobStatus()
    } catch {
      setBulkStarting(false)
      showPreviewHint('Failed to start bulk AI', 'err')
    }
  }

  function bulkGenerateAI() {
    if (!previewCampaignId || leads.length === 0 || unsavedCount === 0) return

    if (!confirmBulk) {
      setConfirmBulk(true)
      setConfirmRegenerateAll(false)
      return
    }
    setConfirmBulk(false)
    void startBulkJob(false)
  }

  async function retryFailed() {
    if (!previewCampaignId || failedLeadIds.size === 0) return
    void startBulkJob(false, Array.from(failedLeadIds))
  }

  function cancelBulkConfirm() {
    setConfirmBulk(false)
    setConfirmRegenerateAll(false)
  }

  async function stopBulkGenerate() {
    if (!previewCampaignId) return
    try {
      await fetch('/api/ai-generate/bulk/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: previewCampaignId,
          stepOrder,
          jobId: activeBulkJob?.id,
        }),
      })
      showPreviewHint('Bulk AI stopped', 'warn')
      setBulkStarting(false)
      await loadPreviewLeads()
    } catch {
      showPreviewHint('Failed to stop bulk AI', 'err')
    }
  }

  const selectedLead = leads.find((l) => l.id === selectedLeadId)

  return (
    <section className="step-view">
      <div className="step-body split preview-split">
        <div className="queue">
          <div className="queue-head">
            <div className="queue-head-row">
              <div className="queue-title">Leads</div>
              <div className="queue-sub">{leads.length} leads</div>
            </div>
          </div>
          <div className="preview-controls">
            <select
              className="input"
              value={previewCampaignId || ''}
              onChange={(e) => onPreviewCampaignChange(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Select campaign...</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              className="input"
              value={stepOrder}
              onChange={(e) => setStepOrder(parseInt(e.target.value))}
            >
              {steps.map((s) => (
                <option key={s.stepOrder} value={s.stepOrder}>
                  Step {s.stepOrder}{s.useAi ? ' (AI)' : ''}
                </option>
              ))}
            </select>
          </div>
          {selectedCampaign && (
            <p className="field-hint" style={{ padding: '0 0.5rem 0.35rem' }}>
              AI: <strong>{aiProvider?.provider || '...'}</strong> ({aiProvider?.model || '...'}){' '}
              {aiProvider && !aiProvider.hasKey && <span style={{ color: 'var(--err)' }}>— no API key!</span>}
              {aiProvider?.hasKey && <span style={{ color: 'var(--ok)' }}>✓</span>}
              {' · '}Language: <strong>{getOutputLanguageLabel(selectedCampaign.outputLanguage)}</strong>
              {' · '}✓ = saved preview (use <strong>Regenerate all AI</strong> if body shows raw pitch labels)
            </p>
          )}
          <div className="queue-list">
            {leadsLoading && leads.length === 0 ? (
              <div className="queue-item">
                <div className="queue-item-title" style={{ color: 'var(--dim)' }}>Loading leads…</div>
              </div>
            ) : leadsError ? (
              <div className="queue-item">
                <div className="queue-item-title" style={{ color: 'var(--err)' }}>{leadsError}</div>
                <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => void loadPreviewLeads()}>
                  Retry
                </button>
              </div>
            ) : leads.length === 0 ? (
              <div className="queue-item">
                <div className="queue-item-title" style={{ color: 'var(--dim)' }}>No leads in campaign</div>
              </div>
            ) : (
              leads.map((lead) => (
                <div
                  key={lead.id}
                  className={`queue-item ${lead.id === selectedLeadId ? 'is-selected' : ''}`}
                  onClick={() => loadPreview(lead.id)}
                >
                  <div className="queue-item-title">
                    {lead.firstName} {lead.lastName} {lead.hasSaved ? '✓' : ''}
                  </div>
                  <div className="queue-item-meta">{lead.email}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="editor preview-editor">
          <div className="editor-head">
            <div className="editor-head-row">
              <div>
                <div className="editor-title">
                  {loadingPreview ? 'Loading...' : (selectedLead ? `${selectedLead.firstName} ${selectedLead.lastName}`.trim() || selectedLead.email : 'Select a lead')}
                  <InlineHint hint={previewHint} />
                </div>
                <div className="editor-sub">{selectedLead?.email || ''}</div>
              </div>
              <div className="preview-head-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={generateMerge}
                  disabled={!selectedLeadId || loadingPreview || aiLoading || bulkGenerating}
                >
                  Merge
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={generateAI}
                  disabled={!selectedLeadId || loadingPreview || aiLoading || bulkGenerating}
                >
                  {aiLoading ? 'Generating...' : 'AI'}
                </button>
              </div>
            </div>
          </div>

          {preview && (
            <div className="preview-content email-write-panel">
              {looksLikeRawPitchMerge(preview.body) && stepBodyFormat === 'plain' && (
                <p className="field-hint inline-hint inline-hint--warn" style={{ marginBottom: '0.65rem' }}>
                  This looks like a template merge (raw pitch block), not AI. Click <strong>AI</strong> or run{' '}
                  <strong>Regenerate all AI</strong> for Step {stepOrder}.
                </p>
              )}

              <div className="email-write-vars">
                <span className="mini-label">Variables</span>
                <div className="tags-list">
                  {MERGE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="tag-chip"
                      onClick={() => insertMergeTag(tag)}
                    >
                      {`{{${tag}}}`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="email-editor-tabs preview-editor-tabs">
                <button
                  type="button"
                  className={`email-editor-tab ${editorTab === 'simple' ? 'is-active' : ''}`}
                  onClick={() => setEditorTab('simple')}
                >
                  Simple
                </button>
                <button
                  type="button"
                  className={`email-editor-tab ${editorTab === 'html' ? 'is-active' : ''}`}
                  onClick={() => setEditorTab('html')}
                >
                  HTML
                </button>
                <button
                  type="button"
                  className={`email-editor-tab ${editorTab === 'inbox' ? 'is-active' : ''}`}
                  onClick={() => setEditorTab('inbox')}
                >
                  Preview
                </button>
              </div>

              {editorTab !== 'inbox' && (
                <div className="field preview-subject-field">
                  <label className="mini-label">Subject</label>
                  <input
                    ref={subjectRef}
                    type="text"
                    className="input"
                    value={preview.subject}
                    onChange={(e) =>
                      markPreviewEdited({ ...preview, subject: e.target.value })
                    }
                    placeholder="Quick question, {{first_name}}"
                  />
                </div>
              )}

              <div className="field preview-body-field">
                {editorTab === 'simple' && (
                  <textarea
                    ref={bodyRef}
                    className="input textarea email-body-editor"
                    rows={12}
                    value={preview.body}
                    onChange={(e) =>
                      markPreviewEdited({
                        ...preview,
                        body: e.target.value,
                        htmlPreview: buildPreviewHtml(
                          e.target.value,
                          normalizeBodyFormat(preview.bodyFormat ?? stepBodyFormat)
                        ),
                      })
                    }
                    placeholder="Hi {{first_name}}, ..."
                  />
                )}

                {editorTab === 'html' && (
                  <textarea
                    ref={bodyRef}
                    className="input textarea email-body-editor email-body-editor--html"
                    rows={12}
                    spellCheck={false}
                    value={preview.body}
                    onChange={(e) =>
                      markPreviewEdited({
                        ...preview,
                        body: e.target.value,
                        htmlPreview: buildPreviewHtml(e.target.value, 'html'),
                      })
                    }
                    placeholder="<p>Hi {{first_name}},</p>"
                  />
                )}

                {editorTab === 'inbox' && (
                  <div className="preview-inbox-wrap">
                    <EmailInboxPreview
                      subject={preview.subject}
                      body={preview.body}
                      bodyFormat={preview.bodyFormat ?? stepBodyFormat}
                      htmlPreview={preview.htmlPreview}
                      fromEmail={senderFrom.email}
                      fromName={senderFrom.name}
                      toName={[selectedLead?.firstName, selectedLead?.lastName].filter(Boolean).join(' ')}
                      toEmail={selectedLead?.email}
                    />
                  </div>
                )}
              </div>

              <div className="preview-editor-actions">
                <div className="preview-editor-actions-send">
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
                    disabled={!preview.subject.trim() || !preview.body.trim() || testSendLoading || bulkGenerating}
                    onClick={() => void sendTestEmail()}
                  >
                    {testSendLoading ? 'Sending…' : testSendSent ? 'Sent' : 'Send test'}
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={saveCurrentPreview}
                  disabled={!selectedLeadId || bulkGenerating}
                >
                  Save this lead
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="step-footer">
        {bulkGenerating && (
          <div className="bulk-progress bulk-progress--footer">
            <div className="progress-head">
              <span className="progress-label">
                Step {stepOrder} ·{' '}
                {bulkPhase === 'pausing'
                  ? `Pausing ${pauseSecondsLeft}s until next batch…`
                  : 'Generating in background…'}
              </span>
              <span className="progress-count">
                {bulkProgress.generated}/{bulkProgress.total} · {bulkProgress.failed} failed
              </span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${bulkProgress.total ? (bulkProgress.processed / bulkProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <button type="button" className="btn btn-outline btn-sm bulk-stop-btn" onClick={() => void stopBulkGenerate()}>
              Stop generating
            </button>
          </div>
        )}
        <div className="footer-left">
          <span className="footer-text">{savedCount} saved · {unsavedCount} remaining</span>
          <span className="footer-action">
            {unsavedCount > 0 && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={bulkGenerateAI}
                disabled={bulkGenerating || leads.length === 0}
              >
                {bulkGenerating
                  ? `${bulkProgress.generated}/${bulkProgress.total}…`
                  : confirmBulk
                    ? `Confirm (${unsavedCount})`
                    : bulkFlash.flash === 'done'
                      ? 'Generated'
                      : 'Bulk Generate AI'}
              </button>
            )}
            {savedCount > 0 && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  if (confirmRegenerateAll) {
                    setConfirmRegenerateAll(false)
                    setConfirmBulk(false)
                    void startBulkJob(true)
                  } else {
                    setConfirmRegenerateAll(true)
                    setConfirmBulk(false)
                  }
                }}
                disabled={bulkGenerating || leads.length === 0}
              >
                {confirmRegenerateAll ? `Confirm regenerate (${savedCount})` : 'Regenerate All'}
              </button>
            )}
            {failedLeadIds.size > 0 && !bulkGenerating && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={retryFailed}
                style={{ color: 'var(--err)' }}
              >
                Retry Failed ({failedLeadIds.size})
              </button>
            )}
          </span>
          {(confirmBulk || confirmRegenerateAll) && (
            <button type="button" className="btn btn-outline btn-sm" onClick={cancelBulkConfirm}>
              Cancel
            </button>
          )}
        </div>
        <div className="footer-right">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => saveOverrides()}
            disabled={generatedOverrides.length === 0 || bulkGenerating}
          >
            {saveFlash.flash === 'done' ? 'Saved' : saveFlash.flash === 'error' ? 'Failed' : 'Save'}
          </button>
          <button type="button" className="btn primary" onClick={onNextStep}>
            Next: Queue →
          </button>
        </div>
      </footer>
    </section>
  )
}
