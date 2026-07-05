import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { buildBodyOutputLanguageRule, normalizeOutputLanguage } from '@/lib/output-languages'
import { deriveSenderNameFromSignOff } from '@/lib/pitch-block'
import { mergeTags, type MergeTagLeadData } from '@/lib/merge-tags'
import { normalizeBodyFormat, type BodyFormat } from '@/lib/email-html'

export { mergeTags } from '@/lib/merge-tags'

interface LeadData extends MergeTagLeadData { }

interface PreviousSend {
  subject?: string
  body?: string
  body_snippet?: string
}

function stepPromptTier(stepOrder: number): 'step1' | 'step2' | 'step3' {
  if (stepOrder <= 1) return 'step1'
  if (stepOrder === 2) return 'step2'
  return 'step3'
}

interface GenerateEmailOptions {
  leadData: LeadData
  leadId?: number
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  outputLanguage?: string
  subjectTemplate: string
  bodyTemplate: string
  stepOrder?: number
  previous?: PreviousSend
  step1Touch?: PreviousSend
  model: string
  apiKey: string
  provider?: 'openai' | 'gemini'
  bodyFormat?: BodyFormat | string
}

function createAiClient(opts: { apiKey: string; provider?: string }) {
  if (opts.provider === 'gemini') {
    return new OpenAI({
      apiKey: opts.apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    })
  }
  return new OpenAI({ apiKey: opts.apiKey })
}

function completionTokenLimit(provider: string | undefined, kind: 'body' | 'subject' | 'pitch'): number {
  if (provider === 'gemini') {
    if (kind === 'body') return 4096
    if (kind === 'subject') return 512
    return 2048
  }
  if (kind === 'body') return 800
  if (kind === 'subject') return 60
  return 500
}

interface PitchSuggestOptions {
  leadsData: LeadData[]
  existingPitch?: string
  aiVoice?: string
  model: string
  apiKey: string
  provider?: 'openai' | 'gemini'
}

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

function voiceRules(aiVoice: string): string {
  if (aiVoice === 'company') {
    return 'Use company voice — we/our/us. Name the lead\'s company or industry in the bridge sentence. Never write a generic capabilities paragraph — one specific bridge sentence only.'
  }
  return 'Use founder/builder voice — first person I/me/my. Example: "I built...", "I can show you...", "I saw you\'re...". Sound like the person who delivers the work.'
}

function signOffRules(): string {
  return 'Sign-off is controlled per step in the body template — do not append a closing or signature unless the template already includes one or uses {{sender_info}}.'
}

function bodyFormatRules(bodyFormat: BodyFormat): string {
  if (bodyFormat === 'html') {
    return `- Body must be minimal HTML fragments only — no full document wrapper.
- Use only: p, br, strong, b, em, i, u, a, ul, ol, li, span, table, tr, td, th.
- Example: <p>Hi {{first_name}},</p><p>...</p><p>Best,<br>Name</p>
- No markdown, no bullet characters outside HTML lists.`
  }
  return `- Plain text only. No markdown, bullets, or HTML tags.
- Structure: greeting → pain hook → bridge → soft CTA. Closing/sign-off only if the step template includes it.
- 90–130 words for step 1; shorter for follow-ups.`
}

function templateInstruction(subjectTemplate: string, bodyTemplate: string): string {
  const hasSubject = !!subjectTemplate.trim()
  const hasBody = !!bodyTemplate.trim()
  if (!hasSubject && !hasBody) {
    return 'No templates provided — write from the campaign brief and lead data.'
  }
  return 'No templates provided — write from the campaign brief and lead data.'
}

const MERGE_TAG_RE = /\{\{[^}]+\}\}/

function hasUnfilledMergeTags(text: string): boolean {
  return MERGE_TAG_RE.test(text)
}

function listUnfilledMergeTags(subject: string, body: string): string {
  const tags = new Set<string>()
  for (const text of [subject, body]) {
    const re = /\{\{([^}]+)\}\}/g
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      tags.add(`{{${match[1]}}}`)
    }
  }
  return tags.size ? Array.from(tags).join(', ') : '(none)'
}

