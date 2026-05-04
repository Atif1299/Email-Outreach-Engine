import OpenAI from 'openai'
import { getOpenaiKey } from './settingsStore'
import type { LeadData } from '../../src/shared/types'
import { buildContext, renderTemplate } from './templateRender'

export async function generateEmailBody(
  model: string,
  pitchBlock: string,
  senderInfo: string,
  lead: LeadData,
  previous: { subject: string; sent_at: string; body_snippet: string | null } | undefined,
  stepOrder: number,
  baseTemplate: string,
  customInstructions?: string,
): Promise<string> {
  const key = getOpenaiKey()
  if (!key) throw new Error('OpenAI API key is not set in Settings')
  const client = new OpenAI({ apiKey: key })
  const ctx = buildContext(lead, pitchBlock, senderInfo, previous, stepOrder)
  const mergedPreview = renderTemplate(baseTemplate, ctx)
  const signOff =
    senderInfo.trim().length > 0
      ? `Closing must use this exact sign-off block (keep line breaks and URLs as written):\n${senderInfo.trim()}`
      : `No sender sign-off was configured. End with a neutral professional closing. Do not output placeholders like [Your Name] or {{ Your name }}.`
  const sys = `You write concise, professional cold outreach emails (plain text only, no markdown).
The sender is an AI services team offering consulting/automation. Respect opt-out language already in templates.
${signOff}
Custom instructions from user:\n${customInstructions ?? '(none)'}`

  const user = `Lead fields (JSON):\n${JSON.stringify(lead, null, 2)}\n\nPitch / positioning block:\n${pitchBlock}\n\nSender / company sign-off (for reference; closing rules are in system message):\n${senderInfo.trim() || '(none)'}\n\nStep index in sequence: ${stepOrder}\n\nPrevious email subject (if any): ${ctx.previous_subject}\n\nTemplate after merge (use as loose guide, improve wording):\n${mergedPreview}\n\nProduce only the email body text (no subject line).`

  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: 600,
  })
  const text = res.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('Empty response from OpenAI')
  return text
}

export async function generateSubjectLine(
  model: string,
  pitchBlock: string,
  senderInfo: string,
  lead: LeadData,
  subjectTemplate: string,
  bodySoFar: string,
): Promise<string> {
  const key = getOpenaiKey()
  if (!key) throw new Error('OpenAI API key is not set in Settings')
  const client = new OpenAI({ apiKey: key })
  const sys = `Write a single short email subject line (max 90 chars), plain text, no quotes. Professional cold outreach.`
  const user = `Merged subject template (you may refine):\n${subjectTemplate}\n\nBody:\n${bodySoFar.slice(0, 800)}\n\nLead:\n${JSON.stringify(lead)}\n\nPitch:\n${pitchBlock}\n\nSender context (optional):\n${senderInfo.trim() || '(none)'}`
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.5,
    max_tokens: 80,
  })
  const text = res.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '')
  if (!text) throw new Error('Empty subject from OpenAI')
  return text.slice(0, 120)
}
