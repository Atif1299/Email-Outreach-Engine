import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { outreach } from '@/lib/outreachApi'
import type { Campaign, CampaignStep as CampaignStepModel, ImportBatchSummary } from '@/shared/types'
import { defaultPitch, defaultStep } from '@/wizard/constants'
import { Panel } from '@/components/ui/Panel'
import { AutosizeTextarea } from '@/components/ui/AutosizeTextarea'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'
import { DangerButton } from '@/components/ui/buttons'

type DraftStep = {
  step_order: number
  delay_hours_after_previous: number
  subject_template: string
  body_template: string
  use_ai: boolean
}

const PITCH_MERGE_TAGS = [
  '{{first_name}}',
  '{{current_title}}',
  '{{current_employer}}',
  '{{industry}}',
  '{{location}}',
  '{{company_size}}',
  '{{sender_info}}',
  '{{previous_subject}}',
  '{{previous_sent_at}}',
  '{{step_index}}',
  '{{unsubscribe_note}}',
] as const

export function CampaignStep({
  leadVersion,
  onCampaignSaved,
  onValidityChange,
}: {
  leadVersion: number
  onCampaignSaved: (id: number) => void
  onValidityChange: (ok: boolean) => void
}) {
  const api = outreach()
  const [list, setList] = useState<Campaign[]>([])
  const [importBatches, setImportBatches] = useState<ImportBatchSummary[]>([])
  const [targetImportBatchIds, setTargetImportBatchIds] = useState<number[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [committedId, setCommittedId] = useState<number | null>(null)
  const [name, setName] = useState('My campaign')
  const [pitch, setPitch] = useState(defaultPitch)
  const [senderInfo, setSenderInfo] = useState('')
  const [steps, setSteps] = useState<DraftStep[]>([defaultStep(1)])
  const [activeStepIdx, setActiveStepIdx] = useState(0)
  const [editorTab, setEditorTab] = useState<'overview' | 'sequence'>('overview')
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const pitchRef = useRef<HTMLTextAreaElement>(null)
  const senderRef = useRef<HTMLTextAreaElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const mergeTargetRef = useRef<'pitch' | 'sender' | 'subject' | 'body'>('pitch')
  const mergeCursorRef = useRef<{ target: 'pitch' | 'sender' | 'subject' | 'body'; pos: number } | null>(null)

  const valid = committedId !== null && steps.length > 0

  useEffect(() => {
    onValidityChange(valid)
  }, [valid, onValidityChange])

  const loadList = useCallback(async () => {
    setList(await api.campaignsList())
  }, [api])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    void api.importBatchesList().then(setImportBatches)
  }, [api, leadVersion])

  const setTargetBatch = (batchId: number | null) => {
    setTargetImportBatchIds(batchId == null ? [] : [batchId])
  }

  const loadOne = async (id: number) => {
    const c = await api.campaignGet(id)
    if (!c) return
    setEditId(id)
    setCommittedId(id)
    onCampaignSaved(id)
    setName(c.name)
    setPitch(c.pitch_block)
    setSenderInfo(c.sender_info ?? '')
    setSteps(
      c.steps.map((s: CampaignStepModel) => ({
        step_order: s.step_order,
        delay_hours_after_previous: s.delay_hours_after_previous,
        subject_template: s.subject_template,
        body_template: s.body_template,
        use_ai: s.use_ai,
      })),
    )
    setActiveStepIdx(0)
    setEditorTab('overview')
    setTargetImportBatchIds(c.targetImportBatchIds ?? [])
  }

  const newCampaign = () => {
    setEditId(null)
    setCommittedId(null)
    setName('New campaign')
    setPitch(defaultPitch)
    setSenderInfo('')
    setSteps([defaultStep(1), defaultStep(2)])
    setActiveStepIdx(0)
    setEditorTab('overview')
    setTargetImportBatchIds([])
  }

  const save = async () => {
    setSaving(true)
    setSaveNote(null)
    try {
      const id = await api.campaignSave({
        id: editId ?? undefined,
        name,
        pitch_block: pitch,
        sender_info: senderInfo,
        targetImportBatchIds,
        steps: steps.map((s, i) => ({ ...s, step_order: i + 1 })),
      })
      setEditId(id)
      setCommittedId(id)
      onCampaignSaved(id)
      setSaveNote('Saved.')
      void loadList()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSaveNote(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const addStep = () => {
    const n = steps.length + 1
    setSteps([...steps, defaultStep(n)])
    setActiveStepIdx(steps.length)
  }

  const removeStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i + 1 })))
    setActiveStepIdx((prev) => {
      if (idx < prev) return prev - 1
      if (idx === prev) return Math.max(0, prev - 1)
      return prev
    })
  }

  useEffect(() => {
    setActiveStepIdx((i) => (steps.length === 0 ? 0 : Math.min(i, steps.length - 1)))
  }, [steps.length])

  const insertMergeTag = useCallback((tag: string) => {
    const target = mergeTargetRef.current
    const el =
      target === 'sender'
        ? senderRef.current
        : target === 'subject'
          ? subjectRef.current
          : target === 'body'
            ? bodyRef.current
            : pitchRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    mergeCursorRef.current = { target, pos: start + tag.length }
    if (target === 'sender') {
      setSenderInfo((prev) => prev.slice(0, start) + tag + prev.slice(end))
      return
    }
    if (target === 'pitch') {
      setPitch((prev) => prev.slice(0, start) + tag + prev.slice(end))
      return
    }
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== activeStepIdx) return s
        if (target === 'subject') {
          return { ...s, subject_template: s.subject_template.slice(0, start) + tag + s.subject_template.slice(end) }
        }
        return { ...s, body_template: s.body_template.slice(0, start) + tag + s.body_template.slice(end) }
      }),
    )
  }, [activeStepIdx])

  useLayoutEffect(() => {
    const cur = mergeCursorRef.current
    if (cur === null) return
    mergeCursorRef.current = null
    const el =
      cur.target === 'sender'
        ? senderRef.current
        : cur.target === 'subject'
          ? subjectRef.current
          : cur.target === 'body'
            ? bodyRef.current
            : pitchRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(cur.pos, cur.pos)
  }, [pitch, senderInfo, steps, activeStepIdx])

  const editingTitle =
    editId === null && committedId === null ? 'New campaign (unsaved)' : `Editing: ${name}`

  return (
    <div className="space-y-4">
      <p className="text-sm leading-snug text-ink-muted">
        Choose a campaign from the list or create one, then edit the sequence in the panel on the right.
      </p>

      <div className="flex min-h-0 flex-col gap-5 xl:max-h-[min(calc(100dvh-10rem),56rem)] xl:min-h-0 xl:flex-row xl:items-stretch xl:gap-5 xl:overflow-hidden">
        <div className="shrink-0 xl:w-[clamp(16rem,22vw,24rem)] xl:max-w-[min(24rem,28vw)] xl:shrink-0">
          <div className="mb-2 flex items-center gap-2">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-accent bg-accent-subtle text-xs font-bold tabular-nums text-accent"
              aria-hidden
            >
              1
            </span>
            <span className="text-sm font-semibold text-ink">Choose campaign</span>
          </div>
          <Panel title="Your campaigns" className="shrink-0">
            <SecondaryButton className="mb-3 w-full" onClick={newCampaign}>
              New campaign
            </SecondaryButton>
            {list.length === 0 ? (
              <p className="text-sm leading-snug text-ink-muted">
                No campaigns yet. Click <span className="font-medium text-ink">New campaign</span> to create one.
              </p>
            ) : (
              <ul className="space-y-1">
                {list.map((c) => (
                  <li key={c.id} className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void loadOne(c.id)}
                      className={`min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150 ${editId === c.id ? 'bg-accent-subtle text-accent' : 'bg-surface-raised text-ink-muted hover:bg-surface hover:text-ink'
                        }`}
                    >
                      {c.name}
                    </button>
                    <DangerButton
                      className="shrink-0 px-2.5 py-2.5"
                      aria-label={`Delete ${c.name}`}
                      title="Delete campaign"
                      onClick={async () => {
                        if (!confirm(`Delete campaign “${c.name}”?`)) return
                        await api.campaignDelete(c.id)
                        if (editId === c.id) newCampaign()
                        void loadList()
                      }}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    </DangerButton>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-accent bg-accent-subtle text-xs font-bold tabular-nums text-accent"
                aria-hidden
              >
                2
              </span>
              <span className="text-sm font-semibold text-ink">Edit sequence</span>
            </div>
            <p className="min-w-0 text-sm font-medium text-ink">{editingTitle}</p>
          </div>

          <div
            className="mb-3 flex flex-wrap items-center justify-between gap-2"
          >
            <div
              className="flex gap-1 rounded-lg border border-edge bg-surface p-1"
              role="tablist"
              aria-label="Editor sections"
            >
              <button
                type="button"
                role="tab"
                aria-selected={editorTab === 'overview'}
                onClick={() => setEditorTab('overview')}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${editorTab === 'overview'
                  ? 'bg-accent-subtle text-accent'
                  : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                  }`}
              >
                Overview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editorTab === 'sequence'}
                onClick={() => setEditorTab('sequence')}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${editorTab === 'sequence'
                  ? 'bg-accent-subtle text-accent'
                  : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                  }`}
              >
                Sequence
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save campaign'}
              </PrimaryButton>
            </div>
          </div>
          {saveNote && (
            <p
              className={`text-sm ${saveNote.startsWith('Save failed:') ? 'text-danger' : 'text-ink-muted'}`}
              role={saveNote.startsWith('Save failed:') ? 'alert' : undefined}
            >
              {saveNote}
            </p>
          )}

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
            {editorTab === 'overview' && (
              <Panel
                title="Overview"
                description={
                  committedId === null
                    ? 'Save this campaign (or load one from the list) before using Next to continue.'
                    : 'Name, pitch, and sender apply to every step in this campaign.'
                }
                headerRight={
                  <label className="block min-w-[16rem]">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Lead group
                    </span>
                    <select
                      value={targetImportBatchIds[0] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        setTargetBatch(v === '' ? null : +v)
                      }}
                      className="mt-1.5 w-full text-sm"
                    >
                      <option value="">All groups</option>
                      {importBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.filename} ({b.leadCount})
                        </option>
                      ))}
                    </select>
                  </label>
                }
              >
                <div className="w-full space-y-4">
                  <div>
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Campaign name
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1.5 block w-full"
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Pitch block (`{'{{pitch_block}}'}`)
                    </span>
                    <AutosizeTextarea
                      ref={pitchRef}
                      value={pitch}
                      onChange={(e) => setPitch(e.target.value)}
                      onFocus={() => {
                        mergeTargetRef.current = 'pitch'
                      }}
                      minHeightPx={120}
                      maxHeightPx={360}
                      className="mt-1.5 font-mono text-xs leading-relaxed"
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Sender / sign-off (`{'{{sender_info}}'}`)
                    </span>
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      Use in your step body (default templates include it after “Best regards,”). Plain text and URLs on
                      their own lines. Passed to AI so the closing matches your team or personal details.
                    </p>
                    <AutosizeTextarea
                      ref={senderRef}
                      value={senderInfo}
                      onChange={(e) => setSenderInfo(e.target.value)}
                      onFocus={() => {
                        mergeTargetRef.current = 'sender'
                      }}
                      minHeightPx={80}
                      maxHeightPx={240}
                      className="mt-1.5 font-mono text-xs leading-relaxed"
                    />
                  </div>
                </div>
              </Panel>
            )}

            {editorTab === 'sequence' && (
              <>
                <Panel title="Sequence steps">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
                    <div className="flex flex-wrap gap-2">
                      {steps.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveStepIdx(idx)}
                          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${activeStepIdx === idx
                            ? 'bg-accent-subtle text-accent'
                            : 'bg-surface-raised text-ink-muted hover:bg-surface hover:text-ink'
                            }`}
                        >
                          Step {idx + 1}
                        </button>
                      ))}
                    </div>
                    <SecondaryButton onClick={addStep} className="shrink-0 border-dashed border-edge">
                      + Add follow-up step
                    </SecondaryButton>
                  </div>
                  {steps.map((step, idx) =>
                    idx === activeStepIdx ? (
                      <div key={idx} className="mx-auto mt-4 w-full max-w-[65ch] space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <label className="flex items-center gap-2 text-sm text-ink-muted">
                              <input
                                type="checkbox"
                                checked={step.use_ai}
                                onChange={(e) => {
                                  const v = e.target.checked
                                  setSteps((s) => s.map((x, i) => (i === idx ? { ...x, use_ai: v } : x)))
                                }}
                              />
                              Generate body with AI
                            </label>
                            <p className="text-xs leading-relaxed text-ink-faint">
                              Each step can use AI independently. Uses your OpenAI settings from Connect; try merged preview on
                              the Queue step.
                            </p>
                          </div>
                          {steps.length > 1 && (
                            <DangerButton onClick={() => removeStep(idx)}>Remove step</DangerButton>
                          )}
                        </div>
                        {idx > 0 && (
                          <div>
                            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                              Delay after previous (hours)
                            </span>
                            <input
                              type="number"
                              min={0}
                              className="max-w-[120px]"
                              value={step.delay_hours_after_previous}
                              onChange={(e) => {
                                const v = +e.target.value
                                setSteps((s) =>
                                  s.map((x, i) => (i === idx ? { ...x, delay_hours_after_previous: v } : x)),
                                )
                              }}
                            />
                          </div>
                        )}
                        <div>
                          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                            Subject
                          </span>
                          <input
                            type="text"
                            ref={subjectRef}
                            value={step.subject_template}
                            onChange={(e) =>
                              setSteps((s) =>
                                s.map((x, i) => (i === idx ? { ...x, subject_template: e.target.value } : x)),
                              )
                            }
                            onFocus={() => {
                              mergeTargetRef.current = 'subject'
                            }}
                            className="mt-1.5 block w-full font-mono text-xs leading-relaxed"
                          />
                        </div>
                        <div>
                          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                            Body
                          </span>
                          <AutosizeTextarea
                            ref={bodyRef}
                            value={step.body_template}
                            onChange={(e) =>
                              setSteps((s) =>
                                s.map((x, i) => (i === idx ? { ...x, body_template: e.target.value } : x)),
                              )
                            }
                            onFocus={() => {
                              mergeTargetRef.current = 'body'
                            }}
                            minHeightPx={120}
                            maxHeightPx={420}
                            className="font-mono text-xs leading-relaxed"
                          />
                        </div>
                        <details className="rounded-lg border border-edge bg-canvas/40 px-3 py-2">
                          <summary className="cursor-pointer select-none text-sm font-medium text-ink-muted hover:text-ink">
                            Available merge tags
                          </summary>
                          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                            Click a tag to insert at the cursor; uses whichever field you focused last (subject/body — default is pitch).
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {PITCH_MERGE_TAGS.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => insertMergeTag(tag)}
                                className="rounded-md border border-edge bg-surface-raised px-2 py-1 font-mono text-[11px] leading-none text-ink-muted shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)] transition-colors hover:border-accent/40 hover:bg-surface hover:text-ink"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </details>
                      </div>
                    ) : null,
                  )}
                </Panel>
              </>
            )}

            <div className="flex flex-wrap gap-3">
              {editId != null && (
                <DangerButton
                  onClick={async () => {
                    if (!confirm('Delete this campaign?')) return
                    await api.campaignDelete(editId)
                    newCampaign()
                    void loadList()
                  }}
                >
                  Delete campaign
                </DangerButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
