import { useState } from 'react'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { GhostButton } from '@/components/ui/buttons'

export function SecretInput({
  id,
  value,
  onChange,
  autoComplete,
  'aria-describedby': ariaDescribedBy,
  className = '',
}: {
  id: string
  value: string
  onChange: (next: string) => void
  autoComplete?: string
  'aria-describedby'?: string
  className?: string
}) {
  const [visible, setVisible] = useState(false)

  const copy = () => {
    if (!value) return
    void navigator.clipboard.writeText(value)
  }

  return (
    <div className={`relative mt-1.5 ${className}`}>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-describedby={ariaDescribedBy}
        className="block w-full pr-[4.25rem]"
      />
      <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0">
        <GhostButton
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="pointer-events-auto h-8 w-8 shrink-0 p-0"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
        </GhostButton>
        <GhostButton
          type="button"
          aria-label="Copy to clipboard"
          className="pointer-events-auto h-8 w-8 shrink-0 p-0"
          disabled={!value}
          onClick={copy}
        >
          <Copy className="h-4 w-4" strokeWidth={1.75} />
        </GhostButton>
      </div>
    </div>
  )
}
