'use client'

import { Fragment, useEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion, registerScrollTrigger } from '@/lib/gsap/register'

const STEPS = [
  { id: 'connect', label: 'Connect', num: 1 },
  { id: 'import', label: 'Import', num: 2 },
  { id: 'leads', label: 'Leads', num: 3 },
  { id: 'campaign', label: 'Campaign', num: 4 },
  { id: 'preview', label: 'Preview', num: 5 },
  { id: 'queue', label: 'Queue', num: 6 },
  { id: 'replies', label: 'Replies', num: 7 },
]

export default function HeroPipelineMotion({
  variant = 'animated',
  activeId,
}: {
  variant?: 'animated' | 'nav'
  activeId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return

    const fills = el.querySelectorAll<HTMLElement>('.hero-pipeline-connector-fill')

    registerScrollTrigger().then((ST) => {
      if (!ST || !el) return

      fills.forEach((fill, i) => {
        gsap.fromTo(
          fill,
          { scaleX: 0 },
          {
            scaleX: 1,
            duration: 0.8,
            delay: i * 0.12,
            ease: 'power2.out',
            transformOrigin: 'left center',
            scrollTrigger: {
              trigger: el,
              start: 'top 80%',
              once: true,
            },
          }
        )
      })
    })
  }, [])

  return (
    <div ref={ref} className="hero-pipeline" role="list" aria-label="Outreach pipeline">
      {STEPS.map((step, i) => (
        <Fragment key={step.id}>
          {i > 0 && (
            <span className="hero-pipeline-connector" aria-hidden="true">
              <span className="hero-pipeline-connector-fill" />
            </span>
          )}
          {variant === 'nav' ? (
            <a
              href={`#${step.id}`}
              className={`hero-pipeline-node ${activeId === step.id ? 'is-active' : ''}`}
              role="listitem"
            >
              <span className="hero-pipeline-dot">{step.num}</span>
              <span>{step.label}</span>
            </a>
          ) : (
            <div className="hero-pipeline-node is-lit" role="listitem">
              <span className="hero-pipeline-dot">{step.num}</span>
              <span>{step.label}</span>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  )
}
