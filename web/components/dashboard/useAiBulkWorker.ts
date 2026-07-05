'use client'

import { useEffect, useRef } from 'react'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Keeps server-side AI bulk jobs running while the dashboard is open. */
export function useAiBulkWorker() {
  const inFlightRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    const loop = async () => {
      while (!cancelled) {
        if (inFlightRef.current) {
          await sleep(1000)
          continue
        }

        try {
          const activeRes = await fetch('/api/ai-generate/bulk/active')
          if (!activeRes.ok) {
            await sleep(5000)
            continue
          }
          const { jobs } = await activeRes.json()
          if (!jobs?.length) {
            await sleep(60000)
            continue
          }

          inFlightRef.current = true
          const tickRes = await fetch('/api/ai-generate/bulk/tick', { method: 'POST' })
          inFlightRef.current = false

          if (!tickRes.ok) {
            await sleep(5000)
            continue
          }

          const tick = await tickRes.json()
          if (tick.status === 'pausing') {
            await sleep(3000)
          } else if (tick.status === 'idle') {
            await sleep(60000)
          } else {
            await sleep(1200)
          }
        } catch {
          inFlightRef.current = false
          await sleep(5000)
        }
      }
    }

    void loop()
    return () => {
      cancelled = true
    }
  }, [])
}
