'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import ProductFrame from '@/components/marketing/ProductFrame'
import DashboardHeroMock from '@/components/marketing/mocks/DashboardHeroMock'
import { prefersReducedMotion, registerScrollTrigger } from '@/lib/gsap/register'

export default function ProductScrollReveal({ children }: { children?: ReactNode }) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const section = sectionRef.current
    const card = cardRef.current
    if (!section || !card || prefersReducedMotion()) return

    registerScrollTrigger().then((ST) => {
      if (!ST || !section || !card) return

      gsap.fromTo(
        card,
        {
          rotateX: 18,
          rotateY: -8,
          scale: 0.88,
          y: 60,
          opacity: 0.4,
          transformPerspective: 1200,
        },
        {
          rotateX: 0,
          rotateY: 0,
          scale: 1,
          y: 0,
          opacity: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'center center',
            scrub: 1,
          },
        }
      )
    })
  }, [])

  return (
    <section ref={sectionRef} className="m-section product-scroll-section">
      <div className="product-scroll-header">
        <p className="m-bento-intro-label">Live dashboard</p>
        <h2 className="m-display-sm">The engine behind every send</h2>
        <p className="product-scroll-lead">
          Queue, caps, AI preview. Everything you run in production.
        </p>
      </div>
      <div ref={cardRef} className="product-scroll-card">
        <ProductFrame>
          {children ?? <DashboardHeroMock />}
        </ProductFrame>
      </div>
      <p className="hero-cred">
        GPT · Gemini · RFC 8058 unsubscribe · multi-inbox rotation
      </p>
    </section>
  )
}
