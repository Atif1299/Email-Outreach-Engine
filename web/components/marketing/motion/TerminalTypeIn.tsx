'use client'

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion, registerScrollTrigger } from '@/lib/gsap/register'

const LINES = [
  { text: 'open gmail --tabs 3', err: false },
  { text: 'open leads.csv', err: false },
  { text: 'copy_paste --manual', err: false },
  { text: 'error: no follow-up governance', err: true },
  { text: 'error: replies lost in inbox chaos', err: true },
]

export default function TerminalTypeIn() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = ref.current
    if (!container || prefersReducedMotion()) return

    const lines = container.querySelectorAll<HTMLElement>('.terminal-line')

    registerScrollTrigger().then((ST) => {
      if (!ST || !container) return

      lines.forEach((line, i) => {
        const full = line.dataset.full ?? ''
        line.textContent = ''
        gsap.to(
          {},
          {
            duration: full.length * 0.028,
            delay: i * 0.4,
            scrollTrigger: {
              trigger: container,
              start: 'top 80%',
              once: true,
            },
            onUpdate: function () {
              const progress = this.progress()
              const chars = Math.floor(full.length * progress)
              line.textContent = full.slice(0, chars)
            },
          }
        )
      })
    })
  }, [])

  return (
    <div ref={ref} className="m-terminal-body">
      {LINES.map((line) => (
        <div key={line.text} className="terminal-line" data-full={line.text}>
          {prefersReducedMotion() ? (
            line.err ? (
              <span className="m-terminal-err">{line.text}</span>
            ) : (
              <>
                <span className="m-terminal-prompt">$</span> {line.text}
              </>
            )
          ) : null}
        </div>
      ))}
      <div>
        <span className="m-terminal-prompt">$</span> <span className="m-terminal-cursor" />
      </div>
    </div>
  )
}
