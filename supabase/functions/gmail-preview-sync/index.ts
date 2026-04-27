// Supabase Edge Function: gmail-preview-sync
// Preview-only Gmail fetch for recent message metadata.
// No DB email storage, no attachment parsing, no inbox sync.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY') || ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_MESSAGES_LIST_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
const GMAIL_MESSAGE_GET_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'

type JsonMap = Record<string, unknown>
type GmailConnectionRow = {
  id: string
  user_id: string
  connected_email: string | null
  access_token_enc: string | null
  refresh_token_enc: string | null
  expires_at: string | null
  status: string | null
}

type GmailMessageMetadata = {
  id?: string
  threadId?: string
  snippet?: string
  internalDate?: string
  labelIds?: string[]
  payload?: {
    headers?: Array<{ name?: string; value?: string }>
  }
}

type PreviewEmail = {
  id: string
  threadId: string | null
  fromEmail: string | null
  fromName: string | null
  subject: string | null
  snippet: string | null
  internalDate: string | null
  labelIds: string[]
  isUnread: boolean
}

function jsonResponse(body: JsonMap, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

function errorResponse(
  status: number,
  code:
    | 'validation_failed'
    | 'unauthorized'
    | 'gmail_not_connected'
    | 'token_refresh_failed'
    | 'google_reauth_required'
    | 'provider_error'
    | 'provider_unreachable'
    | 'internal_error',
  message: string,
  details?: JsonMap
) {
  return jsonResponse(
    {
      ok: false,
      status: 'failed',
      source: 'gmail',
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status
  )
}

function getBearerToken(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

async function resolveUserFromJwt(req: Request) {
  const token = getBearerToken(req)
  if (!token) return null

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  })

  if (!response.ok) return null
  return (await response.json()) as { id: string; email?: string }
}

async function restSelect(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  })

  let json: unknown = null
  try {
    json = await response.json()
  } catch {
    json = null
  }

  return { ok: response.ok, status: response.status, json }
}

async function restPatch(path: string, payload: unknown) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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
    json = await response.json()
  } catch {
    json = null
  }

  return { ok: response.ok, status: response.status, json }
}

async function loadGmailConnection(userId: string) {
  const select = await restSelect(
    `integration_connections?user_id=eq.${encodeURIComponent(
      userId
    )}&provider=eq.gmail&status=eq.connected&select=id,user_id,connected_email,access_token_enc,refresh_token_enc,expires_at,status&limit=1`
  )

  const row = Array.isArray(select.json) ? (select.json[0] as GmailConnectionRow | undefined) : undefined

  return {
    ok: select.ok,
    status: select.status,
    connection: row || null,
    payload: select.json,
  }
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
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function decryptToken(encoded: string | null) {
  if (!encoded) return null
  if (encoded.startsWith('plain:')) return encoded.slice(6)
  if (!encoded.startsWith('enc:')) return null

  const b64 = encoded.slice(4)
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const iv = bytes.slice(0, 12)
  const payload = bytes.slice(12)

  const key = await getAesKey()
  if (!key) return null

  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload)
  return new TextDecoder().decode(plainBuffer)
}

async function encryptToken(plainText: string) {
  const key = await getAesKey()
  if (!key) return `plain:${plainText}`

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plainText)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  const combined = new Uint8Array(iv.length + cipher.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(cipher), iv.length)

  const b64 = btoa(String.fromCharCode(...combined))
  return `enc:${b64}`
}

function isTokenExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return true
  const ts = new Date(expiresAt).getTime()
  if (Number.isNaN(ts)) return true
  return ts <= Date.now() + 60_000
}

async function refreshGoogleToken(refreshToken: string) {
  const form = new URLSearchParams()
  form.set('client_id', GOOGLE_CLIENT_ID)
  form.set('client_secret', GOOGLE_CLIENT_SECRET)
  form.set('refresh_token', refreshToken)
  form.set('grant_type', 'refresh_token')

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })

  const payload = (await response.json()) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !payload.access_token) {
    return {
      ok: false,
      status: response.status,
      error: payload?.error_description || payload?.error || 'token_refresh_failed',
      payload,
      data: null,
    }
  }

  return {
    ok: true,
    status: response.status,
    error: null,
    payload,
    data: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      expiresIn: Number(payload.expires_in || 0),
    },
  }
}

