# generate-follow-up-draft (Supabase Edge Function)

LLM-backed follow-up draft generation for Heynova (with safe fallback).

## Purpose

- Accepts app context (`userProfile`, `contact`, `meeting`)
- Validates payload strictly
- Calls LLM provider from secure backend only
- Returns a stable frontend contract
- Falls back to deterministic draft if provider fails

## Request

`POST /functions/v1/generate-follow-up-draft`

```json
{
  "userProfile": {
    "id": "uuid-or-id",
    "name": "Mechealle",
    "email": "me@example.com",
    "role": "AE",
    "companyName": "Heynova"
  },
  "contact": {
    "id": "contact-id",
    "name": "John Smith",
    "email": "john@acme.com",
    "company": "Acme Corp",
    "status": "Follow-up needed",
    "notes": "Requested revised proposal"
  },
  "meeting": {
    "id": "meeting-id",
    "title": "Client Strategy Call",
    "startsAt": "2026-04-08T14:00:00.000Z",
    "agenda": "Discuss rollout timeline",
    "notes": "Need revised milestones",
    "summary": "Previous meeting summary text",
    "transcript": "Transcript text (if available)",
    "attendees": ["John Smith", "Mechealle"]
  }
}
```

> Backward compatibility: `user` is also accepted (same shape as `userProfile`).

## Success response (stable contract)

```json
{
  "draft": "Hi John, ...",
  "source": "openai",
  "context": {
    "hasUserProfile": true,
    "hasContact": true,
    "hasMeeting": true
  }
}
```

If provider is unavailable, response remains successful with fallback source:

```json
{
  "draft": "Hi John, ...",
  "source": "fallback",
  "context": {
    "hasUserProfile": true,
    "hasContact": true,
    "hasMeeting": true
  }
}
```

## Error response

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Payload validation failed.",
    "details": {
      "contact.email": "Must be a valid email address."
    }
  }
}
```

## Local development

```bash
supabase functions serve generate-follow-up-draft --no-verify-jwt
```

## Deploy

```bash
supabase functions deploy generate-follow-up-draft
```

## Required Supabase secrets (server-side only)

```bash
supabase secrets set OPENAI_API_KEY=your_key_here
supabase secrets set OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_MODEL` is optional (defaults to `gpt-4.1-mini`).

Do **not** expose provider secrets in frontend `VITE_*` variables.
