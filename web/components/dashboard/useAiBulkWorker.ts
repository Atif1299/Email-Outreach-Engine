'use client'

import { useEffect, useRef, useState } from 'react'

export interface ActiveAiBulkJob {
  id: number
  campaignId: number
  stepOrder: number
  status: string
  total: number
  processed: number
  generated: number
  failed: number
  skipped: number
  remaining: number
  failedLeadIds: number[]
  batchPauseUntil: string | null
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchActiveJobs(): Promise<ActiveAiBulkJob[]> {
  const res = await fetch('/api/ai-generate/bulk/active')
  if (!res.ok) return []
  const { jobs } = await res.json()
  return jobs ?? []
}

function applyTickToJobs(
  jobs: ActiveAiBulkJob[],
  tick: { jobId?: number; generated?: number; processed?: number; failed?: number; remaining?: number }
): ActiveAiBulkJob[] {
  if (tick.jobId == null || tick.generated == null) return jobs
  return jobs.map((j) =>
    j.id === tick.jobId
      ? {
          ...j,
          generated: tick.generated ?? j.generated,
          processed: tick.processed ?? j.processed,
          failed: tick.failed ?? j.failed,
          remaining: tick.remaining ?? j.remaining,
        }
      : j
  )
}

/** Keeps server-side AI bulk jobs running while the dashboard is open. */
export function useAiBulkWorker(options?: { enabled?: boolean }): ActiveAiBulkJob[] {
  const enabled = options?.enabled ?? true
  const [activeJobs, setActiveJobs] = useState<ActiveAiBulkJob[]>([])
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setActiveJobs([])
      return
    }

    let cancelled = false

    const pollProgress = async () => {
      while (!cancelled) {
        await sleep(1500)
        if (cancelled) break
        try {
          const list = await fetchActiveJobs()
          if (list.length) setActiveJobs(list)
        } catch {
          // ignore transient poll errors
        }
      }
    }

    const loop = async () => {
      while (!cancelled) {
        if (inFlightRef.current) {
          await sleep(500)
          continue
        }

        try {
          const list = await fetchActiveJobs()
          setActiveJobs(list)

          if (!list.length) {
            await sleep(60000)
            continue
          }

          inFlightRef.current = true
          let ticks = 0
          const burstStart = Date.now()

          while (!cancelled && ticks < 30 && Date.now() - burstStart < 55_000) {
            const tickRes = await fetch('/api/ai-generate/bulk/tick', { method: 'POST' })
            if (!tickRes.ok) break

            const tick = await tickRes.json()
            ticks++
            setActiveJobs((prev) => applyTickToJobs(prev.length ? prev : list, tick))
            setActiveJobs(await fetchActiveJobs())

            if (tick.status === 'pausing') {
              const pauseUntilMs = tick.pauseUntil
                ? new Date(tick.pauseUntil).getTime()
                : Date.now() + 30_000
              const waitMs = Math.min(Math.max(pauseUntilMs - Date.now(), 1000), 60_000)
              await sleep(waitMs)
              break
            }
            if (tick.status === 'cancelled') break
            if (tick.status === 'idle') break
            if (tick.status === 'completed') continue
            if (tick.status === 'busy') {
              await sleep(500)
              break
            }
          }

          inFlightRef.current = false

          if (list.length > 0) {
            await sleep(300)
          } else if (ticks === 0) {
            await sleep(2000)
          }
        } catch {
          inFlightRef.current = false
          await sleep(5000)
        }
      }
    }

    void loop()
    void pollProgress()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return activeJobs
}
