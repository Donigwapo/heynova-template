function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

export function buildRunExecutionMetadata(nativeEligibility, outbox) {
  const outboxPayload = asRecord(outbox?.payload) || {}

  const base = {
    ...outboxPayload,
    shadow_source: 'activation_outbox_sync',
    trigger: 'campaign_activate',
    outbox_id: outbox?.id || null,
    outbox_status: outbox?.status || null,
    synchronized_at: new Date().toISOString(),
  }

  if (nativeEligibility?.nativeEligible) {
    return {
      ...base,
      shadow_mode: false,
      execute_native_email: true,
      execution_path: 'native',
      native_eligibility_reason: nativeEligibility.reason || 'native_allowlisted',
      source: 'native_activation_sync',
    }
  }

  return {
    ...base,
    shadow_mode: true,
    execute_native_email: false,
    execution_path: 'shadow',
    native_eligibility_reason: nativeEligibility?.reason || 'shadow_default',
    source: 'legacy_outbox_enqueue',
  }
}
