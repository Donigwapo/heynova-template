#!/usr/bin/env node
import { buildConfig, buildSafeLogContext, runSingleIteration } from './delay-workflow-scheduler-lib.js'

async function main() {
  const config = buildConfig(process.env)
  const mode = process.env.DELAY_SCHEDULER_MODE || 'once'

  if (mode === 'once') {
    const result = await runSingleIteration(config)
    if (!result.ok && !result.skipped) {
      console.error('[DelayWorkflowScheduler] iteration failed', {
        ...result,
      })
      process.exitCode = 1
      return
    }

    console.log('[DelayWorkflowScheduler] iteration complete', {
      ...result,
      ...buildSafeLogContext(config),
    })
    return
  }

  console.log('[DelayWorkflowScheduler] interval mode started', buildSafeLogContext(config))

  const tick = async () => {
    const result = await runSingleIteration(config)
    if (!result.ok && !result.skipped) {
      console.error('[DelayWorkflowScheduler] iteration failed', {
        ...result,
      })
    } else {
      console.log('[DelayWorkflowScheduler] iteration complete', {
        ...result,
      })
    }
  }

  await tick()
  setInterval(tick, config.intervalMs)
}

main().catch((error) => {
  console.error('[DelayWorkflowScheduler] fatal', error)
  process.exit(1)
})
