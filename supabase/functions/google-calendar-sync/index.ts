// Supabase Edge Function: google-calendar-sync
// Pulls Google Calendar events for authenticated user's stored integration connection
// and upserts them into meetings table.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY') || ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

const GOOGLE_EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

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

function errorResponse(status: number, code: string, message: string, details?: JsonMap) {
  return jsonResponse(
    {
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

async function getAuthenticatedUser(accessToken: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    console.error('[google-calendar-sync] auth user resolution failed', {
      status: response.status,
      text: text.slice(0, 300),
    })
    return null
  }

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

async function restUpsert(path: string, payload: unknown) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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

  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

async function encryptSecret(plainText: string) {
  const key = await getAesKey()
  if (!key) {
    // fallback for local/dev if encryption key is not configured yet
    return `plain:${plainText}`
  }

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plainText)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  const combined = new Uint8Array(iv.length + cipher.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(cipher), iv.length)

  const b64 = btoa(String.fromCharCode(...combined))
  return `enc:${b64}`
}

async function decryptSecret(encoded: string | null) {
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

function normalizeMeetingDate(event: Record<string, unknown>) {
  const start = (event.start || {}) as { dateTime?: string; date?: string }
  const end = (event.end || {}) as { dateTime?: string; date?: string }

  const meetingDate = start.dateTime || (start.date ? `${start.date}T00:00:00.000Z` : null)
  const endsAt = end.dateTime || (end.date ? `${end.date}T00:00:00.000Z` : null)

  return { meetingDate, endsAt }
}

function buildParticipants(event: Record<string, unknown>) {
  const attendees = Array.isArray(event.attendees) ? event.attendees : []
  return attendees
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const email = typeof row.email === 'string' ? row.email : null
      return email
    })
    .filter(Boolean)
}

function isTokenExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return true
  const ts = new Date(expiresAt).getTime()
  if (Number.isNaN(ts)) return true
  // refresh slightly early to avoid edge timing failures
  return ts <= Date.now() + 60_000
}

async function refreshGoogleAccessToken(refreshToken: string) {
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
    scope?: string
    token_type?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !payload.access_token) {
    return {
      ok: false,
      error: payload?.error_description || payload?.error || 'token_refresh_failed',
      status: response.status,
      payload,
      data: null,
    }
  }

  return {
    ok: true,
    error: null,
    status: response.status,
    payload,
    data: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      expiresIn: Number(payload.expires_in || 0),
      scope: payload.scope || null,
    },
  }
}

