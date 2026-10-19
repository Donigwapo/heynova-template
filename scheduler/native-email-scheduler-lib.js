import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

export function buildConfig(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || ''
  const serviceRoleToken = env.SCHEDULER_SERVICE_ROLE_TOKEN || env.SUPABASE_SERVICE_ROLE_KEY || ''
  const enabled = parseBool(env.NATIVE_EMAIL_SCHEDULER_ENABLED, false)
  const executeEnabled = parseBool(env.NATIVE_EMAIL_SCHEDULER_EXECUTE, false)
  const intervalMs = Math.max(5000, Number(env.NATIVE_EMAIL_SCHEDULER_INTERVAL_MS || 60000))
  const timeoutMs = Math.max(1000, Number(env.NATIVE_EMAIL_SCHEDULER_TIMEOUT_MS || 15000))
  const lockPath = env.NATIVE_EMAIL_SCHEDULER_LOCK_PATH || path.join(os.tmpdir(), 'heynova-native-email-scheduler.lock')
  const functionName = env.NATIVE_EMAIL_SCHEDULER_FUNCTION || 'workflow-email-native-worker'
  const batch = 1

  return {
    supabaseUrl,
    serviceRoleToken,
    enabled,
    executeEnabled,
    intervalMs,
    timeoutMs,
    lockPath,
    functionName,
    batch,
  }
}

export function validateConfig(config) {
  if (!config.enabled) return { ok: true }
  if (!config.executeEnabled) {
    return { ok: false, code: 'EXECUTION_DISABLED', message: 'Scheduler enabled but execution switch is disabled.' }
  }
  if (!config.supabaseUrl) {
    return { ok: false, code: 'MISSING_SUPABASE_URL', message: 'SUPABASE_URL is required.' }
  }
  if (!config.serviceRoleToken) {
    return { ok: false, code: 'MISSING_SERVICE_ROLE_TOKEN', message: 'SCHEDULER_SERVICE_ROLE_TOKEN (or SUPABASE_SERVICE_ROLE_KEY) is required.' }
  }
  return { ok: true }
}

async function acquireLock(lockPath) {
  try {
    const handle = await fs.open(lockPath, 'wx')
    await handle.writeFile(String(process.pid))
    return { ok: true, handle }
  } catch {
    return { ok: false }
  }
}

async function releaseLock(lockPath, handle) {
  try {
    await handle?.close()
  } finally {
    await fs.rm(lockPath, { force: true }).catch(() => {})
  }
}

export async function invokeNativeWorker(config, { fetchFn = fetch, now = Date.now } = {}) {
  const endpoint = `${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/${config.functionName}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.serviceRoleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workerId: `native-email-scheduler-${now()}`,
        batch: config.batch,
      }),
      signal: controller.signal,
    })

    let payload = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }

    return {
      ok: res.ok,
      status: res.status,
      payload,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      error: error instanceof Error ? error.message : 'unknown_error',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runSingleIteration(config, deps = {}) {
  if (!config.enabled) {
    return { ok: true, skipped: true, reason: 'SCHEDULER_DISABLED' }
  }

  const configCheck = validateConfig(config)
  if (!configCheck.ok) {
    return { ok: false, skipped: true, reason: configCheck.code, message: configCheck.message }
  }

  const lock = await acquireLock(config.lockPath)
  if (!lock.ok) {
    return { ok: true, skipped: true, reason: 'OVERLAP_GUARD' }
  }

  try {
    const result = await invokeNativeWorker(config, deps)
    return {
      ok: result.ok,
      skipped: false,
      status: result.status,
      payload: result.payload,
      error: result.error,
    }
  } finally {
    await releaseLock(config.lockPath, lock.handle)
  }
}
