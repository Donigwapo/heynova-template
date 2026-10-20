import {
  buildNativeActivationAllowlistConfig,
  canTransitionOutboxToNativeClaim,
  decideNativeEligibility,
  isAllowlisted,
} from './_eligibility.js'
import { buildOutboxPayloadForNativeExecution } from './_outbox-native-marker.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const ACTIVE_RUN_STATUSES = ['pending', 'running', 'paused'] as const
const NATIVE_ALLOWLIST_CONFIG = buildNativeActivationAllowlistConfig(Deno.env.toObject())

type JsonRecord = Record<string, unknown>

type OutboxRow = {
  id: string
  user_id: string
  workflow_id: string
  workflow_step_id: string
  campaign_id: string
  campaign_lead_id: string
  channel: string | null
  status: string | null
  idempotency_key: string | null
  scheduled_at: string | null
  attempt_count: number | null
  claimed_at: string | null
  payload: JsonRecord | null
  created_at: string | null
}

type RunRow = {
  id: string
  user_id: string
  workflow_id: string
  workflow_version_id: string | null
  campaign_id: string | null
  campaign_lead_id: string | null
  status: string
}

type RunStepRow = {
  id: string
  workflow_run_id: string
  workflow_step_id: string | null
  workflow_version_id: string | null
  workflow_version_step_id: string | null
  status: string
}

type JobRow = {
  id: string
  workflow_run_id: string
  workflow_run_step_id: string | null
  workflow_version_id: string | null
  workflow_version_step_id: string | null
  idempotency_key: string | null
  payload: JsonRecord | null
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
    const json = atob(padded)
    const payload = JSON.parse(json)
    return asRecord(payload)
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

async function restInsert(path: string, body: unknown, prefer = 'return=representation') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: prefer,
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

async function restPatch(path: string, body: unknown, prefer = 'return=representation') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: prefer,
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

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function nowIso() {
  return new Date().toISOString()
}

function statusForOutbox(status: string | null | undefined) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'failed') return 'failed'
  if (normalized === 'sent') return 'completed'
  if (normalized === 'skipped') return 'skipped'
  if (normalized === 'in_progress') return 'running'
  return 'scheduled'
}

function jobStatusForOutbox(status: string | null | undefined) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'failed') return 'dead_letter'
  if (normalized === 'sent' || normalized === 'skipped') return 'succeeded'
  if (normalized === 'in_progress') return 'running'
  return 'queued'
}

function buildShadowRunMetadata(outbox: OutboxRow): JsonRecord {
  return {
    shadow_mode: true,
    shadow_source: 'activation_outbox_sync',
    trigger: 'campaign_activate',
    outbox_id: outbox.id,
    outbox_status: outbox.status || null,
    synchronized_at: nowIso(),
  }
}

function buildShadowRunStepMetadata(outbox: OutboxRow): JsonRecord {
  return {
    shadow_mode: true,
    shadow_source: 'activation_outbox_sync',
    outbox_id: outbox.id,
    outbox_status: outbox.status || null,
  }
}

function buildShadowJobMetadata(outbox: OutboxRow): JsonRecord {
  return {
    shadow_mode: true,
    shadow_source: 'activation_outbox_sync',
    outbox_id: outbox.id,
    outbox_status: outbox.status || null,
    do_not_execute: true,
  }
}

function buildExecutionMetadata(nativeEligibility: { nativeEligible: boolean; reason: string }, outbox: OutboxRow) {
  const shadowJob = buildShadowJobMetadata(outbox)

  if (nativeEligibility.nativeEligible) {
    const { do_not_execute: _dropDoNotExecute, ...restShadowJob } = shadowJob
    return {
      shadow_mode: false,
      execute_native_email: true,
      source: 'native_activation_sync',
      native_eligibility_reason: nativeEligibility.reason,
      shadow_job: {
        ...restShadowJob,
        migrated_to_native: true,
      },
      execution_path: 'native',
    }
  }

  return {
    shadow_mode: true,
    execute_native_email: false,
    source: 'legacy_outbox_enqueue',
    native_eligibility_reason: nativeEligibility.reason,
    shadow_job: shadowJob,
    execution_path: 'shadow',
  }
}

