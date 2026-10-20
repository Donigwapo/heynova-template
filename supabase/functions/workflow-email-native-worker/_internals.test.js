import test from 'node:test'
import assert from 'node:assert/strict'

import {
  fencePreSendOwnershipCore,
  finalizeJobSuccessCore,
  markOutboxSentFromNativeCore,
  recordReconciliationEvidenceCore,
  releaseOutboxNativeClaimCore,
  sendWith401RetryShared,
} from './_internals.js'

function baseDeps(overrides = {}) {
  const calls = {
    restPatch: [],
    send: [],
    refresh: [],
    persist: [],
  }

  const deps = {
    supabaseUrl: 'http://local.test',
    serviceRoleKey: 'service-role',
    defaultLeaseSeconds: 120,
    nowIso: () => '2026-10-14T00:00:00.000Z',
    addSecondsIso: (base, sec) => new Date(new Date(base).getTime() + sec * 1000).toISOString(),
    restPatch: async (...args) => {
      calls.restPatch.push(args)
      const [,, path] = args
      if (path.startsWith('workflow_jobs')) {
        return { ok: true, data: [{ id: 'job-1' }] }
      }
      if (path.startsWith('workflow_delivery_outbox')) {
        return { ok: true, data: [{ id: 'outbox-1' }] }
      }
      if (path.startsWith('workflow_run_steps')) {
        return { ok: true, data: [{ id: 'step-1' }] }
      }
      return { ok: true, data: [] }
    },
    send: async (token, raw) => {
      calls.send.push({ token, raw })
      return { ok: true, status: 200, payload: { id: 'msg-1' } }
    },
    refresh: async (refreshToken) => {
      calls.refresh.push({ refreshToken })
      return {
        ok: true,
        data: { accessToken: 'new-token', refreshToken: 'new-refresh', expiresIn: 3600 },
      }
    },
    persist: async (payload) => {
      calls.persist.push(payload)
      return { ok: true }
    },
    ...overrides,
  }

  return { deps, calls }
}

const baseParams = {
  job: { id: 'job-1', claim_token: 'claim-1' },
  outbox: { id: 'outbox-1' },
  outboxClaimedAt: '2026-10-14T00:00:00.000Z',
}

test('ownership fence: valid owner passes and renews lease', async () => {
  const { deps, calls } = baseDeps()
  const result = await fencePreSendOwnershipCore(baseParams, deps)

  assert.equal(result.ok, true)
  assert.equal(calls.restPatch.length, 2)

  const [jobCall] = calls.restPatch
  assert.match(jobCall[2], /workflow_jobs\?id=eq\.job-1/)
  assert.match(jobCall[2], /status=eq\.running/)
  assert.match(jobCall[2], /claim_token=eq\.claim-1/)
  assert.match(jobCall[2], /lease_expires_at=gt\./)

  const jobPayload = jobCall[3]
  assert.equal(jobPayload.updated_at, '2026-10-14T00:00:00.000Z')
  assert.equal(jobPayload.lease_expires_at, '2026-10-14T00:02:00.000Z')
})

test('ownership fence: invalid claim token fails closed', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_jobs')) return { ok: true, data: [] }
      return { ok: true, data: [{ id: 'outbox-1' }] }
    },
  })

  const result = await fencePreSendOwnershipCore(baseParams, deps)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ownership_lost')
})

test('ownership fence: expired lease fails closed', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_jobs')) return { ok: true, data: [] }
      return { ok: true, data: [{ id: 'outbox-1' }] }
    },
  })

  const result = await fencePreSendOwnershipCore(baseParams, deps)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ownership_lost')
})

test('ownership fence: non-running job fails (empty ownership result)', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.includes('status=eq.running')) return { ok: true, data: [] }
      return { ok: true, data: [{ id: 'outbox-1' }] }
    },
  })

  const result = await fencePreSendOwnershipCore(baseParams, deps)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ownership_lost')
})

test('ownership fence: already-sent outbox fails', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_jobs')) return { ok: true, data: [{ id: 'job-1' }] }
      if (path.startsWith('workflow_delivery_outbox')) return { ok: true, data: [] }
      return { ok: true, data: [] }
    },
  })

  const result = await fencePreSendOwnershipCore(baseParams, deps)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'outbox_ownership_lost')
})

test('ownership fence: mismatched outbox claimed_at fails', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_jobs')) return { ok: true, data: [{ id: 'job-1' }] }
      if (path.includes('claimed_at=eq.2026-10-14T00%3A00%3A00.000Z')) return { ok: true, data: [] }
      return { ok: true, data: [{ id: 'outbox-1' }] }
    },
  })

  const result = await fencePreSendOwnershipCore(baseParams, deps)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'outbox_ownership_lost')
})

