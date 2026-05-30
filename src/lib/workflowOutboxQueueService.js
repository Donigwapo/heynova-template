import { supabase } from './supabase'
import { logSupabaseQueryError } from './queryLogger'
import { buildWorkflowEmailIdempotencyKey } from './workflowDeliveryOutboxService'

const CHANNEL_EMAIL = 'email'

function nowIso() {
  return new Date().toISOString()
}

export async function enqueueWorkflowEmailJobsOnActivate({ workflowId, userId, campaignId }) {
  if (!workflowId || !userId || !campaignId) {
    return {
      queuedCount: 0,
      requeuedCount: 0,
      skippedCount: 0,
      error: new Error('Missing workflowId, userId, or campaignId'),
    }
  }

  console.log('[WorkflowEmailTest][Outbox] enqueue start', {
    workflowId,
    userId,
    campaignId,
    channel: CHANNEL_EMAIL,
  })

  const { data: stepRow, error: stepError } = await supabase
    .from('workflow_steps')
    .select('id,step_order,step_type,subject,body')
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)
    .eq('step_type', 'email')
    .order('step_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (stepError) {
    logSupabaseQueryError({
      table: 'workflow_steps',
      operation: 'select first persisted email step for enqueue',
      userId,
      error: stepError,
      extra: { workflowId },
    })

    return { queuedCount: 0, requeuedCount: 0, skippedCount: 0, error: stepError }
  }

  if (!stepRow?.id) {
    return {
      queuedCount: 0,
      requeuedCount: 0,
      skippedCount: 0,
      error: new Error('No persisted email step found. Save workflow before activating.'),
    }
  }

  const { data: leadRows, error: leadsError } = await supabase
    .from('campaign_leads')
    .select('id,email,full_name')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .not('email', 'is', null)
    .neq('email', '')

  if (leadsError) {
    logSupabaseQueryError({
      table: 'campaign_leads',
      operation: 'select eligible email leads for enqueue',
      userId,
      error: leadsError,
      extra: { campaignId, workflowId },
    })

    return { queuedCount: 0, requeuedCount: 0, skippedCount: 0, error: leadsError }
  }

  const leads = Array.isArray(leadRows) ? leadRows : []
  if (leads.length === 0) {
    return { queuedCount: 0, requeuedCount: 0, skippedCount: 0, error: null }
  }

  const keyed = []
  for (const lead of leads) {
    const key = await buildWorkflowEmailIdempotencyKey({
      userId,
      workflowId,
      workflowStepId: stepRow.id,
      campaignLeadId: lead.id,
      channel: CHANNEL_EMAIL,
    })

    keyed.push({
      lead,
      idempotencyKey: key,
    })
  }

  const keys = keyed.map((item) => item.idempotencyKey)

  const { data: existingRows, error: existingError } = await supabase
    .from('workflow_delivery_outbox')
    .select('id,idempotency_key,status,attempt_count')
    .eq('user_id', userId)
    .in('idempotency_key', keys)

  if (existingError) {
    logSupabaseQueryError({
      table: 'workflow_delivery_outbox',
      operation: 'select existing by idempotency for enqueue',
      userId,
      error: existingError,
      extra: { workflowId, campaignId, keysCount: keys.length },
    })

    return { queuedCount: 0, requeuedCount: 0, skippedCount: 0, error: existingError }
  }

  const existingByKey = new Map((existingRows || []).map((row) => [row.idempotency_key, row]))

  const insertRows = []
  const failedRowIdsToRequeue = []
  let skippedCount = 0

  for (const item of keyed) {
    const existing = existingByKey.get(item.idempotencyKey)

    if (!existing) {
      insertRows.push({
        user_id: userId,
        workflow_id: workflowId,
        workflow_step_id: stepRow.id,
        campaign_id: campaignId,
        campaign_lead_id: item.lead.id,
        channel: CHANNEL_EMAIL,
        status: 'queued',
        idempotency_key: item.idempotencyKey,
        claimed_at: null,
        attempt_count: 0,
        payload: {
          to: item.lead.email,
          subject: stepRow.subject || '',
          text: stepRow.body || '',
          mode: 'activation_enqueue',
        },
      })
      continue
    }

    if (existing.status === 'failed') {
      failedRowIdsToRequeue.push(existing.id)
      continue
    }

    skippedCount += 1
  }

  let queuedCount = 0
  let requeuedCount = 0

  if (insertRows.length > 0) {
    const { error: insertError } = await supabase
      .from('workflow_delivery_outbox')
      .insert(insertRows)

    if (insertError) {
      logSupabaseQueryError({
        table: 'workflow_delivery_outbox',
        operation: 'insert queued rows on activate',
        userId,
        error: insertError,
        extra: { workflowId, campaignId, rows: insertRows.length },
      })
      return { queuedCount: 0, requeuedCount: 0, skippedCount, error: insertError }
    }

    queuedCount = insertRows.length
  }

  if (failedRowIdsToRequeue.length > 0) {
    const { error: requeueError } = await supabase
      .from('workflow_delivery_outbox')
      .update({
        status: 'queued',
        claimed_at: null,
        error_code: null,
        error_message: null,
        updated_at: nowIso(),
      })
      .eq('user_id', userId)
      .in('id', failedRowIdsToRequeue)

    if (requeueError) {
      logSupabaseQueryError({
        table: 'workflow_delivery_outbox',
        operation: 'requeue failed rows on activate',
        userId,
        error: requeueError,
        extra: { workflowId, failedRows: failedRowIdsToRequeue.length },
      })
      return { queuedCount, requeuedCount: 0, skippedCount, error: requeueError }
    }

    requeuedCount = failedRowIdsToRequeue.length
  }

  console.log('[WorkflowEmailTest][Outbox] enqueue complete', {
    workflowId,
    campaignId,
    stepId: stepRow.id,
    eligibleLeads: leads.length,
    queuedCount,
    requeuedCount,
    skippedCount,
  })

  return { queuedCount, requeuedCount, skippedCount, error: null }
}
