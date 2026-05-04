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
      className={`rounded-card border border-edge bg-surface p-4 md:p-5 ${className}`}
    >
      {title && (
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {description && (
            <p className="mt-1.5 text-sm font-normal leading-relaxed text-ink-muted">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
