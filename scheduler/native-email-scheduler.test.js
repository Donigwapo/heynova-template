import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import {
  buildConfig,
  validateConfig,
  runSingleIteration,
  invokeNativeWorker,
} from './native-email-scheduler-lib.js'

function tempLock(name) {
  return path.join(os.tmpdir(), `heynova-${name}-${Date.now()}-${Math.random()}.lock`)
}

test('buildConfig defaults disabled and batch 1', () => {
  const cfg = buildConfig({})
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.executeEnabled, false)
  assert.equal(cfg.batch, 1)
})

test('validateConfig fails closed when enabled but missing credentials', () => {
  const cfg = buildConfig({
    NATIVE_EMAIL_SCHEDULER_ENABLED: 'true',
    NATIVE_EMAIL_SCHEDULER_EXECUTE: 'true',
  })
  const check = validateConfig(cfg)
  assert.equal(check.ok, false)
  assert.equal(check.code, 'MISSING_SUPABASE_URL')
})

test('validateConfig requires explicit execute switch', () => {
  const cfg = buildConfig({
    NATIVE_EMAIL_SCHEDULER_ENABLED: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'x',
  })
  const check = validateConfig(cfg)
  assert.equal(check.ok, false)
  assert.equal(check.code, 'EXECUTION_DISABLED')
})

test('invokeNativeWorker posts batch=1', async () => {
  let capturedBody = null
  const res = await invokeNativeWorker(
    {
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleToken: 'x',
      functionName: 'workflow-email-native-worker',
      timeoutMs: 1000,
      batch: 1,
    },
    {
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
      now: () => 123,
    }
  )

  assert.equal(res.ok, true)
  assert.equal(capturedBody.batch, 1)
  assert.match(capturedBody.workerId, /^native-email-scheduler-/)
})

test('runSingleIteration skips when disabled', async () => {
  const cfg = buildConfig({})
  const result = await runSingleIteration(cfg)
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'SCHEDULER_DISABLED')
})

test('runSingleIteration overlap guard prevents concurrent execution', async () => {
  const lockPath = tempLock('overlap')
  await fs.writeFile(lockPath, 'occupied')

  const cfg = buildConfig({
    NATIVE_EMAIL_SCHEDULER_ENABLED: 'true',
    NATIVE_EMAIL_SCHEDULER_EXECUTE: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'x',
    NATIVE_EMAIL_SCHEDULER_LOCK_PATH: lockPath,
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

test('runSingleIteration executes once with valid config', async () => {
  const cfg = buildConfig({
    NATIVE_EMAIL_SCHEDULER_ENABLED: 'true',
    NATIVE_EMAIL_SCHEDULER_EXECUTE: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'x',
    NATIVE_EMAIL_SCHEDULER_LOCK_PATH: tempLock('ok'),
  })

  let called = 0
  const result = await runSingleIteration(cfg, {
    fetchFn: async () => {
      called += 1
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true }
        },
      }
    },
  })

  assert.equal(called, 1)
  assert.equal(result.ok, true)
  assert.equal(result.skipped, false)
  assert.equal(result.status, 200)
})

test('network timeout/failure is returned without retries', async () => {
  const cfg = buildConfig({
    NATIVE_EMAIL_SCHEDULER_ENABLED: 'true',
    NATIVE_EMAIL_SCHEDULER_EXECUTE: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SCHEDULER_SERVICE_ROLE_TOKEN: 'x',
    NATIVE_EMAIL_SCHEDULER_LOCK_PATH: tempLock('fail'),
  })

  const result = await runSingleIteration(cfg, {
    fetchFn: async () => {
      throw new Error('network down')
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.skipped, false)
})
