import { supabase } from './supabase'

const PROFILE_COLUMNS = 'id, full_name, avatar_url, role, company_name'

export async function fetchProfileByUserId(userId) {
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
    return { profile: null, error }
  }

  return { profile: data || null, error: null }
}
