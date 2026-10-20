const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

type JsonRecord = Record<string, unknown>

type OutboxRow = {
  id: string
  user_id: string
  workflow_id: string
  workflow_step_id: string
  campaign_id: string | null
  campaign_lead_id: string
  status: string | null
  idempotency_key: string | null
  channel: string | null
  created_at: string | null
  payload: JsonRecord | null
}

type JobRow = {
  id: string
  user_id: string
  workflow_run_id: string | null
  workflow_run_step_id: string | null
  workflow_id: string
  campaign_id: string | null
  campaign_lead_id: string | null
  job_type: string
  queue_name: string
  status: string
  idempotency_key: string | null
  external_ref_type: string | null
  external_ref_id: string | null
  created_at: string | null
}

type RunRow = {
  id: string
  user_id: string
  campaign_lead_id: string | null
}

type RunStepRow = {
  id: string
  user_id: string
  workflow_run_id: string
  workflow_step_id: string | null
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

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

function decodeJwtPayload(token: string | null) {
  if (!token) return null

  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const base64Url = parts[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return asRecord(JSON.parse(atob(padded)))
  } catch {
    return null
  }
}

function extractJwtRole(token: string | null) {
  const payload = decodeJwtPayload(token)
  const role = payload?.role
  return typeof role === 'string' ? role : null
}

async function resolveUserIdFromJwt(req: Request) {
  const token = getBearerToken(req)
  if (!token || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    })

    if (!response.ok) return null
    const user = await response.json()
    return user?.id || null
  } catch {
    return null
  }
}

function querySep(path: string) {
  return path.includes('?') ? '&' : '?'
}

function pathWithSelect(path: string, select: string) {
  return `${path}${querySep(path)}select=${encodeURIComponent(select)}`
}

async function restGet(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  return { ok: response.ok, status: response.status, data }
}

