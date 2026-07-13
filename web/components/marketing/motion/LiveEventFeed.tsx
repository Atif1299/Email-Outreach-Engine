'use client'

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { useEngineDemo } from '@/components/marketing/motion/EngineDemoProvider'
import { ENGINE_LOG, PIPELINE_LOG } from '@/components/marketing/motion/engine-demo'

export default function LiveEventFeed() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const lineHeightRef = useRef(0)
  const { beat, beatKey, reducedMotion } = useEngineDemo()

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track || reducedMotion) return

    const firstLine = track.querySelector<HTMLElement>('.ops-feed-line')
    if (!firstLine) return

    lineHeightRef.current = firstLine.offsetHeight
    if (lineHeightRef.current <= 0) return

    const lines = track.querySelectorAll<HTMLElement>('.ops-feed-line')
    gsap.fromTo(
      lines,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.4, stagger: 0.06, delay: 0.35, ease: 'power2.out' }
    )
  }, [reducedMotion])

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!track || reducedMotion || beatKey === 0) return

    const lineHeight = lineHeightRef.current
    if (lineHeight <= 0) return

    gsap.killTweensOf(track)

    const tl = gsap.timeline()

    tl.to(track, {
      y: -lineHeight,
      duration: 0.52,
      ease: 'power2.inOut',
    })

    tl.add(() => {
      const first = track.firstElementChild
      if (first) track.appendChild(first)
      gsap.set(track, { y: 0 })

      const stage = PIPELINE_LOG[beat]?.stage
      if (!stage || !viewport) return

      const viewportRect = viewport.getBoundingClientRect()
      const stageLine = [...track.querySelectorAll<HTMLElement>('.ops-feed-line')].find((line) => {
        if (line.dataset.stage !== stage) return false
        const rect = line.getBoundingClientRect()
        return rect.top >= viewportRect.top - 4 && rect.bottom <= viewportRect.bottom + 4
      })

      if (stageLine) {
        gsap.fromTo(
          stageLine,
          { backgroundColor: 'rgba(56, 189, 248, 0.16)' },
          { backgroundColor: 'rgba(56, 189, 248, 0)', duration: 1.1, ease: 'power2.out' }
        )
      }
    })
  }, [beat, beatKey, reducedMotion])

  return (
    <div className="ops-feed" aria-label="Live engine events">
      <div className="ops-feed-header">
        <span className="ops-feed-dot" />
        LIVE ENGINE LOG
      </div>
      <div ref={viewportRef} className="ops-feed-body">
        <div ref={trackRef} className="ops-feed-track">
          {[...ENGINE_LOG, ...ENGINE_LOG.slice(0, 3)].map((e, i) => (
            <div
              key={`${e.time}-${i}`}
              data-stage={'stage' in e ? e.stage : undefined}
              className={`ops-feed-line ops-feed-line--${e.tone}`}
            >
              <span className="ops-feed-time">{e.time}</span>
              <span className="ops-feed-msg">{e.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
