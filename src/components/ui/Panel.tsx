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
      className={`rounded-card border border-edge bg-surface p-5 md:p-6 ${className}`}
    >
      {title && (
        <div className="mb-5">
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
