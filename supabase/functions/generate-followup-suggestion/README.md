# generate-followup-suggestion (Supabase Edge Function)

Secure backend suggestion generator for Find a Contact rows.

## Purpose

- Receives contact + lightweight context
- Returns one short actionable suggestion
- Keeps provider logic server-side

## Request

```json
{
  "user": {
    "id": "user-id",
    "name": "Mechealle",
    "email": "me@example.com"
  },
  "contact": {
    "id": "contact-id",
    "name": "John Smith",
    "company": "Acme Corp",
    "status": "Follow-up needed",
    "lastContacted": "2026-04-08T12:00:00.000Z"
  },
  "context": {
    "recentMeetingSummary": "...",
    "recentMeetingTitle": "Client Strategy Call",
    "recentOpenTasks": ["Send proposal"],
    "recentDraftStatus": "failed"
  }
}
```

## Success response

```json
{
  "ok": true,
  "source": "mock",
  "suggestion": "Use Client Strategy Call notes to send a concise follow-up...",
  "priority": "high"
}
```

`priority` is one of: `high`, `medium`, `low`.

## Error response

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Payload validation failed.",
    "details": {
      "contact.name": "contact.name is required."
    }
  }
}
```

## Local

```bash
supabase functions serve generate-followup-suggestion --no-verify-jwt
```

## Deploy

```bash
supabase functions deploy generate-followup-suggestion
```

## Frontend env

```bash
VITE_SUPABASE_CONTACT_SUGGESTION_FUNCTION=generate-followup-suggestion
```
