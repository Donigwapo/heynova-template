# google-calendar-oauth-start

Starts Google Calendar OAuth authorization code flow (server-side) for authenticated users.

## Request

`POST /functions/v1/google-calendar-oauth-start`

Body (optional):

```json
{
  "returnPath": "/integrations"
}
```

## Response

```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

## Required env vars (Supabase secrets)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_OAUTH_REDIRECT_URI` (should point to callback function URL)

## Local serve

```bash
supabase functions serve google-calendar-oauth-start --env-file .env.local
```

## Deploy

```bash
supabase functions deploy google-calendar-oauth-start
```
