// Supabase Edge Function: gmail-send
// Sends outbound email through the authenticated user's connected Gmail account.

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
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

type JsonMap = Record<string, unknown>
type StringMap = Record<string, string>

type ValidatedPayload = {
  to: string
  subject: string
  text: string
  html: string | null
}

type GmailConnectionRow = {
  id: string
  user_id: string
  connected_email: string | null
  access_token_enc: string | null
  refresh_token_enc: string | null
  scope: string | null
  expires_at: string | null
  status: string | null
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

function errorResult(
  code:
    | 'validation_failed'
    | 'unauthorized'
    | 'gmail_not_connected'
    | 'token_refresh_failed'
    | 'google_reauth_required'
    | 'mime_build_failed'
    | 'provider_error'
    | 'provider_unreachable'
    | 'internal_error',
  message: string,
  details?: JsonMap
) {
  return {
    ok: false,
    status: 'failed',
    source: 'gmail',
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  } as const
}

function successResult(providerMessageId: string | null) {
  return {
    ok: true,
    status: 'sent',
    source: 'gmail',
    providerMessageId,
    threadId: null,
    message: 'Email sent successfully.',
  } as const
}

function getBearerToken(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeString(
  input: unknown,
  field: string,
  errors: StringMap,
  options: { required?: boolean; maxLength?: number; email?: boolean } = {}
): string | null {
  if (input === undefined || input === null) {
    if (options.required) errors[field] = 'Field is required.'
    return null
  }

  if (typeof input !== 'string') {
    errors[field] = 'Must be a string.'
    return null
  }

  const value = input.trim()
  if (!value) {
    if (options.required) errors[field] = 'Field is required.'
    return null
  }

  if (options.maxLength && value.length > options.maxLength) {
    errors[field] = `Must be ${options.maxLength} characters or fewer.`
    return null
  }

  if (options.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(value)) {
      errors[field] = 'Must be a valid email address.'
      return null
    }
  }

  return value
}

function deriveSubject(payload: Record<string, unknown>) {
  const meeting = asRecord(payload.meeting)
  const contact = asRecord(payload.contact)

  const meetingTitle =
    typeof meeting?.title === 'string' && meeting.title.trim() ? meeting.title.trim() : null
  const contactName =
    typeof contact?.name === 'string' && contact.name.trim() ? contact.name.trim() : null

  if (meetingTitle && contactName) return `Follow-up: ${meetingTitle} (${contactName})`
  if (meetingTitle) return `Follow-up: ${meetingTitle}`
  return 'Follow-up'
}

function deriveTo(payload: Record<string, unknown>) {
  const contact = asRecord(payload.contact)
  if (typeof payload.to === 'string' && payload.to.trim()) return payload.to.trim()
  if (typeof contact?.email === 'string' && contact.email.trim()) return contact.email.trim()
  return null
}

function deriveText(payload: Record<string, unknown>) {
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text.trim()
  if (typeof payload.draftText === 'string' && payload.draftText.trim()) return payload.draftText.trim()
  return null
}

function deriveHtml(payload: Record<string, unknown>) {
  if (typeof payload.html === 'string' && payload.html.trim()) return payload.html.trim()
  return null
}

function validateRequest(payload: unknown): { data: ValidatedPayload | null; error: ReturnType<typeof errorResult> | null } {
  const body = asRecord(payload)
  if (!body) {
    return {
      data: null,
      error: errorResult('validation_failed', 'Request body must be a JSON object.'),
    }
  }

  const errors: StringMap = {}

  const to = normalizeString(deriveTo(body), 'to', errors, {
    required: true,
    email: true,
    maxLength: 254,
  })

  const subject = normalizeString(
    typeof body.subject === 'string' && body.subject.trim() ? body.subject : deriveSubject(body),
    'subject',
    errors,
    { required: true, maxLength: 255 }
  )

  const html = deriveHtml(body)
  const text = normalizeString(deriveText(body), 'text', errors, {
    required: !html,
    maxLength: 20000,
  })

  if (html) {
    normalizeString(html, 'html', errors, { maxLength: 120000 })
  }

  if (Object.keys(errors).length > 0) {
    return {
      data: null,
      error: errorResult('validation_failed', 'Payload validation failed.', { errors }),
    }
  }

  return {
    data: {
      to: to as string,
      subject: subject as string,
      text: (text || '') as string,
      html: html || null,
    },
    error: null,
  }
}

async function resolveUserFromJwt(req: Request) {
  const accessToken = getBearerToken(req)
  if (!accessToken) return null

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
    )}&provider=eq.gmail&status=eq.connected&select=id,user_id,connected_email,access_token_enc,refresh_token_enc,scope,expires_at,status&limit=1`
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
  const timestamp = new Date(expiresAt).getTime()
  if (Number.isNaN(timestamp)) return true
  return timestamp <= Date.now() + 60_000
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
      error: payload.error_description || payload.error || 'token_refresh_failed',
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

function containsNonAscii(value: string) {
  return /[^\x00-\x7F]/.test(value)
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function encodeSubject(subject: string) {
  if (!containsNonAscii(subject)) return subject
  const utf8 = new TextEncoder().encode(subject)
  const b64 = bytesToBase64(utf8)
  return `=?UTF-8?B?${b64}?=`
}

function stripHtmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function buildMimeMessage(input: {
  fromEmail: string
  to: string
  subject: string
  text: string
  html: string | null
}) {
  const fromHeader = `Heynova <${sanitizeHeaderValue(input.fromEmail)}>`
  const toHeader = sanitizeHeaderValue(input.to)
  const subjectHeader = encodeSubject(sanitizeHeaderValue(input.subject))
  const replyTo = sanitizeHeaderValue(input.fromEmail)

  if (input.html) {
    const boundary = `----heynova_boundary_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    const textFallback = input.text?.trim() || stripHtmlToText(input.html)

    return [
      `From: ${fromHeader}`,
      `To: ${toHeader}`,
      `Subject: ${subjectHeader}`,
      `Reply-To: ${replyTo}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      textFallback,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.html,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n')
  }

  return [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    `Subject: ${subjectHeader}`,
    `Reply-To: ${replyTo}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    input.text,
    '',
  ].join('\r\n')
}

