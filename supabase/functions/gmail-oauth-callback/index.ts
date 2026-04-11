// Supabase Edge Function: gmail-oauth-callback
// Handles Gmail OAuth callback, stores encrypted tokens, and redirects back to app.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
const GOOGLE_GMAIL_OAUTH_REDIRECT_URI_RAW = Deno.env.get('GOOGLE_GMAIL_OAUTH_REDIRECT_URI') || ''
const GOOGLE_OAUTH_REDIRECT_URI_FALLBACK = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI') || ''
const GOOGLE_GMAIL_OAUTH_REDIRECT_URI =
  GOOGLE_GMAIL_OAUTH_REDIRECT_URI_RAW || GOOGLE_OAUTH_REDIRECT_URI_FALLBACK || ''
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') || 'http://localhost:5173'
const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY') || ''

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

function redirectTo(pathWithQuery: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${PUBLIC_APP_URL}${pathWithQuery}`,
      ...CORS_HEADERS,
    },
  })
}

function getQueryParam(req: Request, key: string) {
  const url = new URL(req.url)
  return url.searchParams.get(key)
}

function parseStateToken(input: string | null): { userId: string; nonce: string } | null {
  if (!input) return null

  try {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64)
    const parsed = JSON.parse(json) as { userId?: string; nonce?: string }
    if (!parsed?.userId || !parsed?.nonce) return null
    return { userId: parsed.userId, nonce: parsed.nonce }
  } catch {
    return null
  }
}

async function restSelect(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  })

  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }

  return { ok: res.ok, status: res.status, json }
}

async function restPatch(path: string, payload: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  })

  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }

  return { ok: res.ok, status: res.status, json }
}

async function restUpsert(path: string, payload: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  })

  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }

  return { ok: res.ok, status: res.status, json }
}

function textEncoder() {
  return new TextEncoder()
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function getAesKey() {
  const raw = hexToBytes(TOKEN_ENCRYPTION_KEY)
  if (!raw || raw.length !== 32) return null

  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
}

async function encryptSecret(plainText: string) {
  const key = await getAesKey()
  if (!key) {
    // dev fallback if key not set yet
    return `plain:${plainText}`
  }

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = textEncoder().encode(plainText)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  const combined = new Uint8Array(iv.length + cipher.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(cipher), iv.length)

  const b64 = btoa(String.fromCharCode(...combined))
  return `enc:${b64}`
}

async function exchangeCodeForTokens(code: string) {
  const body = new URLSearchParams()
  body.set('code', code)
  body.set('client_id', GOOGLE_CLIENT_ID)
  body.set('client_secret', GOOGLE_CLIENT_SECRET)
  body.set('redirect_uri', GOOGLE_GMAIL_OAUTH_REDIRECT_URI)
  body.set('grant_type', 'authorization_code')

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !data.access_token) {
    return {
      ok: false,
      error:
        data?.error_description || data?.error || `Google token exchange failed (${response.status}).`,
      data: null,
    }
  }

  return { ok: true, error: null, data }
}

async function fetchGoogleAccountEmail(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) return null

  const data = (await response.json()) as { email?: string }
  return data?.email || null
}

Deno.serve(async (req) => {
  console.log('[gmail-oauth-callback] Request received', {
    method: req.method,
  })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'GET') return redirectTo('/integrations?gmail=error&reason=method_not_allowed')

  console.log('[gmail-oauth-callback] Redirect URI config', {
    hasGoogleGmailRedirect: Boolean(GOOGLE_GMAIL_OAUTH_REDIRECT_URI_RAW),
    hasFallbackGoogleRedirect: Boolean(GOOGLE_OAUTH_REDIRECT_URI_FALLBACK),
    usesFallbackRedirect: !GOOGLE_GMAIL_OAUTH_REDIRECT_URI_RAW && Boolean(GOOGLE_OAUTH_REDIRECT_URI_FALLBACK),
    redirectUriUsed: GOOGLE_GMAIL_OAUTH_REDIRECT_URI || null,
  })

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_GMAIL_OAUTH_REDIRECT_URI
  ) {
    return redirectTo('/integrations?gmail=error&reason=server_not_configured')
  }

  const stateToken = getQueryParam(req, 'state')
  const code = getQueryParam(req, 'code')
  const oauthError = getQueryParam(req, 'error')

  console.log('[gmail-oauth-callback] Query params presence', {
    hasState: Boolean(stateToken),
    hasCode: Boolean(code),
    hasOAuthError: Boolean(oauthError),
  })

  if (oauthError) {
    return redirectTo(`/integrations?gmail=error&reason=${encodeURIComponent(oauthError)}`)
  }

  const parsedState = parseStateToken(stateToken)
  if (!parsedState || !code || !stateToken) {
    return redirectTo('/integrations?gmail=error&reason=invalid_state_or_code')
  }

  const stateSelect = await restSelect(
    `integration_oauth_states?state_token=eq.${encodeURIComponent(
      stateToken
    )}&provider=eq.gmail&status=eq.pending&select=id,user_id,return_path,created_at,provider,status&limit=1`
  )

  const row = Array.isArray(stateSelect.json) ? stateSelect.json[0] : null

  console.log('[gmail-oauth-callback] State lookup result', {
    providerQueried: 'gmail',
    lookupOk: stateSelect.ok,
    lookupStatus: stateSelect.status,
    foundRow: Boolean(row),
    rowProvider: row?.provider || null,
    rowStatus: row?.status || null,
    rowUserId: row?.user_id || null,
    parsedStateUserId: parsedState?.userId || null,
  })

  if (!stateSelect.ok || !row || row.user_id !== parsedState.userId) {
    return redirectTo('/integrations?gmail=error&reason=state_not_found_or_invalid')
  }

  const tokenExchange = await exchangeCodeForTokens(code)

  console.log('[gmail-oauth-callback] Token exchange result', {
    ok: tokenExchange.ok,
    hasData: Boolean(tokenExchange.data),
    hasAccessToken: Boolean(tokenExchange.data?.access_token),
    hasRefreshToken: Boolean(tokenExchange.data?.refresh_token),
    error: tokenExchange.error || null,
  })

  if (!tokenExchange.ok || !tokenExchange.data) {
    return redirectTo(
      `/integrations?gmail=error&reason=${encodeURIComponent(tokenExchange.error || 'token_exchange_failed')}`
    )
  }

  const accessToken = tokenExchange.data.access_token as string
  const refreshToken = tokenExchange.data.refresh_token || ''
  const scope = tokenExchange.data.scope || ''
  const expiresIn = Number(tokenExchange.data.expires_in || 0)
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null

  const connectedEmail = await fetchGoogleAccountEmail(accessToken)

  console.log('[gmail-oauth-callback] Userinfo fetch result', {
    success: Boolean(connectedEmail),
    connectedEmail: connectedEmail || null,
  })

  const accessTokenEnc = await encryptSecret(accessToken)
  const refreshTokenEnc = refreshToken ? await encryptSecret(refreshToken) : null

  const upsertResult = await restUpsert(
    'integration_connections?on_conflict=user_id,provider',
    [
      {
        user_id: row.user_id,
        provider: 'gmail',
        connected_email: connectedEmail,
        access_token_enc: accessTokenEnc,
        refresh_token_enc: refreshTokenEnc,
        scope,
        expires_at: expiresAt,
        status: 'connected',
        updated_at: new Date().toISOString(),
      },
    ]
  )

  console.log('[gmail-oauth-callback] integration_connections upsert result', {
    ok: upsertResult.ok,
    status: upsertResult.status,
    payload: upsertResult.json,
    provider: 'gmail',
    userId: row.user_id,
  })

  if (!upsertResult.ok) {
    return redirectTo('/integrations?gmail=error&reason=connection_upsert_failed')
  }

  const stateUpdate = await restPatch(`integration_oauth_states?id=eq.${row.id}`, {
    status: 'used',
    used_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  console.log('[gmail-oauth-callback] OAuth state update result', {
    ok: stateUpdate.ok,
    status: stateUpdate.status,
    payload: stateUpdate.json,
    stateId: row.id,
  })

  const returnPath =
    typeof row.return_path === 'string' && row.return_path.startsWith('/')
      ? row.return_path
      : '/integrations'

  return redirectTo(`${returnPath}?gmail=connected`)
})
