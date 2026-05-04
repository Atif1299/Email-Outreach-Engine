import type { ReactNode } from 'react'

export function FieldLabel({
  children,
  hint,
  htmlFor,
}: {
  children: ReactNode
  hint?: string
  htmlFor?: string
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{children}</span>
      {hint && (
        <span className="text-xs font-normal normal-case text-ink-muted">{hint}</span>
      )}
    </label>
  )
}
