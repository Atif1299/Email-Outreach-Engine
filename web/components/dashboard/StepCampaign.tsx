'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Campaign, CampaignStep, Batch } from '@/app/dashboard/page'
import { OUTPUT_LANGUAGES } from '@/lib/output-languages'
import {
  PITCH_FIELDS,
  countFilledPitchFields,
  fieldsFromPitchBlock,
  serializePitchBlock,
  type PitchFieldKey,
} from '@/lib/pitch-block'
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

const DEFAULT_STEP1_SUBJECT = '{{first_name}} — quick question for {{current_employer}}'
const DEFAULT_STEP1_BODY = `Hi {{first_name}},

If outbound at {{current_employer}} is leaking replies, you're also leaking meetings. As {{current_title}}, that usually means pipeline and follow-up get messy fast.

{{pitch_block}}

Worth a quick look — or not a priority right now?

{{sender_info}}`

const DEFAULT_STEP2_SUBJECT = 'Re: {{first_name}} — {{current_employer}}'
const DEFAULT_STEP2_BODY = `Hi {{first_name}},

Following up on my note to {{current_employer}} — one pattern I see for {{current_title}} teams in {{industry}}:

[One insight, benchmark, or consequence tied to step 1's pain — something useful even without a call]

[Optional one-sentence bridge to your solution from the pitch block]

Want me to send the benchmark — or skip for now?

{{sender_info}}`

const DEFAULT_STEP3_SUBJECT = 'Re: {{first_name}} — {{current_employer}}'
const DEFAULT_STEP3_BODY = `Hi {{first_name}},

Totally understand if timing's off — [one specific pain/workflow from step 1 or 2] at {{current_employer}} is what I had in mind when I wrote last week.

If [offer from pitch — plain language, e.g. a short workflow review] is still useful for your team, I'm happy to run it — otherwise I'll close this out on my side, no worries.

{{sender_info}}`

const DEFAULT_AI_INSTRUCTIONS =
  'Peer tone, no buzzwords. One question max per email. Never say "hope this finds you well" or "just circling back". Name the lead company or industry in every email.'

const DEFAULT_PITCH_BLOCK = `Product: 
For: 
Pain: 
Solution: 
Integrations/channels: 
Offer/CTA: 
Proof (optional): `

const DEFAULT_SENDER_SIGNOFF = `Best,
Your Name
Your Company`

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function AutoResizeTextarea({
  value,
  onChange,
  className = 'input textarea textarea--fit',
  placeholder,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  className?: string
  placeholder?: string
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
      value={value}
      onChange={(e) => {
        onChange(e)
        requestAnimationFrame(resize)
      }}
    />
  )
}

function stepRoleLabel(stepOrder: number): string {
  if (stepOrder <= 1) return 'Observation'
  if (stepOrder === 2) return 'Insight / proof'
  return 'Close loop'
}

