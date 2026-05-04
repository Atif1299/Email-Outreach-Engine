import { useCallback, useEffect, useMemo, useState } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { ColumnMapping, AppSettings, Campaign, CampaignStep, Lead } from '@/shared/types'
import { LEAD_FIELD_KEYS } from '@/shared/types'
import type { CampaignWithSteps, ParsePreviewResult } from '@/lib/outreachApi'
import type { QueueStatus } from '@/shared/types'
import './App.css'

type Tab = 'import' | 'leads' | 'campaigns' | 'settings' | 'send'

const defaultPitch =
  "We're a focused team of AI specialists helping businesses adopt practical automation and AI tooling. I'd love to share a concise idea relevant to your work."

const defaultStep = (order: number): Omit<CampaignStep, 'id' | 'campaign_id'> => ({
  step_order: order,
  delay_hours_after_previous: order === 1 ? 0 : 72,
  subject_template:
    order === 1
      ? 'Quick idea for {{first_name}} ({{current_title}})'
      : 'Following up — {{first_name}}, {{current_employer}}',
  body_template:
    order === 1
      ? `Hi {{first_name}},\n\n{{pitch_block}}\n\nI noticed your role as {{current_title}} at {{current_employer}} — we often help teams in {{industry}} with lightweight AI workflows.\n\nWould a 15-minute chat next week be useful?\n\nBest,\n{{unsubscribe_note}}`
      : `Hi {{first_name}},\n\nFollowing up on my note about AI automation — previously: "{{truncate previous_subject 60}}".\n\nStill happy to share a concrete example for {{current_employer}}.\n\n{{unsubscribe_note}}`,
  use_ai: false,
})

