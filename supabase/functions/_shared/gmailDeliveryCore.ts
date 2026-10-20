const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

type JsonRecord = Record<string, unknown>

export type GmailConnection = {
  id: string
  user_id: string
  connected_email: string | null
  access_token_enc: string | null
  refresh_token_enc: string | null
  expires_at: string | null
  status: string | null
  scope?: string | null
}

export type RefreshGoogleTokenSuccess = {
  ok: true
  status: number
  data: {
    accessToken: string
    refreshToken: string | null
    expiresIn: number
  }
  payload: JsonRecord | null
  error: null
}

export type RefreshGoogleTokenFailure = {
  ok: false
  status: number
  data: null
  payload: JsonRecord | null
  error: string
}

export type RefreshGoogleTokenResult =
  | RefreshGoogleTokenSuccess
  | RefreshGoogleTokenFailure

export type GmailSendResult = {
  ok: boolean
  status: number
  payload: JsonRecord | null
  text: string
  unreachable?: boolean
}

export type MimeInput = {
  fromEmail: string
  to: string
  subject: string
  text: string
  html?: string | null
  encodeNonAsciiSubject?: boolean
  deriveTextFromHtmlIfMissing?: boolean
}

export type PersistTokensParams = {
  connectionId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
}

export type TokenResolutionParams = {
  connection: GmailConnection
  allowRefresh: boolean
  tokenEncryptionKey: string
  googleClientId: string
  googleClientSecret: string
  supabaseUrl: string
  serviceRoleKey: string
}

export type TokenResolutionResult =
  | {
      ok: true
      accessToken: string
      refreshToken: string | null
      expiresAt: string | null
      refreshed: boolean
      persisted: boolean
    }
  | {
      ok: false
      code:
        | 'google_reauth_required'
        | 'token_refresh_failed'
        | 'token_persist_failed'
        | 'token_decrypt_failed'
      message: string
      providerStatus?: number
      details?: JsonRecord
    }

export type SendWith401RetryParams = {
  accessToken: string
  refreshToken: string | null
  connectionId: string
  connectionExpiresAt: string | null
  rawBase64Url: string
  retryOn401?: boolean
  googleClientId: string
  googleClientSecret: string
  supabaseUrl: string
  serviceRoleKey: string
  tokenEncryptionKey: string
}

export type SendWith401RetryResult = {
  send: GmailSendResult
  retriedAfter401: boolean
  refreshAttempted: boolean
  refreshResult: RefreshGoogleTokenResult | null
  finalAccessToken: string
  finalRefreshToken: string | null
  tokenUpdated: boolean
  tokenPersisted: boolean
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function nowIso() {
  return new Date().toISOString()
}

function addSecondsIso(base: string, seconds: number) {
  const t = new Date(base).getTime()
  return new Date(t + seconds * 1000).toISOString()
}

async function parseJsonSafely(response: Response) {
  const text = await response.text()
  let payload: JsonRecord | null = null
  try {
    payload = text ? (JSON.parse(text) as JsonRecord) : null
  } catch {
    payload = null
  }
  return { text, payload }
}

async function restSelect(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  })

  const { payload } = await parseJsonSafely(response)
  return { ok: response.ok, status: response.status, payload }
}

async function restPatch(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  patch: unknown,
  prefer = 'return=representation'
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(patch),
  })

  const { payload } = await parseJsonSafely(response)
  return { ok: response.ok, status: response.status, payload }
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function getAesKey(tokenEncryptionKey: string) {
  const raw = hexToBytes(tokenEncryptionKey)
  if (!raw || raw.length !== 32) return null
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
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

export function isTokenExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return true
  const timestamp = new Date(expiresAt).getTime()
  if (Number.isNaN(timestamp)) return true
  return timestamp <= Date.now() + 60_000
}

export function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export function encodeSubjectRfc2047IfNeeded(subject: string) {
  if (!containsNonAscii(subject)) return subject
  const utf8 = new TextEncoder().encode(subject)
  const b64 = bytesToBase64(utf8)
  return `=?UTF-8?B?${b64}?=`
}

