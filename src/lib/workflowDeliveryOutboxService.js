import { supabase } from './supabase'
import { logSupabaseQueryError } from './queryLogger'

function toHex(bytes) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildWorkflowEmailIdempotencyKey({
  userId,
  workflowId,
  workflowStepId,
  campaignLeadId,
  channel = 'email',
}) {
  const raw = [userId, workflowId, workflowStepId, campaignLeadId, channel].join(':')
  const encoded = new TextEncoder().encode(raw)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const idempotencyKey = toHex(new Uint8Array(digest))

  console.log('[WorkflowEmailTest][Outbox] idempotency key generated', {
    userId,
    workflowId,
    workflowStepId,
    campaignLeadId,
    channel,
    idempotencyKeyPrefix: idempotencyKey.slice(0, 16),
  })

  return idempotencyKey
}

export async function fetchOutboxByIdempotencyKey({ userId, idempotencyKey }) {
  const { data, error } = await supabase
    .from('workflow_delivery_outbox')
    .select(
      'id,user_id,workflow_id,workflow_step_id,campaign_id,campaign_lead_id,channel,status,idempotency_key,attempt_count,sent_at,provider_message_id,error_code,error_message,last_attempt_at,created_at,updated_at'
    )
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'workflow_delivery_outbox',
      operation: 'select maybeSingle by idempotency',
      userId,
      error,
      extra: { idempotencyKeyPrefix: idempotencyKey.slice(0, 16) },
    })
    return { row: null, error }
  }

  return { row: data || null, error: null }
}

export async function upsertOutboxInProgress({
  userId,
  workflowId,
  workflowStepId,
  campaignId,
  campaignLeadId,
  channel,
  idempotencyKey,
  payload,
}) {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('workflow_delivery_outbox')
    .upsert(
      {
        user_id: userId,
        workflow_id: workflowId,
        workflow_step_id: workflowStepId,
        campaign_id: campaignId,
        campaign_lead_id: campaignLeadId,
        channel,
        idempotency_key: idempotencyKey,
        status: 'in_progress',
        last_attempt_at: now,
        error_code: null,
        error_message: null,
        payload: payload || {},
      },
      {
        onConflict: 'idempotency_key',
      }
    )
    .select(
      'id,user_id,workflow_id,workflow_step_id,campaign_id,campaign_lead_id,channel,status,idempotency_key,attempt_count,sent_at,provider_message_id,error_code,error_message,last_attempt_at,created_at,updated_at'
    )
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'workflow_delivery_outbox',
      operation: 'upsert in_progress by idempotency',
      userId,
      error,
      extra: { idempotencyKeyPrefix: idempotencyKey.slice(0, 16) },
    })
    return { row: null, error }
  }

  console.log('[WorkflowEmailTest][Outbox] upserted in_progress row', {
    rowId: data?.id || null,
    status: data?.status || null,
    attemptCount: Number(data?.attempt_count || 0),
    idempotencyKeyPrefix: idempotencyKey.slice(0, 16),
  })

  return { row: data || null, error: null }
}

export async function markOutboxSent({ userId, outboxId, providerMessageId, previousAttemptCount = 0 }) {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('workflow_delivery_outbox')
    .update({
      status: 'sent',
      sent_at: now,
      last_attempt_at: now,
      attempt_count: Number(previousAttemptCount || 0) + 1,
      provider_message_id: providerMessageId || null,
      error_code: null,
      error_message: null,
    })
    .eq('id', outboxId)
    .eq('user_id', userId)
    .select('id,status,attempt_count,sent_at,provider_message_id')
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'workflow_delivery_outbox',
      operation: 'update sent by id',
      userId,
      error,
      extra: { outboxId },
    })
    return { row: null, error }
  }

  console.log('[WorkflowEmailTest][Outbox] marked sent', {
    outboxId,
    attemptCount: Number(data?.attempt_count || 0),
    providerMessageId: data?.provider_message_id || null,
  })

  return { row: data || null, error: null }
}

export async function markOutboxFailed({
  userId,
  outboxId,
  errorCode,
  errorMessage,
  previousAttemptCount = 0,
}) {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('workflow_delivery_outbox')
    .update({
      status: 'failed',
      last_attempt_at: now,
      attempt_count: Number(previousAttemptCount || 0) + 1,
      error_code: errorCode || 'send_failed',
      error_message: errorMessage || 'Unknown send failure.',
    })
    .eq('id', outboxId)
    .eq('user_id', userId)
    .select('id,status,attempt_count,error_code,error_message,last_attempt_at')
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'workflow_delivery_outbox',
      operation: 'update failed by id',
      userId,
      error,
      extra: { outboxId, errorCode: errorCode || 'send_failed' },
    })
    return { row: null, error }
  }

  console.log('[WorkflowEmailTest][Outbox] marked failed', {
    outboxId,
    attemptCount: Number(data?.attempt_count || 0),
    errorCode: data?.error_code || null,
  })

  return { row: data || null, error: null }
}
