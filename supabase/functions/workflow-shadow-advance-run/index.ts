import {
  asRecord,
  extractJwtRole,
  getBearerToken,
  resolveUserIdFromJwt,
} from '../_shared/workflowShadowAdvancementCore.ts'
import { advanceWorkflowRunShadow } from '../_shared/workflowShadowAdvancementEngine.ts'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, message: 'Method not allowed' })

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { ok: false, message: 'Service configuration missing' })
  }

  const body = await req.json().catch(() => null)
  const payload = asRecord(body)
  const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : ''
  const completedRunStepId =
    typeof payload?.completedRunStepId === 'string' && payload.completedRunStepId.trim().length > 0
      ? payload.completedRunStepId.trim()
      : null

  if (!runId) return jsonResponse(400, { ok: false, message: 'runId is required' })

  const token = getBearerToken(req)
  const jwtRole = extractJwtRole(token)
  let userId = await resolveUserIdFromJwt(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  if (!userId && jwtRole === 'service_role') {
    const bodyUserId = typeof payload?.userId === 'string' ? payload.userId.trim() : ''
    if (bodyUserId) userId = bodyUserId
  }

  if (!userId) return jsonResponse(401, { ok: false, message: 'Unauthorized' })

  const result = await advanceWorkflowRunShadow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    runId,
    completedRunStepId,
    initiatedBy: 'manual',
  })

  const status = result.ok ? 200 : 500
  return jsonResponse(status, {
    ...result,
    shadow_mode: true,
    requestedByUserId: userId,
  })
})