function encodeBase64Url(input: string) {
  const bytes = new TextEncoder().encode(input)
  const b64 = bytesToBase64(bytes)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sendViaGmail(accessToken: string, rawBase64Url: string) {
  try {
    const response = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawBase64Url }),
    })

    const text = await response.text()
    let payload: Record<string, unknown> | null = null
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : null
    } catch {
      payload = null
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
      text,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      text: error instanceof Error ? error.message : String(error),
      unreachable: true,
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse(errorResult('internal_error', 'Only POST is supported.'), 405)
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return jsonResponse(errorResult('internal_error', 'Server environment is not configured.'), 500)
    }

    let payloadRaw: unknown
    try {
      payloadRaw = await req.json()
    } catch {
      return jsonResponse(errorResult('validation_failed', 'Request body must be valid JSON.'), 400)
    }

    const validated = validateRequest(payloadRaw)
    if (validated.error || !validated.data) {
      return jsonResponse(validated.error as JsonMap, 400)
    }

    const user = await resolveUserFromJwt(req)
    if (!user?.id) {
      return jsonResponse(errorResult('unauthorized', 'Missing or invalid authorization.'), 401)
    }

    const connectionLookup = await loadGmailConnection(user.id)
    const connection = connectionLookup.connection
    if (!connectionLookup.ok || !connection) {
      return jsonResponse(errorResult('gmail_not_connected', 'Gmail is not connected for this user.'), 404)
    }

    let providerToken = await decryptToken(connection.access_token_enc || null)
    let refreshToken = await decryptToken(connection.refresh_token_enc || null)

    const needsRefresh = !providerToken || isTokenExpired(connection.expires_at)

    if (needsRefresh) {
      if (!refreshToken) {
        return jsonResponse(errorResult('google_reauth_required', 'Refresh token is missing. Reconnect Gmail.'), 401)
      }

      const refresh = await refreshGoogleToken(refreshToken)
      if (!refresh.ok || !refresh.data) {
        console.error('[gmail-send] token refresh failed', {
          user_id: user.id,
          provider: 'gmail',
          status: refresh.status,
          error: refresh.error,
          payload: refresh.payload,
        })
        return jsonResponse(
          errorResult('token_refresh_failed', 'Unable to refresh Gmail access token.', {
            providerStatus: refresh.status,
            providerError: refresh.error,
          }),
          401
        )
      }

      providerToken = refresh.data.accessToken
      refreshToken = refresh.data.refreshToken || refreshToken

      const expiresAt = refresh.data.expiresIn
        ? new Date(Date.now() + refresh.data.expiresIn * 1000).toISOString()
        : connection.expires_at || null

      const persist = await persistTokens({
        connectionId: connection.id,
        accessToken: providerToken,
        refreshToken,
        expiresAt,
      })

      if (!persist.ok) {
        return jsonResponse(
          errorResult('internal_error', 'Token refresh succeeded but failed to persist token state.'),
          500
        )
      }
    }

    if (!providerToken) {
      return jsonResponse(errorResult('google_reauth_required', 'No usable Gmail access token found.'), 401)
    }

    let mimeMessage: string
    try {
      const fromEmail = connection.connected_email || user.email || 'no-reply@heynova.app'
      mimeMessage = buildMimeMessage({
        fromEmail,
        to: validated.data.to,
        subject: validated.data.subject,
        text: validated.data.text,
        html: validated.data.html,
      })
    } catch {
      return jsonResponse(errorResult('mime_build_failed', 'Unable to construct MIME message.'), 500)
    }

    const raw = encodeBase64Url(mimeMessage)

    let sendResult = await sendViaGmail(providerToken, raw)

    // Retry once on 401 after forced refresh.
    if (!sendResult.ok && sendResult.status === 401) {
      if (!refreshToken) {
        return jsonResponse(
          errorResult('google_reauth_required', 'Gmail authorization expired. Reconnect Gmail.'),
          401
        )
      }

      const refreshRetry = await refreshGoogleToken(refreshToken)
      if (!refreshRetry.ok || !refreshRetry.data) {
        console.error('[gmail-send] retry refresh failed', {
          user_id: user.id,
          provider: 'gmail',
          status: refreshRetry.status,
          error: refreshRetry.error,
          payload: refreshRetry.payload,
        })
        return jsonResponse(
          errorResult('token_refresh_failed', 'Unable to refresh Gmail access token for retry.'),
          401
        )
      }

      providerToken = refreshRetry.data.accessToken
      refreshToken = refreshRetry.data.refreshToken || refreshToken

      const retryExpiresAt = refreshRetry.data.expiresIn
        ? new Date(Date.now() + refreshRetry.data.expiresIn * 1000).toISOString()
        : null

      await persistTokens({
        connectionId: connection.id,
        accessToken: providerToken,
        refreshToken,
        expiresAt: retryExpiresAt,
      })

      sendResult = await sendViaGmail(providerToken, raw)
    }

    if (!sendResult.ok) {
      if ((sendResult as { unreachable?: boolean }).unreachable) {
        return jsonResponse(errorResult('provider_unreachable', 'Gmail API is unreachable right now.'), 502)
      }

      const providerError =
        typeof sendResult.payload?.error === 'object' && sendResult.payload?.error !== null
          ? (sendResult.payload.error as Record<string, unknown>)
          : null

      const providerMessage =
        (typeof providerError?.message === 'string' && providerError.message) ||
        `Gmail send failed (${sendResult.status}).`

      console.error('[gmail-send] provider error', {
        user_id: user.id,
        provider: 'gmail',
        to: validated.data.to,
        status: sendResult.status,
        error_code: providerError?.status || 'provider_error',
      })

      return jsonResponse(
        errorResult('provider_error', providerMessage, {
          providerStatus: sendResult.status,
        }),
        502
      )
    }

    const providerMessageId =
      (typeof sendResult.payload?.id === 'string' && sendResult.payload.id) || null

    console.log('[gmail-send] send result', {
      user_id: user.id,
      provider: 'gmail',
      to: validated.data.to,
      status: 'sent',
      error_code: null,
    })

    return jsonResponse(successResult(providerMessageId), 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    console.error('[gmail-send] internal error', {
      provider: 'gmail',
      status: 'failed',
      error_code: 'internal_error',
      message,
    })

    return jsonResponse(errorResult('internal_error', 'Unhandled send error.'), 500)
  }
})
