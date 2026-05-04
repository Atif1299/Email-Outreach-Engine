import type { ButtonHTMLAttributes, ReactNode } from 'react'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
}

export function PrimaryButton({ className = '', children, ...props }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function SecondaryButton({ className = '', children, ...props }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg border border-edge bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-raised disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function GhostButton({ className = '', children, ...props }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg px-2 py-1 text-xs font-medium text-ink-muted transition-colors duration-150 hover:bg-surface hover:text-ink ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function DangerButton({ className = '', children, ...props }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-danger transition-colors duration-150 hover:bg-danger-muted hover:text-ink ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
