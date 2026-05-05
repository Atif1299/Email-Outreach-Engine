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
  onImported: (payload: { leadIds: number[]; importBatchId: number }) => void
  onValidityChange: (ok: boolean) => void
}) {
  const api = outreach()
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importDone, setImportDone] = useState(false)

  const mappingOk = !!(mapping.email && String(mapping.email).length > 0)
  const valid = importDone

  useEffect(() => {
    onValidityChange(valid)
  }, [valid, onValidityChange])

  const pickFile = async () => {
    setMsg(null)
    setImportDone(false)
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
      setMsg(
        [
          `Created a new lead group. Saved ${r.imported} unique email${r.imported === 1 ? '' : 's'}.`,
          r.duplicatesSkipped > 0
            ? `Skipped ${r.duplicatesSkipped} duplicate row${r.duplicatesSkipped === 1 ? '' : 's'} (same email in file).`
            : null,
          r.skippedExistingInApp > 0
            ? `Skipped ${r.skippedExistingInApp} row${r.skippedExistingInApp === 1 ? '' : 's'} already in the app (same email).`
            : null,
          r.skippedNoEmail > 0
            ? `${r.skippedNoEmail} row${r.skippedNoEmail === 1 ? '' : 's'} had no valid email.`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
      )
      setImportDone(true)
      onImported({ leadIds: r.leadIds, importBatchId: r.importBatchId })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const headers = preview?.headers ?? []

  return (
    <div className="space-y-8">
      <Panel
        title="Import leads"
        description="Each import creates a new lead group (previous imports stay in the app). Map at least the email column before importing."
      >
        <SecondaryButton disabled={busy} onClick={pickFile}>
          Choose file…
        </SecondaryButton>

        {preview && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-ink-muted">
              <span className="font-medium text-ink">{preview.filename}</span> — {preview.totalRows}{' '}
              rows (preview {preview.previewRows.length})
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {LEAD_FIELD_KEYS.map((key) => (
                <label key={key} className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{key}</span>
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
            <PrimaryButton disabled={busy || !mappingOk} onClick={() => void commit()}>
              Import leads
            </PrimaryButton>
          </div>
        )}
      </Panel>
      {msg && <p className="text-sm text-ink-secondary">{msg}</p>}
    </div>
  )
}
