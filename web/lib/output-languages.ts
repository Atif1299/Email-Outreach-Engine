export const OUTPUT_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'en-au', label: 'English (Australia)' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' },
] as const

export type OutputLanguageCode = (typeof OUTPUT_LANGUAGES)[number]['code']

const LABEL_BY_CODE = new Map(OUTPUT_LANGUAGES.map((l) => [l.code, l.label]))

export function normalizeOutputLanguage(code: string | null | undefined): OutputLanguageCode {
  const c = (code || 'en').trim().toLowerCase()
  if (LABEL_BY_CODE.has(c as OutputLanguageCode)) return c as OutputLanguageCode
  return 'en'
}

export function getOutputLanguageLabel(code: string | null | undefined): string {
  return LABEL_BY_CODE.get(normalizeOutputLanguage(code)) ?? 'English'
}

const STYLE_NOTES: Partial<Record<OutputLanguageCode, string>> = {
  fr: 'Use formal "vous" in French business email — not "tu".',
  de: 'Use formal "Sie" in German business email.',
  es: 'Use formal "usted" for cold B2B outreach in Spanish unless the lead context is clearly informal.',
  it: 'Use formal "Lei" in Italian business email.',
  pt: 'Use formal "você" or appropriate formal register in Portuguese B2B email.',
  ja: 'Use polite business keigo — です/ます endings, not casual plain form.',
  ko: 'Use polite 합니다/습니다 business style.',
  nl: 'Use formal "u" in Dutch B2B email when addressing the recipient.',
  pl: 'Use formal Pan/Pani forms in Polish business email.',
  ar: 'Use Modern Standard Arabic with polite business tone.',
  hi: 'Use respectful आप form in Hindi business email.',
  tr: 'Use formal "siz" in Turkish business email.',
  ru: 'Use formal "Вы" in Russian business email.',
  zh: 'Use polite 您 and standard simplified Chinese business phrasing.',
}

export function buildLanguageStyleNote(code: string | null | undefined): string {
  const normalized = normalizeOutputLanguage(code)
  return STYLE_NOTES[normalized] || ''
}

export function buildBodyOutputLanguageRule(code: string | null | undefined): string {
  const normalized = normalizeOutputLanguage(code)
  const label = getOutputLanguageLabel(normalized)
  const styleNote = buildLanguageStyleNote(normalized)
  const styleSuffix = styleNote ? ` ${styleNote}` : ''

  if (normalized === 'en') {
    return 'Write the entire email body in English.'
  }
  if (normalized === 'en-au') {
    return [
      'Write the entire email body in Australian English.',
      'Use natural Australian spelling and phrasing (e.g. organise, favour) where appropriate.',
      'Keep tone professional and direct — not overly formal British or American corporate filler.',
      'The pitch block and instructions are in English — translate the meaning naturally for an Australian reader.',
    ].join(' ')
  }
  return [
    `Write the ENTIRE email body in ${label}.`,
    `The pitch block, campaign instructions, and templates are written in English — understand them and express the same meaning naturally in ${label}.`,
    `Do not leave the body in English. Keep person and company names as provided unless ${label} normally uses a standard transliteration.`,
    `Greeting, pain hook, bridge, CTA, and sign-off must all be in ${label}.`,
    styleSuffix,
  ].filter(Boolean).join(' ')
}

export function buildSubjectOutputLanguageRule(code: string | null | undefined): string {
  const normalized = normalizeOutputLanguage(code)
  const label = getOutputLanguageLabel(normalized)
  if (normalized === 'en') return 'Write the subject line in English.'
  if (normalized === 'en-au') return 'Write the subject line in Australian English — same tone as the body.'
  return `Write the subject line in ${label} — same language as the email body.`
}