function buildTemplatePolishMessages(opts: {
  lead: LeadData
  mergedSubject: string
  mergedBody: string
  senderInfo: string
  outputLanguage?: string
  bodyFormat?: BodyFormat | string
}) {
  const bodyFormat = normalizeBodyFormat(opts.bodyFormat)
  const systemTpl = loadPromptFile('email_template_polish_system.md')
  const userTpl = loadPromptFile('email_template_polish_user.md')
  const lang = normalizeOutputLanguage(opts.outputLanguage)
  const leadWithEmail = { ...opts.lead, email: opts.lead.email ?? '' }
  const signOff = opts.senderInfo.trim()

  const system = fillTemplate(systemTpl, {
    BODY_FORMAT_RULES: bodyFormatRules(bodyFormat),
    OUTPUT_LANGUAGE_RULE: buildBodyOutputLanguageRule(lang),
  })

  const senderSection = signOff
    ? `- Sender name for {{sender_name}}: ${deriveSenderNameFromSignOff(signOff) || signOff}
- Full sender sign-off for {{sender_info}}: ${signOff}
- NEVER use the lead's first_name, last_name, or name for sender tags.`
    : `- No campaign-level sender sign-off — only fill {{sender_name}} / {{sender_info}} if they appear in the step template with explicit text in the template; otherwise do not add a sign-off block.`

  const user = fillTemplate(userTpl, {
    LEAD_JSON: JSON.stringify(leadWithEmail, null, 2),
    SENDER_SECTION: senderSection,
    UNFILLED_TAGS: listUnfilledMergeTags(opts.mergedSubject, opts.mergedBody),
    MERGED_SUBJECT: opts.mergedSubject,
    MERGED_BODY: opts.mergedBody,
  })

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

async function polishMergedEmailWithAI(
  opts: GenerateEmailOptions & { mergedSubject: string; mergedBody: string }
): Promise<{ subject: string; body: string }> {
  const openai = createAiClient(opts)

  const baseMessages = buildTemplatePolishMessages({
    lead: opts.leadData,
    mergedSubject: opts.mergedSubject,
    mergedBody: opts.mergedBody,
    senderInfo: opts.senderInfo?.trim() || '',
    outputLanguage: opts.outputLanguage,
    bodyFormat: opts.bodyFormat,
  })

  const request = async (messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) => {
    const response = await openai.chat.completions.create({
      model: opts.model,
      messages,
      temperature: 0.2,
      max_tokens: completionTokenLimit(opts.provider, 'body'),
      ...(opts.provider !== 'gemini' ? { response_format: { type: 'json_object' as const } } : {}),
    })
    const text = response.choices[0]?.message?.content?.trim()
    if (!text) throw new Error('Empty response from AI')
    const parsed = parseEmailJson(text)
    if (!parsed) throw new Error('AI response was not valid JSON with subject and body')
    return parsed
  }

  try {
    return await request(baseMessages)
  } catch {
    const retryMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...baseMessages,
      {
        role: 'user',
        content: 'Return ONLY valid JSON: { "subject": "...", "body": "..." }. No markdown fences.',
      },
    ]
    try {
      return await request(retryMessages)
    } catch {
      return { subject: opts.mergedSubject, body: opts.mergedBody }
    }
  }
}