function TabButton({
  id,
  active,
  children,
  onClick,
}: {
  id: Tab
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${active ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`}
    >
      {children}
    </button>
  )
}

function ImportTab({ onImported }: { onImported: () => void }) {
  const api = outreach()
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pickFile = async () => {
    setMsg(null)
    const p = await api.openImportDialog()
    if (!p) return
    setBusy(true)
    try {
      const r = await api.parsePreview(p)
      setPath(p)
      setPreview(r)
      setMapping(r.mapping)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!path) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.importCommit({ filePath: path, mapping })
      setMsg(`Imported ${r.imported} leads. Skipped ${r.skippedNoEmail} without valid email.`)
      onImported()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const headers = preview?.headers ?? []

  return (
    <div className="max-w-5xl space-y-6">
      <p className="text-slate-400">
        Import a CSV or Excel export. Map columns to lead fields; rows without a valid email are skipped.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={pickFile}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        Choose file…
      </button>
      {preview && (
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-sm text-slate-400">
            <span className="font-medium text-slate-200">{preview.filename}</span> — {preview.totalRows} rows
            (showing {preview.previewRows.length} preview)
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LEAD_FIELD_KEYS.map((key) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="text-slate-400">{key}</span>
                <select
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
                  value={mapping[key] ?? ''}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [key]: e.target.value || '' }))
                  }
                >
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={commit}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Import leads
          </button>
        </div>
      )}
      {msg && <p className="text-sm text-amber-200">{msg}</p>}
    </div>
  )
}

function LeadsTab() {
  const api = outreach()
  const [leads, setLeads] = useState<Lead[]>([])
  const [q, setQ] = useState('')
  const load = useCallback(async () => {
    const rows = await api.leadsList(q || undefined)
    setLeads(rows as Lead[])
  }, [api, q])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search email or any field…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm"
        >
          Search
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-400">
            <tr>
              <th className="p-3">Email</th>
              <th className="p-3">Name</th>
              <th className="p-3">Title</th>
              <th className="p-3">Company</th>
              <th className="p-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b border-slate-800/80">
                <td className="p-3 font-mono text-xs">{l.email}</td>
                <td className="p-3">{l.data.first_name} {l.data.last_name}</td>
                <td className="p-3 text-slate-400">{l.data.current_title}</td>
                <td className="p-3 text-slate-400">{l.data.current_employer}</td>
                <td className="p-3">
                  <button
                    type="button"
                    className="text-rose-400 hover:underline"
                    onClick={async () => {
                      await api.leadDelete(l.id)
                      void load()
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <p className="p-8 text-center text-slate-500">No leads yet. Import a file first.</p>
        )}
      </div>
    </div>
  )
}

function CampaignsTab() {
  const api = outreach()
  const [list, setList] = useState<Campaign[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [name, setName] = useState('My campaign')
  const [pitch, setPitch] = useState(defaultPitch)
  const [steps, setSteps] = useState<
    {
      step_order: number
      delay_hours_after_previous: number
      subject_template: string
      body_template: string
      use_ai: boolean
    }[]
  >([defaultStep(1)])

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
    setName(c.name)
    setPitch(c.pitch_block)
    setSteps(
      c.steps.map((s) => ({
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
    <div className="grid max-w-6xl gap-8 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        <button
          type="button"
          onClick={newCampaign}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white"
        >
          New campaign
        </button>
        <ul className="space-y-1">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void loadOne(c.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${editId === c.id ? 'bg-slate-700 text-white' : 'bg-slate-900 hover:bg-slate-800'
                  }`}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Campaign name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Pitch block (merged as {'{{pitch_block}}'})</span>
          <textarea
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            rows={4}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs"
          />
        </label>
        <p className="text-xs text-slate-500">
          Merge tags: {'{{first_name}}'}, {'{{current_title}}'}, {'{{current_employer}}'}, {'{{industry}}'},{' '}
          {'{{location}}'}, {'{{company_size}}'}, {'{{pitch_block}}'}, follow-ups: {'{{previous_subject}}'},{' '}
          {'{{previous_sent_at}}'}, {'{{step_index}}'}, {'{{unsubscribe_note}}'}
        </p>
        {steps.map((step, idx) => (
          <div key={idx} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">Step {idx + 1}</span>
              <div className="flex gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={step.use_ai}
                    onChange={(e) => {
                      const v = e.target.checked
                      setSteps((s) => s.map((x, i) => (i === idx ? { ...x, use_ai: v } : x)))
                    }}
                  />
                  Generate body with AI (OpenAI key in Settings)
                </label>
                {steps.length > 1 && (
                  <button type="button" className="text-xs text-rose-400" onClick={() => removeStep(idx)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            {idx > 0 && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-slate-400">Delay after previous step (hours)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={step.delay_hours_after_previous}
                  onChange={(e) => {
                    const v = +e.target.value
                    setSteps((s) =>
                      s.map((x, i) => (i === idx ? { ...x, delay_hours_after_previous: v } : x)),
                    )
                  }}
                  className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Subject</span>
              <input
                value={step.subject_template}
                onChange={(e) =>
                  setSteps((s) =>
                    s.map((x, i) => (i === idx ? { ...x, subject_template: e.target.value } : x)),
                  )
                }
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Body</span>
              <textarea
                value={step.body_template}
                onChange={(e) =>
                  setSteps((s) =>
                    s.map((x, i) => (i === idx ? { ...x, body_template: e.target.value } : x)),
                  )
                }
                rows={8}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          onClick={addStep}
          className="rounded-lg border border-dashed border-slate-600 px-4 py-2 text-sm text-slate-400"
        >
          + Add follow-up step
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-lg bg-emerald-700 px-6 py-2 text-white"
          >
            Save campaign
          </button>
          {editId != null && (
            <button
              type="button"
              onClick={async () => {
                if (!confirm('Delete this campaign?')) return
                await api.campaignDelete(editId)
                newCampaign()
                void loadList()
              }}
              className="rounded-lg border border-rose-800 px-4 py-2 text-rose-400"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsTab() {
  const api = outreach()
  const [s, setS] = useState<AppSettings | null>(null)
  const [smtpPass, setSmtpPass] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [testAddr, setTestAddr] = useState('')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void api.settingsGet().then(setS)
  }, [api])

  if (!s) return <p className="text-slate-500">Loading…</p>

  const save = async () => {
    setNote(null)
    try {
      await api.settingsSave({
        settings: s,
        ...(smtpPass ? { smtpPassword: smtpPass } : {}),
        ...(openaiKey ? { openaiKey } : {}),
      })
      setNote('Saved.')
      setSmtpPass('')
      setOpenaiKey('')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  const test = async () => {
    setNote(null)
    try {
      await api.smtpTest(testAddr)
      setNote('SMTP OK. Test email sent if address was provided.')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-slate-400">
        Gmail: use an app password with 2FA, SMTP host smtp.gmail.com, port 465, secure (SSL).
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">SMTP host</span>
        <input
          value={s.smtp.host}
          onChange={(e) => setS({ ...s, smtp: { ...s.smtp, host: e.target.value } })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Port</span>
          <input
            type="number"
            value={s.smtp.port}
            onChange={(e) => setS({ ...s, smtp: { ...s.smtp, port: +e.target.value } })}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input
            type="checkbox"
            checked={s.smtp.secure}
            onChange={(e) => setS({ ...s, smtp: { ...s.smtp, secure: e.target.checked } })}
          />
          TLS / SSL
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Username / email</span>
        <input
          value={s.smtp.user}
          onChange={(e) => setS({ ...s, smtp: { ...s.smtp, user: e.target.value } })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">SMTP password (app password) — leave blank to keep saved</span>
        <input
          type="password"
          value={smtpPass}
          onChange={(e) => setSmtpPass(e.target.value)}
          autoComplete="new-password"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">From name</span>
        <input
          value={s.smtp.fromName}
          onChange={(e) => setS({ ...s, smtp: { ...s.smtp, fromName: e.target.value } })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">From email</span>
        <input
          value={s.smtp.fromEmail}
          onChange={(e) => setS({ ...s, smtp: { ...s.smtp, fromEmail: e.target.value } })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Delay between sends (ms)</span>
        <input
          type="number"
          min={500}
          step={100}
          value={s.sendDelayMs}
          onChange={(e) => setS({ ...s, sendDelayMs: +e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Daily send cap</span>
        <input
          type="number"
          min={1}
          value={s.dailyCap}
          onChange={(e) => setS({ ...s, dailyCap: +e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">OpenAI model (optional AI steps)</span>
        <input
          value={s.openaiModel}
          onChange={(e) => setS({ ...s, openaiModel: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">OpenAI API key — leave blank to keep saved</span>
        <input
          type="password"
          value={openaiKey}
          onChange={(e) => setOpenaiKey(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} className="rounded-lg bg-emerald-700 px-4 py-2 text-white">
          Save settings
        </button>
        <input
          type="email"
          placeholder="test@yourdomain.com"
          value={testAddr}
          onChange={(e) => setTestAddr(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        />
        <button type="button" onClick={() => void test()} className="rounded-lg bg-slate-700 px-4 py-2 text-sm">
          Verify SMTP / send test
        </button>
      </div>
      {note && <p className="text-sm text-amber-200">{note}</p>}
    </div>
  )
}

function SendTab() {
  const api = outreach()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState<number | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [due, setDue] = useState(0)
  const [status, setStatus] = useState<QueueStatus | null>(null)
  const [cw, setCw] = useState<CampaignWithSteps | null>(null)
  const [previewLead, setPreviewLead] = useState<number | null>(null)
  const [previewStep, setPreviewStep] = useState(1)
  const [previewText, setPreviewText] = useState('')
  const [aiNote, setAiNote] = useState('')

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([api.campaignsList(), api.leadsList()])
    setCampaigns(c)
    setLeads(l as Lead[])
    setCampaignId((prev) => (prev != null ? prev : c[0]?.id ?? null))
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

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
    if (campaignId == null || selected.size === 0) {
      setDue(0)
      return
    }
    void api
      .computeDue({ campaignId, leadIds: [...selected] })
      .then((j) => setDue(j.length))
  }, [api, campaignId, selected])

  const toggle = (id: number) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const selectAll = () => {
    if (selected.size === leads.length) setSelected(new Set())
    else setSelected(new Set(leads.map((l) => l.id)))
  }

  const runPreview = async () => {
    if (!campaignId || !previewLead) return
    const r = await api.preview({
      leadId: previewLead,
      campaignId,
      stepOrder: previewStep,
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
    setPreviewText((t) => `${t}\n\n--- AI body ---\n\n${r.body}`)
  }

  const maxStep = cw?.steps.length ?? 1

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Campaign</span>
          <select
            value={campaignId ?? ''}
            onChange={(e) => setCampaignId(+e.target.value || null)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          >
            <option value="">—</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-slate-500">
          Due sends now: <strong className="text-slate-200">{due}</strong>
        </span>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-300">Select leads</span>
          <button type="button" onClick={selectAll} className="text-xs text-indigo-400 hover:underline">
            {selected.size === leads.length ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className="max-h-48 overflow-y-auto text-sm">
          {leads.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-800/50 py-1">
              <input
                type="checkbox"
                checked={selected.has(l.id)}
                onChange={() => toggle(l.id)}
              />
              <span className="font-mono text-xs text-slate-300">{l.email}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!campaignId || selected.size === 0}
          onClick={() => campaignId && api.queueStart({ campaignId, leadIds: [...selected] })}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-40"
        >
          Start queue
        </button>
        <button type="button" onClick={() => void api.queuePause()} className="rounded-lg bg-amber-700 px-4 py-2">
          Pause
        </button>
        <button type="button" onClick={() => void api.queueResume()} className="rounded-lg bg-slate-700 px-4 py-2">
          Resume
        </button>
        <button type="button" onClick={() => void api.queueStop()} className="rounded-lg border border-rose-800 px-4 py-2 text-rose-400">
          Stop
        </button>
      </div>

      {status && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          <p>Running: {status.running ? 'yes' : 'no'} — Paused: {status.paused ? 'yes' : 'no'}</p>
          <p>Sent today: {status.sendsToday}</p>
          <p>Processed this session: {status.processedInSession}</p>
          {status.lastError && <p className="text-rose-400">Error: {status.lastError}</p>}
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <span className="text-sm font-medium text-slate-300">Preview / AI (optional)</span>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            Lead
            <select
              value={previewLead ?? ''}
              onChange={(e) => setPreviewLead(+e.target.value || null)}
              className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1"
            >
              <option value="">—</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.email}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Step
            <input
              type="number"
              min={1}
              max={maxStep}
              value={previewStep}
              onChange={(e) => setPreviewStep(Math.min(maxStep, Math.max(1, +e.target.value)))}
              className="ml-2 w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1"
            />
          </label>
          <button type="button" onClick={() => void runPreview()} className="rounded bg-slate-700 px-3 py-1 text-sm">
            Preview merged
          </button>
        </div>
        <input
          placeholder="Extra instructions for AI…"
          value={aiNote}
          onChange={(e) => setAiNote(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        />
        <button type="button" onClick={() => void runAi()} className="rounded bg-indigo-800 px-3 py-1 text-sm text-white">
          Generate body with AI
        </button>
        {previewText && (
          <textarea readOnly value={previewText} rows={12} className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs" />
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('import')
  const [leadVersion, setLeadVersion] = useState(0)
  const onImported = () => setLeadVersion((v) => v + 1)

  const tabs = useMemo(
    () =>
      [
        ['import', 'Import'],
        ['leads', 'Leads'],
        ['campaigns', 'Campaigns'],
        ['settings', 'Settings'],
        ['send', 'Send'],
      ] as const,
    [],
  )

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">Email Outreach</h1>
          <p className="text-xs text-slate-500">CSV / Excel → personalized sequences → SMTP</p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {tabs.map(([id, label]) => (
            <TabButton key={id} id={id as Tab} active={tab === id} onClick={() => setTab(id as Tab)}>
              {label}
            </TabButton>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-6">
        {tab === 'import' && <ImportTab onImported={onImported} />}
        {tab === 'leads' && <LeadsTab key={leadVersion} />}
        {tab === 'campaigns' && <CampaignsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'send' && <SendTab key={leadVersion} />}
      </main>
    </div>
  )
}
