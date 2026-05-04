import fs from 'node:fs'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ColumnMapping, LeadData } from '../../src/shared/types'

export type ParsedSheet = {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseFileBuffer(filePath: string): ParsedSheet {
  const ext = filePath.toLowerCase().split('.').pop()
  if (ext === 'csv') return parseCsv(filePath)
  if (ext === 'xlsx' || ext === 'xls') return parseXlsx(filePath)
  throw new Error('Unsupported file type. Use .csv, .xlsx, or .xls')
}

function parseCsv(filePath: string): ParsedSheet {
  const text = fs.readFileSync(filePath, 'utf8')
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h).trim(),
  })
  if (result.errors.length) {
    const fatal = result.errors.find((e) => e.type === 'Quotes' || e.type === 'FieldMismatch')
    if (fatal) throw new Error(fatal.message)
  }
  const headers = result.meta.fields?.filter(Boolean).map((h) => String(h).trim()) ?? []
  const rows = (result.data || []).map((row) => normalizeRow(row as Record<string, unknown>, headers))
  return { headers, rows }
}

function parseXlsx(filePath: string): ParsedSheet {
  const buf = fs.readFileSync(filePath)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Empty workbook')
  const sheet = wb.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (!json.length) return { headers: [], rows: [] }
  const headers = Object.keys(json[0]).map((k) => String(k).trim())
  const rows = json.map((row) => normalizeRow(row, headers))
  return { headers, rows }
}

function normalizeRow(
  row: Record<string, unknown>,
  headers: string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of headers) {
    const v = row[h]
    out[h] = v === undefined || v === null ? '' : String(v).trim()
  }
  return out
}

export function guessMapping(headers: string[]): ColumnMapping {
  const lower = (s: string) => s.toLowerCase().replace(/\s+/g, '_')
  const normHeaders = headers.map((h) => ({ raw: h, n: lower(h) }))
  const pairs: [string, string][] = [
    ['linkedin_url', 'linkedin_url'],
    ['email', 'email'],
    ['phone', 'phone'],
    ['name', 'name'],
    ['first_name', 'first_name'],
    ['last_name', 'last_name'],
    ['current_employer', 'current_employer'],
    ['current_title', 'current_title'],
    ['industry', 'industry'],
    ['location', 'location'],
    ['linkedin_handle', 'linkedin_handle'],
    ['company_size', 'company_size'],
  ]
  const mapping: ColumnMapping = {}
  for (const [canonical, hint] of pairs) {
    const found = normHeaders.find(
      (x) => x.n === hint || x.n.includes(hint) || x.raw.toLowerCase() === hint.replace(/_/g, ' '),
    )
    if (found) mapping[canonical] = found.raw
  }
  return mapping
}

export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): LeadData[] {
  const keys = Object.keys(mapping).filter((k) => mapping[k])
  return rows.map((row) => {
    const out: LeadData = {}
    for (const k of keys) {
      const src = mapping[k]
      out[k] = src ? (row[src] ?? '') : ''
    }
    return out
  })
}

export function hasValidEmail(email: string): boolean {
  const e = email.trim()
  if (!e || !e.includes('@')) return false
  const [local, domain] = e.split('@')
  if (!local || !domain || !domain.includes('.')) return false
  return true
}

export function filterLeadsWithEmail(leads: LeadData[]): LeadData[] {
  return leads.filter((l) => hasValidEmail(l.email ?? ''))
}
