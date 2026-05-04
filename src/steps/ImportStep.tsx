import { useEffect, useState } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { ColumnMapping } from '@/shared/types'
import { LEAD_FIELD_KEYS } from '@/shared/types'
import type { ParsePreviewResult } from '@/lib/outreachApi'
import { Panel } from '@/components/ui/Panel'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'

export function ImportStep({
  onImported,
  onValidityChange,
}: {
  onImported: () => void
  onValidityChange: (ok: boolean) => void
}) {
  const api = outreach()
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const valid =
    !!path &&
    !!preview &&
    !!(mapping.email && String(mapping.email).length > 0)

  useEffect(() => {
    onValidityChange(valid)
  }, [valid, onValidityChange])

  const pickFile = async () => {
    setMsg(null)
    const p = await api.openImportDialog()
    if (!p) return
    setBusy(true)
    try {
      const r = await api.parsePreview(p)
      setPath(p)
      setPreview(r)
      setMapping(r.mapping)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!path) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.importCommit({ filePath: path, mapping })
      setMsg(`Imported ${r.imported} leads. Skipped ${r.skippedNoEmail} without valid email.`)
      onImported()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const headers = preview?.headers ?? []

  return (
    <div className="space-y-6">
      <Panel
        title="Import leads"
        description="Choose a CSV or Excel file from your export. Map at least the email column before importing."
      >
        <SecondaryButton disabled={busy} onClick={pickFile}>
          Choose file…
        </SecondaryButton>

        {preview && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-slate-400">
              <span className="font-medium text-slate-200">{preview.filename}</span> — {preview.totalRows}{' '}
              rows (preview {preview.previewRows.length})
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {LEAD_FIELD_KEYS.map((key) => (
                <label key={key} className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{key}</span>
                  <select
                    value={mapping[key] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value || '' }))}
                  >
                    <option value="">—</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <PrimaryButton disabled={busy || !valid} onClick={() => void commit()}>
              Import leads
            </PrimaryButton>
          </div>
        )}
      </Panel>
      {msg && <p className="text-sm text-amber-200/90">{msg}</p>}
    </div>
  )
}
