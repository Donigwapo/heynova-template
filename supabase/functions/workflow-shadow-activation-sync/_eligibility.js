function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function parseCsvSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  )
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase()
}

export function buildNativeActivationAllowlistConfig(env = {}) {
  return {
    activationEnabled: parseBool(env.WORKFLOW_NATIVE_EMAIL_ACTIVATION_ENABLED, false),
    userIds: parseCsvSet(env.WORKFLOW_NATIVE_EMAIL_CANARY_USER_IDS),
    workflowIds: parseCsvSet(env.WORKFLOW_NATIVE_EMAIL_CANARY_WORKFLOW_IDS),
    campaignIds: parseCsvSet(env.WORKFLOW_NATIVE_EMAIL_CANARY_CAMPAIGN_IDS),
  }
}

export function isAllowlisted(config, { userId, workflowId, campaignId }) {
  if (!config?.activationEnabled) return { ok: false, reason: 'activation_disabled' }

  if (!config.workflowIds || config.workflowIds.size === 0) {
    return { ok: false, reason: 'missing_workflow_allowlist' }
  }

  if (!config.userIds || config.userIds.size === 0) {
    return { ok: false, reason: 'missing_user_allowlist' }
  }

  if (!userId || !config.userIds.has(userId)) return { ok: false, reason: 'user_not_allowlisted' }
  if (!workflowId || !config.workflowIds.has(workflowId)) return { ok: false, reason: 'workflow_not_allowlisted' }

  if (config.campaignIds && config.campaignIds.size > 0) {
    if (!campaignId || !config.campaignIds.has(campaignId)) {
      return { ok: false, reason: 'campaign_not_allowlisted' }
    }
  }

  return { ok: true, reason: 'allowlisted' }
}

export function canTransitionOutboxToNativeClaim(status) {
  const s = normalizeStatus(status)
  if (s === 'native_claimed') return { ok: true, reason: 'already_native_claimed' }
  if (s === 'queued' || s === 'retry_scheduled') return { ok: true, reason: 'claimable' }
  if (s === 'in_progress') return { ok: false, reason: 'legacy_in_progress' }
  if (s === 'sent') return { ok: false, reason: 'already_sent' }
  return { ok: false, reason: 'not_claimable' }
}

export function decideNativeEligibility(params) {
  const allow = isAllowlisted(params.config, {
    userId: params.userId,
    workflowId: params.workflowId,
    campaignId: params.campaignId,
  })

  if (!allow.ok) {
    return { nativeEligible: false, reason: allow.reason }
  }

  const transition = canTransitionOutboxToNativeClaim(params.outboxStatus)
  if (!transition.ok) {
    return { nativeEligible: false, reason: transition.reason }
  }

  if (!params.claimedForNative) {
    return { nativeEligible: false, reason: 'native_claim_not_acquired' }
  }

  return { nativeEligible: true, reason: 'native_allowlisted' }
}
