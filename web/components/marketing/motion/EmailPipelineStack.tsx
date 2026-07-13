'use client'

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { useEngineDemo } from '@/components/marketing/motion/EngineDemoProvider'
import {
  PIPELINE_CARDS,
  PIPELINE_LOG,
  STACK_OFFSET,
  STACK_SLOTS,
  type PipelineStage,
} from '@/components/marketing/motion/engine-demo'

const STAGE_ORDER: PipelineStage[] = ['queue', 'ai', 'sent']

function stageIndex(stage: PipelineStage) {
  return STAGE_ORDER.indexOf(stage)
}

export default function EmailPipelineStack() {
  const ref = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Record<PipelineStage, HTMLElement | null>>({
    queue: null,
    ai: null,
    sent: null,
  })
  const stackOrderRef = useRef<PipelineStage[]>([...STAGE_ORDER])
  const { beatKey, reducedMotion } = useEngineDemo()
  const hasEnteredRef = useRef(false)
  const cycleTweenRef = useRef<gsap.core.Timeline | null>(null)

  const applyStackLayout = (order: PipelineStage[], enteringStage?: PipelineStage) => {
    order.forEach((stage, slot) => {
      const el = cardRefs.current[stage]
      if (!el) return
      const target = STACK_SLOTS[slot] ?? STACK_SLOTS[2]

      if (enteringStage === stage) {
        gsap.fromTo(
          el,
          { y: STACK_OFFSET * 2 + 28, opacity: 0, scale: 0.95, zIndex: 1 },
          {
            y: target.y,
            scale: target.scale,
            opacity: target.opacity,
            zIndex: target.zIndex,
            duration: 0.55,
            ease: 'power3.out',
            overwrite: 'auto',
          }
        )
        return
      }

      gsap.to(el, {
        y: target.y,
        scale: target.scale,
        opacity: target.opacity,
        zIndex: target.zIndex,
        duration: 0.55,
        ease: 'power3.inOut',
        overwrite: 'auto',
      })
    })
  }

  useEffect(() => {
    const wrap = ref.current
    if (!wrap || reducedMotion) return

    const ctx = gsap.context(() => {
      gsap.set(Object.values(cardRefs.current).filter(Boolean), {
        y: 48,
        opacity: 0,
        scale: 0.94,
        transformOrigin: 'center top',
      })

      const tl = gsap.timeline({
        onComplete: () => {
          hasEnteredRef.current = true
          stackOrderRef.current.forEach((stage, slot) => {
            const el = cardRefs.current[stage]
            if (!el) return
            const target = STACK_SLOTS[slot] ?? STACK_SLOTS[2]
            gsap.set(el, { ...target, transformOrigin: 'center top' })
          })
        },
      })

      stackOrderRef.current.forEach((stage, slot) => {
        const el = cardRefs.current[stage]
        if (!el) return
        const target = STACK_SLOTS[slot] ?? STACK_SLOTS[2]
        tl.to(
          el,
          {
            y: target.y,
            scale: target.scale,
            opacity: target.opacity,
            zIndex: target.zIndex,
            duration: 0.72,
            ease: 'power3.out',
          },
          slot * 0.09
        )
      })
    }, wrap)

    return () => ctx.revert()
  }, [reducedMotion])

  useEffect(() => {
    if (reducedMotion || !hasEnteredRef.current || beatKey === 0) return

    const order = stackOrderRef.current
    const frontStage = order[0]
    const middleStage = order[1]
    const backStage = order[2]
    const front = cardRefs.current[frontStage]
    const middle = cardRefs.current[middleStage]
    const back = cardRefs.current[backStage]
    if (!front || !middle || !back) return

    cycleTweenRef.current?.kill()

    const nextOrder: PipelineStage[] = [order[1], order[2], order[0]]
    const enteringStage = order[0]

    cycleTweenRef.current = gsap.timeline({
      onComplete: () => {
        stackOrderRef.current = nextOrder
        applyStackLayout(nextOrder, enteringStage)
      },
    })

    cycleTweenRef.current
      .to(front, { y: -48, opacity: 0, scale: 0.92, zIndex: 4, duration: 0.55, ease: 'power2.in' }, 0)
      .to(middle, { y: 0, scale: 1, opacity: 1, zIndex: 3, duration: 0.58, ease: 'power3.out' }, 0.05)
      .to(back, { y: STACK_OFFSET, scale: 0.985, opacity: 0.9, zIndex: 2, duration: 0.58, ease: 'power3.out' }, 0.08)

    return () => {
      cycleTweenRef.current?.kill()
    }
  }, [beatKey, reducedMotion])

  return (
    <div ref={ref} className="ops-email-stack" aria-label="Email pipeline stages">
      {PIPELINE_CARDS.map((card) => (
        <article
          key={card.stage}
          ref={(el) => {
            cardRefs.current[card.stage] = el
          }}
          data-stage={card.stage}
          data-pipeline-step={PIPELINE_LOG[stageIndex(card.stage)]?.msg}
          className={`ops-email-card ops-email-card--${card.tone}`}
        >
          <div className="ops-email-card-top">
            <span className={`ops-email-pill ops-email-pill--${card.tone}`}>{card.state}</span>
            <span className="ops-email-inbox">inbox {card.inbox}</span>
          </div>
          <div className="ops-email-subject">{card.subject}</div>
          <div className="ops-email-preview">{card.preview}</div>
        </article>
      ))}
    </div>
  )
}