function defaultStep(stepOrder: number): CampaignStep {
  if (stepOrder <= 1) {
    return {
      stepOrder: 1,
      delayHoursAfterPrevious: 0,
      subjectTemplate: DEFAULT_STEP1_SUBJECT,
      bodyTemplate: DEFAULT_STEP1_BODY,
      useAi: true,
    }
  }
  if (stepOrder === 2) {
    return {
      stepOrder: 2,
      delayHoursAfterPrevious: 72,
      subjectTemplate: DEFAULT_STEP2_SUBJECT,
      bodyTemplate: DEFAULT_STEP2_BODY,
      useAi: true,
    }
  }
  return {
    stepOrder,
    delayHoursAfterPrevious: 72,
    subjectTemplate: DEFAULT_STEP3_SUBJECT,
    bodyTemplate: DEFAULT_STEP3_BODY,
    useAi: true,
  }
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
  const [activeTab, setActiveTab] = useState<'overview' | 'sequences' | 'examples'>('overview')
  const [draft, setDraft] = useState<Campaign | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestingPitch, setSuggestingPitch] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const saveFlash = useButtonFlash()
  const { hint: pitchHint, showHint: showPitchHint } = useInlineHint()
  const { hint: listHint, showHint: showListHint } = useInlineHint()
  const savedOutputLanguageRef = useRef<string | null>(null)

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  useEffect(() => {
    if (selectedCampaignId) {
      loadCampaign(selectedCampaignId)
    } else {
      setDraft(null)
    }
  }, [selectedCampaignId])

  async function loadCampaign(id: number) {
    try {
      const res = await fetch(`/api/campaigns/${id}`)
      if (res.ok) {
        const data = await res.json()
        setDraft({
          ...data,
          fewShotStep1: data.fewShotStep1 ?? [],
          fewShotStep2: data.fewShotStep2 ?? [],
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
      pitchBlock: DEFAULT_PITCH_BLOCK,
      senderInfo: DEFAULT_SENDER_SIGNOFF,
      aiVoice: 'founder',
      aiInstructions: DEFAULT_AI_INSTRUCTIONS,
      outputLanguage: 'en',
      fewShotStep1: [],
      fewShotStep2: [],
      createdAt: new Date().toISOString(),
      targetImportBatchIds: leadsBatchFilter ? [leadsBatchFilter] : [],
      steps: [defaultStep(1)],
    })
    setActiveTab('overview')
  }

  async function saveCampaign() {
    if (!draft) return
    setSaving(true)

    try {
      const method = draft.id ? 'PUT' : 'POST'
      const url = draft.id ? `/api/campaigns/${draft.id}` : '/api/campaigns'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (res.ok) {
        const saved = await res.json()
        if (!draft.id) {
          onSelectCampaign(saved.id)
        }
        savedOutputLanguageRef.current = saved.outputLanguage || draft.outputLanguage || 'en'
        onCampaignsChanged()
        saveFlash.flashDone()
      } else {
        saveFlash.flashError()
      }
    } catch (e) {
      saveFlash.flashError()
    }
    setSaving(false)
  }

  async function deleteCampaign(id: number) {
    const camp = campaigns.find(c => c.id === id)
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
    } catch (e) {
      showListHint('Delete failed', 'err')
    }
    setConfirmDeleteId(null)
  }

  async function suggestPitch() {
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
        showPitchHint('Updated', 'ok')
      } else {
        showPitchHint('Failed', 'err')
      }
    } catch (e) {
      showPitchHint('Failed', 'err')
    }
    setSuggestingPitch(false)
  }

  function updatePitchField(key: PitchFieldKey, value: string) {
    if (!draft) return
    const fields = fieldsFromPitchBlock(draft.pitchBlock)
    fields[key] = value
    setDraft({ ...draft, pitchBlock: serializePitchBlock(fields) })
  }

  function updateFewShot(step: 'fewShotStep1' | 'fewShotStep2', index: number, value: string) {
    if (!draft) return
    const list = [...draft[step]]
    list[index] = value
    setDraft({ ...draft, [step]: list })
  }

  function addFewShot(step: 'fewShotStep1' | 'fewShotStep2') {
    if (!draft) return
    setDraft({ ...draft, [step]: [...draft[step], ''] })
  }

  function removeFewShot(step: 'fewShotStep1' | 'fewShotStep2', index: number) {
    if (!draft) return
    setDraft({ ...draft, [step]: draft[step].filter((_, i) => i !== index) })
  }

  async function applyFewShotDefaults(step: 'step1' | 'step2' | 'both') {
    if (!draft) return
    try {
      const res = await fetch('/api/campaigns/few-shot-defaults')
      if (!res.ok) return
      const data = await res.json()
      if (step === 'step1') {
        setDraft({ ...draft, fewShotStep1: data.step1 || [] })
      } else if (step === 'step2') {
        setDraft({ ...draft, fewShotStep2: data.step2 || [] })
      } else {
        setDraft({
          ...draft,
          fewShotStep1: data.step1 || [],
          fewShotStep2: data.step2 || [],
        })
      }
    } catch (e) {
      console.error('Failed to load few-shot defaults:', e)
    }
  }

  function clearFewShots(step: 'step1' | 'step2' | 'both') {
    if (!draft) return
    if (step === 'step1') setDraft({ ...draft, fewShotStep1: [] })
    else if (step === 'step2') setDraft({ ...draft, fewShotStep2: [] })
    else setDraft({ ...draft, fewShotStep1: [], fewShotStep2: [] })
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

  function updateStep(index: number, field: keyof CampaignStep, value: any) {
    if (!draft) return
    const newSteps = [...draft.steps]
    newSteps[index] = { ...newSteps[index], [field]: value }
    setDraft({ ...draft, steps: newSteps })
  }

  return (
    <section className="step-view">
      <div className="step-body split">
        {/* Campaign List */}
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

        {/* Campaign Editor */}
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
                    className={`tab-btn ${activeTab === 'overview' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('overview')}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${activeTab === 'sequences' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('sequences')}
                  >
                    Sequences
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${activeTab === 'examples' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('examples')}
                    title="AI style examples"
                  >
                    Examples
                  </button>
                </div>
              </div>

              {/* Overview Tab */}
              {activeTab === 'overview' && (
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
                    Pitch in English; AI writes the email in the language you pick above.
                    {draft.id > 0 &&
                      savedOutputLanguageRef.current != null &&
                      (draft.outputLanguage || 'en') !== savedOutputLanguageRef.current && (
                        <> Regenerate previews — saved overrides are still in the previous language.</>
                      )}
                  </p>

                  <div className="field field-grow">
                    <div className="pitch-block-head">
                      <label className="mini-label">
                        Pitch Block
                        <InlineHint hint={pitchHint} />
                      </label>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={!draft.targetImportBatchIds[0] || suggestingPitch}
                        onClick={suggestPitch}
                      >
                        {suggestingPitch ? 'Analyzing...' : 'Suggest from leads'}
                      </button>
                    </div>
                    <div className="pitch-fields">
                      {PITCH_FIELDS.map(({ key, label }) => (
                        <div key={key} className="field pitch-field-row">
                          <label className="mini-label">{label}</label>
                          <AutoResizeTextarea
                            value={fieldsFromPitchBlock(draft.pitchBlock)[key]}
                            onChange={(e) => updatePitchField(key, e.target.value)}
                            placeholder={`${label}...`}
                          />
                        </div>
                      ))}
                    </div>
                    {countFilledPitchFields(draft.pitchBlock) < 2 && (
                      <p className="field-hint inline-hint inline-hint--warn">
                        Fill at least Pain and Solution so AI can personalize reliably.
                      </p>
                    )}
                    <p className="field-hint">
                      The AI extracts these blocks — plain labeled lines, not marketing fluff.
                      Select a Target Batch to enable Suggest from leads.
                    </p>
                  </div>

                  <div className="field field-grow">
                    <label className="mini-label">AI Instructions (optional)</label>
                    <textarea
                      className="input textarea"
                      rows={3}
                      placeholder="Extra tone notes, words to avoid, CTA preference..."
                      value={draft.aiInstructions}
                      onChange={(e) => setDraft({ ...draft, aiInstructions: e.target.value })}
                    />
                  </div>

                  <div className="field field-grow">
                    <label className="mini-label">Sender Sign-off</label>
                    <textarea
                      className="input textarea"
                      placeholder={`Best,\nYour Name\nYour Company`}
                      value={draft.senderInfo}
                      onChange={(e) => setDraft({ ...draft, senderInfo: e.target.value })}
                    />
                  </div>

                  <div className="merge-tags">
                    <div className="mini-label">Available Merge Tags</div>
                    <div className="tags-list">
                      <code>{'{{first_name}}'}</code>
                      <code>{'{{last_name}}'}</code>
                      <code>{'{{email}}'}</code>
                      <code>{'{{current_employer}}'}</code>
                      <code>{'{{current_title}}'}</code>
                      <code>{'{{industry}}'}</code>
                      <code>{'{{location}}'}</code>
                      <code>{'{{pitch_block}}'}</code>
                      <code>{'{{sender_info}}'}</code>
                    </div>
                  </div>
                </div>
              )}

              {/* AI Examples Tab */}
              {activeTab === 'examples' && (
                <div className="tab-content">
                  <p className="field-hint" style={{ marginBottom: '0.75rem' }}>
                    Style guides for AI body generation — tone and structure only. Product and offer always come from the pitch block.
                    Leave empty to use built-in defaults.
                  </p>

                  <div className="few-shot-section">
                    <div className="few-shot-section-head">
                      <div>
                        <div className="mini-label">Step 1 examples</div>
                        <p className="field-hint">
                          {draft.fewShotStep1.length > 0
                            ? `${draft.fewShotStep1.length} custom — one picked per lead`
                            : 'Using built-in defaults'}
                        </p>
                      </div>
                      <div className="few-shot-section-actions">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => addFewShot('fewShotStep1')}>
                          + Add
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => applyFewShotDefaults('step1')}>
                          Load defaults
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => clearFewShots('step1')}>
                          Use built-in
                        </button>
                      </div>
                    </div>
                    <div className="few-shot-list">
                      {draft.fewShotStep1.length === 0 ? (
                        <p className="field-hint">No custom examples — built-in files under prompts/cold_outreach/few_shot/step1/ are used.</p>
                      ) : (
                        draft.fewShotStep1.map((example, i) => (
                          <div key={`s1-${i}`} className="few-shot-item">
                            <div className="few-shot-item-head">
                              <span className="few-shot-item-label">Example {i + 1}</span>
                              <button type="button" className="btn-delete-item" onClick={() => removeFewShot('fewShotStep1', i)} title="Remove">
                                🗑
                              </button>
                            </div>
                            <AutoResizeTextarea
                              value={example}
                              onChange={(e) => updateFewShot('fewShotStep1', i, e.target.value)}
                              placeholder="Hi {first_name}, ..."
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="few-shot-section">
                    <div className="few-shot-section-head">
                      <div>
                        <div className="mini-label">Follow-up examples (step 2+)</div>
                        <p className="field-hint">
                          {draft.fewShotStep2.length > 0
                            ? `${draft.fewShotStep2.length} custom — one picked per lead`
                            : 'Using built-in defaults'}
                        </p>
                      </div>
                      <div className="few-shot-section-actions">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => addFewShot('fewShotStep2')}>
                          + Add
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => applyFewShotDefaults('step2')}>
                          Load defaults
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => clearFewShots('step2')}>
                          Use built-in
                        </button>
                      </div>
                    </div>
                    <div className="few-shot-list">
                      {draft.fewShotStep2.length === 0 ? (
                        <p className="field-hint">No custom examples — built-in files under prompts/cold_outreach/few_shot/step2/ are used.</p>
                      ) : (
                        draft.fewShotStep2.map((example, i) => (
                          <div key={`s2-${i}`} className="few-shot-item">
                            <div className="few-shot-item-head">
                              <span className="few-shot-item-label">Example {i + 1}</span>
                              <button type="button" className="btn-delete-item" onClick={() => removeFewShot('fewShotStep2', i)} title="Remove">
                                🗑
                              </button>
                            </div>
                            <AutoResizeTextarea
                              value={example}
                              onChange={(e) => updateFewShot('fewShotStep2', i, e.target.value)}
                              placeholder="Hi {first_name}, ..."
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Sequences Tab */}
              {activeTab === 'sequences' && (
                <div className="tab-content">
                  <div className="sequences-header">
                    <div>
                      <div className="mini-label">Email Sequence</div>
                      <p className="field-hint">
                        Templates use merge tags — AI rewrites from this structure; Merge-only sends as-is.
                      </p>
                    </div>
                    <button type="button" className="btn btn-outline btn-sm" onClick={addStep}>
                      + Add Step
                    </button>
                  </div>

                  <div className="steps-list">
                    {draft.steps.map((step, i) => (
                      <div key={i} className="step-item">
                        <div className="step-item-head">
                          <span className="step-item-title">Step {step.stepOrder} · {stepRoleLabel(step.stepOrder)}</span>
                          <div className="step-item-controls">
                            <label style={{ fontSize: '0.72rem', color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <input
                                type="checkbox"
                                checked={step.useAi}
                                onChange={(e) => updateStep(i, 'useAi', e.target.checked)}
                              /> AI
                            </label>
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
                        </div>
                        <div className="step-item-grid">
                          <div className="field">
                            <input
                              type="text"
                              className="input"
                              placeholder="Subject..."
                              value={step.subjectTemplate}
                              onChange={(e) => updateStep(i, 'subjectTemplate', e.target.value)}
                            />
                          </div>
                          <div className="field">
                            <input
                              type="number"
                              className="input"
                              placeholder="Delay (h)"
                              value={step.delayHoursAfterPrevious}
                              onChange={(e) => updateStep(i, 'delayHoursAfterPrevious', parseFloat(e.target.value) || 0)}
                            />
                          </div>
                        </div>
                        <div className="field">
                          <AutoResizeTextarea
                            placeholder="Body template — use merge tags like {{first_name}}, {{current_employer}}..."
                            value={step.bodyTemplate}
                            onChange={(e) => updateStep(i, 'bodyTemplate', e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
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
            disabled={!selectedCampaignId}
            onClick={onNextStep}
          >
            Next: Preview →
          </button>
        </div>
      </footer>
    </section>
  )
}
