Write the email body for this lead.

{{PERSONALIZATION_BRIEF}}

## Lead anchor

- Company: {{LEAD_COMPANY}}
- Title: {{LEAD_TITLE}}
- Industry: {{LEAD_INDUSTRY}}
- Name: {{LEAD_NAME}}

## Lead (full fields)

```json
{{LEAD_JSON}}
```

## Parsed pitch block (extract Pain, Solution, Offer — adapt to lead anchor above)

```json
{{PITCH_PARSED}}
```

## Raw pitch block (ideas only — never copy sentences into the email)

{{PITCH_RAW}}

## Sender sign-off (use exactly at the end)

{{SENDER_INFO}}

## Sequence context

- Step: {{STEP_ORDER}} of sequence
- Previous email subject: {{PREVIOUS_SUBJECT}}
- Previous email snippet: {{PREVIOUS_SNIPPET}}

## Template structure (greeting + hook shape only — do NOT copy the pitch section)

{{MERGED_PREVIEW}}

## Before you write — checklist

1. Pain hook references {{LEAD_COMPANY}} or {{LEAD_INDUSTRY}}.
2. Product bridge = one sentence: pitch Solution applied to {{LEAD_INDUSTRY}} / {{LEAD_TITLE}} workflow.
3. CTA from pitch Offer, not a generic "quick call to explore AI".
4. Product bridge from pitch Solution only — not from the few-shot example or email-tool tropes unless pitch says so.
5. No generic agency paragraphs. No second solution paragraph.

Produce only the email body text. No subject line. No commentary.
