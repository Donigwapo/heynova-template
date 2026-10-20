import test from 'node:test'
import assert from 'node:assert/strict'

import { buildOutboxPayloadForNativeExecution } from '../workflow-shadow-activation-sync/_outbox-native-marker.js'
import { claimLegacyOutboxForNativeCore } from '../workflow-email-native-worker/_outbox-claim.js'
import { classifyLegacyExecutionRisk } from '../workflow-outbox-execute-email/_guard.js'

test('activation marker persists execute_native_email in outbox payload, legacy blocks, native can claim queued outbox', async () => {
  const outbox = {
    id: 'outbox-1',
    status: 'queued',
    claimed_at: null,
    payload: { to: 'lead@example.com', subject: 'Hello' },
  }

  const markedPayload = buildOutboxPayloadForNativeExecution(outbox.payload, 'native_allowlisted')
  assert.equal(markedPayload.execute_native_email, true)
  assert.equal(markedPayload.execution_path, 'native')

  const legacyRisk = classifyLegacyExecutionRisk({ ...outbox, payload: markedPayload })
  assert.equal(legacyRisk.block, true)
  assert.equal(legacyRisk.code, 'native_execution_required')

  const claim = await claimLegacyOutboxForNativeCore(
    {
      job: { id: 'job-1' },
      outbox: { ...outbox, payload: markedPayload },
    },
    {
      supabaseUrl: 'http://local.test',
      serviceRoleKey: 'service-role',
      nowIso: () => '2026-10-19T00:00:00.000Z',
      restPatch: async (_url, _key, path, body) => {
        assert.match(path, /status=in\.\(queued,retry_scheduled\)/)
        assert.equal(body.status, 'native_claimed')
        return {
          ok: true,
          data: [{ id: 'outbox-1', status: 'native_claimed', claimed_at: '2026-10-19T00:00:00.000Z' }],
        }
      },
    }
  )

  assert.equal(claim.ok, true)
  assert.equal(claim.claimed, true)
  assert.equal(claim.reason, 'claimed')
})

test('native worker can proceed when outbox is already native_claimed, and legacy in_progress ownership is respected', async () => {
  const alreadyClaimed = await claimLegacyOutboxForNativeCore(
    {
      job: { id: 'job-2' },
      outbox: {
        id: 'outbox-2',
        status: 'native_claimed',
        claimed_at: '2026-10-19T00:00:01.000Z',
        payload: { execute_native_email: true },
      },
    },
    {
      supabaseUrl: 'http://local.test',
      serviceRoleKey: 'service-role',
      nowIso: () => '2026-10-19T00:00:02.000Z',
      restPatch: async () => ({ ok: true, data: [] }),
    }
  )

  assert.equal(alreadyClaimed.ok, true)
  assert.equal(alreadyClaimed.claimed, true)
  assert.equal(alreadyClaimed.reason, 'already_native_claimed')

  const legacyOwned = await claimLegacyOutboxForNativeCore(
    {
      job: { id: 'job-3' },
      outbox: {
        id: 'outbox-3',
        status: 'in_progress',
        claimed_at: '2026-10-19T00:00:03.000Z',
        payload: { execute_native_email: true },
      },
    },
    {
      supabaseUrl: 'http://local.test',
      serviceRoleKey: 'service-role',
      nowIso: () => '2026-10-19T00:00:04.000Z',
      restPatch: async () => ({ ok: true, data: [] }),
    }
  )

  assert.equal(legacyOwned.ok, true)
  assert.equal(legacyOwned.claimed, false)
  assert.equal(legacyOwned.reason, 'legacy_in_progress')
})

test('claim race returns lost_race and avoids false ownership', async () => {
  const result = await claimLegacyOutboxForNativeCore(
    {
      job: { id: 'job-4' },
      outbox: {
        id: 'outbox-4',
        status: 'queued',
        claimed_at: null,
        payload: { execute_native_email: true },
      },
    },
    {
      supabaseUrl: 'http://local.test',
      serviceRoleKey: 'service-role',
      nowIso: () => '2026-10-19T00:00:05.000Z',
      restPatch: async () => ({ ok: true, data: [] }),
    }
  )

  assert.equal(result.ok, true)
  assert.equal(result.claimed, false)
  assert.equal(result.reason, 'lost_race')
})