async function persistTokens(params: {
  connectionId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
}) {
  const accessTokenEnc = await encryptToken(params.accessToken)
  const refreshTokenEnc = params.refreshToken ? await encryptToken(params.refreshToken) : null

  return await restPatch(`integration_connections?id=eq.${params.connectionId}`, {
    access_token_enc: accessTokenEnc,
    ...(refreshTokenEnc ? { refresh_token_enc: refreshTokenEnc } : {}),
    expires_at: params.expiresAt,
    updated_at: new Date().toISOString(),
  })
}

async function listRecentMessageIds(accessToken: string, maxResults = 20) {
  const url = new URL(GMAIL_MESSAGES_LIST_URL)
  url.searchParams.set('maxResults', String(Math.max(1, Math.min(100, maxResults))))

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const text = await response.text()
  let payload: Record<string, unknown> | null = null
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      payload,
      text,
      ids: [] as string[],
    }
  }

  const messagesRaw = Array.isArray(payload?.messages) ? payload.messages : []
  const ids = messagesRaw
    .map((item) => (item && typeof item === 'object' ? (item as { id?: string }).id || null : null))
    .filter((id): id is string => Boolean(id))

  return {
    ok: true,
    status: response.status,
    payload,
    text,
    ids,
  }
}

async function fetchMessageMetadata(accessToken: string, messageId: string) {
  const url = new URL(`${GMAIL_MESSAGE_GET_BASE}/${encodeURIComponent(messageId)}`)
  url.searchParams.set('format', 'metadata')
  url.searchParams.append('metadataHeaders', 'From')
  url.searchParams.append('metadataHeaders', 'Subject')

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const text = await response.text()
  let payload: GmailMessageMetadata | null = null
  try {
    payload = text ? (JSON.parse(text) as GmailMessageMetadata) : null
  } catch {
    payload = null
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    text,
    messageId,
  }
}

function parseFromHeader(rawFrom: string | null): { fromName: string | null; fromEmail: string | null } {
  if (!rawFrom) {
    return { fromName: null, fromEmail: null }
  }

  const trimmed = rawFrom.trim()

  // Prefer RFC-like angle extraction: Name <email@domain.com>
  const angleEmail = trimmed.match(/<\s*([^<>@\s]+@[^<>@\s]+)\s*>/)
  if (angleEmail) {
    const emailRaw = angleEmail[1]?.trim() || ''
    const nameRaw = trimmed
      .replace(/<\s*[^<>@\s]+@[^<>@\s]+\s*>/, '')
      .trim()
      .replace(/^"|"$/g, '')

    return {
      fromName: nameRaw || null,
      fromEmail: emailRaw || null,
    }
  }

  // Fallback: find first email token anywhere in string.
  const embeddedEmail = trimmed.match(/([^\s<>()]+@[^\s<>()]+\.[^\s<>()]+)/)
  if (embeddedEmail) {
    const emailRaw = embeddedEmail[1]?.trim() || ''
    const nameRaw = trimmed
      .replace(emailRaw, '')
      .replace(/[<>]/g, '')
      .trim()
      .replace(/^"|"$/g, '')

    return {
      fromName: nameRaw || null,
      fromEmail: emailRaw || null,
    }
  }

  // "email@domain.com" only
  const emailOnly = trimmed.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  if (emailOnly) {
    return {
      fromName: null,
      fromEmail: trimmed,
    }
  }

  return {
    fromName: trimmed || null,
    fromEmail: null,
  }
}

function findHeaderValue(headers: Array<{ name?: string; value?: string }> | undefined, key: string) {
  if (!Array.isArray(headers)) return null
  const wanted = key.trim().toLowerCase()

  const match = headers.find(
    (h) => typeof h?.name === 'string' && h.name.trim().toLowerCase() === wanted
  )

  return typeof match?.value === 'string' ? match.value : null
}

