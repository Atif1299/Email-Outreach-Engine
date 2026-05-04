import {
  forwardRef,
  useEffect,
  useRef,
  type MutableRefObject,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react'

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (instance: T | null) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') ref(instance)
      else (ref as MutableRefObject<T | null>).current = instance
    }
  }
}

export const AutosizeTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    minHeightPx?: number
    maxHeightPx?: number
  }
>(function AutosizeTextarea(
  { minHeightPx = 80, maxHeightPx = 420, className = '', value, ...rest },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    el.style.height = 'auto'
    const h = Math.max(minHeightPx, Math.min(el.scrollHeight, maxHeightPx))
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight > maxHeightPx ? 'auto' : 'hidden'
  }, [value, minHeightPx, maxHeightPx])

  return (
    <textarea
      ref={mergeRefs(innerRef, forwardedRef)}
      value={value}
      rows={1}
      className={className}
      {...rest}
    />
  )
})
