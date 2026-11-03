import test from 'node:test'
import assert from 'node:assert/strict'

import { buildRunExecutionMetadata } from './_native-run-metadata.js'

test('native run metadata preserves outbox metadata and marks native execution', () => {
  const outbox = {
    id: 'out-1',
    status: 'queued',
    payload: {
      to: 'donnirhey4blog@gmail.com',
      mode: 'activation_enqueue',
    },
  }

  const result = buildRunExecutionMetadata({ nativeEligible: true, reason: 'native_allowlisted' }, outbox)

  assert.equal(result.execute_native_email, true)
  assert.equal(result.shadow_mode, false)
  assert.equal(result.execution_path, 'native')
  assert.equal(result.source, 'native_activation_sync')
  assert.equal(result.native_eligibility_reason, 'native_allowlisted')
  assert.equal(result.to, 'donnirhey4blog@gmail.com')
  assert.equal(result.outbox_id, 'out-1')
})

test('shadow run metadata preserves outbox metadata and stays shadow', () => {
  const outbox = {
    id: 'out-2',
    status: 'queued',
    payload: {
      to: 'donnirhey4blog@gmail.com',
    },
  }

  const result = buildRunExecutionMetadata({ nativeEligible: false, reason: 'workflow_not_allowlisted' }, outbox)

  assert.equal(result.execute_native_email, false)
  assert.equal(result.shadow_mode, true)
  assert.equal(result.execution_path, 'shadow')
  assert.equal(result.source, 'legacy_outbox_enqueue')
  assert.equal(result.native_eligibility_reason, 'workflow_not_allowlisted')
  assert.equal(result.outbox_id, 'out-2')
})
