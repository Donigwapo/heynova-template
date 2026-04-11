# gmail-oauth-callback

Handles Gmail OAuth callback, validates state, exchanges code for tokens, stores encrypted tokens in `integration_connections`, and redirects to `/integrations?gmail=connected`.

## Endpoint

`GET /functions/v1/gmail-oauth-callback?code=...&state=...`

## Behavior

1. Validate `state` using `integration_oauth_states` (`provider = gmail`, `status = pending`).
2. Exchange auth code for Google tokens.
3. Fetch account email from Google userinfo endpoint.
4. Upsert `integration_connections` with `provider = 'gmail'`.
5. Mark oauth state row as `used`.
6. Redirect to app success or error route.

## Required env vars

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_GMAIL_OAUTH_REDIRECT_URI` (or fallback `GOOGLE_OAUTH_REDIRECT_URI`)
- `PUBLIC_APP_URL`
- `TOKEN_ENCRYPTION_KEY`

## Deploy

```bash
supabase functions deploy gmail-oauth-callback
```
