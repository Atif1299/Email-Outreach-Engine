'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/platform', label: 'Platform' },
  { href: '/deliverability', label: 'Deliverability' },
]

export default function MarketingNav() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <nav className={`m-nav ${scrolled ? 'is-scrolled' : ''}`}>
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

          <Link href="/dashboard" className="m-btn-primary">
            Open Dashboard
          </Link>
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
