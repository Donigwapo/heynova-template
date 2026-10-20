function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}

export function buildOutboxPayloadForNativeExecution(existingPayload, reason) {
  const base = asRecord(existingPayload)
  return {
    ...base,
    execute_native_email: true,
    execution_path: 'native',
    native_eligibility_reason: reason || 'native_allowlisted',
  }
}
