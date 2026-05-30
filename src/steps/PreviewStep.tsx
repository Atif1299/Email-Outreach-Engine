import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { outreach } from '@/lib/outreachApi'
import type { Campaign, Lead } from '@/shared/types'
import type { CampaignWithSteps } from '@/lib/outreachApi'
import { Panel } from '@/components/ui/Panel'
import { FieldHint, FieldLabel } from '@/components/ui/FieldLabel'
import { DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons'

export function PreviewStep({
  leadVersion,
  selectedIds,
  setSelectedIds,
  preferredCampaignId,
  onValidityChange,
  onNext,
  nextLabel,
  onGoToQueue,
}: {
  leadVersion: number
  selectedIds: Set<number>
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>
  preferredCampaignId: number | null
  onValidityChange: (ok: boolean) => void
  onNext: () => void
  nextLabel: string
  onGoToQueue: (campaignId: number) => void
}) {
  const api = outreach()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState<number | null>(null)
  const [campaignLeadIds, setCampaignLeadIds] = useState<number[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [cw, setCw] = useState<CampaignWithSteps | null>(null)
  const [previewLead, setPreviewLead] = useState<number | null>(null)
  const [previewStep, setPreviewStep] = useState(1)
  const [aiBatchSize, setAiBatchSize] = useState(3)
  const [aiNote, setAiNote] = useState('')
  const [previewText, setPreviewText] = useState('')

  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewNote, setPreviewNote] = useState<string | null>(null)
  const [singleAiBusy, setSingleAiBusy] = useState(false)
  const [singleAiNote, setSingleAiNote] = useState<string | null>(null)
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyNote, setApplyNote] = useState<string | null>(null)

  const [bulkState, setBulkState] = useState<'idle' | 'running' | 'paused'>('idle')
  const [bulkCurrent, setBulkCurrent] = useState(0)
  const [bulkTotal, setBulkTotal] = useState(0)
  const [bulkBodies, setBulkBodies] = useState<Record<number, string>>({})
  const [bulkErrors, setBulkErrors] = useState<Record<number, string>>({})
  const [bulkOrderIds, setBulkOrderIds] = useState<number[]>([])
  const [mergeByLead, setMergeByLead] = useState<Record<number, string>>({})
  const [aiBodiesSavedScope, setAiBodiesSavedScope] = useState<string | null>(null)
  const [nextBusy, setNextBusy] = useState(false)

  const bulkIdsRef = useRef<number[]>([])
  const bulkIndexRef = useRef(0)
  const bulkLoopActiveRef = useRef(false)
  const bulkStateRef = useRef(bulkState)
  bulkStateRef.current = bulkState

  const load = useCallback(async () => {
    const c = await api.campaignsList()
    setCampaigns(c)
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

  /** Leads + count follow the campaign selected in the dropdown (that campaign’s CSV / scope). */
  useEffect(() => {
    if (campaignId == null) {
      setCampaignLeadIds([])
      setLeads([])
      return
    }
    void (async () => {
      const ids = await api.leadIdsForCampaign(campaignId)
      setCampaignLeadIds(ids)
      const camp = campaigns.find((c) => c.id === campaignId)
      const batchId = camp?.targetImportBatchIds?.[0] ?? null
      const rows = await api.leadsList(batchId != null ? { importBatchId: batchId } : undefined)
      const idSet = new Set(ids)
      const scoped =
        batchId != null ? (rows as Lead[]) : (rows as Lead[]).filter((l) => idSet.has(l.id))
      setLeads(scoped)
      setSelectedIds((prev) => {
        const valid = new Set(ids)
        const next = new Set<number>()
        for (const id of prev) {
          if (valid.has(id)) next.add(id)
        }
        if (next.size > 0) return next
        return valid
      })
    })()
  }, [api, campaignId, campaigns, leadVersion, setSelectedIds])

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
    onValidityChange(campaignId != null)
  }, [campaignId, onValidityChange])

  useEffect(() => {
    setAiBodiesSavedScope(null)
    if (campaignId == null) {
      setBulkBodies({})
      setMergeByLead({})
      return
    }
    setBulkBodies({})
    setMergeByLead({})
    void api.listStepSavedContent({ campaignId, stepOrder: previewStep }).then((saved) => {
      const bodies: Record<number, string> = {}
      for (const { leadId, body } of saved.aiBodies) bodies[leadId] = body
      const merges: Record<number, string> = {}
      for (const { leadId, previewText } of saved.mergePreviews) merges[leadId] = previewText
      setBulkBodies(bodies)
      setMergeByLead(merges)
      if (Object.keys(bodies).length > 0) {
        setAiBodiesSavedScope(`${campaignId}-${previewStep}`)
      }
    })
  }, [api, campaignId, previewStep])

  useEffect(() => {
    if (previewLead == null) {
      setPreviewText('')
      return
    }
    setPreviewText(mergeByLead[previewLead] ?? '')
    setPreviewNote(null)
  }, [previewLead, mergeByLead])

  /** Default lead + nav order so Preview works before any bulk run. */
  useEffect(() => {
    if (!campaignId) {
      setBulkOrderIds([])
      setPreviewLead(null)
      return
    }
    if (leads.length === 0) return
    const selected = leads.filter((l) => selectedIds.has(l.id)).map((l) => l.id)
    const ids = selected.length > 0 ? selected : leads.map((l) => l.id)
    setBulkOrderIds(ids)
    setPreviewLead((p) => {
      if (p != null && ids.includes(p)) return p
      return ids[0] ?? null
    })
  }, [campaignId, leads, selectedIds])

  const isAiBodiesSaveActive =
    campaignId != null && aiBodiesSavedScope === `${campaignId}-${previewStep}`

  const maxStep = cw?.steps.length ?? 1

  const campaignLeadCount = campaignLeadIds.length

  const persistAiBodies = useCallback(
    async (items: { leadId: number; body: string }[]) => {
      if (!campaignId || items.length === 0) return
      await api.applyAiBodyOverrides({ campaignId, stepOrder: previewStep, items })
      setAiBodiesSavedScope(`${campaignId}-${previewStep}`)
    },
    [api, campaignId, previewStep],
  )

  const runPreview = async () => {
    if (!campaignId || !previewLead) return
    setPreviewBusy(true)
    setPreviewNote(null)
    try {
      const r = await api.preview({
        leadId: previewLead,
        campaignId,
        stepOrder: previewStep,
        useAiOverride: false,
      })
      const text = `${r.subject}\n\n---\n\n${r.body}`
      setPreviewText(text)
      setMergeByLead((prev) => ({ ...prev, [previewLead]: text }))
      await api.saveMergePreview({
        leadId: previewLead,
        campaignId,
        stepOrder: previewStep,
        previewText: text,
      })
      setPreviewNote('Preview updated.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPreviewNote(`Preview failed: ${msg}`)
    } finally {
      setPreviewBusy(false)
    }
  }

  const runAi = async () => {
    if (!campaignId || !previewLead) return
    setSingleAiBusy(true)
    setSingleAiNote(null)
    try {
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
      await persistAiBodies([{ leadId: previewLead, body: r.body }])
      setSingleAiNote('AI body generated and saved.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSingleAiNote(`AI failed: ${msg}`)
      setBulkErrors((prev) => ({ ...prev, [previewLead]: msg }))
    } finally {
      setSingleAiBusy(false)
    }
  }

  const processBulkFromIndex = useCallback(async () => {
    if (bulkLoopActiveRef.current) return
    if (!campaignId) return
    bulkLoopActiveRef.current = true
    try {
      const ids = bulkIdsRef.current
      const batch = Math.max(1, Math.min(50, Number.isFinite(aiBatchSize) ? aiBatchSize : 3))
      while (bulkIndexRef.current < ids.length) {
        if (bulkStateRef.current !== 'running') break
        const startIdx = bulkIndexRef.current
        const chunk = ids.slice(startIdx, startIdx + batch)
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
        bulkIndexRef.current = Math.min(startIdx + chunk.length, ids.length)
        setBulkCurrent(bulkIndexRef.current)
      }
      if (bulkIndexRef.current >= ids.length) {
        setBulkState('idle')
        setPreviewLead((p) => p ?? ids[0] ?? null)
      }
    } finally {
      bulkLoopActiveRef.current = false
    }
  }, [aiBatchSize, aiNote, api, campaignId, previewStep])

  useEffect(() => {
    if (bulkState === 'running') void processBulkFromIndex()
  }, [bulkState, processBulkFromIndex])

  const toggleBulkAi = async () => {
    if (bulkState === 'running') {
      setBulkState('paused')
      return
    }
    if (bulkState === 'paused') {
      setBulkState('running')
      return
    }
    if (!campaignId || campaignLeadCount === 0) return
    const ids = leads.filter((l) => selectedIds.has(l.id)).map((l) => l.id)
    const bulkIds = ids.length > 0 ? ids : campaignLeadIds
    if (bulkIds.length === 0) return
    bulkIdsRef.current = bulkIds
    bulkIndexRef.current = 0
    setAiBodiesSavedScope(null)
    setBulkBodies({})
    setBulkErrors({})
    setBulkOrderIds(bulkIds)
    setBulkTotal(bulkIds.length)
    setBulkCurrent(0)
    setBulkState('running')
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

  const bulkRunning = bulkState === 'running'
  const bulkPaused = bulkState === 'paused'

  const applyBodiesForSending = async () => {
    if (!campaignId || bulkReadyItems.length === 0) return
    setApplyBusy(true)
    setApplyNote(null)
    try {
      const items = bulkReadyItems.map(([id, body]) => ({ leadId: +id, body }))
      await api.applyAiBodyOverrides({ campaignId, stepOrder: previewStep, items })
      setAiBodiesSavedScope(`${campaignId}-${previewStep}`)
      setApplyNote('Saved for sending.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setApplyNote(`Save failed: ${msg}`)
    } finally {
      setApplyBusy(false)
    }
  }

  const clearSavedBodiesForStep = async () => {
    if (!campaignId) return
    if (!confirm(`Remove all saved AI bodies for step ${previewStep} in this campaign?`)) return
    setApplyBusy(true)
    setApplyNote(null)
    try {
      await api.clearStepBodyOverrides({ campaignId, stepOrder: previewStep })
      setAiBodiesSavedScope(null)
      setBulkBodies({})
      setApplyNote('Cleared.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setApplyNote(`Clear failed: ${msg}`)
    } finally {
      setApplyBusy(false)
    }
  }

  useEffect(() => {
    if (bulkState !== 'idle' || bulkTotal === 0 || !campaignId) return
    const items = Object.entries(bulkBodies)
      .filter(([id]) => bulkErrors[+id] === undefined)
      .map(([id, body]) => ({ leadId: +id, body }))
    if (items.length === 0) return
    void persistAiBodies(items)
  }, [bulkState, bulkTotal, campaignId, bulkBodies, bulkErrors, persistAiBodies])

  const handleNext = async () => {
    if (!campaignId) return
    setNextBusy(true)
    try {
      const items = Object.entries(bulkBodies)
        .filter(([id]) => bulkErrors[+id] === undefined)
        .map(([id, body]) => ({ leadId: +id, body }))
      if (items.length > 0) {
        await persistAiBodies(items)
      }
      onGoToQueue(campaignId)
      onNext()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setApplyNote(`Could not save before queue: ${msg}`)
    } finally {
      setNextBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Panel title="Preview">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem] md:items-end">
            <div>
              <FieldLabel htmlFor="preview-campaign">Campaign</FieldLabel>
              {campaigns.length === 0 ? (
                <p className="mt-1.5 text-sm leading-snug text-ink-muted">
                  No campaigns found. Go back to <span className="font-medium text-ink">Campaign</span> to create one.
                </p>
              ) : (
                <select
                  id="preview-campaign"
                  value={campaignId ?? ''}
                  onChange={(e) => setCampaignId(+e.target.value || null)}
                  className="mt-1.5 text-sm"
                >
                  <option value="">Select…</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="rounded-lg border border-edge bg-canvas/40 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Selected leads</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{campaignLeadCount}</p>
            </div>
          </div>

          <div className="space-y-3 border-t border-edge pt-3">
            {campaignId == null && (
              <p className="text-sm text-ink-muted">Select a campaign to enable preview and AI actions.</p>
            )}

            <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
              <div className="min-w-0 flex-1">
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
              <div className="flex shrink-0 flex-wrap items-end gap-3 md:flex-nowrap">
                <div className="w-[5.5rem] shrink-0">
                  <FieldLabel htmlFor="preview-step">Step</FieldLabel>
                  <input
                    id="preview-step"
                    type="number"
                    min={1}
                    max={maxStep}
                    value={previewStep}
                    onChange={(e) => setPreviewStep(Math.min(maxStep, Math.max(1, +e.target.value)))}
                    className="mt-1.5 w-full text-sm"
                  />
                </div>
                <div className="w-[5.5rem] shrink-0">
                  <FieldLabel htmlFor="ai-batch-size">Batch</FieldLabel>
                  <input
                    id="ai-batch-size"
                    type="number"
                    min={1}
                    max={50}
                    title="Parallel AI requests per wave for Generate all"
                    value={aiBatchSize}
                    onChange={(e) => setAiBatchSize(Math.min(50, Math.max(1, +e.target.value || 1)))}
                    disabled={bulkRunning}
                    className="mt-1.5 w-full text-sm"
                  />
                </div>
                <div className="min-w-[9.5rem] shrink-0">
                  <SecondaryButton
                    disabled={bulkRunning || previewBusy || campaignId == null || previewLead == null}
                    onClick={() => void runPreview()}
                    className="mt-0 w-full md:mt-[22px]"
                  >
                    {previewBusy ? 'Previewing…' : 'Preview merged'}
                  </SecondaryButton>
                </div>
              </div>
            </div>

            {previewNote && (
              <p
                className={`text-sm ${previewNote.startsWith('Preview failed:') ? 'text-danger' : 'text-ink-muted'}`}
                role={previewNote.startsWith('Preview failed:') ? 'alert' : undefined}
              >
                {previewNote}
              </p>
            )}

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
              <SecondaryButton
                onClick={() => void runAi()}
                disabled={bulkRunning || singleAiBusy || campaignId == null || previewLead == null}
              >
                {singleAiBusy ? 'Generating…' : 'Generate body with AI'}
              </SecondaryButton>
              <PrimaryButton disabled={!campaignId || campaignLeadCount === 0} onClick={() => void toggleBulkAi()}>
                {bulkRunning ? 'Pause generating' : bulkPaused ? 'Resume generating' : 'Generate all (AI)'}
              </PrimaryButton>
              <SecondaryButton
                disabled={!campaignId || bulkReadyItems.length === 0 || bulkRunning || applyBusy}
                onClick={() => void applyBodiesForSending()}
                aria-pressed={isAiBodiesSaveActive}
                title={
                  isAiBodiesSaveActive
                    ? 'Saved — queue will use these AI bodies for this step'
                    : undefined
                }
                className={
                  isAiBodiesSaveActive
                    ? 'border-accent/50 bg-accent-subtle ring-1 ring-accent/40'
                    : undefined
                }
              >
                {applyBusy ? 'Saving…' : 'Use AI bodies for sending'}
              </SecondaryButton>
              <DangerButton
                disabled={!campaignId || bulkRunning || applyBusy}
                onClick={() => void clearSavedBodiesForStep()}
              >
                {applyBusy ? 'Working…' : 'Clear saved bodies (this step)'}
              </DangerButton>
            </div>

            {singleAiNote && (
              <p
                className={`text-sm ${singleAiNote.startsWith('AI failed:') ? 'text-danger' : 'text-ink-muted'}`}
                role={singleAiNote.startsWith('AI failed:') ? 'alert' : undefined}
              >
                {singleAiNote}
              </p>
            )}
            {applyNote && (
              <p
                className={`text-sm ${applyNote.startsWith('Save failed:') || applyNote.startsWith('Clear failed:') ? 'text-danger' : 'text-ink-muted'}`}
                role={applyNote.startsWith('Save failed:') || applyNote.startsWith('Clear failed:') ? 'alert' : undefined}
              >
                {applyNote}
              </p>
            )}

            <details className="text-sm text-ink-muted">
              <summary className="cursor-pointer select-none text-ink-muted hover:text-ink">
                How saving AI bodies affects sending
              </summary>
              <div className="mt-2 pl-0.5">
                <FieldHint id="apply-ai-hint">
                  “Use AI bodies for sending” stores the generated text for this campaign step. The queue then sends that
                  text instead of merging the template or calling AI again. Subject lines still come from the merged subject
                  template (not AI-generated).
                </FieldHint>
              </div>
            </details>

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
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase text-ink-faint">Template merge preview</p>
              <textarea
                readOnly
                value={previewText}
                rows={12}
                placeholder="Click “Preview merged” to generate the merged subject + body for the selected lead."
                className="min-h-[14rem] font-mono text-xs md:min-h-[min(22rem,calc(45dvh-6rem))]"
              />
            </div>
            <div>
              <FieldLabel htmlFor="bulk-ai-body">
                AI body (bulk){previewLead != null ? ` — ${leads.find((l) => l.id === previewLead)?.email ?? previewLead}` : ''}
              </FieldLabel>
              <textarea
                id="bulk-ai-body"
                readOnly
                placeholder={
                  previewLead == null
                    ? 'Select a lead to see AI output.'
                    : bulkBodies[previewLead] === undefined && bulkErrors[previewLead] === undefined
                      ? 'No AI result for this lead yet. Use “Generate body with AI” or “Generate all (AI)”.'
                      : undefined
                }
                value={
                  previewLead != null
                    ? bulkErrors[previewLead] !== undefined
                      ? `Error: ${bulkErrors[previewLead]}`
                      : bulkBodies[previewLead] ?? ''
                    : ''
                }
                rows={12}
                className={`mt-1.5 min-h-[14rem] font-mono text-xs md:min-h-[min(22rem,calc(45dvh-6rem))] ${previewLead != null && bulkErrors[previewLead] !== undefined ? 'border-danger/60 text-danger-muted' : ''}`}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Saved outputs reload when you return. Regenerate anytime; Next saves AI bodies for the queue.
              </p>
            </div>
          </div>

          <div className="flex justify-end border-t border-edge pt-3">
            <PrimaryButton
              disabled={!campaignId || campaignLeadCount === 0 || nextBusy || bulkRunning}
              onClick={() => void handleNext()}
            >
              {nextBusy ? 'Saving…' : nextLabel}
            </PrimaryButton>
          </div>
        </div>
      </Panel>
    </div>
  )
}