async function ensureWorkflowVersion(params: { workflowId: string; userId: string }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ensure_workflow_version`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      p_user_id: params.userId,
      p_workflow_id: params.workflowId,
      p_status: 'published',
    }),
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const rec = asRecord(data)
    const msg = String(rec?.message || rec?.error || 'Unable to ensure workflow version.')
    return {
      workflowVersionId: null as string | null,
      versionNumber: null as number | null,
      definitionHash: null as string | null,
      reused: false,
      error: new Error(msg),
    }
  }

  const row = asArray<JsonRecord>(data)[0] || null
  return {
    workflowVersionId:
      typeof row?.workflow_version_id === 'string' ? (row.workflow_version_id as string) : null,
    versionNumber: typeof row?.version_number === 'number' ? Number(row.version_number) : null,
    definitionHash: typeof row?.definition_hash === 'string' ? (row.definition_hash as string) : null,
    reused: Boolean(row?.reused),
    error: null,
  }
}

async function fetchWorkflowSummary(params: { workflowId: string; userId: string }) {
  const result = await restGet(
    pathWithSelect(
      `workflows?id=eq.${encodeURIComponent(params.workflowId)}&user_id=eq.${encodeURIComponent(
        params.userId
      )}&limit=1`,
      'id,user_id,campaign_id,status'
    )
  )

  if (!result.ok) return null

  const rows = asArray<JsonRecord>(result.data)
  return rows[0] || null
}

async function fetchFirstEmailStepId(params: { workflowId: string; userId: string }) {
  const result = await restGet(
    pathWithSelect(
      `workflow_steps?workflow_id=eq.${encodeURIComponent(params.workflowId)}&user_id=eq.${encodeURIComponent(
        params.userId
      )}&step_type=eq.email&order=step_order.asc&limit=1`,
      'id'
    )
  )

  if (!result.ok) {
    return {
      stepId: null as string | null,
      error: new Error('Unable to resolve first email step for workflow shadow sync.'),
    }
  }

  const rows = asArray<JsonRecord>(result.data)
  const stepId = typeof rows[0]?.id === 'string' ? rows[0].id : null

  if (!stepId) {
    return {
      stepId: null,
      error: new Error('No persisted email step found for workflow shadow sync.'),
    }
  }

  return { stepId, error: null }
}

async function fetchActivationOutboxRows(params: {
  workflowId: string
  userId: string
  campaignId: string | null
  firstEmailStepId: string
}) {
  let path = `workflow_delivery_outbox?user_id=eq.${encodeURIComponent(
    params.userId
  )}&workflow_id=eq.${encodeURIComponent(params.workflowId)}&workflow_step_id=eq.${encodeURIComponent(
    params.firstEmailStepId
  )}`

  if (params.campaignId) {
    path += `&campaign_id=eq.${encodeURIComponent(params.campaignId)}`
  }

  path += '&channel=eq.email&order=created_at.desc&limit=5000'

  const result = await restGet(
    pathWithSelect(
      path,
      'id,user_id,workflow_id,workflow_step_id,campaign_id,campaign_lead_id,channel,status,idempotency_key,scheduled_at,attempt_count,claimed_at,payload,created_at'
    )
  )

  if (!result.ok) {
    return {
      rows: [] as OutboxRow[],
      error: new Error('Unable to load workflow delivery outbox rows for shadow sync.'),
    }
  }

  return {
    rows: asArray<OutboxRow>(result.data),
    error: null,
  }
}

async function markOutboxNativeDesignated(outbox: OutboxRow, reason: string) {
  const transition = canTransitionOutboxToNativeClaim(outbox.status)

  if (!transition.ok && transition.reason !== 'already_native_claimed') {
    return {
      ok: true,
      designated: false,
      reason: transition.reason,
      row: outbox,
    }
  }

  if (String(outbox.status || '').toLowerCase() === 'native_claimed') {
    return {
      ok: true,
      designated: true,
      reason: 'already_native_claimed',
      row: outbox,
    }
  }

  const patched = await restPatch(
    `workflow_delivery_outbox?id=eq.${encodeURIComponent(outbox.id)}&status=in.(queued,retry_scheduled)`,
    {
      payload: buildOutboxPayloadForNativeExecution(outbox.payload, reason),
      updated_at: nowIso(),
    },
    'return=representation'
  )

  if (!patched.ok) {
    return {
      ok: false,
      designated: false,
      reason: 'mark_patch_failed',
      row: outbox,
      error: new Error('Unable to mark outbox row for native execution.'),
    }
  }

  const row = asArray<OutboxRow>(patched.data)[0] || null
  if (!row?.id) {
    return {
      ok: true,
      designated: false,
      reason: 'mark_race_lost',
      row: outbox,
    }
  }

  return {
    ok: true,
    designated: true,
    reason: 'marked',
    row,
  }
}

async function findVersionStepBySourceStep(params: {
  workflowVersionId: string
  sourceWorkflowStepId: string
}) {
  const path = pathWithSelect(
    `workflow_version_steps?workflow_version_id=eq.${encodeURIComponent(
      params.workflowVersionId
    )}&source_workflow_step_id=eq.${encodeURIComponent(params.sourceWorkflowStepId)}&limit=1`,
    'id,workflow_version_id,workflow_id,source_workflow_step_id,step_order,step_type,delay_days,subject,body,metadata'
  )

  const result = await restGet(path)
  if (!result.ok) {
    return {
      row: null as JsonRecord | null,
      error: new Error('Unable to resolve workflow_version_step by source step.'),
    }
  }

  const rows = asArray<JsonRecord>(result.data)
  return { row: rows[0] || null, error: null }
}

async function findActiveRunByLead(params: {
  userId: string
  workflowId: string
  workflowVersionId: string | null
  campaignLeadId: string
}) {
  let filter = `workflow_runs?user_id=eq.${encodeURIComponent(params.userId)}&workflow_id=eq.${encodeURIComponent(
    params.workflowId
  )}&campaign_lead_id=eq.${encodeURIComponent(params.campaignLeadId)}&order=created_at.desc&limit=10`

  if (params.workflowVersionId) {
    filter += `&workflow_version_id=eq.${encodeURIComponent(params.workflowVersionId)}`
  }

  const path = pathWithSelect(
    filter,
    'id,user_id,workflow_id,workflow_version_id,campaign_id,campaign_lead_id,status'
  )

  const result = await restGet(path)
  if (!result.ok) return { row: null as RunRow | null, error: new Error('Unable to query active run.') }

  const rows = asArray<RunRow>(result.data)
  const active = rows.find((row) => ACTIVE_RUN_STATUSES.includes(row.status as (typeof ACTIVE_RUN_STATUSES)[number]))
  return { row: active || null, error: null }
}

async function createRun(params: {
  userId: string
  workflowId: string
  workflowVersionId: string | null
  campaignId: string | null
  campaignLeadId: string
  outbox: OutboxRow
}) {
  const inserted = await restInsert(
    pathWithSelect(
      'workflow_runs',
      'id,user_id,workflow_id,workflow_version_id,campaign_id,campaign_lead_id,status'
    ),
    {
      user_id: params.userId,
      workflow_id: params.workflowId,
      workflow_version_id: params.workflowVersionId,
      campaign_id: params.campaignId,
      campaign_lead_id: params.campaignLeadId,
      status: 'running',
      trigger_type: 'campaign_activate',
      trigger_ref: {
        source: 'workflow_activation',
        mode: 'shadow',
      },
      metadata: buildShadowRunMetadata(params.outbox),
      started_at: nowIso(),
      updated_at: nowIso(),
    }
  )

  if (!inserted.ok) {
    const topLevel = asRecord(inserted.data)
    const nestedError = asRecord(topLevel?.error)
    const details = asArray<JsonRecord>(topLevel?.details)
    const detailsMessage =
      typeof details[0]?.message === 'string' ? String(details[0].message) : null

    const message =
      (typeof topLevel?.message === 'string' && topLevel.message) ||
      (typeof nestedError?.message === 'string' && nestedError.message) ||
      detailsMessage ||
      'Unable to create workflow_run shadow record.'

    return { row: null as RunRow | null, error: new Error(String(message)) }
  }

  const rows = asArray<RunRow>(inserted.data)
  return { row: rows[0] || null, error: null }
}

async function ensureRun(params: {
  userId: string
  workflowId: string
  workflowVersionId: string | null
  campaignId: string | null
  campaignLeadId: string
  outbox: OutboxRow
}) {
  const activeResult = await findActiveRunByLead({
    userId: params.userId,
    workflowId: params.workflowId,
    workflowVersionId: params.workflowVersionId,
    campaignLeadId: params.campaignLeadId,
  })

  if (activeResult.error) {
    return { row: null as RunRow | null, action: 'error', error: activeResult.error }
  }

  if (activeResult.row?.id) {
    console.log('[WorkflowShadow] run reused', {
      runId: activeResult.row.id,
      workflowId: params.workflowId,
      campaignLeadId: params.campaignLeadId,
      outboxId: params.outbox.id,
    })

    return { row: activeResult.row, action: 'reused', error: null }
  }

  const created = await createRun(params)
  if (created.error || !created.row?.id) {
    return {
      row: null,
      action: 'error',
      error: created.error || new Error('Failed to create workflow_run shadow record.'),
    }
  }

  console.log('[WorkflowShadow] run created', {
    runId: created.row.id,
    workflowId: params.workflowId,
    campaignLeadId: params.campaignLeadId,
    outboxId: params.outbox.id,
  })

  return { row: created.row, action: 'created', error: null }
}

async function findRunStepByOutbox(params: { runId: string; outboxId: string }) {
  const path = pathWithSelect(
    `workflow_run_steps?workflow_run_id=eq.${encodeURIComponent(
      params.runId
    )}&metadata->>outbox_id=eq.${encodeURIComponent(params.outboxId)}&limit=1`,
    'id,workflow_run_id,workflow_step_id,workflow_version_id,workflow_version_step_id,status'
  )

  const result = await restGet(path)
  if (!result.ok) {
    return { row: null as RunStepRow | null, error: new Error('Unable to query run step by outbox marker.') }
  }

  const rows = asArray<RunStepRow>(result.data)
  return { row: rows[0] || null, error: null }
}

async function createRunStep(params: {
  run: RunRow
  outbox: OutboxRow
  workflowVersionId: string | null
  workflowVersionStepId: string | null
}) {
  const sequenceNo = 0
  const visitNo = 1
  const outboxStatus = statusForOutbox(params.outbox.status)

  const inserted = await restInsert(
    pathWithSelect('workflow_run_steps', 'id,workflow_run_id,workflow_step_id,status'),
    {
      user_id: params.run.user_id,
      workflow_run_id: params.run.id,
      workflow_id: params.run.workflow_id,
      workflow_version_id: params.workflowVersionId,
      workflow_version_step_id: params.workflowVersionStepId,
      workflow_step_id: params.outbox.workflow_step_id,
      path_key: 'main',
      sequence_no: sequenceNo,
      visit_no: visitNo,
      status: outboxStatus,
      scheduled_at: params.outbox.scheduled_at,
      attempt_count: Number(params.outbox.attempt_count || 0),
      max_attempts: 5,
      input_snapshot: {
        channel: params.outbox.channel || 'email',
        legacy_outbox_status: params.outbox.status || null,
        workflow_version_id: params.workflowVersionId,
        workflow_version_step_id: params.workflowVersionStepId,
      },
      metadata: buildShadowRunStepMetadata(params.outbox),
      updated_at: nowIso(),
    }
  )

  if (!inserted.ok) {
    const message =
      asRecord(inserted.data)?.message ||
      asRecord(asRecord(inserted.data)?.error)?.message ||
      'Unable to create workflow_run_step shadow record.'

    return { row: null as RunStepRow | null, error: new Error(String(message)) }
  }

  const rows = asArray<RunStepRow>(inserted.data)
  return { row: rows[0] || null, error: null }
}

async function ensureRunStep(params: {
  run: RunRow
  outbox: OutboxRow
  workflowVersionId: string | null
  workflowVersionStepId: string | null
}) {
  const existing = await findRunStepByOutbox({
    runId: params.run.id,
    outboxId: params.outbox.id,
  })

  if (existing.error) {
    return { row: null as RunStepRow | null, action: 'error', error: existing.error }
  }

  if (existing.row?.id) {
    console.log('[WorkflowShadow] run_step reused', {
      runStepId: existing.row.id,
      runId: params.run.id,
      outboxId: params.outbox.id,
    })

    return { row: existing.row, action: 'reused', error: null }
  }

  const created = await createRunStep(params)
  if (created.error || !created.row?.id) {
    return {
      row: null,
      action: 'error',
      error: created.error || new Error('Failed to create workflow_run_step shadow record.'),
    }
  }

  console.log('[WorkflowShadow] run_step created', {
    runStepId: created.row.id,
    runId: params.run.id,
    outboxId: params.outbox.id,
  })

  return { row: created.row, action: 'created', error: null }
}

async function findJobByIdempotency(params: { userId: string; idempotencyKey: string }) {
  const path = pathWithSelect(
    `workflow_jobs?user_id=eq.${encodeURIComponent(params.userId)}&idempotency_key=eq.${encodeURIComponent(
      params.idempotencyKey
    )}&limit=1`,
    'id,workflow_run_id,workflow_run_step_id,workflow_version_id,workflow_version_step_id,idempotency_key,payload'
  )

  const result = await restGet(path)
  if (!result.ok) {
    return { row: null as JobRow | null, error: new Error('Unable to query workflow_job by idempotency.') }
  }

  const rows = asArray<JobRow>(result.data)
  return { row: rows[0] || null, error: null }
}

async function createJob(params: {
  run: RunRow
  runStep: RunStepRow
  outbox: OutboxRow
  workflowVersionId: string | null
  workflowVersionStepId: string | null
  nativeEligibility: { nativeEligible: boolean; reason: string }
}) {
  const idempotencyKey = params.outbox.idempotency_key
  const status = jobStatusForOutbox(params.outbox.status)

  if (!idempotencyKey) {
    return { row: null as JobRow | null, error: new Error('Outbox row missing idempotency_key.') }
  }

  const executionMetadata = buildExecutionMetadata(params.nativeEligibility, params.outbox)

  const inserted = await restInsert(
    pathWithSelect('workflow_jobs', 'id,workflow_run_id,workflow_run_step_id,idempotency_key'),
    {
      user_id: params.run.user_id,
      workflow_run_id: params.run.id,
      workflow_run_step_id: params.runStep.id,
      workflow_id: params.run.workflow_id,
      workflow_version_id: params.workflowVersionId,
      workflow_version_step_id: params.workflowVersionStepId,
      campaign_id: params.run.campaign_id,
      campaign_lead_id: params.run.campaign_lead_id,
      job_type: 'send_email',
      queue_name: 'email',
      priority: 100,
      status,
      scheduled_at: params.outbox.scheduled_at,
      available_at: params.outbox.scheduled_at || params.outbox.created_at || nowIso(),
      idempotency_key: idempotencyKey,
      attempt_count: Number(params.outbox.attempt_count || 0),
      payload: {
        ...executionMetadata,
        workflow_version_id: params.workflowVersionId,
        workflow_version_step_id: params.workflowVersionStepId,
      },
      result: null,
      external_ref_type: 'workflow_delivery_outbox',
      external_ref_id: params.outbox.id,
      last_error_code: null,
      last_error_message: null,
      last_error_details: null,
      updated_at: nowIso(),
    }
  )

  if (!inserted.ok) {
    const message =
      asRecord(inserted.data)?.message ||
      asRecord(asRecord(inserted.data)?.error)?.message ||
      'Unable to create workflow_job shadow record.'

    return { row: null as JobRow | null, error: new Error(String(message)) }
  }

  const rows = asArray<JobRow>(inserted.data)
  return { row: rows[0] || null, error: null }
}

async function ensureJob(params: {
  run: RunRow
  runStep: RunStepRow
  outbox: OutboxRow
  workflowVersionId: string | null
  workflowVersionStepId: string | null
  nativeEligibility: { nativeEligible: boolean; reason: string }
}) {
  if (!params.outbox.idempotency_key) {
    return {
      row: null as JobRow | null,
      action: 'error',
      error: new Error('Outbox row missing idempotency key for shadow job.'),
    }
  }

  const existing = await findJobByIdempotency({
    userId: params.run.user_id,
    idempotencyKey: params.outbox.idempotency_key,
  })

  if (existing.error) {
    return { row: null as JobRow | null, action: 'error', error: existing.error }
  }

  if (existing.row?.id) {
    console.log('[WorkflowShadow] job reused', {
      jobId: existing.row.id,
      runId: params.run.id,
      runStepId: params.runStep.id,
      outboxId: params.outbox.id,
    })

    const executionMetadata = buildExecutionMetadata(params.nativeEligibility, params.outbox)

    await restPatch(
      `workflow_jobs?id=eq.${encodeURIComponent(existing.row.id)}`,
      {
        workflow_run_id: params.run.id,
        workflow_run_step_id: params.runStep.id,
        workflow_version_id: params.workflowVersionId,
        workflow_version_step_id: params.workflowVersionStepId,
        external_ref_type: 'workflow_delivery_outbox',
        external_ref_id: params.outbox.id,
        payload: {
          ...executionMetadata,
          workflow_version_id: params.workflowVersionId,
          workflow_version_step_id: params.workflowVersionStepId,
        },
        updated_at: nowIso(),
      },
      'return=minimal'
    )

    return { row: existing.row, action: 'reused', error: null }
  }

  const created = await createJob(params)
  if (created.error || !created.row?.id) {
    return {
      row: null,
      action: 'error',
      error: created.error || new Error('Failed to create workflow_job shadow record.'),
    }
  }

  console.log('[WorkflowShadow] job created', {
    jobId: created.row.id,
    runId: params.run.id,
    runStepId: params.runStep.id,
    outboxId: params.outbox.id,
  })

  return { row: created.row, action: 'created', error: null }
}

async function appendEvent(params: {
  userId: string
  workflowId: string
  campaignId: string | null
  campaignLeadId: string
  runId: string | null
  runStepId: string | null
  jobId: string | null
  eventType: string
  payload?: JsonRecord
  idempotencyKey?: string
}) {
  const insert = await restInsert(
    pathWithSelect('workflow_events', 'id'),
    {
      user_id: params.userId,
      workflow_run_id: params.runId,
      workflow_run_step_id: params.runStepId,
      workflow_job_id: params.jobId,
      workflow_id: params.workflowId,
      campaign_id: params.campaignId,
      campaign_lead_id: params.campaignLeadId,
      event_type: params.eventType,
      event_source: 'shadow_activation_sync',
      severity: 'info',
      idempotency_key: params.idempotencyKey || null,
      payload: params.payload || {},
      occurred_at: nowIso(),
    }
  )

  if (!insert.ok) {
    const message =
      asRecord(insert.data)?.message ||
      asRecord(asRecord(insert.data)?.error)?.message ||
      'Unable to write workflow_event shadow record.'

    return { ok: false, error: new Error(String(message)) }
  }

  return { ok: true, error: null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, message: 'Method not allowed.' })
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, {
      ok: false,
      message: 'Supabase service configuration missing for shadow sync.',
    })
  }

  const body = await req.json().catch(() => null)
  const payload = asRecord(body)
  const workflowId = typeof payload?.workflowId === 'string' ? payload.workflowId.trim() : ''
  const campaignIdInput = typeof payload?.campaignId === 'string' ? payload.campaignId.trim() : null

  if (!workflowId) {
    return jsonResponse(400, { ok: false, message: 'workflowId is required.' })
  }

  const token = getBearerToken(req)
  const jwtRole = extractJwtRole(token)

  let userId = await resolveUserIdFromJwt(req)

  if (!userId && jwtRole === 'service_role') {
    const bodyUserId = typeof payload?.userId === 'string' ? payload.userId.trim() : ''
    if (bodyUserId) {
      userId = bodyUserId
    }
  }

  if (!userId) {
    return jsonResponse(401, { ok: false, message: 'Unauthorized.' })
  }

  const workflowSummary = await fetchWorkflowSummary({ workflowId, userId })
  if (!workflowSummary) {
    return jsonResponse(404, { ok: false, message: 'Workflow not found for current user.' })
  }

  const campaignId =
    campaignIdInput || (typeof workflowSummary.campaign_id === 'string' ? workflowSummary.campaign_id : null)

  const firstStepResult = await fetchFirstEmailStepId({ workflowId, userId })

  if (firstStepResult.error || !firstStepResult.stepId) {
    console.error('[WorkflowShadow] first email step lookup failed', {
      workflowId,
      userId,
      message: firstStepResult.error?.message || 'Unknown workflow step lookup error',
    })

    return jsonResponse(500, {
      ok: false,
      message: 'Unable to resolve first email step for shadow synchronization.',
    })
  }

  const outboxResult = await fetchActivationOutboxRows({
    workflowId,
    userId,
    campaignId,
    firstEmailStepId: firstStepResult.stepId,
  })

  if (outboxResult.error) {
    console.error('[WorkflowShadow] outbox fetch failed', {
      workflowId,
      userId,
      campaignId,
      message: outboxResult.error.message,
    })

    return jsonResponse(500, {
      ok: false,
      message: 'Unable to load outbox rows for shadow synchronization.',
    })
  }

  const ensureVersionResult = await ensureWorkflowVersion({ workflowId, userId })

  if (ensureVersionResult.error || !ensureVersionResult.workflowVersionId) {
    console.error('[WorkflowShadow] ensure workflow version failed', {
      workflowId,
      userId,
      message: ensureVersionResult.error?.message || 'Unknown ensure-version error',
    })

    return jsonResponse(500, {
      ok: false,
      message: 'Unable to ensure immutable workflow version for shadow synchronization.',
    })
  }

  const workflowVersionId = ensureVersionResult.workflowVersionId

  const outboxRows = outboxResult.rows

  const allowlistDecision = isAllowlisted(NATIVE_ALLOWLIST_CONFIG, {
    userId,
    workflowId,
    campaignId,
  })

  if (outboxRows.length === 0) {
    return jsonResponse(200, {
      ok: true,
      mode: 'shadow_only',
      workflowId,
      campaignId,
      workflowVersionId,
      workflowVersionReused: ensureVersionResult.reused,
      workflowVersionNumber: ensureVersionResult.versionNumber,
      nativeActivationAllowlist: {
        enabled: NATIVE_ALLOWLIST_CONFIG.activationEnabled,
        decision: allowlistDecision.reason,
      },
      processed: 0,
      runCreated: 0,
      runReused: 0,
      runStepCreated: 0,
      runStepReused: 0,
      jobCreated: 0,
      jobReused: 0,
      nativeEligibleJobs: 0,
      legacyShadowJobs: 0,
      nativeOutboxDesignations: 0,
      eventCreated: 0,
      failures: [],
    })
  }

  const failures: Array<Record<string, unknown>> = []

  let runCreated = 0
  let runReused = 0
  let runStepCreated = 0
  let runStepReused = 0
  let jobCreated = 0
  let jobReused = 0
  let eventCreated = 0
  let nativeEligibleJobs = 0
  let legacyShadowJobs = 0
  let nativeOutboxDesignations = 0

  for (const outbox of outboxRows) {
    const campaignLeadId = outbox.campaign_lead_id

    if (!campaignLeadId || !outbox.workflow_step_id || !outbox.idempotency_key) {
      failures.push({
        outboxId: outbox.id,
        reason: 'missing required outbox fields',
      })
      continue
    }

    const versionStepResult = await findVersionStepBySourceStep({
      workflowVersionId,
      sourceWorkflowStepId: outbox.workflow_step_id,
    })

    if (versionStepResult.error || !versionStepResult.row?.id) {
      failures.push({
        outboxId: outbox.id,
        campaignLeadId,
        stage: 'version_step',
        message: versionStepResult.error?.message || 'version step not found',
      })
      continue
    }

    const workflowVersionStepId = String(versionStepResult.row.id)

    const runResult = await ensureRun({
      userId,
      workflowId,
      workflowVersionId,
      campaignId,
      campaignLeadId,
      outbox,
    })

    if (runResult.error || !runResult.row?.id) {
      const rawMessage = runResult.error?.message || 'Unknown run error'
      const lowered = String(rawMessage).toLowerCase()
      const isActiveRunConflict =
        lowered.includes('duplicate key value') &&
        lowered.includes('uq_workflow_runs_active_per_lead')

      console.error('[WorkflowShadow] run ensure failed', {
        workflowId,
        userId,
        campaignLeadId,
        outboxId: outbox.id,
        message: rawMessage,
        activeRunConflict: isActiveRunConflict,
      })

      failures.push({
        outboxId: outbox.id,
        campaignLeadId,
        stage: 'run',
        code: isActiveRunConflict ? 'active_run_conflict' : 'run_ensure_failed',
        message: rawMessage,
      })
      continue
    }

    if (runResult.action === 'created') runCreated += 1
    if (runResult.action === 'reused') runReused += 1

    const run = runResult.row

    const runStepResult = await ensureRunStep({
      run,
      outbox,
      workflowVersionId,
      workflowVersionStepId,
    })
    if (runStepResult.error || !runStepResult.row?.id) {
      console.error('[WorkflowShadow] run_step ensure failed', {
        workflowId,
        userId,
        campaignLeadId,
        runId: run.id,
        outboxId: outbox.id,
        message: runStepResult.error?.message || 'Unknown run_step error',
      })

      failures.push({
        outboxId: outbox.id,
        campaignLeadId,
        runId: run.id,
        stage: 'run_step',
        message: runStepResult.error?.message || 'run_step ensure failed',
      })
      continue
    }

    if (runStepResult.action === 'created') runStepCreated += 1
    if (runStepResult.action === 'reused') runStepReused += 1

    const runStep = runStepResult.row

    let outboxForJob = outbox
    let markedForNative = false

    if (allowlistDecision.ok) {
      const markResult = await markOutboxNativeDesignated(outbox, 'native_allowlisted')

      if (!markResult.ok) {
        failures.push({
          outboxId: outbox.id,
          campaignLeadId,
          runId: run.id,
          runStepId: runStep.id,
          stage: 'native_outbox_designation',
          code: 'native_designation_failed',
          message: markResult.error?.message || 'Unable to mark outbox row for native execution.',
        })
        continue
      }

      outboxForJob = markResult.row || outbox
      markedForNative = markResult.designated

      if (markedForNative) {
        nativeOutboxDesignations += 1
      }
    }

    const nativeEligibility = decideNativeEligibility({
      config: NATIVE_ALLOWLIST_CONFIG,
      userId,
      workflowId,
      campaignId,
      outboxStatus: outboxForJob.status,
      claimedForNative: markedForNative,
    })

    const jobResult = await ensureJob({
      run,
      runStep,
      outbox: outboxForJob,
      workflowVersionId,
      workflowVersionStepId,
      nativeEligibility,
    })

    if (jobResult.error || !jobResult.row?.id) {
      console.error('[WorkflowShadow] job ensure failed', {
        workflowId,
        userId,
        campaignLeadId,
        runId: run.id,
        runStepId: runStep.id,
        outboxId: outbox.id,
        message: jobResult.error?.message || 'Unknown job error',
      })

      failures.push({
        outboxId: outbox.id,
        campaignLeadId,
        runId: run.id,
        runStepId: runStep.id,
        stage: 'job',
        message: jobResult.error?.message || 'job ensure failed',
      })
      continue
    }

    if (jobResult.action === 'created') jobCreated += 1
    if (jobResult.action === 'reused') jobReused += 1

    const job = jobResult.row

    if (nativeEligibility.nativeEligible) {
      nativeEligibleJobs += 1
    } else {
      legacyShadowJobs += 1
    }

    const eventSeed = `${userId}:${workflowId}:${outbox.workflow_step_id}:${campaignLeadId}:email`

    const runEvent = await appendEvent({
      userId,
      workflowId,
      campaignId,
      campaignLeadId,
      runId: run.id,
      runStepId: null,
      jobId: null,
      eventType: 'run_created',
      payload: {
        shadow_mode: !nativeEligibility.nativeEligible,
        action: runResult.action,
        outbox_id: outbox.id,
      },
      idempotencyKey: `shadow:run_created:${eventSeed}`,
    })

    if (runEvent.ok) eventCreated += 1

    const stepEvent = await appendEvent({
      userId,
      workflowId,
      campaignId,
      campaignLeadId,
      runId: run.id,
      runStepId: runStep.id,
      jobId: null,
      eventType: 'step_created',
      payload: {
        shadow_mode: !nativeEligibility.nativeEligible,
        action: runStepResult.action,
        outbox_id: outbox.id,
      },
      idempotencyKey: `shadow:step_created:${eventSeed}`,
    })

    if (stepEvent.ok) eventCreated += 1

    const jobEvent = await appendEvent({
      userId,
      workflowId,
      campaignId,
      campaignLeadId,
      runId: run.id,
      runStepId: runStep.id,
      jobId: job.id,
      eventType: 'job_created',
      payload: {
        shadow_mode: !nativeEligibility.nativeEligible,
        execute_native_email: nativeEligibility.nativeEligible,
        native_eligibility_reason: nativeEligibility.reason,
        action: jobResult.action,
        outbox_id: outbox.id,
        external_ref_type: 'workflow_delivery_outbox',
        external_ref_id: outbox.id,
      },
      idempotencyKey: `shadow:job_created:${eventSeed}`,
    })

    if (jobEvent.ok) eventCreated += 1

    console.log('[WorkflowShadow] correlated with outbox', {
      workflowId,
      campaignLeadId,
      outboxId: outbox.id,
      runId: run.id,
      runStepId: runStep.id,
      jobId: job.id,
    })
  }

  const responsePayload = {
    ok: true,
    mode: nativeEligibleJobs > 0 ? 'mixed_shadow_native' : 'shadow_only',
    workflowId,
    workflowVersionId,
    workflowVersionReused: ensureVersionResult.reused,
    workflowVersionNumber: ensureVersionResult.versionNumber,
    workflowDefinitionHash: ensureVersionResult.definitionHash,
    campaignId,
    nativeActivationAllowlist: {
      enabled: NATIVE_ALLOWLIST_CONFIG.activationEnabled,
      decision: allowlistDecision.reason,
    },
    processed: outboxRows.length,
    runCreated,
    runReused,
    runStepCreated,
    runStepReused,
    jobCreated,
    jobReused,
    nativeEligibleJobs,
    legacyShadowJobs,
    nativeOutboxDesignations,
    eventCreated,
    failures,
  }

  if (failures.length > 0) {
    console.warn('[WorkflowShadow] completed with partial failures', {
      workflowId,
      userId,
      processed: outboxRows.length,
      failures: failures.length,
    })
  } else {
    console.log('[WorkflowShadow] sync completed', {
      workflowId,
      workflowVersionId,
      workflowVersionReused: ensureVersionResult.reused,
      workflowVersionNumber: ensureVersionResult.versionNumber,
      userId,
      processed: outboxRows.length,
      runCreated,
      runReused,
      runStepCreated,
      runStepReused,
      jobCreated,
      jobReused,
      eventCreated,
    })
  }

  return jsonResponse(200, responsePayload)
})
