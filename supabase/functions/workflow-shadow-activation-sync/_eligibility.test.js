import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildNativeActivationAllowlistConfig,
  canTransitionOutboxToNativeClaim,
  decideNativeEligibility,
  isAllowlisted,
} from './_eligibility.js'

test('allowlist defaults are disabled and fail closed', () => {
  const cfg = buildNativeActivationAllowlistConfig({})

  const decision = isAllowlisted(cfg, {
    userId: 'u1',
    workflowId: 'w1',
    campaignId: 'c1',
  })

  assert.equal(cfg.activationEnabled, false)
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'activation_disabled')
})

test('allowlist requires both user and workflow ids', () => {
  const cfg = buildNativeActivationAllowlistConfig({
    WORKFLOW_NATIVE_EMAIL_ACTIVATION_ENABLED: 'true',
    WORKFLOW_NATIVE_EMAIL_CANARY_USER_IDS: 'u1',
  })

  const decision = isAllowlisted(cfg, {
    userId: 'u1',
    workflowId: 'w1',
    campaignId: 'c1',
  })

  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'missing_workflow_allowlist')
})

test('allowlist accepts explicitly configured workflow+user and optional campaign', () => {
  const cfg = buildNativeActivationAllowlistConfig({
    WORKFLOW_NATIVE_EMAIL_ACTIVATION_ENABLED: 'true',
    WORKFLOW_NATIVE_EMAIL_CANARY_USER_IDS: 'u1',
    WORKFLOW_NATIVE_EMAIL_CANARY_WORKFLOW_IDS: 'w1',
    WORKFLOW_NATIVE_EMAIL_CANARY_CAMPAIGN_IDS: 'c1',
  })

  const allowed = isAllowlisted(cfg, {
    userId: 'u1',
    workflowId: 'w1',
    campaignId: 'c1',
  })

  const deniedCampaign = isAllowlisted(cfg, {
    userId: 'u1',
    workflowId: 'w1',
    campaignId: 'c2',
  })

  assert.equal(allowed.ok, true)
  assert.equal(allowed.reason, 'allowlisted')
  assert.equal(deniedCampaign.ok, false)
  assert.equal(deniedCampaign.reason, 'campaign_not_allowlisted')
})

test('legacy/native outbox transition rules block in_progress and sent', () => {
  assert.equal(canTransitionOutboxToNativeClaim('queued').ok, true)
  assert.equal(canTransitionOutboxToNativeClaim('retry_scheduled').ok, true)

  const inProgress = canTransitionOutboxToNativeClaim('in_progress')
  assert.equal(inProgress.ok, false)
  assert.equal(inProgress.reason, 'legacy_in_progress')

  const sent = canTransitionOutboxToNativeClaim('sent')
  assert.equal(sent.ok, false)
  assert.equal(sent.reason, 'already_sent')
})

test('native eligibility requires allowlist and acquired native claim', () => {
  const cfg = buildNativeActivationAllowlistConfig({
    WORKFLOW_NATIVE_EMAIL_ACTIVATION_ENABLED: 'true',
    WORKFLOW_NATIVE_EMAIL_CANARY_USER_IDS: 'u1',
    WORKFLOW_NATIVE_EMAIL_CANARY_WORKFLOW_IDS: 'w1',
  })

  const missingClaim = decideNativeEligibility({
    config: cfg,
    userId: 'u1',
    workflowId: 'w1',
    campaignId: null,
    outboxStatus: 'queued',
    claimedForNative: false,
  })

  const eligible = decideNativeEligibility({
    config: cfg,
    userId: 'u1',
    workflowId: 'w1',
    campaignId: null,
    outboxStatus: 'native_claimed',
    claimedForNative: true,
  })

  assert.equal(missingClaim.nativeEligible, false)
  assert.equal(missingClaim.reason, 'native_claim_not_acquired')

  assert.equal(eligible.nativeEligible, true)
  assert.equal(eligible.reason, 'native_allowlisted')
})

test('disallowed workflow remains shadow-mode in eligibility decision', () => {
  const cfg = buildNativeActivationAllowlistConfig({
    WORKFLOW_NATIVE_EMAIL_ACTIVATION_ENABLED: 'true',
    WORKFLOW_NATIVE_EMAIL_CANARY_USER_IDS: 'u1',
    WORKFLOW_NATIVE_EMAIL_CANARY_WORKFLOW_IDS: 'w1',
  })

  const decision = decideNativeEligibility({
    config: cfg,
    userId: 'u1',
    workflowId: 'w2',
    campaignId: null,
    outboxStatus: 'queued',
    claimedForNative: true,
  })

  assert.equal(decision.nativeEligible, false)
  assert.equal(decision.reason, 'workflow_not_allowlisted')
})
