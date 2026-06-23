import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import {
  buildBodyOutputLanguageRule,
  buildSubjectOutputLanguageRule,
  normalizeOutputLanguage,
} from '@/lib/output-languages'

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
  leadId?: number
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  aiInstructions: string
  outputLanguage?: string
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

const PITCH_STUB_FOR_AI =
  '[Write one industry-specific bridge sentence from PITCH_PARSED — do not copy this placeholder or pitch raw text]'

function loadPromptFile(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'prompts', 'cold_outreach', name), 'utf8').trim()
}

function loadFewShotExamples(stepOrder: number): string[] {
  const subdir = stepOrder > 1 ? 'few_shot/step2' : 'few_shot/step1'
  const dirPath = path.join(process.cwd(), 'prompts', 'cold_outreach', subdir)
  if (!fs.existsSync(dirPath)) {
    try {
      return [loadPromptFile('few_shot_example.txt')]
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
      return [loadPromptFile('few_shot_example.txt')]
    } catch {
      return []
    }
  }
  return examples
}

/** Stable pick so the same lead + step always gets the same style bucket. */
function pickFewShotForLead(examples: string[], opts: { leadId?: number; email?: string; stepOrder: number }): string {
  if (examples.length === 0) return ''
  if (examples.length === 1) return examples[0]

  let key = opts.leadId ?? 0
  if (!key) {
    const email = (opts.email || '').trim().toLowerCase()
    for (let i = 0; i < email.length; i++) {
      key = (key * 31 + email.charCodeAt(i)) | 0
    }
  }
  key = Math.abs((key * 31 + opts.stepOrder) | 0)
  return examples[key % examples.length]
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

function inferLeadIndustry(lead: LeadData): string {
  const industry = lead.industry?.trim()
  if (industry) return industry

  const company = (lead.current_employer || '').toLowerCase()
  const title = (lead.current_title || '').toLowerCase()

  if (/marketing|agency|communications|media|advertising|mc\b/.test(company)) return 'marketing / agency'
  if (/legal|law|attorney|docq/.test(company)) return 'legal tech'
  if (/health|medical|clinic|pharma|care/.test(company)) return 'healthcare'
  if (/tech|software|saas|ai\b|data|platform/.test(company)) return 'technology / SaaS'
  if (/consult|advisory/.test(company)) return 'consulting'
  if (/finance|bank|capital|invest|fintech/.test(company)) return 'financial services'
  if (/coach|training|education/.test(company)) return 'coaching / education'
  if (title.includes('marketing') || title.includes('brand')) return 'marketing'
  if (title.includes('sales') || title.includes('revenue') || title.includes('bd')) return 'sales / revenue'
  if (title.includes('operations') || title.includes(' ops')) return 'operations'
  if (title.includes('strategy') || title.includes('planning')) return 'strategy / planning'

  return 'infer from company name and title'
}

function pitchField(fields: Record<string, string>, key: string, fallback: string): string {
  const v = fields[key]?.trim()
  return v || fallback
}

function buildPersonalizationBrief(lead: LeadData, pitch: ReturnType<typeof parsePitchBlock>): string {
  const company = lead.current_employer?.trim() || 'their company'
  const title = lead.current_title?.trim() || 'their role'
  const industry = inferLeadIndustry(lead)
  const f = pitch.fields

  const pain = pitch.structured
    ? pitchField(f, 'pain', 'manual repetitive work and tool sprawl')
    : 'extract the core pain from PITCH_RAW'
  const solution = pitch.structured
    ? pitchField(f, 'solution', pitchField(f, 'product', 'your specific solution from PITCH_RAW'))
    : 'extract the solution from PITCH_RAW'
  const offer = pitch.structured
    ? pitchField(f, 'offer', 'use the exact CTA from PITCH_RAW')
    : 'extract the offer/CTA from PITCH_RAW'
  const product = pitch.structured ? pitchField(f, 'product', solution) : solution
  const integrations = pitch.structured ? pitchField(f, 'integrations', '') : ''

  const integrationNote = integrations ? ` Mention tools/channels: ${integrations}.` : ''

  return `## Mandatory personalization (follow exactly)

Lead context:
- Company: ${company}
- Title: ${title}
- Industry: ${industry}

Pain for THIS lead (from pitch, adapted): ${pain} — as experienced by a ${title} at ${company} in ${industry}.

Bridge sentence (ONE sentence only): Connect "${product}" / "${solution}" to ${company}'s ${industry} workflow.${integrationNote} Name ${company} or a ${industry}-specific task (campaign planning, client reporting, pipeline ops, etc.). No generic "we help businesses" language.

CTA (ONE short question): Use this exact offer — "${offer}". Do not invent "book a free consultation" or "discover automation opportunities".

## BAD output (never write anything like this)

"We design and deploy AI agents and intelligent automations that streamline marketing operations, allowing your team to focus on high-value activities and enhance campaign effectiveness."

"Let's discuss how AI can transform your operations — book a free consultation to discover automation opportunities in your business."

## GOOD bridge examples (match this specificity, not wording)

"For planning directors at agencies like Wave Marketing, manual reporting across client campaigns eats strategy time — we automate intake and status sync across your project stack so you ship plans faster."

"At Docq.AI, doc-review bottlenecks slow product cycles — we build agents on your existing doc pipeline so founders ship features instead of chasing manual triage."`
}

const BANNED_BODY_PATTERNS = [
  /design and deploy ai agents/i,
  /intelligent automations/i,
  /streamline (?:marketing |business )?operations/i,
  /focus on high-value activities/i,
  /enhance campaign effectiveness/i,
  /transform your operations/i,
  /book a free consultation/i,
  /discover automation opportunities/i,
  /we help businesses like yours/i,
  /let'?s discuss how ai can/i,
]

function hasBannedBodyFiller(text: string): boolean {
  return BANNED_BODY_PATTERNS.some((re) => re.test(text))
}

function voiceRules(aiVoice: string): string {
  if (aiVoice === 'company') {
    return 'Use company voice — we/our/us. Name the lead\'s company or industry in the bridge sentence. Never write a generic capabilities paragraph — one specific bridge sentence only.'
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
  leadId?: number
  pitchBlock: string
  senderInfo: string
  previous?: PreviousSend
  stepOrder: number
  mergedPreview: string
  aiVoice: string
  aiInstructions: string
  outputLanguage?: string
}) {
  const examples = loadFewShotExamples(opts.stepOrder)
  const fewShot = pickFewShotForLead(examples, {
    leadId: opts.leadId,
    email: opts.lead.email,
    stepOrder: opts.stepOrder,
  })
  const systemTpl = loadPromptFile('body_system.md')
  const userTpl = loadPromptFile('body_user.md')

  const pitch = parsePitchBlock(opts.pitchBlock)
  const instructions = (opts.aiInstructions || '').trim() || '(none)'
  const lang = normalizeOutputLanguage(opts.outputLanguage)

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(opts.aiVoice),
    FEW_SHOT_EXAMPLE: fewShot,
    SIGN_OFF_RULES: signOffRules(opts.senderInfo),
    AI_INSTRUCTIONS: instructions,
    OUTPUT_LANGUAGE_RULE: buildBodyOutputLanguageRule(lang),
  })

  const leadWithEmail = { ...opts.lead, email: opts.lead.email ?? '' }
  const industry = inferLeadIndustry(leadWithEmail)
  const user = fillTemplate(userTpl, {
    LEAD_NAME: [leadWithEmail.first_name, leadWithEmail.last_name].filter(Boolean).join(' ') || '(unknown)',
    LEAD_COMPANY: leadWithEmail.current_employer?.trim() || '(unknown)',
    LEAD_TITLE: leadWithEmail.current_title?.trim() || '(unknown)',
    LEAD_INDUSTRY: industry,
    PERSONALIZATION_BRIEF: buildPersonalizationBrief(leadWithEmail, pitch),
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
  outputLanguage?: string
}) {
  const systemTpl = loadPromptFile('subject_system.md')
  const instructions = (opts.aiInstructions || '').trim() || '(none)'
  const lang = normalizeOutputLanguage(opts.outputLanguage)

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(opts.aiVoice),
    AI_INSTRUCTIONS: instructions,
    OUTPUT_LANGUAGE_RULE: buildSubjectOutputLanguageRule(lang),
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
  const leadFull = { ...opts.leadData, email: opts.leadData.email ?? '' }

  const baseMessages = buildBodyMessages({
    lead: leadFull,
    leadId: opts.leadId,
    pitchBlock: opts.pitchBlock,
    senderInfo: opts.senderInfo,
    previous: opts.previous,
    stepOrder: opts.stepOrder ?? 1,
    mergedPreview: mergeTags(opts.bodyTemplate, leadFull, PITCH_STUB_FOR_AI, opts.senderInfo),
    aiVoice: opts.aiVoice || 'founder',
    aiInstructions: opts.aiInstructions || '',
    outputLanguage: opts.outputLanguage,
  })

  const request = async (messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) => {
    const response = await openai.chat.completions.create({
      model: opts.model,
      messages,
      temperature: 0.45,
      max_tokens: 350,
    })
    const text = response.choices[0]?.message?.content?.trim()
    if (!text) throw new Error('Empty response from OpenAI')
    return text
  }

  let text = await request(baseMessages)
  if (hasBannedBodyFiller(text)) {
    text = await request([
      ...baseMessages,
      { role: 'assistant', content: text },
      {
        role: 'user',
        content:
          'REJECTED: bridge/CTA is generic agency filler. Rewrite the entire body. Bridge must name the lead company and industry-specific workflow. CTA must use pitch Offer only. One bridge sentence + one CTA sentence. No "design and deploy AI agents", no "streamline operations", no "free consultation".',
      },
    ])
  }

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
    outputLanguage: opts.outputLanguage,
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
  leadId?: number
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  aiInstructions: string
  outputLanguage?: string
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
          outputLanguage: opts.outputLanguage,
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
      leadId: opts.leadId,
      pitchBlock: opts.pitchBlock,
      senderInfo: opts.senderInfo,
      aiVoice: opts.aiVoice,
      aiInstructions: opts.aiInstructions,
      outputLanguage: opts.outputLanguage,
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
