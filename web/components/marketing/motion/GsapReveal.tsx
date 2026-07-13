'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion, registerScrollTrigger } from '@/lib/gsap/register'

export default function GsapReveal({
  children,
  className = '',
  delay = 0,
  y = 32,
  staggerChildren = false,
  childSelector = ':scope > *',
}: {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
  staggerChildren?: boolean
  childSelector?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: 1, y: 0 })
      gsap.set(el.querySelectorAll(childSelector), { opacity: 1, y: 0 })
      el.classList.remove('gsap-reveal-pending')
      return
    }

    let tween: gsap.core.Tween | null = null
    let scrollTrigger: import('gsap/ScrollTrigger').ScrollTrigger | null = null

    registerScrollTrigger().then((ST) => {
      if (!el) return
      if (!ST) {
        gsap.set(el, { opacity: 1, y: 0 })
        return
      }

      const targets = staggerChildren ? el.querySelectorAll(childSelector) : el
      gsap.set(targets, { opacity: 0, y })

      tween = gsap.to(targets, {
        opacity: 1,
        y: 0,
        duration: 0.7,
        delay: delay / 1000,
        stagger: staggerChildren ? 0.1 : 0,
        ease: 'power2.out',
        onComplete: () => el.classList.remove('gsap-reveal-pending'),
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          once: true,
        },
      })

      scrollTrigger = tween.scrollTrigger ?? null
    })

    return () => {
      tween?.kill()
      scrollTrigger?.kill()
    }
  }, [delay, y, staggerChildren, childSelector])

  return (
    <div ref={ref} className={`gsap-reveal-pending ${className}`}>
      {children}
    </div>
  )
}
