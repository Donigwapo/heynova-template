# gmail-oauth-start

Starts Google OAuth authorization code flow for Gmail send access.

## Request

`POST /functions/v1/gmail-oauth-start`

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

## Scopes

- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/userinfo.email`
- `openid`

## Required env vars

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_GMAIL_OAUTH_REDIRECT_URI` (or fallback `GOOGLE_OAUTH_REDIRECT_URI`)

## Deploy

```bash
supabase functions deploy gmail-oauth-start
```
