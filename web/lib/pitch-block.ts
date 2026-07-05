export const PITCH_FIELDS = [
  { key: 'product', label: 'Product' },
  { key: 'for', label: 'For' },
  { key: 'pain', label: 'Pain' },
  { key: 'solution', label: 'Solution' },
  { key: 'integrations', label: 'Integrations/channels' },
  { key: 'offer', label: 'Offer/CTA' },
  { key: 'proof', label: 'Proof (optional)' },
] as const

const PITCH_LABELS: Array<[string, RegExp]> = [
  ['product', /^product\s*:/i],
  ['for', /^for\s*:/i],
  ['pain', /^pain\s*:/i],
  ['solution', /^solution\s*:/i],
  ['integrations', /^integrations(?:\/channels)?\s*:/i],
  ['offer', /^offer(?:\/cta)?\s*:/i],
  ['proof', /^proof(?:\s*\(optional\))?\s*:/i],
]

export type PitchFieldKey = (typeof PITCH_FIELDS)[number]['key']

export function emptyPitchFields(): Record<PitchFieldKey, string> {
  return Object.fromEntries(PITCH_FIELDS.map((f) => [f.key, ''])) as Record<PitchFieldKey, string>
}

export function parsePitchBlock(text: string) {
  const raw = (text || '').trim()
  if (!raw) return { raw: '', structured: false, fields: {} as Record<string, string> }

  const fields: Record<string, string> = {}
  let currentKey: string | null = null
  let currentLines: string[] = []

  const flush = () => {
    if (currentKey && currentLines.length) {
      fields[currentKey] = currentLines.join('\n')
    }
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmedStart = line.trimStart()
    let matched = false
    for (const [key, re] of PITCH_LABELS) {
      const m = trimmedStart.match(re)
      if (m && m.index === 0) {
        flush()
        currentKey = key
        const labelEnd = line.length - trimmedStart.length + m[0].length
        currentLines = [line.slice(labelEnd).replace(/^\s/, '')]
        matched = true
        break
      }
    }
    if (!matched && currentKey) {
      currentLines.push(line)
    }
  }
  flush()

  const structured = Object.keys(fields).length >= 2
  return { raw, structured, fields }
}

export function fieldsFromPitchBlock(text: string): Record<PitchFieldKey, string> {
  const base = emptyPitchFields()
  const parsed = parsePitchBlock(text)
  for (const [key, value] of Object.entries(parsed.fields)) {
    if (key in base) {
      base[key as PitchFieldKey] = value
    }
  }
  return base
}

export function serializePitchBlock(fields: Record<string, string>): string {
  return PITCH_FIELDS.map(({ key, label }) => `${label}: ${fields[key] || ''}`).join('\n')
}

export function countFilledPitchFields(text: string): number {
  const parsed = parsePitchBlock(text)
  return Object.values(parsed.fields).filter((v) => v.trim()).length
}

/** Short sender label from explicit {{sender_info}} value. Not the lead's name. */
export function deriveSenderNameFromSignOff(signOff: string): string {
  const text = (signOff || '').trim()
  if (!text) return ''

  const firstLine = text.split(/\r?\n/)[0]?.trim() || text

  const afterComma = firstLine.match(/,(.+)$/)
  if (afterComma) {
    return afterComma[1].trim()
  }

  const afterDash = firstLine.match(/[—–-]\s*(.+)$/)
  if (afterDash) {
    return afterDash[1].trim()
  }

  if (/^(best|regards|thanks|cheers|sincerely|kind regards|warm regards)/i.test(firstLine)) {
    return ''
  }

  return firstLine
}

export const BRIEF_PLACEHOLDER =
  'What you sell, who it\'s for, the pain you solve, your offer/CTA, and tone notes.'
