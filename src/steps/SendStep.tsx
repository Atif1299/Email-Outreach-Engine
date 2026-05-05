import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { Campaign, Lead } from '@/shared/types'
import type { QueueStatus } from '@/shared/types'
import { Panel } from '@/components/ui/Panel'
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
  const [queueActionBusy, setQueueActionBusy] = useState(false)
  const [queueNote, setQueueNote] = useState<string | null>(null)

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

  const doQueueAction = async (label: string, fn: () => Promise<unknown>) => {
    setQueueActionBusy(true)
    setQueueNote(null)
    try {
      await fn()
      setQueueNote(`${label}.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setQueueNote(`${label} failed: ${msg}`)
    } finally {
      setQueueActionBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-snug text-ink-muted">
        Start, pause, or stop the sender. Use Preview to test merges or generate AI bodies before running the queue.
      </p>

      <div className="grid gap-3 md:grid-cols-2 md:items-stretch xl:grid-cols-3 xl:gap-4">
        <Panel title="Campaign to send">
          {campaigns.length === 0 ? (
            <p className="text-sm leading-snug text-ink-muted">
              No campaigns found. Go back to <span className="font-medium text-ink">Campaign</span> to create one.
            </p>
          ) : (
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
          )}
        </Panel>

        <Panel title="Queue status">
          <div className="grid grid-cols-2 gap-3 text-sm xl:gap-4">
            <div className="rounded-lg border border-edge/80 bg-canvas/30 px-3 py-2.5 xl:px-4 xl:py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Due now</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink xl:text-3xl">{due}</p>
            </div>
            <div className="rounded-lg border border-edge/80 bg-canvas/30 px-3 py-2.5 xl:px-4 xl:py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Recipients selected</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink xl:text-3xl">{selectedCount}</p>
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

        <Panel title="Send rules" className="hidden xl:flex xl:min-h-0 xl:flex-col">
          <p className="text-sm leading-relaxed text-ink-muted">
            Daily send cap and min/max delay between sends come from <span className="font-medium text-ink">Connect</span>.
            Change them there before starting a long run.
          </p>
        </Panel>
      </div>

      <Panel title="Run queue">
        <p className="mb-3 text-sm leading-snug text-ink-muted">
          Sends selected leads. Uses daily cap and delay from Connect.
        </p>
        <div className="flex flex-wrap gap-2">
          <PrimaryButton
            disabled={!campaignId || selectedIds.size === 0 || queueActionBusy}
            onClick={() =>
              void doQueueAction('Started', () =>
                campaignId ? api.queueStart({ campaignId, leadIds: [...selectedIds] }) : Promise.resolve(),
              )
            }
          >
            {queueActionBusy ? 'Working…' : 'Start queue'}
          </PrimaryButton>
          <SecondaryButton
            disabled={queueActionBusy}
            onClick={() => void doQueueAction('Paused', () => api.queuePause())}
          >
            Pause
          </SecondaryButton>
          <SecondaryButton
            disabled={queueActionBusy}
            onClick={() => void doQueueAction('Resumed', () => api.queueResume())}
          >
            Resume
          </SecondaryButton>
          <button
            type="button"
            disabled={queueActionBusy}
            onClick={() => void doQueueAction('Stopped', () => api.queueStop())}
            className="rounded-lg border border-edge px-4 py-2.5 text-sm font-medium text-danger transition-colors duration-150 hover:bg-danger-muted"
          >
            Stop
          </button>
        </div>
        {queueNote && (
          <p
            className={`mt-3 text-sm ${queueNote.includes('failed:') ? 'text-danger' : 'text-ink-muted'}`}
            role={queueNote.includes('failed:') ? 'alert' : undefined}
          >
            {queueNote}
          </p>
        )}
      </Panel>
    </div>
  )
}