async function fetchWorkflowSummary(workflowId: string, userId: string) {
  const result = await restGet(
    pathWithSelect(
      `workflows?id=eq.${encodeURIComponent(workflowId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      'id,user_id,campaign_id'
    )
  )
  if (!result.ok) return null
  return asArray<JsonRecord>(result.data)[0] || null
}

async function fetchCurrentFirstEmailStep(workflowId: string, userId: string) {
  const result = await restGet(
    pathWithSelect(
      `workflow_steps?workflow_id=eq.${encodeURIComponent(workflowId)}&user_id=eq.${encodeURIComponent(
        userId
      )}&step_type=eq.email&order=step_order.asc&limit=1`,
      'id,step_order'
    )
  )
  if (!result.ok) return { stepId: null as string | null }
  const row = asArray<JsonRecord>(result.data)[0] || null
  return { stepId: typeof row?.id === 'string' ? row.id : null }
}

function mapLegacyToShadowExpectedStatuses(legacyStatus: string | null | undefined) {
  const normalized = String(legacyStatus || '').toLowerCase()
  if (normalized === 'queued') return ['queued', 'scheduled']
  if (normalized === 'in_progress') return ['running', 'claimed']
  if (normalized === 'sent') return ['succeeded']
  if (normalized === 'failed') return ['dead_letter', 'retry_scheduled']
  if (normalized === 'skipped') return ['succeeded']
  return ['scheduled', 'queued']
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
  const campaignIdInput = typeof payload?.campaignId === 'string' ? payload.campaignId.trim() : null
  const includeHistorical = Boolean(payload?.includeHistorical)

  if (!workflowId) return jsonResponse(400, { ok: false, message: 'workflowId is required' })

  const token = getBearerToken(req)
  const jwtRole = extractJwtRole(token)
  let userId = await resolveUserIdFromJwt(req)

  if (!userId && jwtRole === 'service_role') {
    const bodyUserId = typeof payload?.userId === 'string' ? payload.userId.trim() : ''
    if (bodyUserId) userId = bodyUserId
  }

  if (!userId) return jsonResponse(401, { ok: false, message: 'Unauthorized' })

  const workflow = await fetchWorkflowSummary(workflowId, userId)
  if (!workflow) return jsonResponse(404, { ok: false, message: 'Workflow not found' })

  const campaignId = campaignIdInput || (typeof workflow.campaign_id === 'string' ? workflow.campaign_id : null)

  const firstStep = await fetchCurrentFirstEmailStep(workflowId, userId)
  if (!firstStep.stepId) {
    return jsonResponse(200, {
      ok: true,
      mode: 'shadow_reconciliation',
      workflowId,
      campaignId,
      userId,
      message: 'No current first email step found. Nothing to reconcile for current-step scope.',
      summary: {
        relevantLegacyOutboxCount: 0,
        shadowJobCountInScope: 0,
        matchedByExternalRefCount: 0,
        missingShadowCount: 0,
        missingLegacyCount: 0,
        mismatchCount: 0,
        duplicateCount: 0,
      },
      rows: [],
    })
  }

  let legacyPath = `workflow_delivery_outbox?user_id=eq.${encodeURIComponent(
    userId
  )}&workflow_id=eq.${encodeURIComponent(workflowId)}&workflow_step_id=eq.${encodeURIComponent(
    firstStep.stepId
  )}&channel=eq.email&order=created_at.asc&limit=5000`
  if (campaignId) legacyPath += `&campaign_id=eq.${encodeURIComponent(campaignId)}`

  const legacyResult = await restGet(
    pathWithSelect(
      legacyPath,
      'id,user_id,workflow_id,workflow_step_id,campaign_id,campaign_lead_id,status,idempotency_key,channel,created_at,payload'
    )
  )

  if (!legacyResult.ok) {
    return jsonResponse(500, { ok: false, message: 'Unable to load legacy outbox rows' })
  }

  const legacyRows = asArray<OutboxRow>(legacyResult.data)
  const legacyById = new Map(legacyRows.map((row) => [row.id, row]))

  let jobsPath = `workflow_jobs?user_id=eq.${encodeURIComponent(userId)}&workflow_id=eq.${encodeURIComponent(
    workflowId
  )}&job_type=eq.send_email&queue_name=eq.email&order=created_at.asc&limit=5000`
  if (campaignId) jobsPath += `&campaign_id=eq.${encodeURIComponent(campaignId)}`

  const jobsResult = await restGet(
    pathWithSelect(
      jobsPath,
      'id,user_id,workflow_run_id,workflow_run_step_id,workflow_id,campaign_id,campaign_lead_id,job_type,queue_name,status,idempotency_key,external_ref_type,external_ref_id,created_at'
    )
  )

  if (!jobsResult.ok) {
    return jsonResponse(500, { ok: false, message: 'Unable to load shadow jobs' })
  }

  const allJobs = asArray<JobRow>(jobsResult.data)
  const candidateJobs = allJobs.filter((job) => job.external_ref_type === 'workflow_delivery_outbox')

  const runStepIds = [...new Set(candidateJobs.map((job) => job.workflow_run_step_id).filter(Boolean) as string[])]
  const runIds = [...new Set(candidateJobs.map((job) => job.workflow_run_id).filter(Boolean) as string[])]

  let runSteps: RunStepRow[] = []
  if (runStepIds.length > 0) {
    const stepRes = await restGet(
      pathWithSelect(
        `workflow_run_steps?id=in.(${runStepIds.map((id) => encodeURIComponent(id)).join(',')})&limit=5000`,
        'id,user_id,workflow_run_id,workflow_step_id'
      )
    )
    if (stepRes.ok) runSteps = asArray<RunStepRow>(stepRes.data)
  }

  let runs: RunRow[] = []
  if (runIds.length > 0) {
    const runRes = await restGet(
      pathWithSelect(`workflow_runs?id=in.(${runIds.map((id) => encodeURIComponent(id)).join(',')})&limit=5000`, 'id,user_id,campaign_lead_id')
    )
    if (runRes.ok) runs = asArray<RunRow>(runRes.data)
  }

  const runStepById = new Map(runSteps.map((row) => [row.id, row]))
  const runById = new Map(runs.map((row) => [row.id, row]))

  const jobsByExternalRef = new Map<string, JobRow[]>()
  for (const job of candidateJobs) {
    const refId = job.external_ref_id || ''
    if (!refId) continue
    const list = jobsByExternalRef.get(refId) || []
    list.push(job)
    jobsByExternalRef.set(refId, list)
  }

  let matchedByExternalRefCount = 0
  let missingShadowCount = 0
  let mismatchCount = 0
  let duplicateCount = 0

  const rows: Array<Record<string, unknown>> = []

  for (const legacy of legacyRows) {
    const linked = jobsByExternalRef.get(legacy.id) || []

    if (linked.length === 0) {
      missingShadowCount += 1
      rows.push({
        campaign_lead_id: legacy.campaign_lead_id,
        legacy_outbox_id: legacy.id,
        shadow_run_id: null,
        shadow_run_step_id: null,
        shadow_job_id: null,
        workflow_step_id: legacy.workflow_step_id,
        legacy_status: legacy.status,
        shadow_status: null,
        correlation_status: 'missing_shadow',
      })
      continue
    }

    if (linked.length > 1) duplicateCount += 1

    const chosen = linked[0]
    matchedByExternalRefCount += 1

    const runStep = chosen.workflow_run_step_id ? runStepById.get(chosen.workflow_run_step_id) || null : null
    const run = chosen.workflow_run_id ? runById.get(chosen.workflow_run_id) || null : null

    const mismatches: string[] = []
    if (chosen.user_id !== legacy.user_id) mismatches.push('user_id')
    if (chosen.workflow_id !== legacy.workflow_id) mismatches.push('workflow_id')
    if ((chosen.campaign_lead_id || null) !== (legacy.campaign_lead_id || null)) mismatches.push('campaign_lead_id')
    if (chosen.job_type !== 'send_email') mismatches.push('job_type')
    if (chosen.idempotency_key !== legacy.idempotency_key) mismatches.push('idempotency_key')
    if ((runStep?.workflow_step_id || null) !== (legacy.workflow_step_id || null)) mismatches.push('workflow_step_id')
    if ((run?.campaign_lead_id || null) !== (legacy.campaign_lead_id || null)) mismatches.push('run.campaign_lead_id')

    const expectedStatuses = mapLegacyToShadowExpectedStatuses(legacy.status)
    if (!expectedStatuses.includes(chosen.status)) mismatches.push('status_mapping')

    const correlationStatus = mismatches.length > 0 ? (linked.length > 1 ? 'duplicate' : 'mismatch') : linked.length > 1 ? 'duplicate' : 'matched'

    if (mismatches.length > 0) mismatchCount += 1

    rows.push({
      campaign_lead_id: legacy.campaign_lead_id,
      legacy_outbox_id: legacy.id,
      shadow_run_id: chosen.workflow_run_id,
      shadow_run_step_id: chosen.workflow_run_step_id,
      shadow_job_id: chosen.id,
      workflow_step_id: legacy.workflow_step_id,
      legacy_status: legacy.status,
      shadow_status: chosen.status,
      correlation_status: correlationStatus,
      mismatches,
      expected_shadow_statuses: expectedStatuses,
    })
  }

  const legacyIds = new Set(legacyRows.map((row) => row.id))
  const shadowWithoutLegacy = candidateJobs.filter((job) => {
    const refId = job.external_ref_id || ''
    return !refId || !legacyIds.has(refId)
  })

  const missingLegacyCount = shadowWithoutLegacy.length

  for (const job of shadowWithoutLegacy) {
    rows.push({
      campaign_lead_id: job.campaign_lead_id,
      legacy_outbox_id: null,
      shadow_run_id: job.workflow_run_id,
      shadow_run_step_id: job.workflow_run_step_id,
      shadow_job_id: job.id,
      workflow_step_id: null,
      legacy_status: null,
      shadow_status: job.status,
      correlation_status: 'missing_legacy',
      mismatches: ['missing_legacy_ref'],
      expected_shadow_statuses: null,
    })
  }

  let historical: JsonRecord | null = null
  if (includeHistorical) {
    let allOutboxPath = `workflow_delivery_outbox?user_id=eq.${encodeURIComponent(
      userId
    )}&workflow_id=eq.${encodeURIComponent(workflowId)}&channel=eq.email&order=created_at.asc&limit=5000`
    if (campaignId) allOutboxPath += `&campaign_id=eq.${encodeURIComponent(campaignId)}`

    const allOutboxRes = await restGet(pathWithSelect(allOutboxPath, 'id,workflow_step_id,payload'))
    const allOutbox = allOutboxRes.ok ? asArray<JsonRecord>(allOutboxRes.data) : []

    const stepRes = await restGet(pathWithSelect(`workflow_steps?workflow_id=eq.${encodeURIComponent(workflowId)}&limit=5000`, 'id'))
    const activeStepIds = new Set(
      (stepRes.ok ? asArray<JsonRecord>(stepRes.data) : [])
        .map((row) => (typeof row.id === 'string' ? row.id : null))
        .filter(Boolean) as string[]
    )

    let deletedStepRefCount = 0
    let payloadHasSubjectCount = 0
    let payloadHasTextCount = 0

    for (const row of allOutbox) {
      const stepId = typeof row.workflow_step_id === 'string' ? row.workflow_step_id : null
      if (stepId && !activeStepIds.has(stepId)) deletedStepRefCount += 1

      const payloadObj = asRecord(row.payload)
      if (typeof payloadObj?.subject === 'string' && payloadObj.subject.length > 0) payloadHasSubjectCount += 1
      if (typeof payloadObj?.text === 'string' && payloadObj.text.length > 0) payloadHasTextCount += 1
    }

    historical = {
      totalEmailOutboxRowsForWorkflow: allOutbox.length,
      activeWorkflowStepCount: activeStepIds.size,
      deletedWorkflowStepReferenceCount: deletedStepRefCount,
      deletedWorkflowStepReferenceRatio:
        allOutbox.length > 0 ? Number((deletedStepRefCount / allOutbox.length).toFixed(4)) : 0,
      payloadHasSubjectCount,
      payloadHasTextCount,
    }
  }

  console.log('[WorkflowReconciliation] report generated', {
    workflowId,
    userId,
    campaignId,
    relevantLegacyOutboxCount: legacyRows.length,
    shadowJobCountInScope: candidateJobs.length,
    matchedByExternalRefCount,
    missingShadowCount,
    missingLegacyCount,
    mismatchCount,
    duplicateCount,
  })

  return jsonResponse(200, {
    ok: true,
    mode: 'shadow_reconciliation',
    workflowId,
    campaignId,
    userId,
    currentFirstEmailStepId: firstStep.stepId,
    statusMapping: {
      queued: ['queued', 'scheduled'],
      in_progress: ['running', 'claimed'],
      sent: ['succeeded'],
      failed: ['dead_letter', 'retry_scheduled'],
      skipped: ['succeeded'],
      default: ['scheduled', 'queued'],
    },
    summary: {
      relevantLegacyOutboxCount: legacyRows.length,
      shadowJobCountInScope: candidateJobs.length,
      matchedByExternalRefCount,
      missingShadowCount,
      missingLegacyCount,
      mismatchCount,
      duplicateCount,
    },
    rows,
    historical,
  })
})
