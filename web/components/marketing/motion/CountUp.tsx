'use client'

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { registerScrollTrigger } from '@/lib/gsap/register'

export function HudCountUp({
  items,
  className = 'hero-hud',
}: {
  items: Array<{ value: number; label: string }>
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = ref.current
    if (!container) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const values = container.querySelectorAll<HTMLElement>('[data-hud-count]')

    if (reduced) return

    values.forEach((el) => {
      const target = parseInt(el.dataset.hudCount ?? '0', 10)
      const obj = { val: 0 }
      gsap.to(obj, {
        val: target,
        duration: 1.6,
        delay: 0.8,
        ease: 'power2.out',
        onUpdate: () => {
          el.textContent = String(Math.round(obj.val))
        },
      })
    })
  }, [items])

  return (
    <div ref={ref} className={className}>
      {items.map((item, i) => (
        <span key={item.label}>
          {i > 0 && <span className="hero-hud-sep"> · </span>}
          <span data-hud-count={item.value}>{item.value}</span> {item.label}
        </span>
      ))}
    </div>
  )
}

export default function CountUp({
  stats,
}: {
  stats: Array<{ value: string; label: string }>
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = ref.current
    if (!container) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const values = container.querySelectorAll<HTMLElement>('[data-count]')

    if (reduced) {
      values.forEach((el, i) => {
        el.textContent = stats[i]?.value ?? el.textContent
      })
      return
    }

    registerScrollTrigger().then((ST) => {
      if (!ST || !container) return

      values.forEach((el, i) => {
        const target = parseInt(el.dataset.count ?? '0', 10)
        if (isNaN(target)) {
          el.textContent = stats[i]?.value ?? el.textContent
          return
        }
        const obj = { val: 0 }
        gsap.to(obj, {
          val: target,
          duration: 1.2,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: container,
            start: 'top 85%',
            once: true,
          },
          onUpdate: () => {
            el.textContent = String(Math.round(obj.val))
          },
        })
      })
    })
  }, [stats])

  return (
    <div ref={ref} className="m-stats-band">
      {stats.map((stat, i) => {
        const num = parseInt(stat.value, 10)
        return (
          <div key={stat.label} className="m-stats-item">
            <div className="m-stats-value" data-count={isNaN(num) ? undefined : num}>
              {stat.value}
            </div>
            <div className="m-stats-label">{stat.label}</div>
            {i < stats.length - 1 && <span className="m-stats-divider" aria-hidden="true" />}
          </div>
        )
      })}
    </div>
  )
}
