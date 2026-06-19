'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

export type HintType = 'ok' | 'err' | 'warn'

export function useInlineHint(clearMs = 3500) {
  const [hint, setHint] = useState<{ text: string; type: HintType } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setHint(null)
  }, [])

  const show = useCallback(
    (text: string, type: HintType = 'ok') => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setHint({ text, type })
      timerRef.current = setTimeout(() => setHint(null), clearMs)
    },
    [clearMs]
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return { hint, showHint: show, clearHint: clear }
}

export function InlineHint({ hint }: { hint: { text: string; type: HintType } | null }) {
  if (!hint) return null
  return (
    <span className={`inline-hint inline-hint--${hint.type}`} role="status">
      {hint.text}
    </span>
  )
}

export function useButtonFlash(clearMs = 2500) {
  const [flash, setFlash] = useState<'idle' | 'done' | 'error'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashDone = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFlash('done')
    timerRef.current = setTimeout(() => setFlash('idle'), clearMs)
  }, [clearMs])

  const flashError = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFlash('error')
    timerRef.current = setTimeout(() => setFlash('idle'), clearMs)
  }, [clearMs])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return { flash, flashDone, flashError }
}
