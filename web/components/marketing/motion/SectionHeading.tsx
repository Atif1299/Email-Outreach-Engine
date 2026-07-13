'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion, registerScrollTrigger } from '@/lib/gsap/register'

export default function SectionHeading({
  text,
  className = 'm-display-sm',
  as: Tag = 'h2',
  align = 'center',
}: {
  text: string
  className?: string
  as?: 'h1' | 'h2' | 'h3'
  align?: 'left' | 'center'
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const words = text.split(' ')

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return

    const spans = el.querySelectorAll('.section-heading-word')

    registerScrollTrigger().then((ST) => {
      if (!ST || !el) return
      gsap.fromTo(
        spans,
        { y: 24, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.55,
          stagger: 0.06,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 88%',
            once: true,
          },
        }
      )
    })
  }, [text])

  const Heading = Tag

  return (
    <Heading
      ref={ref as React.RefObject<HTMLHeadingElement>}
      className={className}
      style={{ textAlign: align, display: 'flex', flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: '0.3em' }}
    >
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="section-heading-word" style={{ display: 'inline-block' }}>
          {word}
        </span>
      ))}
    </Heading>
  )
}

