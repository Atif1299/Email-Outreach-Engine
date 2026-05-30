import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { Campaign, CampaignSendProgress } from '@/shared/types'
import type { QueueStatus } from '@/shared/types'
import { Panel } from '@/components/ui/Panel'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'

type ProgressPhase = 'not_started' | 'in_progress' | 'complete'

function progressPhase(p: CampaignSendProgress): ProgressPhase {
  if (p.leadCount === 0) return 'not_started'
  if (p.leadsCompleted >= p.leadCount) return 'complete'
  if (p.emailsSent > 0 || p.leadsStarted > 0) return 'in_progress'
  return 'not_started'
}

function campaignOptionLabel(name: string, p: CampaignSendProgress | undefined): string {
  if (!p || p.leadCount === 0) return name
  const phase = progressPhase(p)
  if (phase === 'complete') return `${name} ✓ ${p.leadsCompleted}/${p.leadCount} complete`
  if (phase === 'in_progress') return `${name} · ${p.leadsStarted}/${p.leadCount} emailed`
  return name
}

function phaseLabel(phase: ProgressPhase): string {
  if (phase === 'complete') return 'Complete'
  if (phase === 'in_progress') return 'In progress'
  return 'Not started'
}

function phaseClass(phase: ProgressPhase): string {
  if (phase === 'complete') return 'text-green-500'
  if (phase === 'in_progress') return 'text-accent'
  return 'text-ink-muted'
}

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
  const [campaignLeadCount, setCampaignLeadCount] = useState(0)
  const [due, setDue] = useState(0)
  const [progressMap, setProgressMap] = useState<Record<number, CampaignSendProgress>>({})
  const [status, setStatus] = useState<QueueStatus | null>(null)
  const [queueActionBusy, setQueueActionBusy] = useState(false)
  const [queueNote, setQueueNote] = useState<string | null>(null)

  const refreshProgress = useCallback(async () => {
    const rows = await api.campaignsSendProgressList()
    const map: Record<number, CampaignSendProgress> = {}
    for (const r of rows) map[r.campaignId] = r
    setProgressMap(map)
  }, [api])

  const load = useCallback(async () => {
    const c = await api.campaignsList()
    setCampaigns(c)
    setCampaignId((prev) => {
      if (preferredCampaignId != null && c.some((x) => x.id === preferredCampaignId)) {
        return preferredCampaignId
      }
      return prev != null ? prev : c[0]?.id ?? null
    })
    await refreshProgress()
  }, [api, preferredCampaignId, refreshProgress])

  useEffect(() => {
    void load()
  }, [load, leadVersion])

  /** Queue uses all leads in the selected campaign; load ids + due together so counts stay in sync. */
  useEffect(() => {
    if (campaignId == null) {
      setCampaignLeadCount(0)
      setDue(0)
      return
    }
    setDue(0)
    let cancelled = false
    void (async () => {
      const ids = await api.leadIdsForCampaign(campaignId)
      if (cancelled) return
      setCampaignLeadCount(ids.length)
      setSelectedIds(new Set(ids))
      if (ids.length === 0) return
      const jobs = await api.computeDue({ campaignId, leadIds: ids })
      if (cancelled) return
      setDue(jobs.length)
      await refreshProgress()
    })()
    return () => {
      cancelled = true
    }
  }, [api, campaignId, leadVersion, setSelectedIds, refreshProgress])

  useEffect(() => {
    if (preferredCampaignId != null) setCampaignId(preferredCampaignId)
  }, [preferredCampaignId])

  useEffect(() => {
    const handler = (_e: unknown, st: QueueStatus) => {
      setStatus(st)
      void refreshProgress()
    }
    window.ipcRenderer.on('queue:status', handler)
    void api.queueStatus().then(setStatus)
    const t = setInterval(() => {
      void api.queueStatus().then(setStatus)
      void refreshProgress()
    }, 2000)
    return () => {
      window.ipcRenderer.off('queue:status', handler)
      clearInterval(t)
    }
  }, [api, refreshProgress])

  const currentProgress = campaignId != null ? progressMap[campaignId] : undefined
  const phase = currentProgress ? progressPhase(currentProgress) : 'not_started'
  const emailedPct =
    currentProgress && currentProgress.leadCount > 0
      ? Math.round((currentProgress.leadsStarted / currentProgress.leadCount) * 100)
      : 0
  const completePct =
    currentProgress && currentProgress.leadCount > 0
      ? Math.round((currentProgress.leadsCompleted / currentProgress.leadCount) * 100)
      : 0

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
        {status.running && status.processedInSession > 0 && (
          <>
            <span className="text-ink-faint"> · </span>
            This run: <span className="text-ink">{status.processedInSession}</span>
          </>
        )}
      </p>
    ) : null

  const doQueueAction = async (label: string, fn: () => Promise<unknown>) => {
    setQueueActionBusy(true)
    setQueueNote(null)
    try {
      await fn()
      setQueueNote(`${label}.`)
      await refreshProgress()
      if (campaignId != null) {
        const ids = await api.leadIdsForCampaign(campaignId)
        setCampaignLeadCount(ids.length)
        const jobs = await api.computeDue({ campaignId, leadIds: ids })
        setDue(jobs.length)
      }
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
            <>
              <select
                value={campaignId ?? ''}
                onChange={(e) => setCampaignId(+e.target.value || null)}
                className="text-sm"
              >
                <option value="">Select…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {campaignOptionLabel(c.name, progressMap[c.id])}
                  </option>
                ))}
              </select>
              {currentProgress && (
                <p className={`mt-2 text-xs font-medium ${phaseClass(phase)}`}>
                  {phaseLabel(phase)}
                  {phase === 'in_progress' &&
                    ` · ${currentProgress.leadsStarted} of ${currentProgress.leadCount} leads emailed`}
                  {phase === 'complete' && ` · all leads finished the sequence`}
                  {phase === 'not_started' && currentProgress.emailsSent === 0 && ' · no emails sent yet'}
                </p>
              )}
            </>
          )}
        </Panel>

        <Panel title="Queue status">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-edge/80 bg-canvas/30 px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Due now</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{due}</p>
            </div>
            <div className="rounded-lg border border-edge/80 bg-canvas/30 px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Campaign leads</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{campaignLeadCount}</p>
            </div>
          </div>
          {currentProgress && currentProgress.leadCount > 0 && (
            <div className="mt-3 space-y-2 border-t border-edge pt-3">
              <div className="grid grid-cols-2 gap-3 text-xs text-ink-muted">
                <p>
                  <span className="font-medium text-ink">{currentProgress.leadsStarted}</span> /{' '}
                  {currentProgress.leadCount} leads emailed
                </p>
                <p className="text-right">
                  <span className="font-medium text-ink">{currentProgress.leadsCompleted}</span> /{' '}
                  {currentProgress.leadCount} sequence complete
                </p>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-ink-faint">
                  <span>Progress</span>
                  <span className="tabular-nums">{emailedPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-edge">
                  <div
                    className={`h-1.5 rounded-full transition-[width] duration-200 ${phase === 'complete' ? 'bg-green-500' : 'bg-accent'}`}
                    style={{ width: `${emailedPct}%` }}
                  />
                </div>
              </div>
              <p className="text-xs text-ink-muted">
                <span className="font-medium text-ink">{currentProgress.emailsSent}</span> emails sent (all time)
                {completePct > 0 && (
                  <span className="text-ink-faint"> · {completePct}% finished full sequence</span>
                )}
              </p>
            </div>
          )}
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
          Sends all leads in the selected campaign. Uses daily cap and delay from Connect.
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