test('ownership fence: null claimed_at allowed (weaker ownership mode)', async () => {
  const { deps, calls } = baseDeps()
  const result = await fencePreSendOwnershipCore({ ...baseParams, outboxClaimedAt: null }, deps)

  assert.equal(result.ok, true)
  const [, outboxCall] = calls.restPatch
  assert.ok(!outboxCall[2].includes('claimed_at=eq.'))
})

test('ownership fence: database error on job validation fails closed', async () => {
  const { deps } = baseDeps({
    restPatch: async () => ({ ok: false, data: null }),
  })

  const result = await fencePreSendOwnershipCore(baseParams, deps)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ownership_check_failed')
})

test('ownership fence: database error on outbox validation fails closed', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_jobs')) return { ok: true, data: [{ id: 'job-1' }] }
      return { ok: false, data: null }
    },
  })

  const result = await fencePreSendOwnershipCore(baseParams, deps)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'outbox_check_failed')
})

test('401 retry behavior: retries once after refresh', async () => {
  const { deps, calls } = baseDeps({
    send: async (_token, _raw) => {
      const n = calls.send.length
      calls.send.push({})
      if (n === 0) return { ok: false, status: 401, payload: null }
      return { ok: true, status: 200, payload: { id: 'msg-1' } }
    },
  })

  const result = await sendWith401RetryShared(
    {
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      raw: 'mime',
      connectionId: 'conn-1',
      connectionExpiresAt: null,
    },
    deps
  )

  assert.equal(calls.send.length, 2)
  assert.equal(calls.refresh.length, 1)
  assert.equal(calls.persist.length, 1)
  assert.equal(result.sendResult.ok, true)
})

test('401 retry behavior: no refresh token means no retry', async () => {
  const { deps, calls } = baseDeps({
    send: async () => {
      calls.send.push({})
      return { ok: false, status: 401, payload: null }
    },
  })

  const result = await sendWith401RetryShared(
    {
      accessToken: 'old-token',
      refreshToken: null,
      raw: 'mime',
      connectionId: 'conn-1',
      connectionExpiresAt: null,
    },
    deps
  )

  assert.equal(calls.send.length, 1)
  assert.equal(calls.refresh.length, 0)
  assert.equal(result.sendResult.status, 401)
})

test('ownership failure path should not call Gmail (integration guard simulation)', async () => {
  const { deps, calls } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_jobs')) return { ok: true, data: [] }
      return { ok: true, data: [{ id: 'outbox-1' }] }
    },
  })

  const fence = await fencePreSendOwnershipCore(baseParams, deps)
  assert.equal(fence.ok, false)

  // Worker should skip calling send when fence fails.
  // This test proves fence exposes deterministic failure signal.
  assert.equal(calls.send.length, 0)
})

test('401 retry behavior: beforeRetry success allows second send', async () => {
  const { deps, calls } = baseDeps({
    send: async () => {
      const n = calls.send.length
      calls.send.push({})
      if (n === 0) return { ok: false, status: 401, payload: null }
      return { ok: true, status: 200, payload: { id: 'msg-2' } }
    },
    beforeRetry: async () => ({ ok: true }),
  })

  const result = await sendWith401RetryShared(
    {
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      raw: 'mime',
      connectionId: 'conn-1',
      connectionExpiresAt: null,
    },
    deps
  )

  assert.equal(result.retriedAfter401, true)
  assert.equal(calls.send.length, 2)
})

test('401 retry behavior: beforeRetry failure blocks second send', async () => {
  const { deps, calls } = baseDeps({
    send: async () => {
      const n = calls.send.length
      calls.send.push({})
      if (n === 0) return { ok: false, status: 401, payload: null }
      return { ok: true, status: 200, payload: { id: 'msg-2' } }
    },
    beforeRetry: async () => ({ ok: false, code: 'ownership_lost', reason: 'ownership lost' }),
  })

  const result = await sendWith401RetryShared(
    {
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      raw: 'mime',
      connectionId: 'conn-1',
      connectionExpiresAt: null,
    },
    deps
  )

  assert.equal(result.retriedAfter401, false)
  assert.equal(result.retryBlocked?.code, 'ownership_lost')
  assert.equal(calls.send.length, 1)
})

test('401 retry behavior: refresh failure prevents retry', async () => {
  const { deps, calls } = baseDeps({
    send: async () => {
      calls.send.push({})
      return { ok: false, status: 401, payload: null }
    },
    refresh: async () => ({ ok: false, data: null }),
  })

  const result = await sendWith401RetryShared(
    {
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      raw: 'mime',
      connectionId: 'conn-1',
      connectionExpiresAt: null,
    },
    deps
  )

  assert.equal(result.retriedAfter401, false)
  assert.equal(calls.send.length, 1)
  assert.equal(calls.refresh.length, 0) // custom refresh did not push
})

