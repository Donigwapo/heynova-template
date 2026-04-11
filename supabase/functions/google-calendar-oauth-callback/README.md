# google-calendar-oauth-callback

Handles Google OAuth callback, validates state, exchanges code for tokens, stores connection server-side, then redirects back to `/integrations`.

## Endpoint

`GET /functions/v1/google-calendar-oauth-callback?code=...&state=...`

## Behavior

1. Validates `state` against `integration_oauth_states`.
2. Exchanges authorization code for tokens.
3. Fetches Google account email.
4. Stores provider tokens in `integration_connections` (encrypted or prefixed fallback in dev).
5. Marks oauth state as used.
6. Redirects to app (`/integrations?gcal=connected` or `?gcal=error&reason=...`).

## Required env vars (Supabase secrets)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `PUBLIC_APP_URL` (example: `https://app.heynova.com`)
- `TOKEN_ENCRYPTION_KEY` (64-char hex / 32-byte AES key)

## Local serve

```bash
supabase functions serve google-calendar-oauth-callback --env-file .env.local
```

## Deploy

```bash
supabase functions deploy google-calendar-oauth-callback
```
