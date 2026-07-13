'use client'

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion } from '@/lib/gsap/register'

export default function DeliverabilityHeroPulse() {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = ref.current
    if (!svg || prefersReducedMotion()) return

    const shield = svg.querySelector('.deliverability-shield')
    const ring = svg.querySelector('.deliverability-ring')

    if (shield) {
      gsap.to(shield, {
        scale: 1.06,
        transformOrigin: '50% 50%',
        duration: 2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })
    }
    if (ring) {
      gsap.to(ring, {
        attr: { r: 42 },
        opacity: 0.15,
        duration: 2.5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })
    }
  }, [])

  return (
    <div className="deliverability-hero-pulse" aria-hidden="true">
      <svg ref={ref} viewBox="0 0 100 100" className="deliverability-hero-svg">
        <circle cx="50" cy="50" r="32" className="deliverability-ring" fill="none" stroke="rgba(56,189,248,0.35)" strokeWidth="1" />
        <path
          className="deliverability-shield"
          d="M50 18 L72 28 V48 C72 62 62 74 50 78 C38 74 28 62 28 48 V28 Z"
          fill="rgba(56,189,248,0.1)"
          stroke="rgba(125,211,252,0.6)"
          strokeWidth="1.5"
        />
        <text x="50" y="54" textAnchor="middle" fill="#7dd3fc" fontSize="18">
          ✉
        </text>
      </svg>
    </div>
  )
}