test('401 retry behavior: second attempt failure is returned', async () => {
  const { deps, calls } = baseDeps({
    send: async () => {
      const n = calls.send.length
      calls.send.push({})
      if (n === 0) return { ok: false, status: 401, payload: null }
      return { ok: false, status: 500, payload: { error: { message: 'server err' } } }
    },
  })

  const result = await sendWith401RetryShared(
    {
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      raw: 'mime',
      connectionId: 'conn-1',
      connectionExpiresAt: null,
    },
    deps
  )

  assert.equal(result.retriedAfter401, true)
  assert.equal(result.sendResult.status, 500)
  assert.equal(calls.send.length, 2)
})

test('non-401 provider failure does not trigger 401 retry path', async () => {
  const { deps, calls } = baseDeps({
    send: async () => {
      calls.send.push({})
      return { ok: false, status: 429, payload: { error: { message: 'rate limit' } } }
    },
  })

  const result = await sendWith401RetryShared(
    {
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      raw: 'mime',
      connectionId: 'conn-1',
      connectionExpiresAt: null,
    },
    deps
  )

  assert.equal(result.retriedAfter401, false)
  assert.equal(calls.send.length, 1)
  assert.equal(calls.persist.length, 0)
})

test('no more than two send attempts occur', async () => {
  const { deps, calls } = baseDeps({
    send: async () => {
      const n = calls.send.length
      calls.send.push({})
      if (n === 0) return { ok: false, status: 401, payload: null }
      return { ok: false, status: 401, payload: null }
    },
  })

  const result = await sendWith401RetryShared(
    {
      accessToken: 'old-token',
      refreshToken: 'refresh-1',
      raw: 'mime',
      connectionId: 'conn-1',
      connectionExpiresAt: null,
    },
    deps
  )

  assert.equal(calls.send.length, 2)
  assert.equal(result.attempts, 2)
  assert.equal(result.sendResult.status, 401)
})

test('outbox sent update: success requires one row', async () => {
  const { deps } = baseDeps()
  const result = await markOutboxSentFromNativeCore(
    {
      outboxId: 'outbox-1',
      providerMessageId: 'msg-1',
      priorAttemptCount: 0,
      claimedAt: '2026-10-14T00:00:00.000Z',
    },
    deps
  )

  assert.equal(result.ok, true)
  assert.equal(result.applied, true)
})

test('outbox sent update: zero-row is not success', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_delivery_outbox')) return { ok: true, data: [] }
      return { ok: true, data: [{ id: 'x' }] }
    },
  })

  const result = await markOutboxSentFromNativeCore(
    {
      outboxId: 'outbox-1',
      providerMessageId: 'msg-1',
      priorAttemptCount: 0,
      claimedAt: '2026-10-14T00:00:00.000Z',
    },
    deps
  )

  assert.equal(result.ok, false)
  assert.equal(result.error, 'ownership_lost_or_not_claimed')
})

test('outbox sent update: database error fails', async () => {
  const { deps } = baseDeps({
    restPatch: async () => ({ ok: false, data: null }),
  })

  const result = await markOutboxSentFromNativeCore(
    {
      outboxId: 'outbox-1',
      providerMessageId: 'msg-1',
      priorAttemptCount: 0,
      claimedAt: '2026-10-14T00:00:00.000Z',
    },
    deps
  )

  assert.equal(result.ok, false)
  assert.equal(result.error, 'patch_failed')
})

test('job finalization success: requires job and run_step updates', async () => {
  const { deps } = baseDeps()
  const result = await finalizeJobSuccessCore(
    {
      job: { id: 'job-1', claim_token: 'claim-1' },
      runStepId: 'step-1',
      providerMessageId: 'msg-1',
      gmailResponse: { id: 'msg-1' },
    },
    deps
  )

  assert.equal(result.ok, true)
  assert.equal(result.jobApplied, true)
  assert.equal(result.runStepApplied, true)
})

test('job finalization: zero-row job update is not success', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_jobs')) return { ok: true, data: [] }
      return { ok: true, data: [{ id: 'step-1' }] }
    },
  })

  const result = await finalizeJobSuccessCore(
    {
      job: { id: 'job-1', claim_token: 'claim-1' },
      runStepId: 'step-1',
      providerMessageId: 'msg-1',
      gmailResponse: { id: 'msg-1' },
    },
    deps
  )

  assert.equal(result.ok, false)
  assert.equal(result.error, 'job_ownership_lost')
})

test('job finalization: run_step patch failure reported', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_jobs')) return { ok: true, data: [{ id: 'job-1' }] }
      return { ok: false, data: null }
    },
  })

  const result = await finalizeJobSuccessCore(
    {
      job: { id: 'job-1', claim_token: 'claim-1' },
      runStepId: 'step-1',
      providerMessageId: 'msg-1',
      gmailResponse: { id: 'msg-1' },
    },
    deps
  )

  assert.equal(result.ok, false)
  assert.equal(result.error, 'run_step_patch_failed')
})

