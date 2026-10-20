import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyLegacyExecutionRisk } from './_guard.js'

test('legacy executor allows rows without native execution marker', () => {
  const result = classifyLegacyExecutionRisk({
    payload: { shadow_mode: true },
  })

  assert.equal(result.block, false)
  assert.equal(result.reason, 'legacy_execution_allowed')
})

test('legacy executor blocks rows explicitly marked execute_native_email=true', () => {
  const result = classifyLegacyExecutionRisk({
    payload: { execute_native_email: true, shadow_mode: false },
  })

  assert.equal(result.block, true)
  assert.equal(result.code, 'native_execution_required')
})

test('legacy executor handles missing payload safely', () => {
  const result = classifyLegacyExecutionRisk({
    payload: null,
  })

  assert.equal(result.block, false)
})
