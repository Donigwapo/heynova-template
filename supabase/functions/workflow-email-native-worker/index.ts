import {
  asArray,
  asRecord,
  extractJwtRole,
  getBearerToken,
  nowIso,
  pathWithSelect,
  restGet,
  restInsert,
  restPatch,
} from '../_shared/workflowShadowAdvancementCore.ts'
import { advanceWorkflowRunShadow } from '../_shared/workflowShadowAdvancementEngine.ts'
import {
  buildMimeMessage as coreBuildMimeMessage,
  decryptToken as coreDecryptToken,
  encodeBase64Url as coreEncodeBase64Url,
  isTokenExpired as coreIsTokenExpired,
  persistConnectionTokens,
  refreshGoogleToken as coreRefreshGoogleToken,
  sendViaGmail as coreSendViaGmail,
} from '../_shared/gmailDeliveryCore.ts'
import {
  fencePreSendOwnershipCore,
  finalizeJobSuccessCore,
  markOutboxSentFromNativeCore,
  recordReconciliationEvidenceCore,
  releaseOutboxNativeClaimCore,
  sendWith401RetryShared,
} from './_internals.js'
import { claimLegacyOutboxForNativeCore } from './_outbox-claim.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY') || ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

const CANARY_USER_IDS = new Set(
  (Deno.env.get('WORKFLOW_NATIVE_EMAIL_CANARY_USER_IDS') || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
)
const CANARY_WORKFLOW_IDS = new Set(
  (Deno.env.get('WORKFLOW_NATIVE_EMAIL_CANARY_WORKFLOW_IDS') || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
)
const CANARY_CAMPAIGN_IDS = new Set(
  (Deno.env.get('WORKFLOW_NATIVE_EMAIL_CANARY_CAMPAIGN_IDS') || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
)

const MAX_CLAIM_BATCH = Number(Deno.env.get('WORKFLOW_NATIVE_EMAIL_MAX_CLAIM_BATCH') || '5')
const DEFAULT_LEASE_SECONDS = Number(Deno.env.get('WORKFLOW_NATIVE_EMAIL_LEASE_SECONDS') || '120')

type JsonRecord = Record<string, unknown>

type JobRow = {
  id: string
  user_id: string
  workflow_run_id: string
  workflow_run_step_id: string | null
  workflow_id: string
  workflow_version_id: string | null
  workflow_version_step_id: string | null
  campaign_id: string | null
  campaign_lead_id: string | null
  job_type: string
  queue_name: string
  status: string
  idempotency_key: string | null
  payload: JsonRecord | null
  external_ref_type: string | null
  external_ref_id: string | null
  claim_token: string | null
  attempt_count: number | null
  max_attempts: number | null
  lease_expires_at: string | null
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
  user_id: string
  workflow_run_id: string
  workflow_id: string
  workflow_step_id: string | null
  workflow_version_id: string | null
  workflow_version_step_id: string | null
  status: string
  scheduled_at: string | null
  completed_at: string | null
  input_snapshot: JsonRecord | null
  metadata: JsonRecord | null
}

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
  payload: JsonRecord | null
  attempt_count: number | null
  claimed_at: string | null
  sent_at: string | null
  provider_message_id: string | null
}

type LeadRow = {
  id: string
  user_id: string
  email: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
}

type VersionStepRow = {
  id: string
  workflow_version_id: string
  workflow_id: string
  source_workflow_step_id: string | null
  step_order: number
  step_type: string
  delay_days: number
  subject: string | null
  body: string | null
  metadata: JsonRecord | null
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

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

function addSecondsIso(base: string, seconds: number) {
  const d = new Date(base)
  return new Date(d.getTime() + seconds * 1000).toISOString()
}

function isCanaryAllowed(job: JobRow) {
  if (!CANARY_USER_IDS.has(job.user_id)) return false

  if (CANARY_WORKFLOW_IDS.size > 0 && !CANARY_WORKFLOW_IDS.has(job.workflow_id)) return false
  if (CANARY_CAMPAIGN_IDS.size > 0) {
    if (!job.campaign_id || !CANARY_CAMPAIGN_IDS.has(job.campaign_id)) return false
  }

  return true
}

function isShadowModeDisabled(job: JobRow) {
  const payload = asRecord(job.payload)
  if (!payload) return true

  // execution-enabled marker: true means eligible for native execution
  if (payload.execute_native_email === true) return true

  // legacy shadow flags block execution
  if (payload.shadow_mode === true) return false
  const shadowJob = asRecord(payload.shadow_job)
  if (shadowJob?.do_not_execute === true) return false
  if (payload.execute_disabled === true) return false

  return false
}

function isLeaseExpired(leaseExpiresAt: string | null) {
  if (!leaseExpiresAt) return true
  const t = new Date(leaseExpiresAt).getTime()
  if (Number.isNaN(t)) return true
  return t <= Date.now()
}


async function appendEvent(params: {
  userId: string
  workflowId: string
  campaignId: string | null
  campaignLeadId: string | null
  runId: string | null
  runStepId: string | null
  jobId: string | null
  eventType: string
  severity?: 'info' | 'warn' | 'error'
  payload?: JsonRecord
  idempotencyKey?: string | null
}) {
  const inserted = await restInsert(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
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
      event_source: 'workflow_email_native_worker',
      severity: params.severity || 'info',
      idempotency_key: params.idempotencyKey || null,
      payload: params.payload || {},
      occurred_at: nowIso(),
    }
  )

  if (!inserted.ok) {
    const rec = asRecord(inserted.data)
    const msg = String(rec?.message || rec?.error || '')
    if (msg.toLowerCase().includes('duplicate key value')) return { ok: true, duplicate: true }
    return { ok: false, duplicate: false, error: new Error(msg || 'Unable to append event') }
  }

  return { ok: true, duplicate: false }
}

async function fetchRun(runId: string) {
  const result = await restGet(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    pathWithSelect(
      `workflow_runs?id=eq.${encodeURIComponent(runId)}&limit=1`,
      'id,user_id,workflow_id,workflow_version_id,campaign_id,campaign_lead_id,status'
    )
  )
  if (!result.ok) return { row: null as RunRow | null, error: new Error('Unable to load run') }
  return { row: asArray<RunRow>(result.data)[0] || null, error: null }
}

async function fetchRunStep(runStepId: string) {
  const result = await restGet(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    pathWithSelect(
      `workflow_run_steps?id=eq.${encodeURIComponent(runStepId)}&limit=1`,
      'id,user_id,workflow_run_id,workflow_id,workflow_step_id,workflow_version_id,workflow_version_step_id,status,scheduled_at,completed_at,input_snapshot,metadata'
    )
  )
  if (!result.ok) return { row: null as RunStepRow | null, error: new Error('Unable to load run step') }
  return { row: asArray<RunStepRow>(result.data)[0] || null, error: null }
}

async function fetchVersionStep(runStep: RunStepRow, run: RunRow) {
  if (runStep.workflow_version_step_id) {
    const result = await restGet(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      pathWithSelect(
        `workflow_version_steps?id=eq.${encodeURIComponent(runStep.workflow_version_step_id)}&limit=1`,
        'id,workflow_version_id,workflow_id,source_workflow_step_id,step_order,step_type,delay_days,subject,body,metadata'
      )
    )
    if (result.ok) {
      const row = asArray<VersionStepRow>(result.data)[0] || null
      if (row) return { row, error: null }
    }
  }

  if (run.workflow_version_id && runStep.workflow_step_id) {
    const result = await restGet(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      pathWithSelect(
        `workflow_version_steps?workflow_version_id=eq.${encodeURIComponent(
          run.workflow_version_id
        )}&source_workflow_step_id=eq.${encodeURIComponent(runStep.workflow_step_id)}&limit=1`,
        'id,workflow_version_id,workflow_id,source_workflow_step_id,step_order,step_type,delay_days,subject,body,metadata'
      )
    )
    if (result.ok) {
      const row = asArray<VersionStepRow>(result.data)[0] || null
      if (row) return { row, error: null }
    }
  }

  return { row: null as VersionStepRow | null, error: new Error('Version step could not be resolved') }
}

async function fetchLead(leadId: string, userId: string) {
  const result = await restGet(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    pathWithSelect(
      `campaign_leads?id=eq.${encodeURIComponent(leadId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      'id,user_id,email,full_name,first_name,last_name'
    )
  )
  if (!result.ok) return { row: null as LeadRow | null, error: new Error('Unable to load lead') }
  return { row: asArray<LeadRow>(result.data)[0] || null, error: null }
}

async function fetchOutboxByExternalRef(job: JobRow) {
  if (job.external_ref_type !== 'workflow_delivery_outbox' || !job.external_ref_id) {
    return { row: null as OutboxRow | null, error: null }
  }

  const result = await restGet(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    pathWithSelect(
      `workflow_delivery_outbox?id=eq.${encodeURIComponent(job.external_ref_id)}&limit=1`,
      'id,user_id,workflow_id,workflow_step_id,campaign_id,campaign_lead_id,channel,status,idempotency_key,payload,attempt_count,claimed_at,sent_at,provider_message_id'
    )
  )

  if (!result.ok) return { row: null as OutboxRow | null, error: new Error('Unable to load outbox by external ref') }
  return { row: asArray<OutboxRow>(result.data)[0] || null, error: null }
}

async function claimLegacyOutboxForNative(job: JobRow, outbox: OutboxRow | null) {
  return await claimLegacyOutboxForNativeCore(
    { job, outbox },
    {
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      nowIso,
      restPatch,
    }
  )
}

async function markOutboxSentFromNative(
  outboxId: string,
  providerMessageId: string | null,
  priorAttemptCount: number | null,
  claimedAt?: string | null
) {
  return await markOutboxSentFromNativeCore(
    {
      outboxId,
      providerMessageId,
      priorAttemptCount,
      claimedAt: claimedAt || null,
    },
    {
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      nowIso,
      restPatch,
    }
  )
}

async function releaseOutboxNativeClaim(outboxId: string, errorCode: string, errorMessage: string, claimedAt?: string | null) {
  return await releaseOutboxNativeClaimCore(
    {
      outboxId,
      errorCode,
      errorMessage,
      claimedAt: claimedAt || null,
    },
    {
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      nowIso,
      restPatch,
    }
  )
}

async function findOutboxSentByIdempotency(userId: string, idempotencyKey: string | null) {
  if (!idempotencyKey) return { sent: false, row: null as OutboxRow | null, error: null }
  const result = await restGet(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    pathWithSelect(
      `workflow_delivery_outbox?user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(
        idempotencyKey
      )}&status=eq.sent&limit=1`,
      'id,user_id,workflow_id,workflow_step_id,campaign_id,campaign_lead_id,channel,status,idempotency_key,payload,attempt_count,claimed_at,sent_at,provider_message_id'
    )
  )

  if (!result.ok) return { sent: false, row: null as OutboxRow | null, error: new Error('Unable to query sent outbox by idempotency') }
  const row = asArray<OutboxRow>(result.data)[0] || null
  return { sent: Boolean(row?.id), row, error: null }
}

async function loadGmailConnection(userId: string) {
  const result = await restGet(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    `integration_connections?user_id=eq.${encodeURIComponent(
      userId
    )}&provider=eq.gmail&status=eq.connected&select=id,user_id,connected_email,access_token_enc,refresh_token_enc,expires_at,status&limit=1`
  )

  const row = asArray<GmailConnectionRow>(result.data)[0] || null
  return { ok: result.ok, status: result.status, connection: row }
}

async function persistTokens(params: {
  connectionId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
}) {
  return await persistConnectionTokens(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    TOKEN_ENCRYPTION_KEY,
    params
  )
}

async function claimJob(job: JobRow, workerId: string) {
  const claimToken = crypto.randomUUID()
  const claimedAt = nowIso()
  const leaseExpiresAt = addSecondsIso(claimedAt, DEFAULT_LEASE_SECONDS)

  const patch = await restPatch(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    `workflow_jobs?id=eq.${encodeURIComponent(job.id)}&status=in.(queued,scheduled,retry_scheduled)`,
    {
      status: 'claimed',
      claimed_at: claimedAt,
      claimed_by: workerId,
      claim_token: claimToken,
      lease_expires_at: leaseExpiresAt,
      updated_at: claimedAt,
    },
    'return=representation'
  )

  if (!patch.ok) {
    return { row: null as JobRow | null, claimed: false, error: new Error('Claim patch failed') }
  }

  const row = asArray<JobRow>(patch.data)[0] || null
  if (!row?.id) return { row: null as JobRow | null, claimed: false, error: null }
  return { row, claimed: true, error: null }
}

async function moveClaimedToRunning(jobId: string, claimToken: string) {
  const patch = await restPatch(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    `workflow_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.claimed&claim_token=eq.${encodeURIComponent(
      claimToken
    )}`,
    {
      status: 'running',
      started_at: nowIso(),
      updated_at: nowIso(),
    },
    'return=representation'
  )

  if (!patch.ok) return { row: null as JobRow | null, ok: false, error: new Error('Unable to move job to running') }
  return { row: asArray<JobRow>(patch.data)[0] || null, ok: true, error: null }
}

async function fencePreSendOwnership(params: {
  job: JobRow
  outbox: OutboxRow | null
  outboxClaimedAt: string | null
}) {
  return await fencePreSendOwnershipCore(params, {
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    defaultLeaseSeconds: DEFAULT_LEASE_SECONDS,
    nowIso,
    addSecondsIso,
    restPatch,
  })
}

async function finalizeJobSuccess(params: {
  job: JobRow
  runStepId: string | null
  providerMessageId: string | null
  gmailResponse: JsonRecord
}) {
  return await finalizeJobSuccessCore(
    {
      job: params.job,
      runStepId: params.runStepId,
      providerMessageId: params.providerMessageId,
      gmailResponse: params.gmailResponse,
    },
    {
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      nowIso,
      restPatch,
    }
  )
}

async function recordReconciliationEvidence(params: {
  job: JobRow
  runId: string | null
  runStepId: string | null
  workflowId: string
  campaignId: string | null
  campaignLeadId: string | null
  outboxId: string | null
  providerMessageId: string | null
  stage:
    | 'post_send_job_finalization_failed'
    | 'post_send_outbox_update_failed'
    | 'post_send_event_append_failed'
    | 'post_send_advancement_failed'
  errorCode: string
  errorMessage: string
}) {
  return await recordReconciliationEvidenceCore(
    {
      ...params,
      userId: params.job.user_id,
    },
    {
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      nowIso,
      restPatch,
      restInsert,
      pathWithSelect,
    }
  )
}

function classifyProviderFailure(status: number, providerMessage: string) {
  const msg = String(providerMessage || '').toLowerCase()

  if (status === 429 || status >= 500) {
    return { type: 'retriable' as const, code: 'provider_transient' }
  }

  if (msg.includes('invalid') || msg.includes('recipient') || msg.includes('address')) {
    return { type: 'non_retriable' as const, code: 'invalid_recipient' }
  }

  return { type: 'non_retriable' as const, code: 'provider_error' }
}

function computeBackoffSeconds(attemptCount: number) {
  // conservative first canary policy
  const base = 30
  const cap = 3600
  const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attemptCount - 1)))
  return Math.floor(exp)
}

async function finalizeJobFailure(params: {
  job: JobRow
  runStepId: string | null
  errorCode: string
  errorMessage: string
  retriable: boolean
  uncertainSend?: boolean
  details?: JsonRecord
}) {
  const attemptCount = Number(params.job.attempt_count || 0) + 1
  const maxAttempts = Number(params.job.max_attempts || 5)
  const terminal = !params.retriable || attemptCount >= maxAttempts
  const now = nowIso()

  if (terminal) {
    await restPatch(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `workflow_jobs?id=eq.${encodeURIComponent(params.job.id)}&claim_token=eq.${encodeURIComponent(
        params.job.claim_token || ''
      )}`,
      {
        status: params.uncertainSend ? 'failed' : 'dead_letter',
        failed_at: now,
        attempt_count: attemptCount,
        lease_expires_at: null,
        last_error_code: params.errorCode,
        last_error_message: params.errorMessage,
        last_error_details: {
          ...(params.details || {}),
          uncertain_send: Boolean(params.uncertainSend),
        },
        updated_at: now,
      },
      'return=minimal'
    )

    if (params.runStepId) {
      await restPatch(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `workflow_run_steps?id=eq.${encodeURIComponent(params.runStepId)}`,
        {
          status: 'failed',
          failed_at: now,
          last_error_code: params.errorCode,
          last_error_message: params.errorMessage,
          attempt_count: attemptCount,
          updated_at: now,
        },
        'return=minimal'
      )
    }

    return
  }

  const retrySeconds = computeBackoffSeconds(attemptCount)
  const nextRetryAt = addSecondsIso(now, retrySeconds)

  await restPatch(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    `workflow_jobs?id=eq.${encodeURIComponent(params.job.id)}&claim_token=eq.${encodeURIComponent(
      params.job.claim_token || ''
    )}`,
    {
      status: 'retry_scheduled',
      attempt_count: attemptCount,
      next_retry_at: nextRetryAt,
      scheduled_at: nextRetryAt,
      available_at: nextRetryAt,
      lease_expires_at: null,
      last_error_code: params.errorCode,
      last_error_message: params.errorMessage,
      last_error_details: params.details || {},
      updated_at: now,
    },
    'return=minimal'
  )

  if (params.runStepId) {
    await restPatch(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `workflow_run_steps?id=eq.${encodeURIComponent(params.runStepId)}`,
      {
        status: 'scheduled',
        scheduled_at: nextRetryAt,
        attempt_count: attemptCount,
        last_error_code: params.errorCode,
        last_error_message: params.errorMessage,
        updated_at: now,
      },
      'return=minimal'
    )
  }
}

async function fetchEligibleJobs(limit: number) {
  const now = encodeURIComponent(nowIso())
  const nativeExecutableFilter = encodeURIComponent(JSON.stringify({ execute_native_email: true }))
  const path = pathWithSelect(
    `workflow_jobs?job_type=eq.send_email&queue_name=eq.email&or=(status.eq.queued,status.eq.scheduled,status.eq.retry_scheduled,status.eq.claimed)&payload=cs.${nativeExecutableFilter}&order=created_at.asc&limit=${Math.max(
      1,
      Math.min(limit, MAX_CLAIM_BATCH)
    )}`,
    'id,user_id,workflow_run_id,workflow_run_step_id,workflow_id,workflow_version_id,workflow_version_step_id,campaign_id,campaign_lead_id,job_type,queue_name,status,idempotency_key,payload,external_ref_type,external_ref_id,claim_token,attempt_count,max_attempts,lease_expires_at,scheduled_at,available_at'
  )

  const result = await restGet(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, path)
  if (!result.ok) return { rows: [] as JobRow[], error: new Error('Unable to fetch jobs') }

  const raw = asArray<JobRow>(result.data)
  const rows = raw.filter((row) => {
    const scheduledAt = (row as unknown as { scheduled_at?: string | null }).scheduled_at || null
    const availableAt = (row as unknown as { available_at?: string | null }).available_at || null

    if (row.status === 'claimed') return isLeaseExpired(row.lease_expires_at)
    if (scheduledAt && new Date(scheduledAt).getTime() > Date.now()) return false
    if (availableAt && new Date(availableAt).getTime() > Date.now()) return false
    return true
  })

  return { rows, error: null }
}

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatLeadName(lead: LeadRow) {
  return normalizeString(lead.full_name) || [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
}

function applyLeadTemplate(text: string, lead: LeadRow) {
  const name = formatLeadName(lead) || 'there'
  return text
    .replaceAll('{{first_name}}', normalizeString(lead.first_name) || name)
    .replaceAll('{{last_name}}', normalizeString(lead.last_name) || '')
    .replaceAll('{{full_name}}', name)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, message: 'Method not allowed' })

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return jsonResponse(500, { ok: false, message: 'Service configuration missing' })
  }

  const token = getBearerToken(req)
  const jwtRole = extractJwtRole(token)

  if (jwtRole !== 'service_role') {
    return jsonResponse(401, { ok: false, message: 'Unauthorized' })
  }

  const body = await req.json().catch(() => ({}))
  const payload = asRecord(body) || {}
  const workerId = normalizeString(payload.workerId) || `native-email-worker-${crypto.randomUUID().slice(0, 8)}`
  const batch = Number(payload.batch || MAX_CLAIM_BATCH)

  const fetched = await fetchEligibleJobs(batch)
  if (fetched.error) {
    return jsonResponse(500, { ok: false, message: fetched.error.message })
  }

  const summary = {
    scanned: fetched.rows.length,
    canaryBlocked: 0,
    shadowBlocked: 0,
    claimed: 0,
    skippedDuplicate: 0,
    skippedRunState: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    uncertain: 0,
  }

  const details: JsonRecord[] = []

  for (const candidate of fetched.rows) {
    try {
      if (!isCanaryAllowed(candidate)) {
        summary.canaryBlocked += 1
        console.log('[WorkflowEmailWorker] canary skip', { jobId: candidate.id, userId: candidate.user_id })
        continue
      }

      if (!isShadowModeDisabled(candidate)) {
        summary.shadowBlocked += 1
        console.log('[WorkflowEmailWorker] shadow-mode skip', { jobId: candidate.id })
        continue
      }

      const claim = await claimJob(candidate, workerId)
      if (claim.error || !claim.claimed || !claim.row?.id) continue
      summary.claimed += 1
      const job = claim.row

      const running = await moveClaimedToRunning(job.id, job.claim_token || '')
      if (!running.ok || !running.row?.id) continue

      await appendEvent({
        userId: job.user_id,
        workflowId: job.workflow_id,
        campaignId: job.campaign_id,
        campaignLeadId: job.campaign_lead_id,
        runId: job.workflow_run_id,
        runStepId: job.workflow_run_step_id,
        jobId: job.id,
        eventType: 'job_started',
        idempotencyKey: `native:job_started:${job.id}:${job.claim_token || 'none'}`,
        payload: { worker_id: workerId, shadow_mode: false },
      })

      // run state guard
      const runResult = await fetchRun(job.workflow_run_id)
      const run = runResult.row
      if (!run || ['paused', 'cancelled', 'failed'].includes(String(run.status || '').toLowerCase())) {
        summary.skippedRunState += 1
        await finalizeJobFailure({
          job,
          runStepId: job.workflow_run_step_id,
          errorCode: 'run_not_executable',
          errorMessage: `Run not executable: ${run?.status || 'missing'}`,
          retriable: false,
          details: { run_status: run?.status || null },
        })
        continue
      }

      // must be version-bound for canary native execution
      if (!run.workflow_version_id) {
        await finalizeJobFailure({
          job,
          runStepId: job.workflow_run_step_id,
          errorCode: 'workflow_version_required',
          errorMessage: 'Canary native execution requires workflow_version_id.',
          retriable: false,
        })
        summary.failed += 1
        continue
      }

      // idempotency across hybrid systems
      if (String(job.status).toLowerCase() === 'succeeded') {
        summary.skippedDuplicate += 1
        continue
      }

      const sentByOutbox = await findOutboxSentByIdempotency(job.user_id, job.idempotency_key)
      if (sentByOutbox.error) {
        await finalizeJobFailure({
          job,
          runStepId: job.workflow_run_step_id,
          errorCode: 'duplicate_check_failed',
          errorMessage: sentByOutbox.error.message,
          retriable: true,
        })
        summary.retried += 1
        continue
      }

      if (sentByOutbox.sent) {
        summary.skippedDuplicate += 1
        await restPatch(
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY,
          `workflow_jobs?id=eq.${encodeURIComponent(job.id)}&claim_token=eq.${encodeURIComponent(job.claim_token || '')}`,
          {
            status: 'succeeded',
            completed_at: nowIso(),
            lease_expires_at: null,
            result: {
              duplicate_prevented: true,
              reason: 'legacy_outbox_already_sent',
              legacy_outbox_id: sentByOutbox.row?.id || null,
            },
            updated_at: nowIso(),
          },
          'return=minimal'
        )

        if (job.workflow_run_step_id) {
          await restPatch(
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY,
            `workflow_run_steps?id=eq.${encodeURIComponent(job.workflow_run_step_id)}`,
            {
              status: 'completed',
              completed_at: nowIso(),
              updated_at: nowIso(),
            },
            'return=minimal'
          )
        }

        await appendEvent({
          userId: job.user_id,
          workflowId: job.workflow_id,
          campaignId: job.campaign_id,
          campaignLeadId: job.campaign_lead_id,
          runId: job.workflow_run_id,
          runStepId: job.workflow_run_step_id,
          jobId: job.id,
          eventType: 'email_skipped_duplicate',
          idempotencyKey: `native:email_skipped_duplicate:${job.id}`,
          payload: {
            reason: 'legacy_outbox_already_sent',
            legacy_outbox_id: sentByOutbox.row?.id || null,
          },
        })

        if (job.workflow_run_step_id) {
          await advanceWorkflowRunShadow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            runId: job.workflow_run_id,
            completedRunStepId: job.workflow_run_step_id,
            initiatedBy: 'worker',
          })
        }

        continue
      }

      // claim corresponding legacy outbox row (compatibility ledger + race prevention)
      const outboxRefResult = await fetchOutboxByExternalRef(job)
      if (outboxRefResult.error) {
        await finalizeJobFailure({
          job,
          runStepId: job.workflow_run_step_id,
          errorCode: 'outbox_ref_lookup_failed',
          errorMessage: outboxRefResult.error.message,
          retriable: true,
        })
        summary.retried += 1
        continue
      }

      const outboxClaim = await claimLegacyOutboxForNative(job, outboxRefResult.row)
      if (!outboxClaim.ok) {
        await finalizeJobFailure({
          job,
          runStepId: job.workflow_run_step_id,
          errorCode: 'outbox_claim_failed',
          errorMessage: 'Unable to claim legacy outbox row for native execution.',
          retriable: true,
        })
        summary.retried += 1
        continue
      }

      if (!outboxClaim.claimed && outboxClaim.reason !== 'no_outbox_ref') {
        await finalizeJobFailure({
          job,
          runStepId: job.workflow_run_step_id,
          errorCode: 'outbox_not_claimable',
          errorMessage: `Legacy outbox not claimable: ${outboxClaim.reason}`,
          retriable: false,
        })
        summary.skippedDuplicate += 1
        continue
      }

      // resolve required entities for send
      if (!job.workflow_run_step_id) {
        await finalizeJobFailure({
          job,
          runStepId: null,
          errorCode: 'run_step_missing',
          errorMessage: 'workflow_run_step_id is required for native send.',
          retriable: false,
        })
        summary.failed += 1
        continue
      }

      const runStepResult = await fetchRunStep(job.workflow_run_step_id)
      const runStep = runStepResult.row
      if (!runStep) {
        await finalizeJobFailure({
          job,
          runStepId: job.workflow_run_step_id,
          errorCode: 'run_step_not_found',
          errorMessage: 'Run step not found.',
          retriable: false,
        })
        summary.failed += 1
        continue
      }

      const versionStepResult = await fetchVersionStep(runStep, run)
      const versionStep = versionStepResult.row
      if (!versionStep) {
        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: 'version_step_unresolved',
          errorMessage: 'Unable to resolve immutable version step.',
          retriable: false,
        })
        summary.failed += 1
        continue
      }

      if (String(versionStep.step_type || '').toLowerCase() !== 'email') {
        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: 'step_not_email',
          errorMessage: 'Resolved version step is not email.',
          retriable: false,
        })
        summary.failed += 1
        continue
      }

      const leadResult = job.campaign_lead_id
        ? await fetchLead(job.campaign_lead_id, job.user_id)
        : { row: null as LeadRow | null, error: new Error('campaign_lead_id missing') }
      const lead = leadResult.row
      if (!lead?.email) {
        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: 'lead_email_missing',
          errorMessage: 'Lead email missing.',
          retriable: false,
        })
        if (outboxRefResult.row?.id && outboxClaim.claimed) {
          await releaseOutboxNativeClaim(
            outboxRefResult.row.id,
            'lead_email_missing',
            'Lead email missing.',
            outboxClaim.claimedAt
          )
        }
        summary.failed += 1
        continue
      }

      const subjectRaw = normalizeString(versionStep.subject)
      const bodyRaw = normalizeString(versionStep.body)
      if (!subjectRaw || !bodyRaw) {
        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: 'step_content_missing',
          errorMessage: 'Step subject/body missing.',
          retriable: false,
        })
        if (outboxRefResult.row?.id && outboxClaim.claimed) {
          await releaseOutboxNativeClaim(
            outboxRefResult.row.id,
            'step_content_missing',
            'Step subject/body missing.',
            outboxClaim.claimedAt
          )
        }
        summary.failed += 1
        continue
      }

      const subject = applyLeadTemplate(subjectRaw, lead)
      const text = applyLeadTemplate(bodyRaw, lead)

      // one more pause/cancel guard right before side effect
      const runFresh = await fetchRun(job.workflow_run_id)
      if (!runFresh.row || ['paused', 'cancelled', 'failed'].includes(String(runFresh.row.status || '').toLowerCase())) {
        summary.skippedRunState += 1
        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: 'run_not_executable_pre_send',
          errorMessage: `Run not executable before send: ${runFresh.row?.status || 'missing'}`,
          retriable: false,
          details: { run_status: runFresh.row?.status || null },
        })
        if (outboxRefResult.row?.id && outboxClaim.claimed) {
          await releaseOutboxNativeClaim(
            outboxRefResult.row.id,
            'run_not_executable_pre_send',
            `Run not executable before send: ${runFresh.row?.status || 'missing'}`,
            outboxClaim.claimedAt
          )
        }
        continue
      }

      const connLookup = await loadGmailConnection(job.user_id)
      const connection = connLookup.connection
      if (!connLookup.ok || !connection) {
        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: 'gmail_not_connected',
          errorMessage: 'Gmail not connected.',
          retriable: false,
        })
        if (outboxRefResult.row?.id && outboxClaim.claimed) {
          await releaseOutboxNativeClaim(
            outboxRefResult.row.id,
            'gmail_not_connected',
            'Gmail not connected.',
            outboxClaim.claimedAt
          )
        }
        summary.failed += 1
        continue
      }

      let accessToken = await coreDecryptToken(connection.access_token_enc || null, TOKEN_ENCRYPTION_KEY)
      let refreshToken = await coreDecryptToken(connection.refresh_token_enc || null, TOKEN_ENCRYPTION_KEY)

      if (!accessToken || coreIsTokenExpired(connection.expires_at)) {
        if (!refreshToken) {
          await finalizeJobFailure({
            job,
            runStepId: runStep.id,
            errorCode: 'google_reauth_required',
            errorMessage: 'Refresh token missing.',
            retriable: false,
          })
          summary.failed += 1
          continue
        }

        console.log('[WorkflowEmailWorker] token refresh', { jobId: job.id, userId: job.user_id })

        const refresh = await coreRefreshGoogleToken(refreshToken, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
        if (!refresh.ok || !refresh.data) {
          await finalizeJobFailure({
            job,
            runStepId: runStep.id,
            errorCode: 'token_refresh_failed',
            errorMessage: 'Unable to refresh Gmail token.',
            retriable: true,
            details: { provider_status: refresh.status, provider_error: refresh.error || null },
          })
          if (outboxRefResult.row?.id && outboxClaim.claimed) {
            await releaseOutboxNativeClaim(
              outboxRefResult.row.id,
              'token_refresh_failed',
              'Unable to refresh Gmail token.',
              outboxClaim.claimedAt
            )
          }
          summary.retried += 1
          continue
        }

        accessToken = refresh.data.accessToken
        refreshToken = refresh.data.refreshToken || refreshToken

        const expiresAt = refresh.data.expiresIn
          ? new Date(Date.now() + refresh.data.expiresIn * 1000).toISOString()
          : connection.expires_at || null

        const persisted = await persistTokens({
          connectionId: connection.id,
          accessToken,
          refreshToken,
          expiresAt,
        })

        if (!persisted.ok) {
          await finalizeJobFailure({
            job,
            runStepId: runStep.id,
            errorCode: 'token_persist_failed',
            errorMessage: 'Token refresh succeeded but persist failed.',
            retriable: true,
          })
          if (outboxRefResult.row?.id && outboxClaim.claimed) {
            await releaseOutboxNativeClaim(
              outboxRefResult.row.id,
              'token_persist_failed',
              'Token refresh succeeded but persist failed.',
              outboxClaim.claimedAt
            )
          }
          summary.retried += 1
          continue
        }
      }

      if (!accessToken) {
        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: 'google_reauth_required',
          errorMessage: 'No usable access token.',
          retriable: false,
        })
        if (outboxRefResult.row?.id && outboxClaim.claimed) {
          await releaseOutboxNativeClaim(
            outboxRefResult.row.id,
            'google_reauth_required',
            'No usable access token.',
            outboxClaim.claimedAt
          )
        }
        summary.failed += 1
        continue
      }

      const fromEmail = connection.connected_email || 'no-reply@heynova.app'
      const mime = coreBuildMimeMessage({
        fromEmail,
        to: lead.email,
        subject,
        text,
        html: null,
        encodeNonAsciiSubject: true,
        deriveTextFromHtmlIfMissing: false,
      })
      const raw = coreEncodeBase64Url(mime)

      console.log('[WorkflowEmailWorker] send attempt', {
        jobId: job.id,
        runId: job.workflow_run_id,
        runStepId: runStep.id,
        to_domain: lead.email.split('@')[1] || null,
      })

      const preSendFence = await fencePreSendOwnership({
        job,
        outbox: outboxRefResult.row,
        outboxClaimedAt: outboxClaim.claimedAt,
      })

      if (!preSendFence.ok) {
        const fenceCode = preSendFence.code || 'ownership_fence_failed'
        const fenceReason = preSendFence.reason || 'Ownership validation failed before send.'

        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: fenceCode,
          errorMessage: fenceReason,
          retriable: true,
        })

        if (outboxRefResult.row?.id && outboxClaim.claimed) {
          const released = await releaseOutboxNativeClaim(
            outboxRefResult.row.id,
            fenceCode,
            fenceReason,
            outboxClaim.claimedAt
          )
          if (!released?.ok) {
            console.error('[WorkflowEmailWorker] outbox claim release failed after pre-send fence rejection', {
              jobId: job.id,
              outboxId: outboxRefResult.row.id,
              reason: released?.error || 'unknown',
            })
          }
        }

        summary.retried += 1
        continue
      }

      const retryResult = await sendWith401RetryShared(
        {
          accessToken,
          refreshToken,
          raw,
          connectionId: connection.id,
          connectionExpiresAt: connection.expires_at || null,
        },
        {
          send: coreSendViaGmail,
          refresh: (token: string) => coreRefreshGoogleToken(token, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET),
          persist: persistTokens,
          beforeRetry: async () => {
            const runRetry = await fetchRun(job.workflow_run_id)
            const runRetryRow = runRetry.row
            if (!runRetryRow || ['paused', 'cancelled', 'failed'].includes(String(runRetryRow.status || '').toLowerCase())) {
              return {
                ok: false,
                code: 'run_not_executable_pre_retry',
                reason: `Run not executable before retry: ${runRetryRow?.status || 'missing'}`,
              }
            }

            return await fencePreSendOwnership({
              job,
              outbox: outboxRefResult.row,
              outboxClaimedAt: outboxClaim.claimedAt,
            })
          },
        }
      )

      accessToken = retryResult.accessToken
      refreshToken = retryResult.refreshToken
      let sendResult = retryResult.sendResult

      if (retryResult.retryBlocked) {
        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: retryResult.retryBlocked.code,
          errorMessage: retryResult.retryBlocked.reason,
          retriable: true,
        })

        if (outboxRefResult.row?.id && outboxClaim.claimed) {
          const released = await releaseOutboxNativeClaim(
            outboxRefResult.row.id,
            retryResult.retryBlocked.code,
            retryResult.retryBlocked.reason,
            outboxClaim.claimedAt
          )
          if (!released?.ok) {
            console.error('[WorkflowEmailWorker] outbox claim release failed after retry ownership rejection', {
              jobId: job.id,
              outboxId: outboxRefResult.row.id,
              reason: released?.error || 'unknown',
            })
          }
        }

        summary.retried += 1
        continue
      }

      if (!sendResult.ok) {
        if (sendResult.unreachable) {
          await finalizeJobFailure({
            job,
            runStepId: runStep.id,
            errorCode: 'provider_unreachable_uncertain_send',
            errorMessage: 'Gmail API unreachable; send outcome uncertain.',
            retriable: false,
            uncertainSend: true,
            details: { status: sendResult.status },
          })
          // keep native_claimed to avoid ambiguous duplicate sends; manual/operator reconciliation required.
          summary.uncertain += 1
          continue
        }

        const providerError =
          typeof sendResult.payload?.error === 'object' && sendResult.payload?.error !== null
            ? (sendResult.payload.error as Record<string, unknown>)
            : null
        const providerMessage =
          (typeof providerError?.message === 'string' && providerError.message) ||
          `Gmail send failed (${sendResult.status}).`

        const classification = classifyProviderFailure(sendResult.status, providerMessage)

        await finalizeJobFailure({
          job,
          runStepId: runStep.id,
          errorCode: classification.code,
          errorMessage: providerMessage,
          retriable: classification.type === 'retriable',
          details: { provider_status: sendResult.status },
        })

        if (outboxRefResult.row?.id && outboxClaim.claimed && classification.type === 'retriable') {
          const released = await releaseOutboxNativeClaim(
            outboxRefResult.row.id,
            classification.code,
            providerMessage,
            outboxClaim.claimedAt
          )
          if (!released?.ok) {
            console.error('[WorkflowEmailWorker] outbox claim release failed after retriable send error', {
              jobId: job.id,
              outboxId: outboxRefResult.row.id,
              reason: released?.error || 'unknown',
            })
          }
        }

        if (classification.type === 'retriable') summary.retried += 1
        else summary.failed += 1

        console.error('[WorkflowEmailWorker] send failed', {
          jobId: job.id,
          code: classification.code,
          providerStatus: sendResult.status,
          retriable: classification.type === 'retriable',
        })

        continue
      }

      const providerMessageId =
        (typeof sendResult.payload?.id === 'string' && sendResult.payload.id) || null

      const finalizeSuccess = await finalizeJobSuccess({
        job,
        runStepId: runStep.id,
        providerMessageId,
        gmailResponse: {
          id: providerMessageId,
          threadId:
            typeof sendResult.payload?.threadId === 'string' ? String(sendResult.payload.threadId) : null,
        },
      })

      if (!finalizeSuccess?.ok) {
        const failureReason = String(finalizeSuccess?.error || 'unknown')
        console.error('[WorkflowEmailWorker] post-send persistence failed (job finalization)', {
          jobId: job.id,
          runId: job.workflow_run_id,
          runStepId: runStep.id,
          providerMessageId,
          reason: failureReason,
        })

        const reconciliation = await recordReconciliationEvidence({
          job,
          runId: job.workflow_run_id,
          runStepId: runStep.id,
          workflowId: job.workflow_id,
          campaignId: job.campaign_id,
          campaignLeadId: job.campaign_lead_id,
          outboxId: outboxRefResult.row?.id || null,
          providerMessageId,
          stage: 'post_send_job_finalization_failed',
          errorCode: 'post_send_job_finalization_failed',
          errorMessage: failureReason,
        })

        if (!reconciliation.ok) {
          console.error('[WorkflowEmailWorker] reconciliation recording failed', {
            jobId: job.id,
            stage: 'post_send_job_finalization_failed',
          })
        }

        summary.uncertain += 1
        continue
      }

      if (outboxRefResult.row?.id && outboxClaim.claimed) {
        const outboxSent = await markOutboxSentFromNative(
          outboxRefResult.row.id,
          providerMessageId,
          Number(outboxRefResult.row.attempt_count || 0),
          outboxClaim.claimedAt
        )

        if (!outboxSent?.ok) {
          const failureReason = String(outboxSent?.error || 'unknown')
          console.error('[WorkflowEmailWorker] post-send persistence failed (outbox sent update)', {
            jobId: job.id,
            runId: job.workflow_run_id,
            runStepId: runStep.id,
            outboxId: outboxRefResult.row.id,
            providerMessageId,
            reason: failureReason,
          })

          const reconciliation = await recordReconciliationEvidence({
            job,
            runId: job.workflow_run_id,
            runStepId: runStep.id,
            workflowId: job.workflow_id,
            campaignId: job.campaign_id,
            campaignLeadId: job.campaign_lead_id,
            outboxId: outboxRefResult.row.id,
            providerMessageId,
            stage: 'post_send_outbox_update_failed',
            errorCode: 'post_send_outbox_update_failed',
            errorMessage: failureReason,
          })

          if (!reconciliation.ok) {
            console.error('[WorkflowEmailWorker] reconciliation recording failed', {
              jobId: job.id,
              stage: 'post_send_outbox_update_failed',
            })
          }

          summary.uncertain += 1
          continue
        }
      }

      const emailSentEvent = await appendEvent({
        userId: job.user_id,
        workflowId: job.workflow_id,
        campaignId: job.campaign_id,
        campaignLeadId: job.campaign_lead_id,
        runId: job.workflow_run_id,
        runStepId: runStep.id,
        jobId: job.id,
        eventType: 'email_sent',
        idempotencyKey: `native:email_sent:${job.id}`,
        payload: {
          provider: 'gmail',
          provider_message_id: providerMessageId,
          shadow_mode: false,
        },
      })

      if (!emailSentEvent.ok) {
        const reconciliation = await recordReconciliationEvidence({
          job,
          runId: job.workflow_run_id,
          runStepId: runStep.id,
          workflowId: job.workflow_id,
          campaignId: job.campaign_id,
          campaignLeadId: job.campaign_lead_id,
          outboxId: outboxRefResult.row?.id || null,
          providerMessageId,
          stage: 'post_send_event_append_failed',
          errorCode: 'post_send_event_append_failed',
          errorMessage: 'Failed to append email_sent event.',
        })
        if (!reconciliation.ok) {
          console.error('[WorkflowEmailWorker] reconciliation recording failed', {
            jobId: job.id,
            stage: 'post_send_event_append_failed',
          })
        }
      }

      const jobSucceededEvent = await appendEvent({
        userId: job.user_id,
        workflowId: job.workflow_id,
        campaignId: job.campaign_id,
        campaignLeadId: job.campaign_lead_id,
        runId: job.workflow_run_id,
        runStepId: runStep.id,
        jobId: job.id,
        eventType: 'job_succeeded',
        idempotencyKey: `native:job_succeeded:${job.id}`,
        payload: { provider: 'gmail', shadow_mode: false },
      })

      if (!jobSucceededEvent.ok) {
        const reconciliation = await recordReconciliationEvidence({
          job,
          runId: job.workflow_run_id,
          runStepId: runStep.id,
          workflowId: job.workflow_id,
          campaignId: job.campaign_id,
          campaignLeadId: job.campaign_lead_id,
          outboxId: outboxRefResult.row?.id || null,
          providerMessageId,
          stage: 'post_send_event_append_failed',
          errorCode: 'post_send_event_append_failed',
          errorMessage: 'Failed to append job_succeeded event.',
        })
        if (!reconciliation.ok) {
          console.error('[WorkflowEmailWorker] reconciliation recording failed', {
            jobId: job.id,
            stage: 'post_send_event_append_failed',
          })
        }
      }

      // advance run after successful real execution
      const advanceResult = await advanceWorkflowRunShadow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        runId: job.workflow_run_id,
        completedRunStepId: runStep.id,
        initiatedBy: 'worker',
      })

      if (!advanceResult.ok) {
        const reconciliation = await recordReconciliationEvidence({
          job,
          runId: job.workflow_run_id,
          runStepId: runStep.id,
          workflowId: job.workflow_id,
          campaignId: job.campaign_id,
          campaignLeadId: job.campaign_lead_id,
          outboxId: outboxRefResult.row?.id || null,
          providerMessageId,
          stage: 'post_send_advancement_failed',
          errorCode: 'post_send_advancement_failed',
          errorMessage: String(advanceResult.message || 'Advancement failed.'),
        })
        if (!reconciliation.ok) {
          console.error('[WorkflowEmailWorker] reconciliation recording failed', {
            jobId: job.id,
            stage: 'post_send_advancement_failed',
          })
        }
      }

      summary.sent += 1
      details.push({ jobId: job.id, providerMessageId })

      console.log('[WorkflowEmailWorker] send success', {
        jobId: job.id,
        runId: job.workflow_run_id,
        runStepId: runStep.id,
        providerMessageId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[WorkflowEmailWorker] unexpected error', { message })
    }
  }

  return jsonResponse(200, {
    ok: true,
    workerId,
    shadow_mode: false,
    summary,
    details,
  })
})
