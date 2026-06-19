import Papa from 'papaparse'
import * as XLSX from 'xlsx'

type Row = Record<string, string>

export async function parseFile(file: File): Promise<Row[]> {
  const name = file.name.toLowerCase()
  const buffer = await file.arrayBuffer()

  if (name.endsWith('.csv')) {
    return parseCSV(buffer)
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseExcel(buffer)
  }

  throw new Error('Unsupported file type')
}

function parseCSV(buffer: ArrayBuffer): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const text = new TextDecoder().decode(buffer)

    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve(results.data as Row[])
      },
      error: (error: Error) => {
        reject(error)
      }
    })
  })
}

function parseExcel(buffer: ArrayBuffer): Row[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheet]
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Row[]
}

export function guessColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const headerLower = headers.map(h => h.toLowerCase().trim())

  const patterns: Record<string, RegExp[]> = {
    email: [/^email$/i, /e-?mail/i, /email.*address/i],
    first_name: [/^first.?name$/i, /^first$/i, /^fname$/i, /given.?name/i],
    last_name: [/^last.?name$/i, /^last$/i, /^lname$/i, /surname/i, /family.?name/i],
    current_employer: [/employer/i, /company/i, /organization/i, /^org$/i, /business/i],
    current_title: [/^title$/i, /job.?title/i, /position/i, /role/i],
    industry: [/industry/i, /sector/i, /vertical/i],
    location: [/location/i, /city/i, /address/i, /region/i, /country/i],
    phone: [/phone/i, /mobile/i, /cell/i, /telephone/i],
  }

  for (const [field, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      const idx = headerLower.findIndex(h => regex.test(h))
      if (idx !== -1 && !mapping[field]) {
        mapping[field] = headers[idx]
        break
      }
    }
  }

  return mapping
}
