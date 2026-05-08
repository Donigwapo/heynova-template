export function logSupabaseQueryError({
  table,
  operation = 'select',
  userId = null,
  pathname,
  error,
  extra = null,
}) {
  const resolvedPathname =
    pathname || (typeof window !== 'undefined' ? window.location.pathname : null)

  // eslint-disable-next-line no-console
  console.error('[SupabaseQueryError]', {
    table,
    operation,
    user_id: userId,
    pathname: resolvedPathname,
    message: error?.message || 'Unknown Supabase error',
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
    extra,
  })
}
