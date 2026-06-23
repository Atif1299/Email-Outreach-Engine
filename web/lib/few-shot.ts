import fs from 'fs'
import path from 'path'

export function parseFewShotJson(json: string | null | undefined): string[] {
  if (!json || json.trim() === '' || json === '[]') return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr.map((s) => String(s).trim()).filter(Boolean)
  } catch {
    return []
  }
}

export function serializeFewShotJson(examples: string[] | null | undefined): string {
  if (!examples || examples.length === 0) return '[]'
  const cleaned = examples.map((s) => s.trim()).filter(Boolean)
  return JSON.stringify(cleaned)
}

/** Built-in examples from prompt files — used when campaign has no custom few-shots. */
export function loadFilesystemFewShots(stepOrder: number): string[] {
  const subdir = stepOrder > 1 ? 'few_shot/step2' : 'few_shot/step1'
  const dirPath = path.join(process.cwd(), 'prompts', 'cold_outreach', subdir)
  if (!fs.existsSync(dirPath)) {
    try {
      return [fs.readFileSync(
        path.join(process.cwd(), 'prompts', 'cold_outreach', 'few_shot_example.txt'),
        'utf8'
      ).trim()].filter(Boolean)
    } catch {
      return []
    }
  }
  const examples = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => fs.readFileSync(path.join(dirPath, f), 'utf8').trim())
    .filter(Boolean)
  if (examples.length === 0) {
    try {
      return [fs.readFileSync(
        path.join(process.cwd(), 'prompts', 'cold_outreach', 'few_shot_example.txt'),
        'utf8'
      ).trim()].filter(Boolean)
    } catch {
      return []
    }
  }
  return examples
}

/** Campaign overrides when non-empty; otherwise built-in filesystem examples. */
export function resolveFewShotExamples(stepOrder: number, campaignExamples?: string[] | null): string[] {
  const custom = campaignExamples?.map((s) => s.trim()).filter(Boolean) ?? []
  if (custom.length > 0) return custom
  return loadFilesystemFewShots(stepOrder)
}

export function loadAllFilesystemFewShots(): { step1: string[]; step2: string[] } {
  return {
    step1: loadFilesystemFewShots(1),
    step2: loadFilesystemFewShots(2),
  }
}
