'use client'

import { useState, useRef, useCallback } from 'react'
import type { Batch } from '@/app/dashboard/page'
import { InlineHint, useButtonFlash, useInlineHint } from '@/components/dashboard/useStepFeedback'

interface Props {
  batches: Batch[]
  selectedBatchId: number | null
  onSelectBatch: (id: number | null) => void
  onBatchesChanged: () => void
  onProceedWithBatch: () => void
}

interface ImportPreview {
  filename: string
  headers: string[]
  previewRows: Record<string, string>[]
  mapping: Record<string, string>
  totalRows: number
}

const FIELD_NAMES = ['email', 'first_name', 'last_name', 'current_employer', 'current_title', 'industry', 'location', 'phone']

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function StepImport({ batches, selectedBatchId, onSelectBatch, onBatchesChanged, onProceedWithBatch }: Props) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const importFlash = useButtonFlash()
  const { hint: importHint, showHint: showImportHint } = useInlineHint()
  const { hint: listHint, showHint: showListHint } = useInlineHint()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedBatch = batches.find(b => b.id === selectedBatchId)

  async function handleFileSelect(selectedFile: File) {
    setFile(selectedFile)
    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      const res = await fetch('/api/import/preview', {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        setPreview(data)
      } else {
        showImportHint('Parse failed', 'err')
      }
    } catch (e) {
      showImportHint('Parse failed', 'err')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) handleFileSelect(droppedFile)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  function handleMappingChange(field: string, column: string) {
    if (!preview) return
    setPreview({
      ...preview,
      mapping: { ...preview.mapping, [field]: column }
    })
  }

  async function handleImport() {
    if (!file || !preview || importing) return
    setImporting(true)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('mapping', JSON.stringify(preview.mapping))

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const result = await res.json()
        const v = result.verification || {}
        showImportHint(
          `${result.imported} imported · ${v.valid || 0} valid · ${v.invalid || 0} invalid · ${v.risky || 0} risky`,
          'ok'
        )
        importFlash.flashDone()
        setPreview(null)
        setFile(null)
        onBatchesChanged()
      } else {
        const err = await res.json()
        showImportHint(err.error || 'Import failed', 'err')
        importFlash.flashError()
      }
    } catch (e) {
      showImportHint('Import failed', 'err')
      importFlash.flashError()
    } finally {
      setImporting(false)
    }
  }

  async function handleDeleteBatch() {
    if (!selectedBatchId) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    try {
      const res = await fetch(`/api/batches/${selectedBatchId}`, { method: 'DELETE' })
      if (res.ok) {
        onSelectBatch(null)
        onBatchesChanged()
        showListHint('Deleted', 'ok')
      } else {
        showListHint('Delete failed', 'err')
      }
    } catch (e) {
      showListHint('Delete failed', 'err')
    }
    setConfirmDelete(false)
  }

  function cancelDelete() {
    setConfirmDelete(false)
  }

  const mappedCols = preview ? Object.keys(preview.mapping).filter(k => preview.mapping[k]) : []

  return (
    <section className="step-view">
      <div className="step-body split">
        {/* Previous Imports List */}
        <div className="queue">
          <div className="queue-head">
            <div className="queue-head-row">
              <div className="queue-title">
                Previous Imports
                <InlineHint hint={listHint} />
              </div>
              <div className="queue-sub">{batches.length} batches</div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!selectedBatchId}
              onClick={handleDeleteBatch}
            >
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </button>
            {confirmDelete && (
              <button type="button" className="btn btn-outline btn-sm" onClick={cancelDelete}>
                Cancel
              </button>
            )}
          </div>
          <div className="queue-list">
            {batches.length === 0 ? (
              <div className="queue-item">
                <div className="queue-item-title" style={{ color: 'var(--dim)' }}>No imports yet</div>
              </div>
            ) : (
              batches.map(b => (
                <div
                  key={b.id}
                  className={`queue-item ${b.id === selectedBatchId ? 'is-selected' : ''}`}
                  onClick={() => onSelectBatch(b.id)}
                >
                  <div className="queue-item-title">{b.filename}</div>
                  <div className="queue-item-meta">{b.leadCount} leads · {formatDate(b.createdAt)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Import Area */}
        <div className="editor">
          <div className="editor-head">
            <div className="editor-head-row">
              <div>
                <div className="editor-title">
                  Import Leads
                  <InlineHint hint={importHint} />
                </div>
                <div className="editor-sub">Upload CSV or Excel file with email addresses</div>
              </div>
              <button
                type="button"
                className="btn primary btn-sm"
                disabled={!preview?.mapping.email || importing}
                onClick={handleImport}
              >
                {importing
                  ? `Importing ${preview?.totalRows ?? 0} rows...`
                  : importFlash.flash === 'done'
                    ? 'Imported'
                    : importFlash.flash === 'error'
                      ? 'Failed'
                      : 'Import'}
              </button>
            </div>
          </div>

          {!preview ? (
            <div
              className={`import-zone ${dragOver ? 'drag-over' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
              <button type="button" className="btn primary">Choose File</button>
              <p className="zone-text">CSV, XLSX, or XLS</p>
            </div>
          ) : (
            <div className="mapping-section">
              <div className="mapping-head">
                <span className="mapping-filename">{preview.filename}</span>
                <span className="mapping-count">{preview.totalRows} rows</span>
              </div>

              <div className="mini-label">Column Mapping</div>
              <div className="mapping-grid">
                {FIELD_NAMES.map(field => (
                  <div key={field} className="field">
                    <label className="mini-label">{field.replace(/_/g, ' ')}</label>
                    <select
                      className="input"
                      value={preview.mapping[field] || ''}
                      onChange={(e) => handleMappingChange(field, e.target.value)}
                    >
                      <option value="">(skip)</option>
                      {preview.headers.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="mapping-preview">
                <div className="mini-label">Preview (first 5 rows)</div>
                <div className="preview-table">
                  {mappedCols.length > 0 && preview.previewRows.length > 0 && (
                    <table>
                      <thead>
                        <tr>
                          {mappedCols.map(col => (
                            <th key={col}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.previewRows.slice(0, 5).map((row, i) => (
                          <tr key={i}>
                            {mappedCols.map(col => (
                              <td key={col}>{row[preview.mapping[col]] || ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="step-footer">
        <div className="footer-left">
          <span className="footer-text">
            {selectedBatch ? `Selected: ${selectedBatch.filename} (${selectedBatch.leadCount} leads)` : ''}
          </span>
        </div>
        <div className="footer-right">
          <button
            type="button"
            className="btn primary"
            disabled={!selectedBatchId}
            onClick={onProceedWithBatch}
          >
            Proceed with Batch →
          </button>
        </div>
      </footer>
    </section>
  )
}
