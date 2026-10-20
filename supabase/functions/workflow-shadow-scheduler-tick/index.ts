import {
  asArray,
  asRecord,
  extractJwtRole,
  getBearerToken,
  nowIso,
  pathWithSelect,
  resolveUserIdFromJwt,
  restGet,
  restInsert,
  restPatch,
} from '../_shared/workflowShadowAdvancementCore.ts'
import { advanceWorkflowRunShadow } from '../_shared/workflowShadowAdvancementEngine.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

type DueScheduledStep = {
  id: string
  user_id: string
  workflow_run_id: string
  workflow_id: string
  status: string
  scheduled_at: string | null
  completed_at: string | null
  workflow_step_id: string | null
  input_snapshot: Record<string, unknown> | null
}

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
  const workflowIdFilter = typeof payload?.workflowId === 'string' ? payload.workflowId.trim() : ''
  const runIdFilter = typeof payload?.runId === 'string' ? payload.runId.trim() : ''
  const maxCount = Number(payload?.maxCount || 50)

  const token = getBearerToken(req)
  const jwtRole = extractJwtRole(token)
  let userId = await resolveUserIdFromJwt(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  if (!userId && jwtRole === 'service_role') {
    const bodyUserId = typeof payload?.userId === 'string' ? payload.userId.trim() : ''
    if (bodyUserId) userId = bodyUserId
  }

  if (!userId) return jsonResponse(401, { ok: false, message: 'Unauthorized' })

  let path = `workflow_run_steps?user_id=eq.${encodeURIComponent(
    userId
  )}&status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(nowIso())}&order=scheduled_at.asc&limit=${Math.max(
    1,
    Math.min(maxCount, 200)
  )}`

  if (workflowIdFilter) {
    path += `&workflow_id=eq.${encodeURIComponent(workflowIdFilter)}`
  }

  if (runIdFilter) {
    path += `&workflow_run_id=eq.${encodeURIComponent(runIdFilter)}`
  }

  const dueResult = await restGet(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    pathWithSelect(
      path,
      'id,user_id,workflow_run_id,workflow_id,workflow_step_id,status,scheduled_at,completed_at,input_snapshot'
    )
  )

  if (!dueResult.ok) {
    return jsonResponse(500, { ok: false, message: 'Unable to fetch due scheduled run steps' })
  }

  const dueSteps = asArray<DueScheduledStep>(dueResult.data)

  let completedWaitSteps = 0
  let advancedRuns = 0
  const failures: Array<Record<string, unknown>> = []

  async function appendEvent(params: {
    userId: string
    workflowId: string
    runId: string
    runStepId: string
    eventType: string
    idempotencyKey: string
    payload: Record<string, unknown>
  }) {
    const inserted = await restInsert(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      pathWithSelect('workflow_events', 'id'),
      {
        user_id: params.userId,
        workflow_run_id: params.runId,
        workflow_run_step_id: params.runStepId,
        workflow_id: params.workflowId,
        event_type: params.eventType,
        event_source: 'workflow_shadow_scheduler',
        severity: 'info',
        idempotency_key: params.idempotencyKey,
        payload: params.payload,
        occurred_at: nowIso(),
      }
    )

    if (!inserted.ok) {
      const arr = asArray<Record<string, unknown>>(inserted.data)
      const maybe = arr[0] || asRecord(inserted.data) || {}
      const msg = String(maybe?.message || maybe?.error || '')
      if (msg.toLowerCase().includes('duplicate key value')) return true
      return false
    }

    return true
  }

  for (const step of dueSteps) {
    const snapshot = asRecord(step.input_snapshot)
    const stepType = String(snapshot?.step_type || '').toLowerCase()

    if (stepType !== 'wait') {
      continue
    }

    const completePatch = await restPatch(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `workflow_run_steps?id=eq.${encodeURIComponent(step.id)}&status=eq.scheduled`,
      {
        status: 'completed',
        completed_at: nowIso(),
        updated_at: nowIso(),
      },
      'return=representation'
    )

    if (!completePatch.ok) {
      failures.push({ runStepId: step.id, stage: 'complete_wait_step', message: 'patch failed' })
      continue
    }

    const patchedRows = asArray<DueScheduledStep>(completePatch.data)
    if (patchedRows.length === 0) {
      // already processed by another invocation
      continue
    }

    completedWaitSteps += 1

    await appendEvent({
      userId: step.user_id,
      workflowId: step.workflow_id,
      runId: step.workflow_run_id,
      runStepId: step.id,
      eventType: 'step_completed',
      idempotencyKey: `shadow:scheduler:step_completed:${step.id}`,
      payload: {
        shadow_mode: true,
        scheduler_tick: true,
        due_scheduled_at: step.scheduled_at,
      },
    })

    const advance = await advanceWorkflowRunShadow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      runId: step.workflow_run_id,
      completedRunStepId: step.id,
      initiatedBy: 'scheduler',
    })

    if (!advance.ok) {
      failures.push({ runStepId: step.id, runId: step.workflow_run_id, stage: 'advance', message: advance.message })
      continue
    }

    advancedRuns += 1
  }

  console.log('[WorkflowShadow][Scheduler] tick complete', {
    userId,
    dueCount: dueSteps.length,
    completedWaitSteps,
    advancedRuns,
    failures: failures.length,
  })

  return jsonResponse(200, {
    ok: true,
    shadow_mode: true,
    userId,
    dueCount: dueSteps.length,
    completedWaitSteps,
    advancedRuns,
    failures,
  })
})
