import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { Campaign, CampaignStep as CampaignStepModel } from '@/shared/types'
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
  '{{previous_subject}}',
  '{{previous_sent_at}}',
  '{{step_index}}',
  '{{unsubscribe_note}}',
] as const

export function CampaignStep({
  onCampaignSaved,
  onValidityChange,
}: {
  onCampaignSaved: (id: number) => void
  onValidityChange: (ok: boolean) => void
}) {
  const api = outreach()
  const [list, setList] = useState<Campaign[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [committedId, setCommittedId] = useState<number | null>(null)
  const [name, setName] = useState('My campaign')
  const [pitch, setPitch] = useState(defaultPitch)
  const [steps, setSteps] = useState<DraftStep[]>([defaultStep(1)])
  const [activeStepIdx, setActiveStepIdx] = useState(0)
  const pitchRef = useRef<HTMLTextAreaElement>(null)
  const mergeCursorRef = useRef<number | null>(null)

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

  const loadOne = async (id: number) => {
    const c = await api.campaignGet(id)
    if (!c) return
    setEditId(id)
    setCommittedId(id)
    onCampaignSaved(id)
    setName(c.name)
    setPitch(c.pitch_block)
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
  }

  const newCampaign = () => {
    setEditId(null)
    setCommittedId(null)
    setName('New campaign')
    setPitch(defaultPitch)
    setSteps([defaultStep(1), defaultStep(2)])
    setActiveStepIdx(0)
  }

  const save = async () => {
    const id = await api.campaignSave({
      id: editId ?? undefined,
      name,
      pitch_block: pitch,
      steps: steps.map((s, i) => ({ ...s, step_order: i + 1 })),
    })
    setEditId(id)
    setCommittedId(id)
    onCampaignSaved(id)
    void loadList()
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

  const insertPitchMergeTag = useCallback((tag: string) => {
    const el = pitchRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    mergeCursorRef.current = start + tag.length
    setPitch((prev) => prev.slice(0, start) + tag + prev.slice(end))
  }, [])

  useLayoutEffect(() => {
    const pos = mergeCursorRef.current
    if (pos === null) return
    mergeCursorRef.current = null
    const el = pitchRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(pos, pos)
  }, [pitch])

  return (
    <div className="flex min-h-0 flex-col gap-5 xl:max-h-[min(calc(100dvh-10rem),56rem)] xl:min-h-0 xl:flex-row xl:items-stretch xl:gap-5 xl:overflow-hidden">
      <Panel title="Campaigns" className="shrink-0 xl:max-w-[300px] xl:shrink-0">
        <SecondaryButton className="mb-3 w-full" onClick={newCampaign}>
          New campaign
        </SecondaryButton>
        <ul className="space-y-1">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void loadOne(c.id)}
                className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150 ${editId === c.id ? 'bg-accent-subtle text-accent' : 'bg-surface-raised text-ink-muted hover:bg-surface hover:text-ink'
                  }`}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
          <Panel
            title="Compose sequence"
            description={
              committedId === null
                ? 'Save this campaign (or load one from the list) before using Next to continue.'
                : undefined
            }
          >
            <div className="space-y-4">
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
                  minHeightPx={120}
                  maxHeightPx={360}
                  className="mt-1.5 font-mono text-xs leading-relaxed"
                />
              </div>
              <details className="rounded-lg border border-edge bg-canvas/40 px-3 py-2">
                <summary className="cursor-pointer select-none text-sm font-medium text-ink-muted hover:text-ink">
                  Available merge tags
                </summary>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  Click a tag to insert it in the pitch block at the cursor.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PITCH_MERGE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => insertPitchMergeTag(tag)}
                      className="rounded-md border border-edge bg-surface-raised px-2 py-1 font-mono text-[11px] leading-none text-ink-muted shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)] transition-colors hover:border-accent/40 hover:bg-surface hover:text-ink"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          </Panel>

          <Panel title="Sequence steps">
            <div className="flex flex-wrap gap-2 border-b border-edge pb-3">
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
            {steps.map((step, idx) =>
              idx === activeStepIdx ? (
                <div key={idx} className="mt-4 space-y-3">
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
                      value={step.subject_template}
                      onChange={(e) =>
                        setSteps((s) =>
                          s.map((x, i) => (i === idx ? { ...x, subject_template: e.target.value } : x)),
                        )
                      }
                      className="mt-1.5 block w-full font-mono text-xs leading-relaxed"
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Body
                    </span>
                    <AutosizeTextarea
                      value={step.body_template}
                      onChange={(e) =>
                        setSteps((s) =>
                          s.map((x, i) => (i === idx ? { ...x, body_template: e.target.value } : x)),
                        )
                      }
                      minHeightPx={120}
                      maxHeightPx={420}
                      className="font-mono text-xs leading-relaxed"
                    />
                  </div>
                </div>
              ) : null,
            )}
          </Panel>

          <SecondaryButton onClick={addStep} className="w-full border-dashed border-edge">
            + Add follow-up step
          </SecondaryButton>

          <div className="flex flex-wrap gap-3">
            <PrimaryButton onClick={() => void save()}>Save campaign</PrimaryButton>
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
  )
}
