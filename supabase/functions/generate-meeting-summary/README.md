# generate-meeting-summary (Supabase Edge Function)

LLM-backed transcript summary function for Heynova (with safe fallback).

## Purpose

- Accepts a meeting transcript from secure frontend invocation
- Validates payload strictly
- Calls LLM provider from backend only
- Returns a structured summary contract:
  - `keyPoints`
  - `decisions`
  - `actionItems`
- Falls back to deterministic transcript summary if provider fails

## Request

`POST /functions/v1/generate-meeting-summary`

```json
{
  "user": {
    "id": "user-id",
    "name": "Mechealle",
    "email": "me@example.com"
  },
  "meeting": {
    "id": "meeting-id",
    "title": "Client Strategy Call",
    "startsAt": "2026-04-08T14:00:00.000Z",
    "transcript": "Full transcript text..."
  }
}
```

## Success response

```json
{
  "ok": true,
  "source": "openai",
  "summary": {
    "title": "Client Strategy Call",
    "keyPoints": ["..."],
    "decisions": ["..."],
    "actionItems": ["..."]
  },
  "message": "Summary generated successfully."
}
```

## Error response

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Payload validation failed.",
    "details": {
      "meeting.transcript": "Field is required."
    }
  }
}
```

## Local

```bash
supabase functions serve generate-meeting-summary --no-verify-jwt
```

## Deploy

```bash
supabase functions deploy generate-meeting-summary
```

## Frontend env

Use in app config:

```bash
VITE_SUPABASE_MEETING_SUMMARY_FUNCTION=generate-meeting-summary
```

## Required Supabase secrets (server-side only)

```bash
supabase secrets set OPENAI_API_KEY=your_key_here
supabase secrets set OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_MODEL` is optional (defaults to `gpt-4.1-mini`).
