export const ENGINE_BEAT_DURATION = 2.75

export const PIPELINE_LOG = [
  { time: '08:41:02', msg: 'Queue tick · picked UAE Step 3 · lead #2041', tone: 'accent', stage: 'queue' },
  { time: '08:41:06', msg: 'AI draft ready · subject personalized for Acme Corp', tone: 'dim', stage: 'ai' },
  { time: '08:41:09', msg: 'SMTP send · visionscraft.ai@gmail.com · step 2', tone: 'ok', stage: 'sent' },
] as const

export const BACKGROUND_LOG = [
  { time: '08:41:14', msg: 'Open tracked · Germany campaign · lead #2086', tone: 'accent' },
  { time: '08:41:18', msg: 'IMAP sync · reply detected · removed from queue', tone: 'ok' },
  { time: '08:41:22', msg: 'Follow-up due · 62 jobs · interleaving campaigns', tone: 'warn' },
  { time: '08:41:27', msg: 'Cap check · 12/150 sent today · 3 inboxes healthy', tone: 'dim' },
] as const

export const ENGINE_LOG = [...PIPELINE_LOG, ...BACKGROUND_LOG]

export type PipelineStage = (typeof PIPELINE_LOG)[number]['stage']

export const PIPELINE_CARDS = [
  {
    state: 'Queued',
    subject: 'Quick idea for {{company}}',
    preview: 'Waiting for send slot · Step 1 · 4m delay',
    tone: 'queue',
    stage: 'queue' as PipelineStage,
    inbox: 1,
  },
  {
    state: 'AI Draft',
    subject: 'Partnership intro, personalized',
    preview: 'Hi Sarah, noticed Acme is scaling outbound...',
    tone: 'ai',
    stage: 'ai' as PipelineStage,
    inbox: 2,
  },
  {
    state: 'Sent',
    subject: 'Re: growth at {{company}}',
    preview: 'Delivered via inbox 2 · open pixel attached',
    tone: 'sent',
    stage: 'sent' as PipelineStage,
    inbox: 2,
  },
] as const

export const STACK_OFFSET = 20

export const STACK_SLOTS = [
  { y: 0, scale: 1, opacity: 1, zIndex: 3 },
  { y: STACK_OFFSET, scale: 0.985, opacity: 0.9, zIndex: 2 },
  { y: STACK_OFFSET * 2, scale: 0.97, opacity: 0.78, zIndex: 1 },
] as const
