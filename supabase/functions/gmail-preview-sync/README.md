# gmail-preview-sync

Preview-only Gmail fetch for recent message metadata.

## Scope

- Fetch recent Gmail message IDs (`maxResults=20`)
- Fetch lightweight metadata for each message
- Return normalized preview payload
- No DB storage of emails
- No attachment parsing
- No inbox sync/history sync

## Endpoint

`POST /functions/v1/gmail-preview-sync`

Requires:
- `Authorization: Bearer <supabase_user_jwt>`

## Success response

```json
{
  "ok": true,
  "status": "success",
  "source": "gmail",
  "emails": [
    {
      "id": "...",
      "threadId": "...",
      "fromEmail": "...",
      "fromName": "...",
      "subject": "...",
      "snippet": "...",
      "internalDate": "2026-04-12T23:00:00.000Z",
      "labelIds": ["INBOX", "UNREAD"],
      "isUnread": true
    }
  ],
  "count": 12,
  "requestedCount": 20
}
```

## Failure response

```json
{
  "ok": false,
  "status": "failed",
  "source": "gmail",
  "error": {
    "code": "gmail_not_connected",
    "message": "..."
  }
}
```

## Error codes

- `validation_failed`
- `unauthorized`
- `gmail_not_connected`
- `token_refresh_failed`
- `google_reauth_required`
- `provider_error`
- `provider_unreachable`
- `internal_error`

## Notes

- Batch is resilient: failed metadata fetch for one message is skipped.
- Output remains partial when From/Subject is missing.
- Final emails are sorted by `internalDate` descending.

## Required env vars

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
