import type { ReactNode } from 'react'

export function FieldLabel({
  children,
  htmlFor,
}: {
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <label htmlFor={htmlFor} className="flex w-full min-w-0 flex-col">
      <span className="text-[12px] font-medium uppercase tracking-wide text-ink-faint">{children}</span>
    </label>
  )
}

/** Helper text placed under the input so label + input rows align in multi-column grids. */
export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs leading-snug text-ink-muted">
      {children}
    </p>
  )
}