Deno.serve(async (req) => {
  try {
    console.log('[google-calendar-sync] Function start', {
      requestReceived: true,
      method: req.method,
      hasAuthorizationHeader: Boolean(req.headers.get('Authorization')),
    })

    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
    if (req.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Only POST is supported.')
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[google-calendar-sync] Missing server env vars', {
        hasSupabaseUrl: Boolean(SUPABASE_URL),
        hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      })
      return errorResponse(500, 'server_not_configured', 'Supabase server environment is not configured.')
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error('[google-calendar-sync] Missing Google OAuth env vars for refresh', {
        hasGoogleClientId: Boolean(GOOGLE_CLIENT_ID),
        hasGoogleClientSecret: Boolean(GOOGLE_CLIENT_SECRET),
      })
      return errorResponse(500, 'google_not_configured', 'Google OAuth env vars are missing.')
    }

    const accessToken = getBearerToken(req)
    if (!accessToken) {
      console.error('[google-calendar-sync] Missing bearer token in request')
      return errorResponse(401, 'unauthorized', 'Missing access token.')
    }

    const user = await getAuthenticatedUser(accessToken)
    console.log('[google-calendar-sync] Auth/user resolution', {
      userResolved: Boolean(user?.id),
      userId: user?.id || null,
    })

    if (!user?.id) {
      return errorResponse(401, 'unauthorized', 'Unable to authenticate user.')
    }

    let body: {
      calendarId?: string
      windowDaysPast?: number
      windowDaysFuture?: number
      maxResults?: number
    } = {}

    try {
      body = (await req.json()) as typeof body
    } catch {
      body = {}
    }

    const calendarId = typeof body.calendarId === 'string' && body.calendarId.trim() ? body.calendarId : 'primary'
    const windowDaysPast = Number.isFinite(body.windowDaysPast) ? Number(body.windowDaysPast) : 14
    const windowDaysFuture = Number.isFinite(body.windowDaysFuture) ? Number(body.windowDaysFuture) : 90
    const maxResults = Number.isFinite(body.maxResults) ? Number(body.maxResults) : 250

    const connSelect = await restSelect(
      `integration_connections?user_id=eq.${encodeURIComponent(
        user.id
      )}&provider=eq.google_calendar&status=eq.connected&select=id,access_token_enc,refresh_token_enc,connected_email,scope,expires_at,last_synced_at,status&limit=1`
    )

    const connection = Array.isArray(connSelect.json) ? connSelect.json[0] : null

    console.log('[google-calendar-sync] integration_connections lookup', {
      foundConnection: Boolean(connection),
      connectedEmail: connection?.connected_email || null,
      status: connection?.status || null,
      hasAccessToken: Boolean(connection?.access_token_enc),
      hasRefreshToken: Boolean(connection?.refresh_token_enc),
      expiresAt: connection?.expires_at || null,
      selectOk: connSelect.ok,
      selectStatus: connSelect.status,
    })

    if (!connSelect.ok || !connection) {
      return errorResponse(404, 'connection_not_found', 'Google Calendar is not connected.', {
        selectStatus: connSelect.status,
      })
    }

    let providerToken = await decryptSecret(connection.access_token_enc || null)
    const refreshTokenPlain = await decryptSecret(connection.refresh_token_enc || null)
    const tokenExpired = isTokenExpired(connection.expires_at || null)

    console.log('[google-calendar-sync] Token state', {
      tokenExpired,
      hasAccessToken: Boolean(providerToken),
      hasRefreshToken: Boolean(refreshTokenPlain),
      expiresAt: connection.expires_at || null,
    })

    if (!providerToken || tokenExpired) {
      console.log('[google-calendar-sync] Refresh decision', {
        refreshAttempted: true,
        reason: !providerToken ? 'missing_access_token' : 'access_token_expired',
      })

      if (!refreshTokenPlain) {
        console.error('[google-calendar-sync] Refresh token missing; reauth required')
        return errorResponse(401, 'google_reauth_required', 'Google reauthorization required (missing refresh token).')
      }

      const refreshResult = await refreshGoogleAccessToken(refreshTokenPlain)

      if (!refreshResult.ok || !refreshResult.data) {
        console.error('[google-calendar-sync] Token refresh failed', {
          status: refreshResult.status,
          error: refreshResult.error,
          payload: refreshResult.payload,
        })

        return errorResponse(401, 'token_refresh_failed', 'Google token refresh failed. Reauthorization may be required.', {
          providerStatus: refreshResult.status,
          providerError: refreshResult.error,
          providerPayload: (refreshResult.payload as JsonMap) || null,
        })
      }

      const newAccessToken = refreshResult.data.accessToken
      const nextRefreshToken = refreshResult.data.refreshToken || refreshTokenPlain
      const nextExpiresAt = refreshResult.data.expiresIn
        ? new Date(Date.now() + refreshResult.data.expiresIn * 1000).toISOString()
        : connection.expires_at || null

      const accessTokenEnc = await encryptSecret(newAccessToken)
      const refreshTokenEnc = nextRefreshToken ? await encryptSecret(nextRefreshToken) : null

      const refreshPatch = await restPatch(`integration_connections?id=eq.${connection.id}`, {
        access_token_enc: accessTokenEnc,
        refresh_token_enc: refreshTokenEnc,
        expires_at: nextExpiresAt,
        updated_at: new Date().toISOString(),
      })

      console.log('[google-calendar-sync] Refresh persistence result', {
        refreshSucceeded: refreshPatch.ok,
        patchStatus: refreshPatch.status,
        patchPayload: refreshPatch.json,
        nextExpiresAt,
      })

      if (!refreshPatch.ok) {
        return errorResponse(500, 'token_refresh_persist_failed', 'Token refreshed but failed to persist updated token state.', {
          patchStatus: refreshPatch.status,
          patchPayload: (refreshPatch.json as JsonMap) || null,
        })
      }

      providerToken = newAccessToken

      console.log('[google-calendar-sync] Token refresh completed', {
        refreshSucceeded: true,
      })
    }

    const now = new Date()
    const timeMin = new Date(now.getTime() - windowDaysPast * 86400000).toISOString()
    const timeMax = new Date(now.getTime() + windowDaysFuture * 86400000).toISOString()

    const eventsUrl = new URL(`${GOOGLE_EVENTS_BASE}/${encodeURIComponent(calendarId)}/events`)
    eventsUrl.searchParams.set('singleEvents', 'true')
    eventsUrl.searchParams.set('orderBy', 'startTime')
    eventsUrl.searchParams.set('timeMin', timeMin)
    eventsUrl.searchParams.set('timeMax', timeMax)
    eventsUrl.searchParams.set('maxResults', String(Math.min(2500, Math.max(1, maxResults))))

    console.log('[google-calendar-sync] Google Calendar request', {
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    })

    console.log('[google-calendar-sync] Events fetch attempted', {
      attemptedAfterRefresh: true,
      calendarId,
    })

    const eventsResponse = await fetch(eventsUrl.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    })

    if (!eventsResponse.ok) {
      const text = await eventsResponse.text()
      console.error('[google-calendar-sync] Google events fetch failed', {
        status: eventsResponse.status,
        body: text.slice(0, 500),
      })
      return errorResponse(
        502,
        'google_events_fetch_failed',
        `Google Calendar events fetch failed (${eventsResponse.status}).`,
        {
          providerStatus: eventsResponse.status,
          providerBodyPreview: text.slice(0, 180),
        }
      )
    }

    const eventsJson = (await eventsResponse.json()) as {
      items?: Array<Record<string, unknown>>
    }

    const events = Array.isArray(eventsJson.items) ? eventsJson.items : []

    console.log('[google-calendar-sync] Google response', {
      eventCount: events.length,
      sampleEvents: events.slice(0, 2).map((e) => ({
        id: typeof e.id === 'string' ? e.id : null,
        title: typeof e.summary === 'string' ? e.summary : null,
      })),
    })

    const rows = events
      .map((event) => {
        const eventId = typeof event.id === 'string' ? event.id : null
        const title = typeof event.summary === 'string' ? event.summary : 'Untitled Event'
        const description = typeof event.description === 'string' ? event.description : null
        const organizerEmail =
          event.organizer && typeof event.organizer === 'object'
            ? (event.organizer as { email?: string }).email || null
            : null

        const { meetingDate, endsAt } = normalizeMeetingDate(event)
        const participants = buildParticipants(event)

        if (!eventId || !meetingDate) return null

        return {
          user_id: user.id,
          integration_source: 'google_calendar',
          external_event_id: eventId,
          title,
          meeting_date: meetingDate,
          ends_at: endsAt,
          notes: description,
          organizer_email: organizerEmail,
          participants,
          raw_provider_payload: event,
          status: typeof event.status === 'string' ? event.status : null,
          provider_html_link: typeof event.htmlLink === 'string' ? event.htmlLink : null,
          updated_at: new Date().toISOString(),
        }
      })
      .filter(Boolean)

    console.log('[google-calendar-sync] Transform/upsert step', {
      transformedCount: rows.length,
      firstRowPreview: rows[0]
        ? {
            user_id: rows[0].user_id,
            integration_source: rows[0].integration_source,
            external_event_id: rows[0].external_event_id,
            title: rows[0].title,
            meeting_date: rows[0].meeting_date,
            ends_at: rows[0].ends_at,
            organizer_email: rows[0].organizer_email,
            participants_count: Array.isArray(rows[0].participants) ? rows[0].participants.length : 0,
            status: rows[0].status,
          }
        : null,
    })

    let upsertMeta: JsonMap = { skipped: true }

    if (rows.length > 0) {
      const upsert = await restUpsert(
        'meetings?on_conflict=user_id,integration_source,external_event_id',
        rows
      )

      upsertMeta = {
        success: upsert.ok,
        status: upsert.status,
        rowsAffected:
          Array.isArray(upsert.json) ? upsert.json.length : null,
        errorPayload: upsert.ok ? null : upsert.json,
      }

      console.log('[google-calendar-sync] Upsert result', upsertMeta)

      if (!upsert.ok) {
        return errorResponse(500, 'meeting_upsert_failed', 'Unable to upsert meetings from Google events.', {
          status: upsert.status,
          payload: (upsert.json as JsonMap) || null,
        })
      }
    } else {
      console.log('[google-calendar-sync] Upsert skipped (no transformed rows)')
    }

    const patchResult = await restPatch(`integration_connections?id=eq.${connection.id}`, {
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    console.log('[google-calendar-sync] Completion', {
      lastSyncedUpdateSucceeded: patchResult.ok,
      patchStatus: patchResult.status,
      patchPayload: patchResult.json,
      finalSuccess: true,
    })

    return jsonResponse({
      ok: true,
      source: 'google_calendar',
      syncedCount: rows.length,
      calendarId,
      timeWindow: {
        timeMin,
        timeMax,
      },
      upsert: upsertMeta,
      lastSyncedUpdateSucceeded: patchResult.ok,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[google-calendar-sync] Unhandled error', {
      message,
      stack: error instanceof Error ? error.stack : null,
    })

    return errorResponse(500, 'internal_error', 'Unhandled sync error.', {
      message,
    })
  }
})
