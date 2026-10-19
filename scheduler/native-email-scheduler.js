#!/usr/bin/env node
import { buildConfig, runSingleIteration } from './native-email-scheduler-lib.js'

async function main() {
  const config = buildConfig(process.env)

  const mode = process.env.NATIVE_EMAIL_SCHEDULER_MODE || 'once'
  if (mode === 'once') {
    const result = await runSingleIteration(config)
    if (!result.ok && !result.skipped) {
      console.error('[NativeEmailScheduler] iteration failed', result)
      process.exitCode = 1
      return
    }
    console.log('[NativeEmailScheduler] iteration complete', result)
    return
  }

  // interval mode (still disabled by default unless env explicitly enables execution)
  console.log('[NativeEmailScheduler] interval mode started', {
    intervalMs: config.intervalMs,
    enabled: config.enabled,
    executeEnabled: config.executeEnabled,
  })

  const tick = async () => {
    const result = await runSingleIteration(config)
    if (!result.ok && !result.skipped) {
      console.error('[NativeEmailScheduler] iteration failed', result)
    } else {
      console.log('[NativeEmailScheduler] iteration complete', result)
    }
  }

  await tick()
  setInterval(tick, config.intervalMs)
}

main().catch((error) => {
  console.error('[NativeEmailScheduler] fatal', error)
  process.exit(1)
})
