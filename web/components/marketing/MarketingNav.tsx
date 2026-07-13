'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import MagneticButton from '@/components/marketing/motion/MagneticButton'
import { registerScrollTrigger } from '@/lib/gsap/register'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/platform', label: 'Platform' },
  { href: '/deliverability', label: 'Deliverability' },
]

export default function MarketingNav() {
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return

    registerScrollTrigger().then((ST) => {
      if (!ST || !nav) return

      gsap.to(nav, {
        backdropFilter: 'blur(16px)',
        backgroundColor: 'rgba(6, 8, 13, 0.88)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        ease: 'none',
        scrollTrigger: {
          trigger: document.body,
          start: 'top top',
          end: '80px top',
          scrub: 0.3,
        },
      })
    })
  }, [])

  return (
    <>
      <nav ref={navRef} className="m-nav">
        <div className="m-nav-inner">
          <Link href="/" className="m-logo">
            <span className="m-logo-mark" aria-hidden="true">
              ✉
            </span>
            <span>Email Outreach Engine</span>
          </Link>

          <div className="m-nav-links">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`m-nav-link ${pathname === link.href ? 'is-active' : ''}`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <MagneticButton>
            <Link href="/dashboard" className="m-btn-primary">
              Open Dashboard
            </Link>
          </MagneticButton>
        </div>
      </nav>

      <div className="m-mobile-nav">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`m-nav-link ${pathname === link.href ? 'is-active' : ''}`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </>
  )
}
