'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ENGINE_BEAT_DURATION } from '@/components/marketing/motion/engine-demo'
import { prefersReducedMotion } from '@/lib/gsap/register'

type EngineDemoContextValue = {
  beat: number
  beatKey: number
  reducedMotion: boolean
}

const EngineDemoContext = createContext<EngineDemoContextValue>({
  beat: 0,
  beatKey: 0,
  reducedMotion: false,
})

export function useEngineDemo() {
  return useContext(EngineDemoContext)
}

export function EngineDemoProvider({ children }: { children: React.ReactNode }) {
  const [beat, setBeat] = useState(0)
  const [beatKey, setBeatKey] = useState(0)
  const reduced = prefersReducedMotion()

  const beatRef = useRef(0)
  const delayRef = useRef<gsap.core.Tween | null>(null)

  useEffect(() => {
    if (reduced) return

    const schedule = () => {
      delayRef.current = gsap.delayedCall(ENGINE_BEAT_DURATION, () => {
        beatRef.current = (beatRef.current + 1) % 3
        setBeat(beatRef.current)
        setBeatKey((k) => k + 1)
        schedule()
      })
    }

    delayRef.current = gsap.delayedCall(ENGINE_BEAT_DURATION, () => {
      beatRef.current = 1
      setBeat(1)
      setBeatKey((k) => k + 1)
      schedule()
    })

    return () => {
      delayRef.current?.kill()
    }
  }, [reduced])

  return (
    <EngineDemoContext.Provider value={{ beat, beatKey, reducedMotion: reduced }}>
      {children}
    </EngineDemoContext.Provider>
  )
}
