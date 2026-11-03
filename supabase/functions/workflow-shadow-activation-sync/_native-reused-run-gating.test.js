import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const sourcePath = path.resolve('supabase/functions/workflow-shadow-activation-sync/index.ts')
const source = readFileSync(sourcePath, 'utf8')

test('active run lookup fetches metadata for reuse gating', () => {
  assert.match(source, /workflow_runs\?user_id=eq\./)
  assert.match(source, /status,metadata'/)
})

test('reused run requires native-confirmed metadata before native job eligibility', () => {
  assert.match(source, /if \(runResult.action === 'reused' && nativeEligibility.nativeEligible\)/)
  assert.match(source, /const runNativeConfirmed = isRunMetadataNativeConfirmed\(run\)/)
  assert.match(source, /effectiveNativeEligibility = \{[\s\S]*nativeEligible:\s*false,[\s\S]*reason:\s*'reused_run_not_native_confirmed'/)
})

test('effectiveNativeEligibility drives ensureJob payload selection', () => {
  assert.match(source, /nativeEligibility:\s*effectiveNativeEligibility/)
  assert.match(source, /if \(effectiveNativeEligibility.nativeEligible\) \{[\s\S]*nativeEligibleJobs \+= 1/)
  assert.match(source, /execute_native_email:\s*effectiveNativeEligibility.nativeEligible/)
})

test('run metadata native confirmation requires execute_native_email, execution_path native, and shadow_mode off', () => {
  assert.match(source, /function isRunMetadataNativeConfirmed\(run: RunRow \| null \| undefined\)/)
  assert.match(source, /execute_native_email/)
  assert.match(source, /execution_path/)
  assert.match(source, /shadow_mode/)
})
