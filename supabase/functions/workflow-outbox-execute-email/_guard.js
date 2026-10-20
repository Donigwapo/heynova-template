function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

export function classifyLegacyExecutionRisk(outboxRow) {
  const payload = asRecord(outboxRow?.payload)
  const executeNative = payload?.execute_native_email === true

  if (executeNative) {
    return {
      block: true,
      code: 'native_execution_required',
      reason: 'Outbox row is marked for native execution and must not be sent by legacy executor.',
    }
  }

  return {
    block: false,
    code: null,
    reason: 'legacy_execution_allowed',
  }
}
