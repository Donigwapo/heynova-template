import {
  asArray,
  asRecord,
  extractJwtRole,
  getBearerToken,
  resolveUserIdFromJwt,
} from '../_shared/workflowShadowAdvancementCore.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

async function restRpc(functionName: string, body: unknown) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  return { ok: response.ok, status: response.status, data }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, message: 'Method not allowed' })

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { ok: false, message: 'Service configuration missing' })
  }

  const body = await req.json().catch(() => null)
  const payload = asRecord(body)
  const workflowId = typeof payload?.workflowId === 'string' ? payload.workflowId.trim() : ''

  if (!workflowId) {
    return jsonResponse(400, { ok: false, message: 'workflowId is required' })
  }

  const token = getBearerToken(req)
  const jwtRole = extractJwtRole(token)

  let userId = await resolveUserIdFromJwt(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  if (!userId && jwtRole === 'service_role') {
    const bodyUserId = typeof payload?.userId === 'string' ? payload.userId.trim() : ''
    if (bodyUserId) userId = bodyUserId
  }

  if (!userId) {
    return jsonResponse(401, { ok: false, message: 'Unauthorized' })
  }

  const rpc = await restRpc('ensure_workflow_version', {
    p_user_id: userId,
    p_workflow_id: workflowId,
    p_status: 'published',
  })

  if (!rpc.ok) {
    const rec = asRecord(rpc.data)
    const msg = String(rec?.message || rec?.error || 'Unable to ensure workflow version')

    console.error('[WorkflowShadow][Version] ensure failed', {
      workflowId,
      userId,
      message: msg,
    })

    return jsonResponse(500, { ok: false, message: msg })
  }

  const row = asArray<Record<string, unknown>>(rpc.data)[0] || null

  console.log('[WorkflowShadow][Version] ensured', {
    workflowId,
    userId,
    workflowVersionId: row?.workflow_version_id || null,
    versionNumber: row?.version_number || null,
    reused: row?.reused || false,
  })

  return jsonResponse(200, {
    ok: true,
    workflowId,
    userId,
    workflowVersionId: row?.workflow_version_id || null,
    versionNumber: row?.version_number || null,
    definitionHash: row?.definition_hash || null,
    reused: Boolean(row?.reused),
    stepCount: Number(row?.step_count || 0),
  })
})