function buildCombinedMessages(opts: {
  lead: LeadData
  pitchBlock: string
  senderInfo: string
  previous?: PreviousSend
  step1Touch?: PreviousSend
  stepOrder: number
  aiVoice: string
  outputLanguage?: string
  bodyFormat?: BodyFormat | string
  subjectTemplate?: string
  bodyTemplate?: string
}) {
  const tier = stepPromptTier(opts.stepOrder)
  const bodyFormat = normalizeBodyFormat(opts.bodyFormat)
  const subjectTemplate = opts.subjectTemplate?.trim() || '(none)'
  const bodyTemplate = opts.bodyTemplate?.trim() || '(none)'

  const systemTpl = loadPromptFile('email_combined_system.md')
  const userTpl = loadPromptFile('email_combined_user.md')
  const lang = normalizeOutputLanguage(opts.outputLanguage)
  const signOff = opts.senderInfo?.trim() || ''

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(opts.aiVoice),
    SIGN_OFF_RULES: signOffRules(),
    OUTPUT_LANGUAGE_RULE: buildBodyOutputLanguageRule(lang),
    BODY_FORMAT_RULES: bodyFormatRules(bodyFormat),
  })

  const leadWithEmail = { ...opts.lead, email: opts.lead.email ?? '' }
  const industry = inferLeadIndustry(leadWithEmail)

  const previousBody =
    opts.previous?.body?.trim() ||
    opts.previous?.body_snippet?.trim() ||
    ''
  const step1Body =
    opts.step1Touch?.body?.trim() ||
    opts.step1Touch?.body_snippet?.trim() ||
    ''

  let priorSection = ''
  if (tier === 'step1') {
    priorSection = 'This is the first email in the sequence.'
  } else if (tier === 'step2') {
    priorSection = `Prior email (reference this thread):\nSubject: ${opts.previous?.subject?.trim() || '(unknown)'}\nBody:\n${previousBody || '(none — generate step 1 preview first)'}`
  } else {
    priorSection = `Step 1 email:\nSubject: ${opts.step1Touch?.subject?.trim() || opts.previous?.subject?.trim() || '(unknown)'}\nBody:\n${step1Body || previousBody || '(none)'}\n\nMost recent email:\nSubject: ${opts.previous?.subject?.trim() || '(unknown)'}\nBody:\n${previousBody || '(none)'}`
  }

  const stepType =
    tier === 'step1' ? 'first touch' : tier === 'step2' ? 'follow-up' : 'close-loop follow-up'

  const user = fillTemplate(userTpl, {
    CAMPAIGN_BRIEF: opts.pitchBlock?.trim() || '(empty — write a generic peer outreach email)',
    LEAD_NAME: [leadWithEmail.first_name, leadWithEmail.last_name].filter(Boolean).join(' ') || '(unknown)',
    LEAD_TITLE: leadWithEmail.current_title?.trim() || '(unknown)',
    LEAD_COMPANY: leadWithEmail.current_employer?.trim() || '(unknown)',
    LEAD_INDUSTRY: industry,
    LEAD_LOCATION: leadWithEmail.location?.trim() || '(unknown)',
    LEAD_JSON: JSON.stringify(leadWithEmail, null, 2),
    STEP_ORDER: String(opts.stepOrder),
    STEP_TYPE: stepType,
    PRIOR_EMAIL_SECTION: priorSection,
    SUBJECT_TEMPLATE: subjectTemplate,
    BODY_TEMPLATE: bodyTemplate,
    TEMPLATE_INSTRUCTION: templateInstruction(subjectTemplate, bodyTemplate),
  })

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

function parseEmailJson(text: string): { subject: string; body: string } | null {
  const trimmed = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '')
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { subject?: unknown; body?: unknown }
    if (typeof parsed.subject === 'string' && typeof parsed.body === 'string') {
      return {
        subject: parsed.subject.trim().replace(/^["']|["']$/g, '').slice(0, 100),
        body: parsed.body.trim(),
      }
    }
  } catch {
    /* invalid JSON */
  }
  return null
}

function finalizeRenderedEmail(
  result: { subject: string; body: string },
  _opts: { bodyTemplate: string; signOff: string; bodyFormat?: BodyFormat | string }
): { subject: string; body: string } {
  return result
}

export function normalizePitchBlock(text: string): string {
  return text
    .trim()
    .replace(/^```[\w]*\n?|\n?```$/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .trim()
}

export async function generateEmailWithAI(opts: GenerateEmailOptions): Promise<{ subject: string; body: string }> {
  const openai = createAiClient(opts)
  const leadFull = { ...opts.leadData, email: opts.leadData.email ?? '' }
  const signOff = opts.senderInfo?.trim() || ''
  const hasBodyTemplate = !!opts.bodyTemplate?.trim()
  const hasSubjectTemplate = !!opts.subjectTemplate?.trim()

  if (hasBodyTemplate || hasSubjectTemplate) {
    const mergedSubject = hasSubjectTemplate
      ? mergeTags(opts.subjectTemplate, leadFull, opts.pitchBlock, signOff)
      : ''
    const mergedBody = hasBodyTemplate
      ? mergeTags(opts.bodyTemplate, leadFull, opts.pitchBlock, signOff)
      : ''

    if (!hasUnfilledMergeTags(mergedSubject) && !hasUnfilledMergeTags(mergedBody)) {
      return { subject: mergedSubject, body: mergedBody }
    }

    return polishMergedEmailWithAI({
      ...opts,
      mergedSubject,
      mergedBody,
    })
  }

  const baseMessages = buildCombinedMessages({
    lead: leadFull,
    pitchBlock: opts.pitchBlock,
    senderInfo: signOff,
    previous: opts.previous,
    step1Touch: opts.step1Touch,
    stepOrder: opts.stepOrder ?? 1,
    aiVoice: opts.aiVoice || 'founder',
    outputLanguage: opts.outputLanguage,
    bodyFormat: opts.bodyFormat,
    subjectTemplate: opts.subjectTemplate,
    bodyTemplate: opts.bodyTemplate,
  })

  const request = async (messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) => {
    const response = await openai.chat.completions.create({
      model: opts.model,
      messages,
      temperature: 0.45,
      max_tokens: completionTokenLimit(opts.provider, 'body'),
      ...(opts.provider !== 'gemini' ? { response_format: { type: 'json_object' as const } } : {}),
    })
    const text = response.choices[0]?.message?.content?.trim()
    if (!text) throw new Error('Empty response from AI')
    const parsed = parseEmailJson(text)
    if (!parsed) throw new Error('AI response was not valid JSON with subject and body')
    return parsed
  }

  try {
    return await request(baseMessages)
  } catch {
    const retryMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...baseMessages,
      {
        role: 'user',
        content: 'Return ONLY valid JSON: { "subject": "...", "body": "..." }. No markdown fences.',
      },
    ]
    try {
      return await request(retryMessages)
    } catch {
      const mergedSubject = mergeTags(opts.subjectTemplate, leadFull, opts.pitchBlock, signOff)
      const mergedBody = mergeTags(opts.bodyTemplate, leadFull, opts.pitchBlock, signOff)
      if (mergedSubject.trim() && mergedBody.trim()) {
        return { subject: mergedSubject, body: mergedBody }
      }
      throw new Error('AI generation failed and no manual templates are configured')
    }
  }
}

