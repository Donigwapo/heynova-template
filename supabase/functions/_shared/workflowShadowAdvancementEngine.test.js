import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const enginePath = path.resolve('supabase/functions/_shared/workflowShadowAdvancementEngine.ts')
const source = readFileSync(enginePath, 'utf8')

test('native-eligible email run emits execute_native_email payload in advancement jobs', () => {
  assert.match(source, /const nativeEligibleRun = stepType === 'email' && isRunNativeEligible\(params.run\)/)
  assert.match(source, /execute_native_email:\s*true/)
  assert.match(source, /execution_path:\s*'native'/)
  assert.match(source, /source:\s*'native_run_advancement'/)
  assert.doesNotMatch(source, /execute_disabled:\s*true[\s\S]*native_run_advancement/)
})

test('non-email jobs remain shadow-only by eligibility gate', () => {
  assert.match(source, /const nativeEligibleRun = stepType === 'email' && isRunNativeEligible\(params.run\)/)
  assert.match(source, /execute_disabled:\s*true/)
  assert.match(source, /execution_path:\s*'shadow'/)
  assert.match(source, /source:\s*'legacy_shadow_advancement'/)
})

test('run fetch includes metadata required for native propagation', () => {
  assert.match(source, /workflow_runs\?id=eq\.\$\{encodeURIComponent\(runId\)\}&limit=1/)
  assert.match(source, /metadata,started_at,completed_at,updated_at/)
})

test('job idempotency key structure remains unchanged', () => {
  assert.match(source, /'shadow-job-v1'/)
  assert.match(source, /params\.userId/)
  assert.match(source, /params\.workflowId/)
  assert.match(source, /params\.workflowStepId/)
  assert.match(source, /params\.runId/)
  assert.match(source, /params\.runStepId/)
  assert.match(source, /params\.campaignLeadId \|\| 'none'/)
})
