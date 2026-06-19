'use client'

import { useState, useEffect, useRef } from 'react'
import type { Campaign } from '@/app/dashboard/page'
import { InlineHint, useButtonFlash, useInlineHint } from '@/components/dashboard/useStepFeedback'

interface Props {
  campaigns: Campaign[]
  previewCampaignId: number | null
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
}

type OverrideItem = { leadId: number; subject: string; body: string }

/** Generate actively for this long, then pause before the next batch. */
const BATCH_ACTIVE_MS = 90_000
/** Break between batches — keeps each Vercel call short and avoids rate limits. */
const BATCH_PAUSE_MS = 60_000

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export default function StepPreview({
  campaigns,
  previewCampaignId,
  onPreviewCampaignChange,
  onNextStep,
}: Props) {
  const [stepOrder, setStepOrder] = useState(1)
  const [leads, setLeads] = useState<PreviewLead[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null)
  const [preview, setPreview] = useState<PreviewContent | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkPhase, setBulkPhase] = useState<'generating' | 'pausing'>('generating')
  const [pauseSecondsLeft, setPauseSecondsLeft] = useState(0)
  const [bulkProgress, setBulkProgress] = useState({
    processed: 0,
    total: 0,
    generated: 0,
    failed: 0,
    skipped: 0,
  })
  const [savedCount, setSavedCount] = useState(0)
  const [generatedOverrides, setGeneratedOverrides] = useState<OverrideItem[]>([])
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [confirmRegenerateAll, setConfirmRegenerateAll] = useState(false)
  const bulkAbortRef = useRef(false)
  const saveFlash = useButtonFlash()
  const bulkFlash = useButtonFlash()
  const { hint: previewHint, showHint: showPreviewHint } = useInlineHint()

  const selectedCampaign = campaigns.find((c) => c.id === previewCampaignId)
  const steps = selectedCampaign?.steps || []
  const unsavedCount = leads.filter((l) => !l.hasSaved).length

  useEffect(() => {
    if (previewCampaignId) {
      loadPreviewLeads()
    }
  }, [previewCampaignId, stepOrder])

  useEffect(() => {
    return () => {
      bulkAbortRef.current = true
    }
  }, [])

  async function loadPreviewLeads() {
    if (!previewCampaignId) return
    try {
      const res = await fetch(`/api/preview/leads?campaignId=${previewCampaignId}&stepOrder=${stepOrder}`)
      if (res.ok) {
        const data = await res.json()
        setLeads(data.leads || [])
        setSavedCount(data.savedCount || 0)
      }
    } catch (e) {
      console.error('Failed to load preview leads:', e)
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
        setPreview(data)
      }
    } catch (e) {
      console.error('Failed to load preview:', e)
    }
    setLoadingPreview(false)
  }

  async function generateMerge() {
    if (!selectedLeadId || !previewCampaignId) return
    setLoadingPreview(true)

    try {
      const res = await fetch(`/api/preview?leadId=${selectedLeadId}&campaignId=${previewCampaignId}&stepOrder=${stepOrder}&useAi=false`)
      if (res.ok) {
        const data = await res.json()
        setPreview(data)
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
        setPreview(data)
        setGeneratedOverrides((prev) => [...prev, { leadId: selectedLeadId, ...data }])
      } else {
        showPreviewHint('AI failed', 'err')
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

  async function pauseBetweenBatches() {
    setBulkPhase('pausing')
    const pauseSec = Math.ceil(BATCH_PAUSE_MS / 1000)
    for (let s = pauseSec; s > 0; s--) {
      if (bulkAbortRef.current) return
      setPauseSecondsLeft(s)
      await sleep(1000)
    }
    setPauseSecondsLeft(0)
    setBulkPhase('generating')
  }

  async function runBulkGenerate(regenerateAll: boolean) {
    if (!previewCampaignId || leads.length === 0) return

    bulkAbortRef.current = false
    setBulkGenerating(true)
    setBulkPhase('generating')

    const targets = regenerateAll ? leads : leads.filter((l) => !l.hasSaved)
    const sessionDone = new Set<number>()
    let generated = 0
    let failed = 0
    let skipped = 0
    let batchBuffer: OverrideItem[] = []

    setBulkProgress({
      processed: 0,
      total: targets.length,
      generated: 0,
      failed: 0,
      skipped: 0,
    })

    const updateProgress = () => {
      setBulkProgress({
        processed: generated + failed + skipped,
        total: targets.length,
        generated,
        failed,
        skipped,
      })
    }

    while (!bulkAbortRef.current) {
      const batchStart = Date.now()
      let workInBatch = false

      while (Date.now() - batchStart < BATCH_ACTIVE_MS && !bulkAbortRef.current) {
        const lead = targets.find((l) => !sessionDone.has(l.id))
        if (!lead) break

        sessionDone.add(lead.id)

        if (!regenerateAll && lead.hasSaved) {
          skipped++
          updateProgress()
          continue
        }

        workInBatch = true
        try {
          const res = await fetch('/api/ai-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId: lead.id, campaignId: previewCampaignId, stepOrder }),
          })
          if (res.ok) {
            const data = await res.json()
            batchBuffer.push({ leadId: lead.id, subject: data.subject, body: data.body })
            generated++
          } else {
            failed++
          }
        } catch (e) {
          console.error('Bulk AI error for lead', lead.id, e)
          failed++
        }
        updateProgress()
      }

      if (batchBuffer.length > 0) {
        await saveOverrideBatch(batchBuffer, true)
        batchBuffer = []
      }

      if (sessionDone.size >= targets.length) break
      if (!workInBatch) break

      await pauseBetweenBatches()
    }

    if (batchBuffer.length > 0) {
      await saveOverrideBatch(batchBuffer, true)
    }

    setBulkGenerating(false)
    setBulkPhase('generating')
    bulkFlash.flashDone()
    showPreviewHint(
      `Done: ${generated} generated, ${skipped} skipped, ${failed} failed`,
      failed > 0 ? 'warn' : 'ok'
    )
  }

  function bulkGenerateAI() {
    if (!previewCampaignId || leads.length === 0) return

    if (unsavedCount === 0) {
      if (!confirmRegenerateAll) {
        setConfirmRegenerateAll(true)
        setConfirmBulk(false)
        return
      }
      setConfirmRegenerateAll(false)
      runBulkGenerate(true)
      return
    }

    if (!confirmBulk) {
      setConfirmBulk(true)
      setConfirmRegenerateAll(false)
      return
    }
    setConfirmBulk(false)
    runBulkGenerate(false)
  }

  function cancelBulkConfirm() {
    setConfirmBulk(false)
    setConfirmRegenerateAll(false)
  }

  function stopBulkGenerate() {
    bulkAbortRef.current = true
    showPreviewHint('Stopping after current batch…', 'warn')
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
          <div className="queue-list">
            {leads.length === 0 ? (
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
            <div className="preview-content">
              <div className="field preview-subject-field">
                <label className="mini-label">Subject</label>
                <div className="preview-box">{preview.subject}</div>
              </div>
              <div className="field preview-body-field">
                <label className="mini-label">Body</label>
                <div className="preview-box preview-body">{preview.body}</div>
              </div>
            </div>
          )}

          {bulkGenerating && (
            <div className="bulk-progress">
              <div className="progress-head">
                <span className="progress-label">
                  {bulkPhase === 'pausing'
                    ? `Pausing ${pauseSecondsLeft}s until next batch…`
                    : 'Generating batch (~1.5 min)…'}
                </span>
                <span className="progress-count">
                  {bulkProgress.generated} ok · {bulkProgress.failed} failed · {bulkProgress.skipped} skipped
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
              <button type="button" className="btn btn-outline btn-sm bulk-stop-btn" onClick={stopBulkGenerate}>
                Stop after this batch
              </button>
            </div>
          )}
        </div>
      </div>

      <footer className="step-footer">
        <div className="footer-left">
          <span className="footer-text">{savedCount} saved · {unsavedCount} remaining</span>
          <span className="footer-action">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={bulkGenerateAI}
              disabled={bulkGenerating || leads.length === 0}
            >
              {bulkGenerating
                ? `${bulkProgress.generated}/${bulkProgress.total}…`
                : confirmRegenerateAll
                  ? `Confirm regenerate all (${leads.length})`
                  : confirmBulk
                    ? `Confirm bulk (${unsavedCount})`
                    : bulkFlash.flash === 'done'
                      ? 'Generated'
                      : unsavedCount === 0
                        ? 'Regenerate all AI'
                        : 'Bulk Generate AI'}
            </button>
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
