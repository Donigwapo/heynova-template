import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'


function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function normalizeString(value) {
  return String(value || '').trim()
}

export function buildConfig(env = process.env) {
  const supabaseUrl = normalizeString(env.SUPABASE_URL)
  const serviceRoleToken = normalizeString(env.SCHEDULER_SERVICE_ROLE_TOKEN || env.SUPABASE_SERVICE_ROLE_KEY)
  const enabled = parseBool(env.DELAY_SCHEDULER_ENABLED, false)
  const executeEnabled = parseBool(env.DELAY_SCHEDULER_EXECUTE, false)
  const intervalMs = Math.max(5000, Number(env.DELAY_SCHEDULER_INTERVAL_MS || 60000))
  const timeoutMs = Math.max(1000, Number(env.DELAY_SCHEDULER_TIMEOUT_MS || 45000))
  const lockPath =
    normalizeString(env.DELAY_SCHEDULER_LOCK_PATH) || path.join(os.tmpdir(), 'heynova-delay-workflow-scheduler.lock')
  const functionName = normalizeString(env.DELAY_SCHEDULER_FUNCTION) || 'workflow-shadow-scheduler-tick'
  const canaryUserId = normalizeString(env.DELAY_SCHEDULER_CANARY_USER_ID)
  const canaryWorkflowId = normalizeString(env.DELAY_SCHEDULER_CANARY_WORKFLOW_ID)
  const maxCount = 1

  return {
    supabaseUrl,
    serviceRoleToken,
    enabled,
    executeEnabled,
    intervalMs,
    timeoutMs,
    lockPath,
    functionName,
    canaryUserId,
    canaryWorkflowId,
    maxCount,
  }
}

export function validateConfig(config) {
  if (!config.enabled) return { ok: true }
  if (!config.executeEnabled) {
    return { ok: false, code: 'EXECUTION_DISABLED', message: 'Delay scheduler enabled but execution switch is disabled.' }
  }
  if (!config.supabaseUrl) {
    return { ok: false, code: 'MISSING_SUPABASE_URL', message: 'SUPABASE_URL is required.' }
  }
  if (!config.serviceRoleToken) {
    return { ok: false, code: 'MISSING_SERVICE_ROLE_TOKEN', message: 'SCHEDULER_SERVICE_ROLE_TOKEN (or SUPABASE_SERVICE_ROLE_KEY) is required.' }
  }
  if (!config.canaryUserId || !config.canaryWorkflowId) {
    return {
      ok: false,
      code: 'MISSING_CANARY_IDENTIFIERS',
      message: 'DELAY_SCHEDULER_CANARY_USER_ID and DELAY_SCHEDULER_CANARY_WORKFLOW_ID are required.',
    }
  }
  return { ok: true }
}

export function buildSafeLogContext(config) {
  return {
    enabled: config.enabled,
    executeEnabled: config.executeEnabled,
    intervalMs: config.intervalMs,
    timeoutMs: config.timeoutMs,
    functionName: config.functionName,
    canaryUserId: config.canaryUserId,
    canaryWorkflowId: config.canaryWorkflowId,
    maxCount: config.maxCount,
  }
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

export async function invokeDelayTick(config, { fetchFn = fetch } = {}) {
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
        userId: config.canaryUserId,
        workflowId: config.canaryWorkflowId,
        maxCount: config.maxCount,
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
    const result = await invokeDelayTick(config, deps)
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
