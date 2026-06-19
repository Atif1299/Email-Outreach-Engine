import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'

interface LeadData {
  email?: string
  first_name?: string
  last_name?: string
  current_employer?: string
  current_title?: string
  industry?: string
  location?: string
  [key: string]: string | undefined
}

interface PreviousSend {
  subject?: string
  body_snippet?: string
}

interface GenerateEmailOptions {
  leadData: LeadData
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  aiInstructions: string
  subjectTemplate: string
  bodyTemplate: string
  stepOrder?: number
  previous?: PreviousSend
  model: string
  apiKey: string
}

interface PitchSuggestOptions {
  leadsData: LeadData[]
  existingPitch?: string
  aiVoice?: string
  model: string
  apiKey: string
}

const PITCH_LABELS: Array<[string, RegExp]> = [
  ['product', /^product\s*:/i],
  ['for', /^for\s*:/i],
  ['pain', /^pain\s*:/i],
  ['solution', /^solution\s*:/i],
  ['integrations', /^integrations(?:\/channels)?\s*:/i],
  ['offer', /^offer(?:\/cta)?\s*:/i],
  ['proof', /^proof(?:\s*\(optional\))?\s*:/i],
]

function loadPromptFile(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'prompts', 'cold_outreach', name), 'utf8').trim()
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value ?? '')
  }
  return out
}

