import { useEffect, useRef, type TextareaHTMLAttributes } from 'react'

export function AutosizeTextarea({
  minHeightPx = 80,
  maxHeightPx = 420,
  className = '',
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minHeightPx?: number
  maxHeightPx?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const h = Math.max(minHeightPx, Math.min(el.scrollHeight, maxHeightPx))
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight > maxHeightPx ? 'auto' : 'hidden'
  }, [value, minHeightPx, maxHeightPx])

  return <textarea ref={ref} value={value} rows={1} className={className} {...rest} />
}
