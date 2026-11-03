import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const sourcePath = path.resolve('supabase/functions/workflow-shadow-activation-sync/index.ts')
const source = readFileSync(sourcePath, 'utf8')

test('run starts as shadow metadata and upgrades to native only after final eligibility', () => {
  assert.match(source, /runMetadata:\s*buildShadowRunMetadata\(outbox\)/)
  assert.match(source, /const nativeEligibility = decideNativeEligibility\([\s\S]*claimedForNative:\s*markedForNative[\s\S]*\)/)
  assert.match(source, /let effectiveNativeEligibility = nativeEligibility/)
  assert.match(source, /if \(runResult.action === 'created' && effectiveNativeEligibility.nativeEligible\)/)
  assert.match(source, /const runMetadata = buildRunExecutionMetadata\(effectiveNativeEligibility, outboxForJob\)/)
})

test('failed native run metadata patch records failure and blocks job creation', () => {
  assert.match(source, /const runPatch = await restPatch\([\s\S]*workflow_runs\?id=eq\.\$\{encodeURIComponent\(run.id\)\}[\s\S]*\)/)
  assert.match(source, /if \(!runPatch.ok\) \{[\s\S]*stage:\s*'run_metadata_native_patch'[\s\S]*continue\s*\}/)
})

test('failed native designation does not proceed to native run metadata update', () => {
  assert.match(source, /if \(!markResult.ok\) \{[\s\S]*continue\s*\}/)
})

test('existing run reuse is preserved and not auto-promoted', () => {
  assert.match(source, /if \(activeResult.row\?\.id\) \{[\s\S]*action: 'reused'/)
  assert.match(source, /if \(runResult.action === 'reused' && nativeEligibility.nativeEligible\)/)
  assert.match(source, /reused_run_not_native_confirmed/)
})
