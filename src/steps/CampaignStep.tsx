import { useCallback, useEffect, useState } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { Campaign, CampaignStep as CampaignStepModel } from '@/shared/types'
import { defaultPitch, defaultStep } from '@/wizard/constants'
import { Panel } from '@/components/ui/Panel'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'
import { DangerButton } from '@/components/ui/buttons'

type DraftStep = {
  step_order: number
  delay_hours_after_previous: number
  subject_template: string
  body_template: string
  use_ai: boolean
}

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
  }

  const newCampaign = () => {
    setEditId(null)
    setCommittedId(null)
    setName('New campaign')
    setPitch(defaultPitch)
    setSteps([defaultStep(1), defaultStep(2)])
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
  }

  const removeStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i + 1 })))
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
      <Panel title="Campaigns" className="h-fit">
        <SecondaryButton className="mb-4 w-full" onClick={newCampaign}>
          New campaign
        </SecondaryButton>
        <ul className="space-y-1">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void loadOne(c.id)}
                className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition ${editId === c.id ? 'bg-accent-muted text-accent' : 'bg-surface-muted hover:bg-slate-800'
                  }`}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="space-y-5">
        <Panel title="Compose sequence">
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Campaign name
              </span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Pitch block (`{'{{pitch_block}}'}`)
              </span>
              <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} rows={4} className="font-mono text-xs" />
            </div>
            <p className="text-xs text-slate-500">
              Tags: {'{{first_name}}'}, {'{{current_title}}'}, {'{{current_employer}}'}, {'{{industry}}'}, {'{{location}}'},{' '}
              {'{{company_size}}'}, follow-ups: {'{{previous_subject}}'}, {'{{previous_sent_at}}'}, {'{{step_index}}'},{' '}
              {'{{unsubscribe_note}}'}
            </p>
          </div>
        </Panel>

        {steps.map((step, idx) => (
          <Panel key={idx} title={`Step ${idx + 1}`}>
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-400">
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
                {steps.length > 1 && (
                  <DangerButton onClick={() => removeStep(idx)}>Remove step</DangerButton>
                )}
              </div>
              {idx > 0 && (
                <div>
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
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
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Subject
                </span>
                <input
                  value={step.subject_template}
                  onChange={(e) =>
                    setSteps((s) =>
                      s.map((x, i) => (i === idx ? { ...x, subject_template: e.target.value } : x)),
                    )
                  }
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Body
                </span>
                <textarea
                  value={step.body_template}
                  onChange={(e) =>
                    setSteps((s) =>
                      s.map((x, i) => (i === idx ? { ...x, body_template: e.target.value } : x)),
                    )
                  }
                  rows={8}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </Panel>
        ))}

        <SecondaryButton onClick={addStep} className="w-full border-dashed">
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
  )
}
