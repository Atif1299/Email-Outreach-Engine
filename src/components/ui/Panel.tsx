import type { ReactNode } from 'react'

export function Panel({
  children,
  className = '',
  title,
  description,
}: {
  children: ReactNode
  className?: string
  title?: string
  description?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface-elevated/80 p-5 shadow-sm backdrop-blur-sm ${className}`}
    >
      {title && (
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
        </div>
      )}
      {children}
    </div>
  )
}
