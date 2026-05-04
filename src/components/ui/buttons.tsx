import type { ButtonHTMLAttributes, ReactNode } from 'react'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
}

export function PrimaryButton({ className = '', children, ...props }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 ${className}`}
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
      className={`inline-flex items-center justify-center rounded-xl border border-border bg-surface-muted px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:opacity-40 ${className}`}
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
      className={`inline-flex items-center justify-center rounded-lg px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-800/60 hover:text-slate-300 ${className}`}
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
      className={`inline-flex items-center justify-center rounded-lg border border-rose-900/50 bg-transparent px-3 py-1.5 text-xs text-rose-400/70 transition hover:border-rose-700 hover:bg-rose-950/40 hover:text-rose-300 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
