import { useCallback, useEffect, useState } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { Campaign, Lead } from '@/shared/types'
import type { CampaignWithSteps } from '@/lib/outreachApi'
import type { QueueStatus } from '@/shared/types'
import { Panel } from '@/components/ui/Panel'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'

export function SendStep({
  leadVersion,
  selectedIds,
  preferredCampaignId,
}: {
  leadVersion: number
  selectedIds: Set<number>
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
  const [previewText, setPreviewText] = useState('')
  const [aiNote, setAiNote] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

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
  const selectedCount = selectedIds.size

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
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
        <Panel title="Queue status">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Due now</p>
              <p className="text-2xl font-semibold text-white">{due}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Recipients selected</p>
              <p className="text-2xl font-semibold text-white">{selectedCount}</p>
            </div>
          </div>
          {status && (
            <div className="mt-4 space-y-1 border-t border-border pt-4 text-xs text-slate-400">
              <p>
                <span className="text-slate-500">Running</span>{' '}
                <span className={status.running ? 'text-emerald-400' : 'text-slate-500'}>
                  {status.running ? 'yes' : 'no'}
                </span>
                {' · '}
                <span className="text-slate-500">Paused</span>{' '}
                {status.paused ? 'yes' : 'no'}
              </p>
              <p>
                Sent today: <span className="text-slate-200">{status.sendsToday}</span> · Session:{' '}
                <span className="text-slate-200">{status.processedInSession}</span>
              </p>
              {status.lastError && (
                <p className="text-rose-400/90">Error: {status.lastError}</p>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Run queue">
        <p className="mb-4 text-sm text-slate-400">
          Starts sending for the selected leads from the previous step. Respect your daily cap and delay in Connect.
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
            className="rounded-xl border border-rose-900/60 px-4 py-2.5 text-sm font-medium text-rose-300/90 transition hover:bg-rose-950/50"
          >
            Stop
          </button>
        </div>
      </Panel>

      <div className="rounded-2xl border border-border bg-surface-elevated/40">
        <button
          type="button"
          onClick={() => setPreviewOpen((o) => !o)}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-slate-200"
        >
          Preview & AI tools
          <span className="text-slate-500">{previewOpen ? '▼' : '▶'}</span>
        </button>
        {previewOpen && (
          <div className="space-y-4 border-t border-border px-5 pb-5 pt-2">
            <div className="flex flex-wrap gap-3">
              <label className="text-sm text-slate-400">
                Lead
                <select
                  value={previewLead ?? ''}
                  onChange={(e) => setPreviewLead(+e.target.value || null)}
                  className="ml-2 max-w-xs text-sm"
                >
                  <option value="">—</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-400">
                Step
                <input
                  type="number"
                  min={1}
                  max={maxStep}
                  value={previewStep}
                  onChange={(e) =>
                    setPreviewStep(Math.min(maxStep, Math.max(1, +e.target.value)))
                  }
                  className="ml-2 w-16 text-sm"
                />
              </label>
              <SecondaryButton onClick={() => void runPreview()}>Preview merged</SecondaryButton>
            </div>
            <input
              placeholder="Extra instructions for AI…"
              value={aiNote}
              onChange={(e) => setAiNote(e.target.value)}
              className="text-sm"
            />
            <SecondaryButton onClick={() => void runAi()}>Generate body with AI</SecondaryButton>
            {previewText && (
              <textarea readOnly value={previewText} rows={10} className="font-mono text-xs" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