export function stripHtmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildMimeMessage(input: MimeInput) {
  const fromHeader = `Heynova <${sanitizeHeaderValue(input.fromEmail)}>`
  const toHeader = sanitizeHeaderValue(input.to)
  const subjectRaw = sanitizeHeaderValue(input.subject)
  const subjectHeader = input.encodeNonAsciiSubject ? encodeSubjectRfc2047IfNeeded(subjectRaw) : subjectRaw
  const replyTo = sanitizeHeaderValue(input.fromEmail)
  const html = input.html || null

  if (html) {
    const boundary = `----heynova_boundary_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    const textFallback =
      input.deriveTextFromHtmlIfMissing && !input.text?.trim()
        ? stripHtmlToText(html)
        : input.text

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
      html,
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

export function encodeBase64Url(input: string) {
  const bytes = new TextEncoder().encode(input)
  const b64 = bytesToBase64(bytes)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function decryptToken(encoded: string | null, tokenEncryptionKey: string) {
  if (!encoded) return null
  if (encoded.startsWith('plain:')) return encoded.slice(6)
  if (!encoded.startsWith('enc:')) return null

  const b64 = encoded.slice(4)
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const iv = bytes.slice(0, 12)
  const payload = bytes.slice(12)

  const key = await getAesKey(tokenEncryptionKey)
  if (!key) return null

  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload)
  return new TextDecoder().decode(plainBuffer)
}

export async function encryptToken(plainText: string, tokenEncryptionKey: string) {
  const key = await getAesKey(tokenEncryptionKey)
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

export async function loadGmailConnection(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string
): Promise<{ ok: boolean; status: number; connection: GmailConnection | null; payload?: unknown }> {
  const query =
    `integration_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&provider=eq.gmail&status=eq.connected` +
    '&select=id,user_id,connected_email,access_token_enc,refresh_token_enc,scope,expires_at,status&limit=1'

  const selected = await restSelect(supabaseUrl, serviceRoleKey, query)

  const payload = selected.payload
  const first = Array.isArray(payload) ? asRecord(payload[0]) : null

  return {
    ok: selected.ok,
    status: selected.status,
    connection: first ? (first as unknown as GmailConnection) : null,
    payload,
  }
}

export async function refreshGoogleToken(
  refreshToken: string,
  googleClientId: string,
  googleClientSecret: string
): Promise<RefreshGoogleTokenResult> {
  const form = new URLSearchParams()
  form.set('client_id', googleClientId)
  form.set('client_secret', googleClientSecret)
  form.set('refresh_token', refreshToken)
  form.set('grant_type', 'refresh_token')

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })

  const { payload } = await parseJsonSafely(response)

  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : null
  const expiresIn = Number(payload?.expires_in || 0)
  const rotatedRefreshToken = typeof payload?.refresh_token === 'string' ? payload.refresh_token : null
  const providerError =
    (typeof payload?.error_description === 'string' && payload.error_description) ||
    (typeof payload?.error === 'string' && payload.error) ||
    'token_refresh_failed'

  if (!response.ok || !accessToken) {
    return {
      ok: false,
      status: response.status,
      data: null,
      payload,
      error: providerError,
    }
  }

  return {
    ok: true,
    status: response.status,
    payload,
    error: null,
    data: {
      accessToken,
      refreshToken: rotatedRefreshToken,
      expiresIn,
    },
  }
}

export async function persistConnectionTokens(
  supabaseUrl: string,
  serviceRoleKey: string,
  tokenEncryptionKey: string,
  params: PersistTokensParams
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const accessTokenEnc = await encryptToken(params.accessToken, tokenEncryptionKey)
  const refreshTokenEnc = params.refreshToken ? await encryptToken(params.refreshToken, tokenEncryptionKey) : null

  const patchResult = await restPatch(
    supabaseUrl,
    serviceRoleKey,
    `integration_connections?id=eq.${encodeURIComponent(params.connectionId)}`,
    {
      access_token_enc: accessTokenEnc,
      ...(refreshTokenEnc ? { refresh_token_enc: refreshTokenEnc } : {}),
      expires_at: params.expiresAt,
      updated_at: nowIso(),
    }
  )

  return {
    ok: patchResult.ok,
    status: patchResult.status,
    payload: patchResult.payload,
  }
}

export async function resolveUsableAccessToken(
  params: TokenResolutionParams
): Promise<TokenResolutionResult> {
  let accessToken: string | null = null
  let refreshToken: string | null = null

  try {
    accessToken = await decryptToken(params.connection.access_token_enc || null, params.tokenEncryptionKey)
    refreshToken = await decryptToken(params.connection.refresh_token_enc || null, params.tokenEncryptionKey)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: 'token_decrypt_failed',
      message: 'Unable to decrypt Gmail token(s).',
      details: { error: message },
    }
  }

  const needsRefresh = !accessToken || isTokenExpired(params.connection.expires_at)
  if (params.allowRefresh && needsRefresh) {
    if (!refreshToken) {
      return {
        ok: false,
        code: 'google_reauth_required',
        message: 'Refresh token missing.',
      }
    }

    const refresh = await refreshGoogleToken(refreshToken, params.googleClientId, params.googleClientSecret)
    if (!refresh.ok || !refresh.data) {
      return {
        ok: false,
        code: 'token_refresh_failed',
        message: 'Unable to refresh Gmail token.',
        providerStatus: refresh.status,
        details: {
          provider_error: refresh.error,
        },
      }
    }

    accessToken = refresh.data.accessToken
    refreshToken = refresh.data.refreshToken || refreshToken

    const expiresAt = refresh.data.expiresIn
      ? addSecondsIso(nowIso(), refresh.data.expiresIn)
      : params.connection.expires_at || null

    const persisted = await persistConnectionTokens(
      params.supabaseUrl,
      params.serviceRoleKey,
      params.tokenEncryptionKey,
      {
        connectionId: params.connection.id,
        accessToken,
        refreshToken,
        expiresAt,
      }
    )

    if (!persisted.ok) {
      return {
        ok: false,
        code: 'token_persist_failed',
        message: 'Token refresh succeeded but persist failed.',
        providerStatus: persisted.status,
      }
    }

    return {
      ok: true,
      accessToken,
      refreshToken,
      expiresAt,
      refreshed: true,
      persisted: true,
    }
  }

  if (!accessToken) {
    return {
      ok: false,
      code: 'google_reauth_required',
      message: 'No usable access token.',
    }
  }

  return {
    ok: true,
    accessToken,
    refreshToken,
    expiresAt: params.connection.expires_at || null,
    refreshed: false,
    persisted: false,
  }
}

export async function sendViaGmail(
  accessToken: string,
  rawBase64Url: string
): Promise<GmailSendResult> {
  try {
    const response = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawBase64Url }),
    })

    const { text, payload } = await parseJsonSafely(response)

    return {
      ok: response.ok,
      status: response.status,
      payload,
      text,
      unreachable: false,
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

export async function sendViaGmailWith401Retry(
  params: SendWith401RetryParams
): Promise<SendWith401RetryResult> {
  let accessToken = params.accessToken
  let refreshToken = params.refreshToken
  let tokenUpdated = false
  let tokenPersisted = false

  const firstSend = await sendViaGmail(accessToken, params.rawBase64Url)

  if (!params.retryOn401 || firstSend.ok || firstSend.status !== 401) {
    return {
      send: firstSend,
      retriedAfter401: false,
      refreshAttempted: false,
      refreshResult: null,
      finalAccessToken: accessToken,
      finalRefreshToken: refreshToken,
      tokenUpdated,
      tokenPersisted,
    }
  }

  if (!refreshToken) {
    return {
      send: firstSend,
      retriedAfter401: false,
      refreshAttempted: false,
      refreshResult: null,
      finalAccessToken: accessToken,
      finalRefreshToken: refreshToken,
      tokenUpdated,
      tokenPersisted,
    }
  }

  const refresh = await refreshGoogleToken(refreshToken, params.googleClientId, params.googleClientSecret)
  if (!refresh.ok || !refresh.data) {
    return {
      send: firstSend,
      retriedAfter401: false,
      refreshAttempted: true,
      refreshResult: refresh,
      finalAccessToken: accessToken,
      finalRefreshToken: refreshToken,
      tokenUpdated,
      tokenPersisted,
    }
  }

  accessToken = refresh.data.accessToken
  refreshToken = refresh.data.refreshToken || refreshToken
  tokenUpdated = true

  const retryExpiresAt = refresh.data.expiresIn
    ? addSecondsIso(nowIso(), refresh.data.expiresIn)
    : params.connectionExpiresAt || null

  const persisted = await persistConnectionTokens(
    params.supabaseUrl,
    params.serviceRoleKey,
    params.tokenEncryptionKey,
    {
      connectionId: params.connectionId,
      accessToken,
      refreshToken,
      expiresAt: retryExpiresAt,
    }
  )

  tokenPersisted = persisted.ok

  const secondSend = await sendViaGmail(accessToken, params.rawBase64Url)

  return {
    send: secondSend,
    retriedAfter401: true,
    refreshAttempted: true,
    refreshResult: refresh,
    finalAccessToken: accessToken,
    finalRefreshToken: refreshToken,
    tokenUpdated,
    tokenPersisted,
  }
}
