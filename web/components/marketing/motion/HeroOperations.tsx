'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import LiveEventFeed from '@/components/marketing/motion/LiveEventFeed'
import EmailPipelineStack from '@/components/marketing/motion/EmailPipelineStack'
import MagneticButton from '@/components/marketing/motion/MagneticButton'
import { EngineDemoProvider } from '@/components/marketing/motion/EngineDemoProvider'
import { prefersReducedMotion } from '@/lib/gsap/register'

export default function HeroOperations() {
  const sectionRef = useRef<HTMLElement>(null)
  const headlineRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const headline = headlineRef.current
    if (!headline) return
    const lines = headline.querySelectorAll('.hero-ops-line')
    gsap.fromTo(
      lines,
      { y: 48, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.75, stagger: 0.14, ease: 'power3.out' }
    )
  }, [])

  return (
    <EngineDemoProvider>
      <section ref={sectionRef} className="hero-ops">
        <div className="hero-ops-grid" aria-hidden="true" />
        <div className="hero-ops-inner">
          <div className="hero-ops-copy">
            <div className="m-hero-status hero-ops-status">
              Engine live · cloud cron · 4 inboxes
            </div>

            <h1 ref={headlineRef} className="hero-ops-headline">
              <span className="hero-ops-line">Cold email,</span>
              <span className="hero-ops-line hero-ops-line--accent">on autopilot.</span>
            </h1>

            <p className="hero-ops-sub">
              Import leads, let AI write each message, and run multi-step sequences across every inbox without living in Gmail.
            </p>

            <div className="hero-ops-ctas">
              <MagneticButton>
                <Link href="/dashboard" className="m-btn-primary m-btn-lg">
                  Open Dashboard
                </Link>
              </MagneticButton>
              <MagneticButton>
                <Link href="/platform" className="m-btn-ghost m-btn-lg">
                  See the pipeline
                </Link>
              </MagneticButton>
            </div>

            <LiveEventFeed />
          </div>

          <div className="hero-ops-visual">
            <EmailPipelineStack />
            <div className="hero-ops-caption">
              Each lead moves through queue → AI → send. You watch the engine work.
            </div>
          </div>
        </div>
      </section>
    </EngineDemoProvider>
  )
}
