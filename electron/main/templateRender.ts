import Handlebars from 'handlebars'
import type { LeadData } from '../../src/shared/types'

export type RenderContext = LeadData & {
  pitch_block: string
  sender_info: string
  previous_subject: string
  previous_sent_at: string
  previous_body_snippet: string
  step_index: string
  unsubscribe_note: string
}

Handlebars.registerHelper('truncate', (str: unknown, len: number) => {
  const s = typeof str === 'string' ? str : String(str ?? '')
  const n = typeof len === 'number' ? len : 80
  if (s.length <= n) return s
  return `${s.slice(0, n)}…`
})

export function buildContext(
  lead: LeadData,
  pitchBlock: string,
  senderInfo: string,
  previous:
    | { subject: string; sent_at: string; body_snippet: string | null }
    | undefined,
  stepOrder: number,
): RenderContext {
  return {
    ...lead,
    pitch_block: pitchBlock,
    sender_info: senderInfo,
    previous_subject: previous?.subject ?? '',
    previous_sent_at: previous?.sent_at ?? '',
    previous_body_snippet: previous?.body_snippet ?? '',
    step_index: String(stepOrder),
    unsubscribe_note: 'Reply STOP to opt out of further emails.',
  }
}

export function renderTemplate(template: string, ctx: RenderContext): string {
  const compile = Handlebars.compile(template, { noEscape: true })
  return compile(ctx).trim()
}
