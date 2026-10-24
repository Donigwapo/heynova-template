import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import {
  buildConfig,
  validateConfig,
  runSingleIteration,
  invokeDelayTick,
  buildSafeLogContext,
} from './delay-workflow-scheduler-lib.js'

function tempLock(name) {
  return path.join(os.tmpdir(), `heynova-delay-${name}-${Date.now()}-${Math.random()}.lock`)
}

test('buildConfig defaults disabled and maxCount 1', () => {
  const cfg = buildConfig({})
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.executeEnabled, false)
  assert.equal(cfg.intervalMs, 60000)
  assert.equal(cfg.timeoutMs, 45000)
  assert.equal(cfg.maxCount, 1)
})

test('disabled scheduler never invokes function', async () => {
  const cfg = buildConfig({
    DELAY_SCHEDULER_ENABLED: 'false',
    DELAY_SCHEDULER_EXECUTE: 'false',
  })

  let called = 0
  const result = await runSingleIteration(cfg, {
    fetchFn: async () => {
      called += 1
      return { ok: true, status: 200, async json() { return { ok: true } } }
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'SCHEDULER_DISABLED')
  assert.equal(called, 0)
})

test('missing canary identifiers block execution', async () => {
  const cfg = buildConfig({
    DELAY_SCHEDULER_ENABLED: 'true',
    DELAY_SCHEDULER_EXECUTE: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'x',
    DELAY_SCHEDULER_CANARY_USER_ID: '',
    DELAY_SCHEDULER_CANARY_WORKFLOW_ID: '',
  })

  const check = validateConfig(cfg)
  assert.equal(check.ok, false)
  assert.equal(check.code, 'MISSING_CANARY_IDENTIFIERS')
})

test('payload always includes userId, workflowId, and maxCount=1', async () => {
  let capturedBody = null
  const cfg = buildConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'x',
    DELAY_SCHEDULER_CANARY_USER_ID: 'u1',
    DELAY_SCHEDULER_CANARY_WORKFLOW_ID: 'w1',
  })

  const result = await invokeDelayTick(cfg, {
    fetchFn: async (_url, init) => {
      capturedBody = JSON.parse(String(init.body))
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true }
        },
      }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(capturedBody, {
    userId: 'u1',
    workflowId: 'w1',
    maxCount: 1,
  })
})

test('failed HTTP request does not trigger immediate retries', async () => {
  const cfg = buildConfig({
    DELAY_SCHEDULER_ENABLED: 'true',
    DELAY_SCHEDULER_EXECUTE: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'x',
    DELAY_SCHEDULER_CANARY_USER_ID: 'u1',
    DELAY_SCHEDULER_CANARY_WORKFLOW_ID: 'w1',
    DELAY_SCHEDULER_LOCK_PATH: tempLock('fail'),
  })

  let called = 0
  const result = await runSingleIteration(cfg, {
    fetchFn: async () => {
      called += 1
      throw new Error('network down')
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.skipped, false)
  assert.equal(called, 1)
})

test('safe log context never exposes credentials', () => {
  const cfg = buildConfig({
    DELAY_SCHEDULER_ENABLED: 'true',
    DELAY_SCHEDULER_EXECUTE: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'super-secret-token',
    DELAY_SCHEDULER_CANARY_USER_ID: 'u1',
    DELAY_SCHEDULER_CANARY_WORKFLOW_ID: 'w1',
  })

  const safe = buildSafeLogContext(cfg)
  const serialized = JSON.stringify(safe)
  assert.equal(serialized.includes('super-secret-token'), false)
  assert.equal(serialized.includes('serviceRoleToken'), false)
})

test('overlap lock prevents concurrent invocation', async () => {
  const lockPath = tempLock('overlap')
  await fs.writeFile(lockPath, 'occupied')

  const cfg = buildConfig({
    DELAY_SCHEDULER_ENABLED: 'true',
    DELAY_SCHEDULER_EXECUTE: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'x',
    DELAY_SCHEDULER_CANARY_USER_ID: 'u1',
    DELAY_SCHEDULER_CANARY_WORKFLOW_ID: 'w1',
    DELAY_SCHEDULER_LOCK_PATH: lockPath,
  })

  const result = await runSingleIteration(cfg, {
    fetchFn: async () => {
      throw new Error('should not call fetch')
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'OVERLAP_GUARD')

  await fs.rm(lockPath, { force: true })
})
