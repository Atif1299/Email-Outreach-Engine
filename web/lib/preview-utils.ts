/** Saved body looks like a template merge dumping raw pitch labels, not AI output. */
export function looksLikeRawPitchMerge(body: string): boolean {
  const text = (body || '').trim()
  if (!text) return false
  const labelHits = (text.match(/^product\s*:/im) ? 1 : 0)
    + (text.match(/^pain\s*:/im) ? 1 : 0)
    + (text.match(/^solution\s*:/im) ? 1 : 0)
  return labelHits >= 2
}