function toIsoFromInternalDate(value: string | undefined) {
  if (!value) return null
  const millis = Number(value)
  if (!Number.isFinite(millis)) return null
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function parsePreviewEmail(message: GmailMessageMetadata): PreviewEmail | null {
  const id = typeof message.id === 'string' ? message.id : null
  if (!id) return null

  const threadId = typeof message.threadId === 'string' ? message.threadId : null
  const snippet = typeof message.snippet === 'string' ? message.snippet : null
  const labelIds = Array.isArray(message.labelIds)
    ? message.labelIds.filter((label): label is string => typeof label === 'string')
    : []

  const headers = message.payload?.headers
  const fromRaw = findHeaderValue(headers, 'From')
  const subjectRaw = findHeaderValue(headers, 'Subject')
  const { fromName, fromEmail } = parseFromHeader(fromRaw)
  const internalDate = toIsoFromInternalDate(message.internalDate)

  const normalized = {
    id,
    threadId,
    fromEmail,
    fromName,
    subject: subjectRaw || null,
    snippet,
    internalDate,
    labelIds,
    isUnread: labelIds.includes('UNREAD'),
  }

  return normalized
}

function sortByNewestInternalDate(a: PreviewEmail, b: PreviewEmail) {
  const aTs = a.internalDate ? new Date(a.internalDate).getTime() : 0
  const bTs = b.internalDate ? new Date(b.internalDate).getTime() : 0
  return bTs - aTs
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') {
    return errorResponse(405, 'validation_failed', 'Only POST is supported.')
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return errorResponse(500, 'internal_error', 'Server environment is not configured.')
    }

    const user = await resolveUserFromJwt(req)
    if (!user?.id) {
      return errorResponse(401, 'unauthorized', 'Missing or invalid authorization.')
    }

    const connectionLookup = await loadGmailConnection(user.id)
    const connection = connectionLookup.connection
    if (!connectionLookup.ok || !connection) {
      return errorResponse(404, 'gmail_not_connected', 'Gmail is not connected for this user.')
    }

    let accessToken = await decryptToken(connection.access_token_enc || null)
    let refreshToken = await decryptToken(connection.refresh_token_enc || null)

    if (!accessToken || isTokenExpired(connection.expires_at)) {
      if (!refreshToken) {
        return errorResponse(401, 'google_reauth_required', 'Refresh token is missing. Reconnect Gmail.')
      }

      const refresh = await refreshGoogleToken(refreshToken)
      if (!refresh.ok || !refresh.data) {
        return errorResponse(401, 'token_refresh_failed', 'Unable to refresh Gmail access token.', {
          providerStatus: refresh.status,
          providerError: refresh.error,
        })
      }

      accessToken = refresh.data.accessToken
      refreshToken = refresh.data.refreshToken || refreshToken
      const expiresAt = refresh.data.expiresIn
        ? new Date(Date.now() + refresh.data.expiresIn * 1000).toISOString()
        : connection.expires_at || null

      const persist = await persistTokens({
        connectionId: connection.id,
        accessToken,
        refreshToken,
        expiresAt,
      })

      if (!persist.ok) {
        return errorResponse(500, 'internal_error', 'Token refresh succeeded but persistence failed.')
      }
    }

    if (!accessToken) {
      return errorResponse(401, 'google_reauth_required', 'No usable Gmail access token found.')
    }

    const listed = await listRecentMessageIds(accessToken, 20)

    if (!listed.ok) {
      return errorResponse(502, 'provider_error', 'Unable to list Gmail messages.', {
        providerStatus: listed.status,
      })
    }

    const requestedCount = listed.ids.length

    const metadataResults = await Promise.allSettled(
      listed.ids.map((id) => fetchMessageMetadata(accessToken as string, id))
    )

    const emails: PreviewEmail[] = []

    let sampleLogged = false

    for (const result of metadataResults) {
      if (result.status !== 'fulfilled') {
        continue
      }

      const fetched = result.value
      if (!fetched.ok || !fetched.payload) {
        // skip failed message fetch, continue batch
        continue
      }

      const parsed = parsePreviewEmail(fetched.payload)
      if (!parsed) continue

      if (!sampleLogged) {
        const headers = fetched.payload?.payload?.headers || []
        const fromRaw = findHeaderValue(headers, 'From')
        const subjectRaw = findHeaderValue(headers, 'Subject')

        console.log('[gmail-preview-sync] sample header parse', {
          messageId: parsed.id,
          rawHeaders: headers,
          parsedFromRaw: fromRaw,
          parsedSubjectRaw: subjectRaw,
          normalizedPreview: parsed,
        })

        sampleLogged = true
      }

      emails.push(parsed)
    }

    emails.sort(sortByNewestInternalDate)

    return jsonResponse({
      ok: true,
      status: 'success',
      source: 'gmail',
      emails,
      count: emails.length,
      requestedCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    console.error('[gmail-preview-sync] internal error', {
      error: message,
    })

    return errorResponse(500, 'internal_error', 'Unhandled preview sync error.')
  }
})
