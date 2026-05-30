// Supabase Edge Function: workflow-outbox-execute-email
// Executes one claimed outbox email row and finalizes status.

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

type OutboxRow = {
  id: string
  user_id: string
  workflow_id: string
  workflow_step_id: string
  campaign_id: string
  campaign_lead_id: string
  channel: string
  status: string
  attempt_count: number | null
  payload: Record<string, unknown> | null
}

type StepRow = {
  id: string
  step_type: string | null
  subject: string | null
  body: string | null
}

type LeadRow = {
  id: string
  email: string | null
  full_name: string | null
}

type WorkflowRow = {
  id: string
  status: string | null
  campaign_id: string | null
}

type GmailConnectionRow = {
  id: string
  user_id: string
  connected_email: string | null
  access_token_enc: string | null
  refresh_token_enc: string | null
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

function errorResponse(status: number, code: string, message: string, details?: JsonMap) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status
  )
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

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function buildMimeMessage(input: {
  fromEmail: string
  to: string
  subject: string
  text: string
}) {
  const fromHeader = `Heynova <${sanitizeHeaderValue(input.fromEmail)}>`
  const toHeader = sanitizeHeaderValue(input.to)
  const subjectHeader = sanitizeHeaderValue(input.subject)
  const replyTo = sanitizeHeaderValue(input.fromEmail)

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

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
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

async function loadOutboxRow(outboxId: string) {
  const select = await restSelect(
    `workflow_delivery_outbox?id=eq.${encodeURIComponent(
      outboxId
    )}&select=id,user_id,workflow_id,workflow_step_id,campaign_id,campaign_lead_id,channel,status,attempt_count,payload&limit=1`
  )

  const row = Array.isArray(select.json) ? (select.json[0] as OutboxRow | undefined) : undefined
  return {
    ok: select.ok,
    status: select.status,
    row: row || null,
  }
}

async function loadWorkflowRow(workflowId: string) {
  const select = await restSelect(
    `workflows?id=eq.${encodeURIComponent(workflowId)}&select=id,status,campaign_id&limit=1`
  )
  const row = Array.isArray(select.json) ? (select.json[0] as WorkflowRow | undefined) : undefined
  return row || null
}

async function loadStepRow(stepId: string, userId: string) {
  const select = await restSelect(
    `workflow_steps?id=eq.${encodeURIComponent(
      stepId
    )}&user_id=eq.${encodeURIComponent(userId)}&select=id,step_type,subject,body&limit=1`
  )
  const row = Array.isArray(select.json) ? (select.json[0] as StepRow | undefined) : undefined
  return row || null
}

async function loadLeadRow(leadId: string, userId: string) {
  const select = await restSelect(
    `campaign_leads?id=eq.${encodeURIComponent(
      leadId
    )}&user_id=eq.${encodeURIComponent(userId)}&select=id,email,full_name&limit=1`
  )
  const row = Array.isArray(select.json) ? (select.json[0] as LeadRow | undefined) : undefined
  return row || null
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
  }
}

async function markOutboxSkipped(outboxId: string, errorCode: string, errorMessage: string) {
  return await restPatch(`workflow_delivery_outbox?id=eq.${outboxId}`, {
    status: 'skipped',
    error_code: errorCode,
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  })
}

async function markOutboxFailed(outboxRow: OutboxRow, errorCode: string, errorMessage: string) {
  return await restPatch(`workflow_delivery_outbox?id=eq.${outboxRow.id}`, {
    status: 'failed',
    attempt_count: Number(outboxRow.attempt_count || 0) + 1,
    last_attempt_at: new Date().toISOString(),
    error_code: errorCode,
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  })
}

async function markOutboxSent(outboxRow: OutboxRow, providerMessageId: string | null) {
  return await restPatch(`workflow_delivery_outbox?id=eq.${outboxRow.id}`, {
    status: 'sent',
    sent_at: new Date().toISOString(),
    attempt_count: Number(outboxRow.attempt_count || 0) + 1,
    provider_message_id: providerMessageId,
    error_code: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  })
}

