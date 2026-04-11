# gmail-send

Sends outbound email through the authenticated user's connected Gmail account.

## Endpoint

`POST /functions/v1/gmail-send`

## Request body

```json
{
  "to": "recipient@company.com",
  "subject": "Follow-up from today",
  "text": "Plain text body",
  "html": "<p>Optional HTML body</p>"
}
```

Compatibility fallback (if not provided):
- `to` can be inferred from `contact.email`
- `subject` can be inferred from meeting/contact payload
- `text` can be inferred from `draftText`

## Success response

```json
{
  "ok": true,
  "status": "sent",
  "source": "gmail",
  "providerMessageId": "...",
  "threadId": null,
  "message": "Email sent successfully."
}
```

## Failure response

```json
{
  "ok": false,
  "status": "failed",
  "source": "gmail",
  "error": {
    "code": "validation_failed",
    "message": "..."
  }
}
```

Supported `error.code` values:
- `validation_failed`
- `unauthorized`
- `gmail_not_connected`
- `token_refresh_failed`
- `google_reauth_required`
- `mime_build_failed`
- `provider_error`
- `provider_unreachable`
- `internal_error`

## Required secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Notes

- Uses `integration_connections` provider `gmail`.
- Refreshes expired token with 60s buffer.
- Retries send once if Gmail returns 401.
- Does not log tokens or full body content.
