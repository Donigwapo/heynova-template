import { supabase } from './supabase'

function toUiList(row) {
  return {
    id: row.id,
    name: row.name || 'Untitled List',
    createdAt: row.created_at || null,
    leadsCount: Number(row.leads_count || 0),
    status: row.status || 'Completed',
  }
}

function toUiLead(row) {
  return {
    id: row.id,
    linkedinUrl: row.linkedin_url || row.linkedin_profile_url || null,
    fullName: row.full_name || '—',
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    jobTitle: row.job_title || '—',
    companyName: row.company_name || '—',
    location: row.location || '—',
    profileSummary: row.profile_summary || 'No summary available',
    status: row.status || '—',
  }
}

async function resolveCurrentUserId() {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user?.id) {
    return { userId: null, error: error || new Error('Unable to resolve authenticated user.') }
  }
  return { userId: data.user.id, error: null }
}

export async function fetchLeadLists() {
  const { userId, error: authError } = await resolveCurrentUserId()
  if (authError || !userId) {
    return { rows: [], error: authError || new Error('Unauthorized.') }
  }

  const { data, error } = await supabase
    .from('lead_lists')
    .select('id,name,created_at,leads_count,status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    return { rows: [], error }
  }

  return { rows: (data || []).map(toUiList), error: null }
}

export async function fetchLeadListById(id) {
  const { userId, error: authError } = await resolveCurrentUserId()
  if (authError || !userId) {
    return { row: null, error: authError || new Error('Unauthorized.') }
  }

  const { data, error } = await supabase
    .from('lead_lists')
    .select('id,name,created_at,leads_count,status')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return { row: null, error }
  }

  return { row: data ? toUiList(data) : null, error: null }
}

export async function fetchLeadListItems(leadListId) {
  const { userId, error: authError } = await resolveCurrentUserId()
  if (authError || !userId) {
    return { rows: [], error: authError || new Error('Unauthorized.') }
  }

  const { data, error } = await supabase
    .from('lead_list_items')
    .select(
      'id,linkedin_url,full_name,first_name,last_name,job_title,company_name,location,profile_summary,status,created_at'
    )
    .eq('lead_list_id', leadListId)
    .order('created_at', { ascending: false })

  if (error) {
    return { rows: [], error }
  }

  return { rows: (data || []).map(toUiLead), error: null }
}

export async function createLeadListWithItems(params) {
  const { name, leads, status = 'Completed' } = params

  const { userId, error: authError } = await resolveCurrentUserId()
  if (authError || !userId) {
    return { id: null, error: authError || new Error('Unauthorized.') }
  }

  const normalizedLeads = Array.isArray(leads) ? leads : []

  const { data: listRow, error: listError } = await supabase
    .from('lead_lists')
    .insert({
      user_id: userId,
      name,
      status,
      leads_count: normalizedLeads.length,
    })
    .select('id')
    .single()

  if (listError || !listRow?.id) {
    return { id: null, error: listError || new Error('Unable to create lead list.') }
  }

  if (normalizedLeads.length > 0) {
    const itemRows = normalizedLeads.map((lead) => ({
      lead_list_id: listRow.id,
      linkedin_url: lead.linkedinUrl || lead.linkedin_url || lead.linkedin_profile_url || '',
      full_name: lead.fullName || lead.full_name || null,
      first_name: lead.firstName || lead.first_name || null,
      last_name: lead.lastName || lead.last_name || null,
      job_title: (lead.jobTitle || lead.job_title) === '—' ? null : lead.jobTitle || lead.job_title || null,
      company_name:
        (lead.companyName || lead.company_name) === '—' ? null : lead.companyName || lead.company_name || null,
      location: lead.location === '—' ? null : lead.location || null,
      profile_summary:
        (lead.profileSummary || lead.profile_summary) === 'No summary available'
          ? null
          : lead.profileSummary || lead.profile_summary || null,
      status: lead.status === '—' ? null : lead.status || null,
    }))

    console.log('[LeadDatabaseStore] lead_list_items insert debug', {
      createdListId: listRow.id,
      currentUserId: userId,
      leadsLength: normalizedLeads.length,
      firstLead: normalizedLeads[0] || null,
      firstMappedItemPayload: itemRows[0] || null,
    })

    const { error: itemError } = await supabase.from('lead_list_items').insert(itemRows)
    if (itemError) {
      console.error('lead_list_items insert error:', itemError)
      return { id: null, error: itemError }
    }
  }

  return { id: listRow.id, error: null }
}
