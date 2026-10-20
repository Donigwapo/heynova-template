export function asArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Executes the pre-send ownership fence used by native worker.
 * Returns fail-closed errors when ownership cannot be confirmed.
 */
export async function fencePreSendOwnershipCore(params, deps) {
  const now = deps.nowIso()
  const renewedLease = deps.addSecondsIso(now, deps.defaultLeaseSeconds)

  const jobPath =
    `workflow_jobs?id=eq.${encodeURIComponent(params.job.id)}` +
    `&status=eq.running` +
    `&claim_token=eq.${encodeURIComponent(params.job.claim_token || '')}` +
    `&lease_expires_at=gt.${encodeURIComponent(now)}`

  const jobPatch = await deps.restPatch(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    jobPath,
    {
      lease_expires_at: renewedLease,
      updated_at: now,
    },
    'return=representation'
  )

  if (!jobPatch.ok) {
    return { ok: false, code: 'ownership_check_failed', reason: 'Unable to validate running job ownership.' }
  }

  const ownedJob = asArray(jobPatch.data)[0] || null
  if (!ownedJob?.id) {
    return { ok: false, code: 'ownership_lost', reason: 'Job ownership lost or lease expired.' }
  }

  if (!params.outbox?.id) return { ok: true }

  const ownershipFilter = params.outboxClaimedAt
    ? `&claimed_at=eq.${encodeURIComponent(params.outboxClaimedAt)}`
    : ''

  const outboxPath =
    `workflow_delivery_outbox?id=eq.${encodeURIComponent(params.outbox.id)}` +
    `&status=eq.native_claimed` +
    `&sent_at=is.null` +
    `&provider_message_id=is.null` +
    ownershipFilter

  const outboxPatch = await deps.restPatch(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    outboxPath,
    {
      updated_at: now,
    },
    'return=representation'
  )

  if (!outboxPatch.ok) {
    return { ok: false, code: 'outbox_check_failed', reason: 'Unable to validate outbox ownership.' }
  }

  const ownedOutbox = asArray(outboxPatch.data)[0] || null
  if (!ownedOutbox?.id) {
    return { ok: false, code: 'outbox_ownership_lost', reason: 'Outbox no longer claim-owned or already sent.' }
  }

  return { ok: true }
}

export async function markOutboxSentFromNativeCore(params, deps) {
  const ownershipFilter = params.claimedAt ? `&claimed_at=eq.${encodeURIComponent(params.claimedAt)}` : ''
  const patch = await deps.restPatch(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    `workflow_delivery_outbox?id=eq.${encodeURIComponent(params.outboxId)}&status=eq.native_claimed${ownershipFilter}`,
    {
      status: 'sent',
      sent_at: deps.nowIso(),
      provider_message_id: params.providerMessageId,
      attempt_count: Number(params.priorAttemptCount || 0) + 1,
      last_attempt_at: deps.nowIso(),
      error_code: null,
      error_message: null,
      updated_at: deps.nowIso(),
    },
    'return=representation'
  )

  if (!patch.ok) return { ok: false, applied: false, error: 'patch_failed' }
  const row = asArray(patch.data)[0] || null
  if (!row?.id) return { ok: false, applied: false, error: 'ownership_lost_or_not_claimed' }
  return { ok: true, applied: true, row }
}

export async function releaseOutboxNativeClaimCore(params, deps) {
  const ownershipFilter = params.claimedAt ? `&claimed_at=eq.${encodeURIComponent(params.claimedAt)}` : ''
  const patch = await deps.restPatch(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    `workflow_delivery_outbox?id=eq.${encodeURIComponent(params.outboxId)}&status=eq.native_claimed${ownershipFilter}`,
    {
      status: 'queued',
      error_code: params.errorCode,
      error_message: params.errorMessage,
      last_attempt_at: deps.nowIso(),
      updated_at: deps.nowIso(),
    },
    'return=representation'
  )

  if (!patch.ok) return { ok: false, applied: false, error: 'patch_failed' }
  const row = asArray(patch.data)[0] || null
  if (!row?.id) return { ok: false, applied: false, error: 'ownership_lost_or_not_claimed' }
  return { ok: true, applied: true, row }
}

