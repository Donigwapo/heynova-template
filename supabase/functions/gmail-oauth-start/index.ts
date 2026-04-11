// Supabase Edge Function: gmail-oauth-start
// Starts Google OAuth authorization code flow for Gmail send access.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const GOOGLE_GMAIL_OAUTH_REDIRECT_URI_RAW = Deno.env.get('GOOGLE_GMAIL_OAUTH_REDIRECT_URI') || ''
const GOOGLE_OAUTH_REDIRECT_URI_FALLBACK = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI') || ''
const GOOGLE_GMAIL_OAUTH_REDIRECT_URI =
  GOOGLE_GMAIL_OAUTH_REDIRECT_URI_RAW || GOOGLE_OAUTH_REDIRECT_URI_FALLBACK || ''

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_SCOPE = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ')

type JsonMap = Record<string, unknown>

function jsonResponse(body: JsonMap, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: { code, message } }, status)
}

function toBase64Url(input: string) {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function getBearerToken(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

async function getAuthenticatedUser(accessToken: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  })

  if (!response.ok) return null
  return (await response.json()) as { id: string; email?: string }
}

async function persistOAuthState(params: {
  userId: string
  provider: 'gmail'
  stateToken: string
  returnPath: string
}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/integration_oauth_states`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([
      {
        user_id: params.userId,
        provider: params.provider,
        state_token: params.stateToken,
        return_path: params.returnPath,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]),
  })

  return response.ok
}

Deno.serve(async (req) => {
  console.log('[gmail-oauth-start] Request received', {
    method: req.method,
    hasAuthorizationHeader: Boolean(req.headers.get('Authorization')),
  })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Only POST is supported.')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return errorResponse(500, 'server_not_configured', 'Supabase server environment is not configured.')
  }

  console.log('[gmail-oauth-start] Redirect URI config', {
    hasGoogleGmailRedirect: Boolean(GOOGLE_GMAIL_OAUTH_REDIRECT_URI_RAW),
    hasFallbackGoogleRedirect: Boolean(GOOGLE_OAUTH_REDIRECT_URI_FALLBACK),
    usesFallbackRedirect: !GOOGLE_GMAIL_OAUTH_REDIRECT_URI_RAW && Boolean(GOOGLE_OAUTH_REDIRECT_URI_FALLBACK),
    redirectUriUsed: GOOGLE_GMAIL_OAUTH_REDIRECT_URI || null,
  })

  if (!GOOGLE_CLIENT_ID || !GOOGLE_GMAIL_OAUTH_REDIRECT_URI) {
    return errorResponse(500, 'google_not_configured', 'Google OAuth env vars are missing.')
  }

  const token = getBearerToken(req)
  if (!token) return errorResponse(401, 'unauthorized', 'Missing user access token.')

  const user = await getAuthenticatedUser(token)
  if (!user?.id) return errorResponse(401, 'unauthorized', 'Unable to authenticate user.')

  let body: JsonMap = {}
  try {
    body = (await req.json()) as JsonMap
  } catch {
    body = {}
  }

  const returnPath =
    typeof body.returnPath === 'string' && body.returnPath.startsWith('/')
      ? body.returnPath
      : '/integrations'

  const statePayload = {
    userId: user.id,
    nonce: crypto.randomUUID(),
    provider: 'gmail',
    issuedAt: Date.now(),
  }

  const stateToken = toBase64Url(JSON.stringify(statePayload))

  const saved = await persistOAuthState({
    userId: user.id,
    provider: 'gmail',
    stateToken,
    returnPath,
  })

  console.log('[gmail-oauth-start] OAuth state persist result', {
    userId: user.id,
    provider: 'gmail',
    saved,
    returnPath,
  })

  if (!saved) {
    return errorResponse(500, 'state_persist_failed', 'Unable to persist OAuth state.')
  }

  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', GOOGLE_GMAIL_OAUTH_REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('scope', GOOGLE_SCOPE)
  url.searchParams.set('state', stateToken)
  url.searchParams.set('include_granted_scopes', 'true')

  const authUrl = url.toString()

  console.log('[gmail-oauth-start] Final auth URL generated', {
    provider: 'gmail',
    redirectUriUsed: GOOGLE_GMAIL_OAUTH_REDIRECT_URI,
    authUrl,
  })

  return jsonResponse({ authUrl })
})
