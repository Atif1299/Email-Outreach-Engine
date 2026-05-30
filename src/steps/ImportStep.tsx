import { useCallback, useEffect, useState } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { ColumnMapping, ImportBatchSummary } from '@/shared/types'
import { LEAD_FIELD_KEYS } from '@/shared/types'
import type { ParsePreviewResult } from '@/lib/outreachApi'
import { Panel } from '@/components/ui/Panel'
import { DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons'
import { ChevronRight, Trash2 } from 'lucide-react'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ImportStep({
  onImported,
  onValidityChange,
  onOpenLeadGroup,
  onImportBatchDeleted,
}: {
  onImported: (payload: { leadIds: number[]; importBatchId: number }) => void
  onValidityChange: (ok: boolean) => void
  onOpenLeadGroup: (batchId: number) => void
  onImportBatchDeleted: (payload: {
    batchId: number
    deletedLeadIds: number[]
    deletedCampaignIds: number[]
  }) => void
}) {
  const api = outreach()
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [batches, setBatches] = useState<ImportBatchSummary[]>([])

  const loadBatches = useCallback(async () => {
    const list = await api.importBatchesList()
    setBatches(list)
  }, [api])

  useEffect(() => {
    void loadBatches()
  }, [loadBatches])

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
      void loadBatches()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteBatch = async (b: ImportBatchSummary) => {
    const ok = window.confirm(
      `Delete "${b.filename}" and its ${b.leadCount} lead${b.leadCount === 1 ? '' : 's'}? Campaigns that only target this file will also be deleted. This cannot be undone.`,
    )
    if (!ok) return
    setBusy(true)
    setMsg(null)
    try {
      const leads = await api.leadsList({ importBatchId: b.id })
      const deletedLeadIds = leads.map((l) => l.id)
      const r = await api.importBatchDelete(b.id)
      onImportBatchDeleted({
        batchId: b.id,
        deletedLeadIds,
        deletedCampaignIds: r.deletedCampaignIds,
      })
      const parts = [
        `Removed ${r.deletedLeads} lead${r.deletedLeads === 1 ? '' : 's'}.`,
        r.deletedCampaigns > 0
          ? `Deleted ${r.deletedCampaigns} campaign${r.deletedCampaigns === 1 ? '' : 's'} tied only to this file.`
          : null,
      ].filter(Boolean)
      setMsg(parts.join(' '))
      if (importDone) {
        setImportDone(false)
        onValidityChange(false)
      }
      void loadBatches()
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

      <Panel
        title="Previous imports"
        description="Click any import to view and select its leads."
      >
        {batches.length === 0 ? (
          <p className="text-sm text-ink-muted">No imports yet.</p>
        ) : (
          <ul className="divide-y divide-edge rounded-card border border-edge">
            {batches.map((b) => (
              <li key={b.id} className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => onOpenLeadGroup(b.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-raised"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{b.filename}</p>
                    <p className="text-sm text-ink-muted">
                      {formatDate(b.created_at)} · {b.leadCount} lead{b.leadCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
                </button>
                <div className="flex shrink-0 items-center border-l border-edge px-2">
                  <DangerButton
                    disabled={busy}
                    className="!border-0 !bg-transparent px-2 py-2"
                    aria-label={`Delete ${b.filename}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteBatch(b)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </DangerButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
