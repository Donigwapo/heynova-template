import { logSupabaseQueryError } from './queryLogger'
import { supabase } from './supabase'

const PROFILE_COLUMNS = 'id, full_name, avatar_url, role, company_name'

export async function fetchProfileByUserId(userId) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null

  if (!userId) {
    return { profile: null, error: null }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'profiles',
      operation: 'select maybeSingle',
      userId,
      pathname,
      error,
    })
    return { profile: null, error }
  }

  return { profile: data || null, error: null }
}