export async function renderEmailForLead(opts: {
  leadData: LeadData
  leadId?: number
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  outputLanguage?: string
  subjectTemplate: string
  bodyTemplate: string
  stepOrder: number
  previous?: PreviousSend
  step1Touch?: PreviousSend
  model: string
  apiKey: string
  provider?: 'openai' | 'gemini'
  useAi: boolean
  storedBody?: string
  storedSubject?: string | null
  bodyFormat?: BodyFormat | string
}): Promise<{ subject: string; body: string }> {
  const hasValidApiKey = !!opts.apiKey?.trim()
  const signOff = opts.senderInfo?.trim() || ''

  if (opts.storedBody !== undefined) {
    return {
      subject: opts.storedSubject ?? mergeTags(opts.subjectTemplate, opts.leadData, opts.pitchBlock, signOff),
      body: opts.storedBody,
    }
  }

  if (opts.useAi && !hasValidApiKey) {
    const providerName = opts.provider === 'gemini' ? 'Gemini' : 'OpenAI'
    throw new Error(`${providerName} API key is required for AI generation`)
  }

  if (opts.useAi && hasValidApiKey) {
    const result = await generateEmailWithAI({
      leadData: opts.leadData,
      leadId: opts.leadId,
      pitchBlock: opts.pitchBlock,
      senderInfo: signOff,
      aiVoice: opts.aiVoice,
      outputLanguage: opts.outputLanguage,
      subjectTemplate: opts.subjectTemplate,
      bodyTemplate: opts.bodyTemplate,
      stepOrder: opts.stepOrder,
      previous: opts.previous,
      step1Touch: opts.step1Touch,
      model: opts.model,
      apiKey: opts.apiKey,
      provider: opts.provider,
      bodyFormat: opts.bodyFormat,
    })
    return finalizeRenderedEmail(result, {
      bodyTemplate: opts.bodyTemplate,
      signOff,
      bodyFormat: opts.bodyFormat,
    })
  }

  return finalizeRenderedEmail(
    {
      subject: mergeTags(opts.subjectTemplate, opts.leadData, opts.pitchBlock, signOff),
      body: mergeTags(opts.bodyTemplate, opts.leadData, opts.pitchBlock, signOff),
    },
    { bodyTemplate: opts.bodyTemplate, signOff, bodyFormat: opts.bodyFormat }
  )
}

export async function suggestPitchFromLeads(opts: PitchSuggestOptions): Promise<string> {
  const openai = createAiClient(opts)

  const systemTpl = loadPromptFile('pitch_from_leads_system.md')
  const userTpl = loadPromptFile('pitch_from_leads_user.md')

  const trimmedExisting = (opts.existingPitch || '').trim()
  const existingSection = trimmedExisting
    ? `Existing campaign brief (refine for this audience — keep product truth):\n${trimmedExisting}`
    : 'No existing brief — generate a fresh campaign brief for this audience.'

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
    max_tokens: completionTokenLimit(opts.provider, 'pitch'),
  })

  const raw = response.choices[0]?.message?.content || opts.existingPitch || ''
  return normalizePitchBlock(raw)
}