export function parsePitchBlock(text: string) {
  const raw = (text || '').trim()
  if (!raw) return { raw: '', structured: false, fields: {} as Record<string, string> }

  const fields: Record<string, string> = {}
  let currentKey: string | null = null
  let currentLines: string[] = []

  const flush = () => {
    if (currentKey && currentLines.length) {
      fields[currentKey] = currentLines.join('\n').trim()
    }
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    let matched = false
    for (const [key, re] of PITCH_LABELS) {
      if (re.test(trimmed)) {
        flush()
        currentKey = key
        currentLines = [trimmed.replace(re, '').trim()]
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

function voiceRules(aiVoice: string): string {
  if (aiVoice === 'company') {
    return 'Use company voice — we/our/us. Example: "We help teams...", "We run outreach for...", "We can show you...". Never use "I built" unless quoting the lead. Do not default to "our platform" — use service/agency language unless the pitch is explicitly product-based.'
  }
  return 'Use founder/builder voice — first person I/me/my. Example: "I built...", "I can show you...", "I saw you\'re...". Sound like the person who delivers the work.'
}

function signOffRules(senderInfo: string): string {
  const s = (senderInfo || '').trim()
  if (s) {
    return `End with a professional closing followed by this exact sign-off block (preserve line breaks):\n${s}`
  }
  return 'End with a short professional closing like "Best" only. No placeholders like [Your Name] or {{sender_info}}.'
}

function buildBodyMessages(opts: {
  lead: LeadData
  pitchBlock: string
  senderInfo: string
  previous?: PreviousSend
  stepOrder: number
  mergedPreview: string
  aiVoice: string
  aiInstructions: string
}) {
  const fewShot = loadPromptFile('few_shot_example.txt')
  const systemTpl = loadPromptFile('body_system.md')
  const userTpl = loadPromptFile('body_user.md')

  const pitch = parsePitchBlock(opts.pitchBlock)
  const instructions = (opts.aiInstructions || '').trim() || '(none)'

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(opts.aiVoice),
    FEW_SHOT_EXAMPLE: fewShot,
    SIGN_OFF_RULES: signOffRules(opts.senderInfo),
    AI_INSTRUCTIONS: instructions,
  })

  const leadWithEmail = { ...opts.lead, email: opts.lead.email ?? '' }
  const user = fillTemplate(userTpl, {
    LEAD_JSON: JSON.stringify(leadWithEmail, null, 2),
    PITCH_PARSED: JSON.stringify(
      pitch.structured ? pitch.fields : { note: 'Unstructured pitch — extract from raw text' },
      null,
      2
    ),
    PITCH_RAW: pitch.raw || '(empty)',
    SENDER_INFO: opts.senderInfo?.trim() || '(none — use "Best" only)',
    STEP_ORDER: String(opts.stepOrder),
    PREVIOUS_SUBJECT: opts.previous?.subject?.trim() || '(none — first email)',
    PREVIOUS_SNIPPET: opts.previous?.body_snippet?.trim() || '(none)',
    MERGED_PREVIEW: opts.mergedPreview?.trim() || '(empty template)',
  })

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

function buildSubjectMessages(opts: {
  lead: LeadData
  pitchBlock: string
  subjectTemplate: string
  bodySoFar: string
  aiVoice: string
  aiInstructions: string
}) {
  const systemTpl = loadPromptFile('subject_system.md')
  const instructions = (opts.aiInstructions || '').trim() || '(none)'

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(opts.aiVoice),
    AI_INSTRUCTIONS: instructions,
  })

  const user = `Merged subject template (starting point only — rewrite substantially):
${opts.subjectTemplate}

Email body (subject must match this hook):
${opts.bodySoFar.slice(0, 800)}

Lead:
- Name: ${opts.lead.first_name || ''} ${opts.lead.last_name || ''}
- Title: ${opts.lead.current_title || 'Unknown'}
- Company: ${opts.lead.current_employer || 'Unknown'}
- Industry: ${opts.lead.industry || 'Unknown'}

Pitch summary:
${opts.pitchBlock.slice(0, 400)}

Write one subject line:`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

export function mergeTags(
  template: string,
  leadData: LeadData,
  pitchBlock: string,
  senderInfo: string
): string {
  let result = template

  const tags: Record<string, string> = {
    email: leadData.email || '',
    first_name: leadData.first_name || '',
    last_name: leadData.last_name || '',
    current_employer: leadData.current_employer || '',
    current_title: leadData.current_title || '',
    industry: leadData.industry || '',
    location: leadData.location || '',
    pitch_block: pitchBlock || '',
    sender_info: senderInfo || '',
  }

  for (const [key, value] of Object.entries(tags)) {
    result = result.split(`{{${key}}}`).join(value)
  }

  for (const [key, value] of Object.entries(leadData)) {
    if (value) {
      result = result.split(`{{${key}}}`).join(value)
    }
  }

  return result
}

/** Strip markdown the model sometimes adds despite instructions */
export function normalizePitchBlock(text: string): string {
  return text
    .trim()
    .replace(/^```[\w]*\n?|\n?```$/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .trim()
}

export async function generateEmailBody(opts: GenerateEmailOptions): Promise<string> {
  const openai = new OpenAI({ apiKey: opts.apiKey })
  const mergedPreview = mergeTags(opts.bodyTemplate, opts.leadData, opts.pitchBlock, opts.senderInfo)
  const leadFull = { ...opts.leadData, email: opts.leadData.email ?? '' }

  const messages = buildBodyMessages({
    lead: leadFull,
    pitchBlock: opts.pitchBlock,
    senderInfo: opts.senderInfo,
    previous: opts.previous,
    stepOrder: opts.stepOrder ?? 1,
    mergedPreview,
    aiVoice: opts.aiVoice || 'founder',
    aiInstructions: opts.aiInstructions || '',
  })

  const response = await openai.chat.completions.create({
    model: opts.model,
    messages,
    temperature: 0.65,
    max_tokens: 550,
  })

  const text = response.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('Empty response from OpenAI')
  return text
}

export async function generateSubjectLine(opts: GenerateEmailOptions & { bodySoFar: string; mergedSubject: string }): Promise<string> {
  const openai = new OpenAI({ apiKey: opts.apiKey })

  const messages = buildSubjectMessages({
    lead: opts.leadData,
    pitchBlock: opts.pitchBlock,
    subjectTemplate: opts.mergedSubject,
    bodySoFar: opts.bodySoFar,
    aiVoice: opts.aiVoice || 'founder',
    aiInstructions: opts.aiInstructions || '',
  })

  const response = await openai.chat.completions.create({
    model: opts.model,
    messages,
    temperature: 0.7,
    max_tokens: 60,
  })

  const text = response.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '')
  if (!text) throw new Error('Empty subject from OpenAI')
  return text.slice(0, 100)
}

export async function generateEmailWithAI(opts: GenerateEmailOptions): Promise<{ subject: string; body: string }> {
  const mergedSubject = mergeTags(opts.subjectTemplate, opts.leadData, opts.pitchBlock, opts.senderInfo)

  const body = await generateEmailBody(opts)

  let subject = mergedSubject
  try {
    subject = await generateSubjectLine({ ...opts, bodySoFar: body, mergedSubject })
  } catch {
    // keep merged subject
  }

  return { subject, body }
}

export async function renderEmailForLead(opts: {
  leadData: LeadData
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  aiInstructions: string
  subjectTemplate: string
  bodyTemplate: string
  stepOrder: number
  previous?: PreviousSend
  model: string
  apiKey: string
  useAi: boolean
  storedBody?: string
  storedSubject?: string | null
}): Promise<{ subject: string; body: string }> {
  if (opts.storedBody !== undefined) {
    let subject = opts.storedSubject ?? mergeTags(opts.subjectTemplate, opts.leadData, opts.pitchBlock, opts.senderInfo)
    if (!opts.storedSubject && opts.useAi && opts.apiKey) {
      try {
        subject = await generateSubjectLine({
          leadData: opts.leadData,
          pitchBlock: opts.pitchBlock,
          senderInfo: opts.senderInfo,
          aiVoice: opts.aiVoice,
          aiInstructions: opts.aiInstructions,
          subjectTemplate: opts.subjectTemplate,
          bodyTemplate: opts.bodyTemplate,
          stepOrder: opts.stepOrder,
          previous: opts.previous,
          model: opts.model,
          apiKey: opts.apiKey,
          bodySoFar: opts.storedBody,
          mergedSubject: subject,
        })
      } catch {
        // keep merged subject
      }
    }
    return { subject, body: opts.storedBody }
  }

  if (opts.useAi && opts.apiKey) {
    const result = await generateEmailWithAI({
      leadData: opts.leadData,
      pitchBlock: opts.pitchBlock,
      senderInfo: opts.senderInfo,
      aiVoice: opts.aiVoice,
      aiInstructions: opts.aiInstructions,
      subjectTemplate: opts.subjectTemplate,
      bodyTemplate: opts.bodyTemplate,
      stepOrder: opts.stepOrder,
      previous: opts.previous,
      model: opts.model,
      apiKey: opts.apiKey,
    })
    return result
  }

  return {
    subject: mergeTags(opts.subjectTemplate, opts.leadData, opts.pitchBlock, opts.senderInfo),
    body: mergeTags(opts.bodyTemplate, opts.leadData, opts.pitchBlock, opts.senderInfo),
  }
}

export async function suggestPitchFromLeads(opts: PitchSuggestOptions): Promise<string> {
  const openai = new OpenAI({ apiKey: opts.apiKey })

  const systemTpl = loadPromptFile('pitch_from_leads_system.md')
  const userTpl = loadPromptFile('pitch_from_leads_user.md')

  const trimmedExisting = (opts.existingPitch || '').trim()
  const existingSection = trimmedExisting
    ? `Existing pitch (refine for this audience — keep product truth):\n${trimmedExisting}`
    : 'No existing pitch — generate a fresh pitch block for this audience.'

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(opts.aiVoice || 'founder'),
  })

  const user = fillTemplate(userTpl, {
    SAMPLE_LEADS_JSON: JSON.stringify(opts.leadsData.slice(0, 10), null, 2),
    EXISTING_PITCH_SECTION: existingSection,
  })

  const response = await openai.chat.completions.create({
    model: opts.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: 500,
  })

  const raw = response.choices[0]?.message?.content || opts.existingPitch || ''
  return normalizePitchBlock(raw)
}