Deno.serve(async (req) => {
  console.log('[workflow-outbox-execute-email] invocation start', {
    timestamp: new Date().toISOString(),
    method: req.method,
    pathname: new URL(req.url).pathname,
  })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Only POST is supported.')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return errorResponse(500, 'server_not_configured', 'Missing required environment variables.')
  }

  try {
    const body = (await req.json()) as { outboxId?: string; runnerId?: string }
    const outboxId = typeof body?.outboxId === 'string' ? body.outboxId : null

    if (!outboxId) return errorResponse(400, 'validation_failed', 'Missing outboxId.')

    const outboxLookup = await loadOutboxRow(outboxId)
    const outbox = outboxLookup.row

    if (!outboxLookup.ok || !outbox) {
      return errorResponse(404, 'outbox_not_found', 'Outbox row not found.', {
        outboxId,
      })
    }

    if (outbox.channel !== 'email') {
      await markOutboxSkipped(outbox.id, 'unsupported_channel', `Unsupported channel: ${outbox.channel}`)
      return errorResponse(409, 'unsupported_channel', 'Outbox channel is not email.', {
        outboxId,
      })
    }

    if (outbox.status !== 'in_progress') {
      return errorResponse(409, 'invalid_status', 'Outbox row must be in in_progress status to execute.', {
        outboxId,
        status: outbox.status,
      })
    }

    const workflow = await loadWorkflowRow(outbox.workflow_id)
    if (!workflow || !workflow.id) {
      await markOutboxSkipped(outbox.id, 'workflow_missing', 'Workflow not found.')
      return errorResponse(404, 'workflow_missing', 'Workflow not found.', { outboxId })
    }

    if (String(workflow.status || '').toLowerCase() !== 'active') {
      await markOutboxSkipped(outbox.id, 'workflow_not_active', 'Workflow is not active.')
      return errorResponse(409, 'workflow_not_active', 'Workflow is not active.', { outboxId })
    }

    const step = await loadStepRow(outbox.workflow_step_id, outbox.user_id)
    if (!step || !step.id) {
      await markOutboxSkipped(outbox.id, 'step_missing', 'Workflow step not found.')
      return errorResponse(404, 'step_missing', 'Workflow step not found.', { outboxId })
    }

    if (String(step.step_type || '').toLowerCase() !== 'email') {
      await markOutboxSkipped(outbox.id, 'step_not_email', 'Workflow step is not email type.')
      return errorResponse(409, 'step_not_email', 'Workflow step is not email type.', { outboxId })
    }

    const lead = await loadLeadRow(outbox.campaign_lead_id, outbox.user_id)
    if (!lead || !lead.id) {
      await markOutboxSkipped(outbox.id, 'lead_missing', 'Campaign lead not found.')
      return errorResponse(404, 'lead_missing', 'Campaign lead not found.', { outboxId })
    }

    const toEmail = String(lead.email || '').trim()
    if (!toEmail) {
      await markOutboxSkipped(outbox.id, 'lead_email_missing', 'Campaign lead email missing.')
      return errorResponse(409, 'lead_email_missing', 'Campaign lead email missing.', { outboxId })
    }

    const subject = String(step.subject || '').trim()
    const text = String(step.body || '').trim()

    if (!subject || !text) {
      await markOutboxSkipped(outbox.id, 'step_content_missing', 'Step subject/body missing.')
      return errorResponse(409, 'step_content_missing', 'Step subject/body missing.', { outboxId })
    }

    const connectionLookup = await loadGmailConnection(outbox.user_id)
    const connection = connectionLookup.connection
    if (!connectionLookup.ok || !connection) {
      await markOutboxFailed(outbox, 'gmail_not_connected', 'Gmail is not connected for user.')
      return errorResponse(404, 'gmail_not_connected', 'Gmail is not connected.', { outboxId })
    }

    let providerToken = await decryptToken(connection.access_token_enc || null)
    let refreshToken = await decryptToken(connection.refresh_token_enc || null)

    const shouldRefresh = !providerToken || isTokenExpired(connection.expires_at)
    if (shouldRefresh) {
      if (!refreshToken) {
        await markOutboxFailed(outbox, 'google_reauth_required', 'Refresh token missing.')
        return errorResponse(401, 'google_reauth_required', 'Refresh token missing.', { outboxId })
      }

      const refresh = await refreshGoogleToken(refreshToken)
      if (!refresh.ok || !refresh.data) {
        await markOutboxFailed(outbox, 'token_refresh_failed', 'Unable to refresh Gmail token.')
        return errorResponse(401, 'token_refresh_failed', 'Unable to refresh Gmail token.', {
          outboxId,
          providerStatus: refresh.status,
        })
      }

      providerToken = refresh.data.accessToken
      refreshToken = refresh.data.refreshToken || refreshToken

      const expiresAt = refresh.data.expiresIn
        ? new Date(Date.now() + refresh.data.expiresIn * 1000).toISOString()
        : connection.expires_at || null

      await persistTokens({
        connectionId: connection.id,
        accessToken: providerToken,
        refreshToken,
        expiresAt,
      })
    }

    if (!providerToken) {
      await markOutboxFailed(outbox, 'google_reauth_required', 'No usable access token.')
      return errorResponse(401, 'google_reauth_required', 'No usable access token.', { outboxId })
    }

    const fromEmail = connection.connected_email || 'no-reply@heynova.app'
    const mime = buildMimeMessage({
      fromEmail,
      to: toEmail,
      subject,
      text,
    })

    const sendResult = await sendViaGmail(providerToken, encodeBase64Url(mime))
    if (!sendResult.ok) {
      const providerError =
        typeof sendResult.payload?.error === 'object' && sendResult.payload?.error !== null
          ? (sendResult.payload.error as Record<string, unknown>)
          : null

      const providerMessage =
        (typeof providerError?.message === 'string' && providerError.message) ||
        `Gmail send failed (${sendResult.status}).`

      await markOutboxFailed(outbox, 'provider_error', providerMessage)

      return errorResponse(502, 'provider_error', providerMessage, {
        outboxId,
        providerStatus: sendResult.status,
      })
    }

    const providerMessageId =
      typeof sendResult.payload?.id === 'string' ? sendResult.payload.id : null

    await markOutboxSent(outbox, providerMessageId)

    console.log('[workflow-outbox-execute-email] send success', {
      outboxId,
      userId: outbox.user_id,
      workflowId: outbox.workflow_id,
      workflowStepId: outbox.workflow_step_id,
      campaignLeadId: outbox.campaign_lead_id,
      providerMessageId,
    })

    return jsonResponse({
      ok: true,
      outboxId,
      status: 'sent',
      providerMessageId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[workflow-outbox-execute-email] internal error', {
      message,
      stack: error instanceof Error ? error.stack || null : null,
    })
    return errorResponse(500, 'internal_error', 'Unhandled execution error.')
  }
})
