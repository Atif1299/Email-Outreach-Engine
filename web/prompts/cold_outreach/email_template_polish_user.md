Fix ONLY unfilled merge tags or broken phrases in this already-merged email. Keep everything else identical.

## Sender merge tags (only if present in the template)

{{SENDER_SECTION}}

## Lead data (recipient — do not use for sender sign-off)

{{LEAD_JSON}}

## Unfilled placeholders still in the text

{{UNFILLED_TAGS}}

## Merged subject (fix only if needed)

{{MERGED_SUBJECT}}

## Merged body (fix only if needed)

{{MERGED_BODY}}

Return JSON: { "subject": "...", "body": "..." }

Rules:
- If a tag like {{company}} is empty in lead data, rephrase that sentence naturally without the missing fact (e.g. "I came across your work" instead of "I came across {{company}}").
- Keep all HTML structure if present — same tags, same nesting.
- Do not invent company names or titles not in lead data.
- Do not add a sign-off block unless the template already includes closing lines or {{sender_info}}.
