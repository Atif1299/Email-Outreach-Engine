import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { outreach } from '@/lib/outreachApi'
import type { Campaign, Lead } from '@/shared/types'
import type { CampaignWithSteps } from '@/lib/outreachApi'
import type { QueueStatus } from '@/shared/types'
import { Panel } from '@/components/ui/Panel'
import { FieldHint, FieldLabel } from '@/components/ui/FieldLabel'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'

export function SendStep({
  leadVersion,
  selectedIds,
  setSelectedIds,
  preferredCampaignId,
}: {
  leadVersion: number
  selectedIds: Set<number>
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>
  preferredCampaignId: number | null
}) {
  const api = outreach()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState<number | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [due, setDue] = useState(0)
  const [status, setStatus] = useState<QueueStatus | null>(null)
  const [cw, setCw] = useState<CampaignWithSteps | null>(null)
  const [previewLead, setPreviewLead] = useState<number | null>(null)
  const [previewStep, setPreviewStep] = useState(1)
  /** How many leads to call OpenAI for in parallel per wave (“Generate all”). */
  const [aiBatchSize, setAiBatchSize] = useState(3)
  const [previewText, setPreviewText] = useState('')
  const [aiNote, setAiNote] = useState('')
  const [queueTab, setQueueTab] = useState<'prepare' | 'run'>('prepare')
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkCurrent, setBulkCurrent] = useState(0)
  const [bulkTotal, setBulkTotal] = useState(0)
  /** One AI body per lead id after “Generate all”; pick Lead below to view (like list → detail). */
  const [bulkBodies, setBulkBodies] = useState<Record<number, string>>({})
  const [bulkErrors, setBulkErrors] = useState<Record<number, string>>({})
  /** Lead order from last bulk run — for ‹ › navigation */
  const [bulkOrderIds, setBulkOrderIds] = useState<number[]>([])
  /** Set after a successful “Use AI bodies for sending” for the matching campaign + step (UI selected state). */
  const [aiBodiesSavedScope, setAiBodiesSavedScope] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([api.campaignsList(), api.leadsList()])
    setCampaigns(c)
    setLeads(l as Lead[])
    setCampaignId((prev) => {
      if (preferredCampaignId != null && c.some((x) => x.id === preferredCampaignId)) {
        return preferredCampaignId
      }
      return prev != null ? prev : c[0]?.id ?? null
    })
  }, [api, preferredCampaignId])

  useEffect(() => {
    void load()
  }, [load, leadVersion])

  /** Drop stale lead ids (e.g. after re-import); if none left, select everyone so Queue stats match DB. */
  useEffect(() => {
    if (leads.length === 0) return
    const validIds = new Set(leads.map((l) => l.id))
    setSelectedIds((prev) => {
      const next = new Set<number>()
      for (const id of prev) {
        if (validIds.has(id)) next.add(id)
      }
      if (next.size > 0) return next
      return new Set(validIds)
    })
  }, [leads, setSelectedIds])

  useEffect(() => {
    if (preferredCampaignId != null) setCampaignId(preferredCampaignId)
  }, [preferredCampaignId])

  useEffect(() => {
    if (!campaignId) {
      setCw(null)
      return
    }
    void api.campaignGet(campaignId).then(setCw)
  }, [api, campaignId])

  useEffect(() => {
    const handler = (_e: unknown, st: QueueStatus) => setStatus(st)
    window.ipcRenderer.on('queue:status', handler)
    void api.queueStatus().then(setStatus)
    const t = setInterval(() => void api.queueStatus().then(setStatus), 2000)
    return () => {
      window.ipcRenderer.off('queue:status', handler)
      clearInterval(t)
    }
  }, [api])

  useEffect(() => {
    if (campaignId == null || selectedIds.size === 0) {
      setDue(0)
      return
    }
    void api
      .computeDue({ campaignId, leadIds: [...selectedIds] })
      .then((j) => setDue(j.length))
  }, [api, campaignId, selectedIds])

  useEffect(() => {
    setAiBodiesSavedScope(null)
  }, [campaignId, previewStep])

  useEffect(() => {
    setPreviewText('')
  }, [previewLead, previewStep, campaignId])

  const isAiBodiesSaveActive =
    campaignId != null && aiBodiesSavedScope === `${campaignId}-${previewStep}`

  const runPreview = async () => {
    if (!campaignId || !previewLead) return
    /** Template merge only for this preview so it does not duplicate “Generate all” AI output below. Overrides DB still wins when set. */
    const r = await api.preview({
      leadId: previewLead,
      campaignId,
      stepOrder: previewStep,
      useAiOverride: false,
    })
    setPreviewText(`${r.subject}\n\n---\n\n${r.body}`)
  }

  const runAi = async () => {
    if (!campaignId || !previewLead) return
    const r = await api.aiGenerate({
      leadId: previewLead,
      campaignId,
      stepOrder: previewStep,
      customInstructions: aiNote || undefined,
    })
    setBulkBodies((prev) => ({ ...prev, [previewLead]: r.body }))
    setBulkErrors((prev) => {
      const next = { ...prev }
      delete next[previewLead]
      return next
    })
    setBulkOrderIds((prev) => (prev.includes(previewLead) ? prev : [...prev, previewLead]))
  }

  const runBulkAi = async () => {
    if (!campaignId || selectedIds.size === 0) return
    const ids = leads.filter((l) => selectedIds.has(l.id)).map((l) => l.id)
    if (ids.length === 0) return
    setBulkRunning(true)
    setAiBodiesSavedScope(null)
    setBulkBodies({})
    setBulkErrors({})
    setBulkOrderIds(ids)
    setBulkTotal(ids.length)
    setBulkCurrent(0)
    const batch = Math.max(1, Math.min(50, Number.isFinite(aiBatchSize) ? aiBatchSize : 3))
    for (let i = 0; i < ids.length; i += batch) {
      const chunk = ids.slice(i, i + batch)
      await Promise.all(
        chunk.map(async (leadId) => {
          try {
            const r = await api.aiGenerate({
              leadId,
              campaignId,
              stepOrder: previewStep,
              customInstructions: aiNote || undefined,
            })
            setBulkBodies((prev) => ({ ...prev, [leadId]: r.body }))
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setBulkErrors((prev) => ({ ...prev, [leadId]: msg }))
          }
        }),
      )
      setBulkCurrent(Math.min(i + chunk.length, ids.length))
    }
    setBulkRunning(false)
    setPreviewLead((p) => p ?? ids[0] ?? null)
  }

  const bulkNavLead = (dir: -1 | 1) => {
    if (!bulkOrderIds.length) return
    const cur = previewLead != null ? bulkOrderIds.indexOf(previewLead) : -1
    const idx = cur < 0 ? 0 : (cur + dir + bulkOrderIds.length) % bulkOrderIds.length
    setPreviewLead(bulkOrderIds[idx])
  }

  const hasBulkResults =
    Object.keys(bulkBodies).length > 0 || Object.keys(bulkErrors).length > 0

  const bulkReadyItems = Object.entries(bulkBodies).filter(
    ([id]) => bulkErrors[+id] === undefined,
  ) as [string, string][]

  const applyBodiesForSending = async () => {
    if (!campaignId || bulkReadyItems.length === 0) return
    const items = bulkReadyItems.map(([id, body]) => ({ leadId: +id, body }))
    await api.applyAiBodyOverrides({ campaignId, stepOrder: previewStep, items })
    setAiBodiesSavedScope(`${campaignId}-${previewStep}`)
  }

  const clearSavedBodiesForStep = async () => {
    if (!campaignId) return
    if (!confirm(`Remove all saved AI bodies for step ${previewStep} in this campaign?`)) return
    await api.clearStepBodyOverrides({ campaignId, stepOrder: previewStep })
    setAiBodiesSavedScope(null)
  }

  const maxStep = cw?.steps.length ?? 1
  const selectedCount = selectedIds.size

  const statusSummary =
    status != null ? (
      <p className="text-xs text-ink-muted">
        {status.running ? (
          <span className="font-medium text-accent">Running</span>
        ) : (
          <span className="text-ink-faint">Idle</span>
        )}
        <span className="text-ink-faint"> · </span>
        Paused: <span className="font-medium text-ink">{status.paused ? 'yes' : 'no'}</span>
        <span className="text-ink-faint"> · </span>
        Sent today: <span className="text-ink">{status.sendsToday}</span>
        <span className="text-ink-faint"> · </span>
        Session: <span className="text-ink">{status.processedInSession}</span>
      </p>
    ) : null

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-2 border-b border-edge pb-3"
        role="tablist"
        aria-label="Queue workflow"
      >
        <button
          type="button"
          role="tab"
          aria-selected={queueTab === 'prepare'}
          onClick={() => setQueueTab('prepare')}
          className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${queueTab === 'prepare'
            ? 'border-accent bg-accent-subtle text-ink'
            : 'border-transparent text-ink-muted hover:border-edge hover:bg-surface-raised hover:text-ink'
            }`}
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-canvas text-[11px] font-bold tabular-nums text-accent"
            aria-hidden
          >
            1
          </span>
          Prepare
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={queueTab === 'run'}
          onClick={() => setQueueTab('run')}
          className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${queueTab === 'run'
            ? 'border-accent bg-accent-subtle text-ink'
            : 'border-transparent text-ink-muted hover:border-edge hover:bg-surface-raised hover:text-ink'
            }`}
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-canvas text-[11px] font-bold tabular-nums text-accent"
            aria-hidden
          >
            2
          </span>
          Run
        </button>
      </div>

      {queueTab === 'prepare' && (
        <div className="space-y-4" role="tabpanel">
          <p className="text-sm leading-snug text-ink-muted">
            Pick the campaign and confirm who is selected, then preview merges or generate AI bodies before you start
            sending.
          </p>
          <div className="grid gap-3 md:grid-cols-2 md:items-stretch">
            <Panel title="Campaign to send">
              <select
                value={campaignId ?? ''}
                onChange={(e) => setCampaignId(+e.target.value || null)}
                className="text-sm"
              >
                <option value="">Select…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Panel>
            <Panel title="Audience summary">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Due now</p>
                  <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{due}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    Recipients selected
                  </p>
                  <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{selectedCount}</p>
                </div>
              </div>
              {status && (
                <div className="mt-3 border-t border-edge pt-3">
                  {statusSummary}
                  {status.lastError && (
                    <p className="mt-2 font-medium text-danger">Error: {status.lastError}</p>
                  )}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Preview merge and AI" description="Optional — test how templates and AI read for one lead or for everyone selected.">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] sm:items-end">
                <div className="min-w-0">
                  <FieldLabel htmlFor="preview-lead">Lead</FieldLabel>
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      type="button"
                      aria-label="Previous lead"
                      disabled={!bulkOrderIds.length}
                      onClick={() => bulkNavLead(-1)}
                      className="flex h-[2.25rem] w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-raised text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                    <select
                      id="preview-lead"
                      value={previewLead ?? ''}
                      onChange={(e) => setPreviewLead(+e.target.value || null)}
                      className="min-w-0 flex-1 text-sm"
                    >
                      <option value="">—</option>
                      {leads.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="Next lead"
                      disabled={!bulkOrderIds.length}
                      onClick={() => bulkNavLead(1)}
                      className="flex h-[2.25rem] w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-raised text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-40"
                    >
                      <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
                <div>
                  <FieldLabel htmlFor="preview-step">Step</FieldLabel>
                  <input
                    id="preview-step"
                    type="number"
                    min={1}
                    max={maxStep}
                    value={previewStep}
                    onChange={(e) =>
                      setPreviewStep(Math.min(maxStep, Math.max(1, +e.target.value)))
                    }
                    className="w-full text-sm sm:max-w-[5.5rem]"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="ai-batch-size">Batch</FieldLabel>
                  <input
                    id="ai-batch-size"
                    type="number"
                    min={1}
                    max={50}
                    title="Parallel AI requests per wave for Generate all"
                    value={aiBatchSize}
                    onChange={(e) =>
                      setAiBatchSize(Math.min(50, Math.max(1, +e.target.value || 1)))
                    }
                    disabled={bulkRunning}
                    className="w-full text-sm sm:max-w-[5.5rem]"
                  />
                </div>
                <div className="sm:justify-self-start sm:pb-0.5">
                  <SecondaryButton disabled={bulkRunning} onClick={() => void runPreview()}>
                    Preview merged
                  </SecondaryButton>
                </div>
              </div>
              <FieldHint id="ai-batch-hint">
                Batch = how many leads are generated in parallel each wave (default 3). Lower it if the API rate-limits.
              </FieldHint>
              <div>
                <FieldLabel htmlFor="preview-ai-note">Extra instructions for AI</FieldLabel>
                <input
                  id="preview-ai-note"
                  placeholder="e.g. shorter tone, mention pricing…"
                  value={aiNote}
                  onChange={(e) => setAiNote(e.target.value)}
                  aria-describedby="preview-ai-note-hint"
                  disabled={bulkRunning}
                  className="text-sm"
                />
                <FieldHint id="preview-ai-note-hint">Optional. Passed to AI only.</FieldHint>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton onClick={() => void runAi()} disabled={bulkRunning}>
                  Generate body with AI
                </SecondaryButton>
                <PrimaryButton
                  disabled={!campaignId || selectedIds.size === 0 || bulkRunning}
                  onClick={() => void runBulkAi()}
                >
                  Generate all (AI)
                </PrimaryButton>
                {isAiBodiesSaveActive ? (
                  <PrimaryButton
                    disabled={!campaignId || bulkReadyItems.length === 0 || bulkRunning}
                    onClick={() => void applyBodiesForSending()}
                    aria-pressed="true"
                    title="Saved — queue will use these AI bodies for this step"
                  >
                    Use AI bodies for sending
                  </PrimaryButton>
                ) : (
                  <SecondaryButton
                    disabled={!campaignId || bulkReadyItems.length === 0 || bulkRunning}
                    onClick={() => void applyBodiesForSending()}
                    aria-pressed="false"
                  >
                    Use AI bodies for sending
                  </SecondaryButton>
                )}
                <SecondaryButton
                  disabled={!campaignId || bulkRunning}
                  onClick={() => void clearSavedBodiesForStep()}
                >
                  Clear saved bodies (this step)
                </SecondaryButton>
              </div>
              <FieldHint id="apply-ai-hint">
                “Use AI bodies for sending” stores the generated text for this campaign step. The queue then sends that
                text instead of merging the template or calling AI again. Subject lines still come from the merged subject
                template (not AI-generated).
              </FieldHint>
              {bulkTotal > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-ink-muted">
                    {bulkRunning
                      ? `Generating… ${bulkCurrent} / ${bulkTotal} (step ${previewStep}, uses campaign pitch + each lead’s fields).`
                      : `Last run: ${bulkTotal} lead(s).`}
                  </p>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-edge">
                    <div
                      className="h-2 rounded-full bg-accent transition-[width] duration-200"
                      style={{
                        width: bulkRunning
                          ? `${(bulkCurrent / Math.max(bulkTotal, 1)) * 100}%`
                          : bulkTotal > 0 && !bulkRunning
                            ? '100%'
                            : '0%',
                      }}
                    />
                  </div>
                </div>
              )}
              {previewText && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase text-ink-faint">Template merge preview</p>
                  <textarea
                    readOnly
                    value={previewText}
                    rows={8}
                    className="font-mono text-xs"
                    aria-describedby="merge-preview-hint"
                  />
                  <FieldHint id="merge-preview-hint">
                    Subject + body from your templates and merge tags only (step “Generate body with AI” is not used here).
                    If you saved AI bodies for sending, this shows that saved text instead.
                  </FieldHint>
                </div>
              )}
              {hasBulkResults && previewLead != null && (
                <div>
                  <FieldLabel htmlFor="bulk-ai-body">
                    AI body (bulk) — {leads.find((l) => l.id === previewLead)?.email ?? previewLead}
                  </FieldLabel>
                  <textarea
                    id="bulk-ai-body"
                    readOnly
                    placeholder={
                      bulkBodies[previewLead] === undefined && bulkErrors[previewLead] === undefined
                        ? 'No result for this lead in the last bulk run (pick another lead or run Generate all again).'
                        : undefined
                    }
                    value={
                      bulkErrors[previewLead] !== undefined
                        ? `Error: ${bulkErrors[previewLead]}`
                        : bulkBodies[previewLead] ?? ''
                    }
                    rows={12}
                    className={`mt-1.5 font-mono text-xs ${bulkErrors[previewLead] !== undefined ? 'border-danger/60 text-danger-muted' : ''}`}
                  />
                  <p className="mt-1 text-xs text-ink-muted">
                    Each lead has its own saved output; switch Lead or use ‹ › to review one at a time.
                  </p>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}

      {queueTab === 'run' && (
        <div className="space-y-4" role="tabpanel">
          <p className="text-sm leading-snug text-ink-muted">
            Start, pause, or stop the sender. Due count and selection reflect the campaign and leads you set up under
            Prepare.
          </p>
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-edge bg-surface px-4 py-3 md:px-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Due now</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{due}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Recipients selected</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{selectedCount}</p>
            </div>
            {status && <div className="min-w-0 flex-1 border-l border-edge pl-4">{statusSummary}</div>}
          </div>
          {status?.lastError && (
            <p className="text-sm font-medium text-danger">Error: {status.lastError}</p>
          )}

          <Panel title="Run queue">
            <p className="mb-3 text-sm leading-snug text-ink-muted">
              Sends selected leads. Uses daily cap and delay from Connect.
            </p>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton
                disabled={!campaignId || selectedIds.size === 0}
                onClick={() => campaignId && api.queueStart({ campaignId, leadIds: [...selectedIds] })}
              >
                Start queue
              </PrimaryButton>
              <SecondaryButton onClick={() => void api.queuePause()}>Pause</SecondaryButton>
              <SecondaryButton onClick={() => void api.queueResume()}>Resume</SecondaryButton>
              <button
                type="button"
                onClick={() => void api.queueStop()}
                className="rounded-lg border border-edge px-4 py-2.5 text-sm font-medium text-danger transition-colors duration-150 hover:bg-danger-muted"
              >
                Stop
              </button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
