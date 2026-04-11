# google-calendar-sync

Manual sync endpoint for Google Calendar events -> `meetings` table.

## Endpoint

`POST /functions/v1/google-calendar-sync`

Request body:

```json
{
  "calendarId": "primary",
  "windowDaysPast": 14,
  "windowDaysFuture": 90,
  "maxResults": 250
}
```

## Response

```json
{
  "ok": true,
  "source": "google_calendar",
  "syncedCount": 42,
  "calendarId": "primary",
  "timeWindow": {
    "timeMin": "...",
    "timeMax": "..."
  }
}
```

## Required env vars (Supabase secrets)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_KEY`

## Notes

- Requires existing connected row in `integration_connections` for provider `google_calendar`.
- Uses upsert identity: `user_id + integration_source + external_event_id`.
- Uses `meeting_date` as canonical start timestamp.

## Local serve

```bash
supabase functions serve google-calendar-sync --env-file .env.local
```

## Deploy

```bash
supabase functions deploy google-calendar-sync
```