test('outbox release: zero-row is not success', async () => {
  const { deps } = baseDeps({
    restPatch: async (_u, _k, path) => {
      if (path.startsWith('workflow_delivery_outbox')) return { ok: true, data: [] }
      return { ok: true, data: [{ id: 'x' }] }
    },
  })

  const result = await releaseOutboxNativeClaimCore(
    {
      outboxId: 'outbox-1',
      errorCode: 'provider_transient',
      errorMessage: 'retry',
      claimedAt: '2026-10-14T00:00:00.000Z',
    },
    deps
  )

  assert.equal(result.ok, false)
  assert.equal(result.error, 'ownership_lost_or_not_claimed')
})

test('reconciliation evidence: event inserted when outbox persistence fails', async () => {
  const { deps } = baseDeps()

  const result = await recordReconciliationEvidenceCore(
    {
      userId: 'user-1',
      job: { id: 'job-1', claim_token: 'claim-1' },
      runId: 'run-1',
      runStepId: 'step-1',
      workflowId: 'wf-1',
      campaignId: 'camp-1',
      campaignLeadId: 'lead-1',
      outboxId: 'outbox-1',
      providerMessageId: 'msg-1',
      stage: 'post_send_outbox_update_failed',
      errorCode: 'post_send_outbox_update_failed',
      errorMessage: 'outbox update failed',
    },
    {
      ...deps,
      restInsert: async () => ({ ok: true, data: [{ id: 'evt-1' }] }),
      pathWithSelect: (_p, _s) => 'workflow_events?select=id',
    }
  )

  assert.equal(result.ok, true)
  assert.equal(result.eventPersisted, true)
})

test('reconciliation evidence: job finalization failure can persist job hint', async () => {
  const { deps } = baseDeps()

  const result = await recordReconciliationEvidenceCore(
    {
      userId: 'user-1',
      job: { id: 'job-1', claim_token: 'claim-1' },
      runId: 'run-1',
      runStepId: 'step-1',
      workflowId: 'wf-1',
      campaignId: 'camp-1',
      campaignLeadId: 'lead-1',
      outboxId: 'outbox-1',
      providerMessageId: 'msg-1',
      stage: 'post_send_job_finalization_failed',
      errorCode: 'post_send_job_finalization_failed',
      errorMessage: 'job finalization failed',
    },
    {
      ...deps,
      restInsert: async () => ({ ok: true, data: [{ id: 'evt-2' }] }),
      pathWithSelect: (_p, _s) => 'workflow_events?select=id',
    }
  )

  assert.equal(result.ok, true)
  assert.equal(result.jobHintPersisted, true)
})

test('reconciliation evidence: event write failure does not imply resend, preserves provider id in hint', async () => {
  const { deps } = baseDeps()

  const result = await recordReconciliationEvidenceCore(
    {
      userId: 'user-1',
      job: { id: 'job-1', claim_token: 'claim-1' },
      runId: 'run-1',
      runStepId: 'step-1',
      workflowId: 'wf-1',
      campaignId: 'camp-1',
      campaignLeadId: 'lead-1',
      outboxId: 'outbox-1',
      providerMessageId: 'msg-1',
      stage: 'post_send_event_append_failed',
      errorCode: 'post_send_event_append_failed',
      errorMessage: 'event append failed',
    },
    {
      ...deps,
      restInsert: async () => ({ ok: false, data: { error: 'insert failed' } }),
      pathWithSelect: (_p, _s) => 'workflow_events?select=id',
    }
  )

  assert.equal(result.ok, true)
  assert.equal(result.jobHintPersisted, true)
  assert.equal(result.eventPersisted, false)
})

test('reconciliation evidence: duplicate event idempotency treated as persisted', async () => {
  const { deps } = baseDeps()

  const result = await recordReconciliationEvidenceCore(
    {
      userId: 'user-1',
      job: { id: 'job-1', claim_token: 'claim-1' },
      runId: 'run-1',
      runStepId: 'step-1',
      workflowId: 'wf-1',
      campaignId: 'camp-1',
      campaignLeadId: 'lead-1',
      outboxId: 'outbox-1',
      providerMessageId: 'msg-1',
      stage: 'post_send_advancement_failed',
      errorCode: 'post_send_advancement_failed',
      errorMessage: 'advancement failed',
    },
    {
      ...deps,
      restInsert: async () => ({ ok: false, data: { message: 'duplicate key value violates unique constraint' } }),
      pathWithSelect: (_p, _s) => 'workflow_events?select=id',
    }
  )

  assert.equal(result.ok, true)
  assert.equal(result.eventPersisted, true)
})
