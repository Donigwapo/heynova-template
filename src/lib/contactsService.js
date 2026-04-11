import { supabase } from './supabase'

export async function fetchContactsByUserId(userId) {
  if (!userId) {
    return { contacts: [], error: null }
  }

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    return { contacts: [], error }
  }

  return { contacts: data || [], error: null }
}

export async function fetchContactsByIdsForUser(userId, contactIds) {
  if (!userId || !Array.isArray(contactIds) || contactIds.length === 0) {
    return { contacts: [], error: null }
  }

  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, full_name, company, company_name')
    .eq('user_id', userId)
    .in('id', contactIds)

  if (error) {
    return { contacts: [], error }
  }

  return { contacts: data || [], error: null }
}
