# send-follow-up (Supabase Edge Function)

Resend-backed follow-up delivery function for Heynova.

## Purpose

- Receives generated follow-up text + context from frontend
- Validates payload strictly
- Sends email through **Resend** from `hello@kynliconsulting.com`
- Returns a stable response contract consumed by the existing frontend send flow

---

## Provider

- **Resend API**
- API key is read from Supabase secrets via:
  - `RESEND_API_KEY`

> Never expose provider keys in frontend code or checked-in files.

---

## Request

`POST /functions/v1/send-follow-up`

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
    "email": "john@acme.com",
    "company": "Acme Corp"
  },
  "meeting": {
    "id": "meeting-id",
    "title": "Client Strategy Call",
    "startsAt": "2026-04-08T14:00:00.000Z"
  },
  "draftText": "Hi John, ..."
}
```

### Validation notes

- `draftText` is required
- `contact.email` is required and must be valid
- optional objects (`user`, `contact`, `meeting`) are validated if present

---

## Stable response contract (frontend-facing)

### Success

```json
{
  "ok": true,
  "status": "sent",
  "source": "resend",
  "message": "Follow-up sent successfully.",
  "providerMessageId": "re_xxxxxxxxx"
}
```

### Provider/send failure (safe shape)

```json
{
  "ok": false,
  "status": "failed",
  "source": "resend",
  "message": "Unable to deliver follow-up email.",
  "providerMessageId": null,
  "error": {
    "code": "provider_error",
    "message": "Unable to deliver follow-up email."
  }
}
```

### Validation / request failure

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

---

## Local development

```bash
supabase functions serve send-follow-up --no-verify-jwt
```

Set local secret:

```bash
supabase secrets set RESEND_API_KEY=your_resend_api_key
```

---

## Deploy

```bash
supabase functions deploy send-follow-up
```

Set/update production secret:

```bash
supabase secrets set RESEND_API_KEY=your_resend_api_key
```

---

## Operational notes

- Sender is fixed to: `hello@kynliconsulting.com`
- Keep provider-specific implementation inside this function only
- Frontend should continue calling the same secure function route with unchanged flow