export async function recordReconciliationEvidenceCore(params, deps) {
  const now = deps.nowIso()
  let jobHintPersisted = false

  const jobPatch = await deps.restPatch(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    `workflow_jobs?id=eq.${encodeURIComponent(params.job.id)}&claim_token=eq.${encodeURIComponent(
      params.job.claim_token || ''
    )}`,
    {
      last_error_code: params.errorCode,
      last_error_message: params.errorMessage,
      last_error_details: {
        stage: params.stage,
        provider_message_id: params.providerMessageId || null,
        outbox_id: params.outboxId || null,
        run_step_id: params.runStepId || null,
        at: now,
      },
      updated_at: now,
    },
    'return=representation'
  )

  if (jobPatch.ok) {
    const jobRow = asArray(jobPatch.data)[0] || null
    if (jobRow?.id) jobHintPersisted = true
  }

  const eventInsert = await deps.restInsert(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    deps.pathWithSelect('workflow_events', 'id'),
    {
      user_id: params.userId,
      workflow_run_id: params.runId,
      workflow_run_step_id: params.runStepId,
      workflow_job_id: params.job.id,
      workflow_id: params.workflowId,
      campaign_id: params.campaignId,
      campaign_lead_id: params.campaignLeadId,
      event_type: 'reconciliation_required',
      event_source: 'workflow_email_native_worker',
      severity: 'error',
      idempotency_key: `native:reconcile:${params.stage}:${params.job.id}`,
      payload: {
        stage: params.stage,
        provider_message_id: params.providerMessageId || null,
        outbox_id: params.outboxId || null,
      },
      error_code: params.errorCode,
      error_message: params.errorMessage,
      occurred_at: now,
    }
  )

  let eventPersisted = false
  if (eventInsert.ok) {
    eventPersisted = true
  } else {
    const rec = typeof eventInsert.data === 'object' && eventInsert.data !== null ? eventInsert.data : null
    const msg = String(rec?.message || rec?.error || '')
    if (msg.toLowerCase().includes('duplicate key value')) eventPersisted = true
  }

  return {
    ok: jobHintPersisted || eventPersisted,
    jobHintPersisted,
    eventPersisted,
  }
}

export async function finalizeJobSuccessCore(params, deps) {
  const completedAt = deps.nowIso()

  const jobPatch = await deps.restPatch(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    `workflow_jobs?id=eq.${encodeURIComponent(params.job.id)}&claim_token=eq.${encodeURIComponent(
      params.job.claim_token || ''
    )}`,
    {
      status: 'succeeded',
      completed_at: completedAt,
      lease_expires_at: null,
      result: {
        provider: 'gmail',
        provider_message_id: params.providerMessageId,
        response: params.gmailResponse,
      },
      last_error_code: null,
      last_error_message: null,
      last_error_details: null,
      updated_at: completedAt,
    },
    'return=representation'
  )

  if (!jobPatch.ok) return { ok: false, jobApplied: false, runStepApplied: false, error: 'job_patch_failed' }
  const jobRow = asArray(jobPatch.data)[0] || null
  if (!jobRow?.id) return { ok: false, jobApplied: false, runStepApplied: false, error: 'job_ownership_lost' }

  if (!params.runStepId) return { ok: true, jobApplied: true, runStepApplied: true }

  const stepPatch = await deps.restPatch(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    `workflow_run_steps?id=eq.${encodeURIComponent(params.runStepId)}`,
    {
      status: 'completed',
      completed_at: completedAt,
      updated_at: completedAt,
    },
    'return=representation'
  )

  if (!stepPatch.ok) return { ok: false, jobApplied: true, runStepApplied: false, error: 'run_step_patch_failed' }
  const stepRow = asArray(stepPatch.data)[0] || null
  if (!stepRow?.id) return { ok: false, jobApplied: true, runStepApplied: false, error: 'run_step_not_updated' }

  return { ok: true, jobApplied: true, runStepApplied: true }
}

/**
 * Shared 401 refresh+single-retry behavior used by production worker and tests.
 * Allows an optional ownership/run revalidation hook before second send attempt.
 */
export async function sendWith401RetryShared(params, deps) {
  let accessToken = params.accessToken
  let refreshToken = params.refreshToken

  const firstSend = await deps.send(accessToken, params.raw)

  if (firstSend.ok || firstSend.status !== 401) {
    return {
      sendResult: firstSend,
      attempts: 1,
      retriedAfter401: false,
      refreshAttempted: false,
      retryBlocked: null,
      accessToken,
      refreshToken,
    }
  }

  if (!refreshToken) {
    return {
      sendResult: firstSend,
      attempts: 1,
      retriedAfter401: false,
      refreshAttempted: false,
      retryBlocked: null,
      accessToken,
      refreshToken,
    }
  }

  const refreshRetry = await deps.refresh(refreshToken)
  if (!refreshRetry.ok || !refreshRetry.data) {
    return {
      sendResult: firstSend,
      attempts: 1,
      retriedAfter401: false,
      refreshAttempted: true,
      retryBlocked: null,
      accessToken,
      refreshToken,
      refreshResult: refreshRetry,
    }
  }

  accessToken = refreshRetry.data.accessToken
  refreshToken = refreshRetry.data.refreshToken || refreshToken

  await deps.persist({
    connectionId: params.connectionId,
    accessToken,
    refreshToken,
    expiresAt: refreshRetry.data.expiresIn
      ? new Date(Date.now() + refreshRetry.data.expiresIn * 1000).toISOString()
      : params.connectionExpiresAt || null,
  })

  if (typeof deps.beforeRetry === 'function') {
    const gate = await deps.beforeRetry()
    if (!gate?.ok) {
      return {
        sendResult: firstSend,
        attempts: 1,
        retriedAfter401: false,
        refreshAttempted: true,
        retryBlocked: {
          code: gate?.code || 'retry_precondition_failed',
          reason: gate?.reason || 'Retry precondition failed.',
        },
        accessToken,
        refreshToken,
      }
    }
  }

  const secondSend = await deps.send(accessToken, params.raw)
  return {
    sendResult: secondSend,
    attempts: 2,
    retriedAfter401: true,
    refreshAttempted: true,
    retryBlocked: null,
    accessToken,
    refreshToken,
  }
}
