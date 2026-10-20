function asArray(value) {
  return Array.isArray(value) ? value : []
}

export async function claimLegacyOutboxForNativeCore(params, deps) {
  const outbox = params.outbox
  if (!outbox?.id) {
    return { ok: true, claimed: false, reason: 'no_outbox_ref', claimedAt: null }
  }

  const status = String(outbox.status || '').toLowerCase()
  if (status === 'sent') return { ok: true, claimed: false, reason: 'already_sent', claimedAt: null }
  if (status === 'in_progress') return { ok: true, claimed: false, reason: 'legacy_in_progress', claimedAt: null }
  if (!['queued', 'native_claimed', 'retry_scheduled'].includes(status)) {
    return { ok: true, claimed: false, reason: 'legacy_not_claimable', claimedAt: null }
  }

  if (status === 'native_claimed') {
    return { ok: true, claimed: true, reason: 'already_native_claimed', claimedAt: outbox.claimed_at || null }
  }

  const claimedAt = deps.nowIso()
  const patch = await deps.restPatch(
    deps.supabaseUrl,
    deps.serviceRoleKey,
    `workflow_delivery_outbox?id=eq.${encodeURIComponent(outbox.id)}&status=in.(queued,retry_scheduled)`,
    {
      status: 'native_claimed',
      claimed_at: claimedAt,
      updated_at: claimedAt,
    },
    'return=representation'
  )

  if (!patch.ok) return { ok: false, claimed: false, reason: 'patch_failed', claimedAt: null }

  const claimed = asArray(patch.data)[0] || null
  return {
    ok: true,
    claimed: Boolean(claimed?.id),
    reason: claimed?.id ? 'claimed' : 'lost_race',
    claimedAt: claimed?.claimed_at || claimedAt,
  }
}
