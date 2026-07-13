'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import MagneticButton from '@/components/marketing/motion/MagneticButton'
import { prefersReducedMotion, registerScrollTrigger } from '@/lib/gsap/register'

const MARQUEE_LABELS = ['Import', 'Personalize', 'Send', 'Track', 'Reply', 'Scale']

function MarqueeSet({ hidden }: { hidden?: boolean }) {
  return (
    <div className="motion-footer-marquee-set" aria-hidden={hidden}>
      {MARQUEE_LABELS.map((label, i) => (
        <span key={`${label}-${hidden ? 'b' : 'a'}-${i}`} className="motion-footer-marquee-label">
          {label}
        </span>
      ))}
    </div>
  )
}

export default function MotionFooter() {
  const footerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const footer = footerRef.current
    if (!footer || prefersReducedMotion()) return

    registerScrollTrigger().then((ST) => {
      if (!ST || !footer) return

      gsap.fromTo(
        footer.querySelector('.motion-footer-inner'),
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          scrollTrigger: {
            trigger: footer,
            start: 'top 85%',
            once: true,
          },
        }
      )
    })
  }, [])

  const year = new Date().getFullYear()

  return (
    <footer ref={footerRef} className="motion-footer">
      <div className="motion-footer-curtain" aria-hidden="true" />
      <div className="motion-footer-marquee" aria-hidden="true">
        <div className="motion-footer-marquee-track">
          <MarqueeSet />
          <MarqueeSet hidden />
        </div>
      </div>
      <div className="motion-footer-inner m-footer-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="m-logo-mark" aria-hidden="true">
            ✉
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Email Outreach Engine</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--m-dim)', marginTop: '0.125rem' }}>
              Import, personalize, and send cold emails at scale.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.875rem', alignItems: 'center' }}>
          <MagneticButton>
            <Link href="/" className="m-nav-link" style={{ padding: 0 }}>
              Home
            </Link>
          </MagneticButton>
          <MagneticButton>
            <Link href="/platform" className="m-nav-link" style={{ padding: 0 }}>
              Platform
            </Link>
          </MagneticButton>
          <MagneticButton>
            <Link href="/deliverability" className="m-nav-link" style={{ padding: 0 }}>
              Deliverability
            </Link>
          </MagneticButton>
          <MagneticButton>
            <Link href="/dashboard" className="m-btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}>
              Open Dashboard
            </Link>
          </MagneticButton>
        </div>

        <div style={{ fontSize: '0.8125rem', color: 'var(--m-dim)' }}>© {year} Email Outreach Engine</div>
      </div>
    </footer>
  )
}
