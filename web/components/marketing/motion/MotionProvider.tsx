'use client'

import { useEffect, type ReactNode } from 'react'
import { registerScrollTrigger } from '@/lib/gsap/register'

export default function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    registerScrollTrigger()
  }, [])

  return <>{children}</>
}
