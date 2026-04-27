# gmail-classify-preview

Component 2: Gmail Intelligence classification engine.

- Calls `gmail-preview-sync` internally
- Applies rule-based pre-classification (newsletter/marketing)
- Classifies remaining emails via LLM in batches
- Returns strict structured output
- No DB writes

## Endpoint

`POST /functions/v1/gmail-classify-preview`

Requires:
- `Authorization: Bearer <supabase_user_jwt>`

## Output per email

```json
{
  "id": "string",
  "tags": ["string"],
  "priority": "high|medium|low",
  "should_store": true,
  "confidence": 0.0,
  "reason": "string"
}
```

## Global response

```json
{
  "ok": true,
  "status": "success",
  "source": "gmail",
  "emails": [],
  "count": 0,
  "requestedCount": 0
}
```

## Rules implemented

- Allowed tags only
- Max 3 tags
- At least 1 tag (`["Low Priority"]` fallback)
- `should_store` computed server-side from tags
- Rule-based newsletter detection skips LLM
- LLM failure falls back to low-priority classification
- Batch classification supported

## Required env vars

- `SUPABASE_URL`
- `OPENAI_API_KEY` (optional; fallback mode works without it)
- `OPENAI_MODEL` (optional, default `gpt-4.1-mini`)

## Deploy

```bash
supabase functions deploy gmail-classify-preview
```
