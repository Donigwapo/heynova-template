import { logSupabaseQueryError } from './queryLogger'
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
    email: row.email || null,
    phone: row.phone || null,
    emailStatus: row.email_status || 'unknown',
    emailConfidence:
      row.email_confidence === null || row.email_confidence === undefined
        ? null
        : Number(row.email_confidence),
    phoneStatus: row.phone_status || 'unknown',
    contactSource: row.contact_source || null,
    enrichmentMetadata:
      row.enrichment_metadata && typeof row.enrichment_metadata === 'object'
        ? row.enrichment_metadata
        : {},
    status: row.status || '—',
  }
}

async function resolveCurrentUserId() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user?.id) {
    if (error) {
      logSupabaseQueryError({
        table: 'auth.users',
        operation: 'getUser',
        userId: null,
        pathname,
        error,
      })
    }

    return { userId: null, error: error || new Error('Unable to resolve authenticated user.') }
  }
  return { userId: data.user.id, error: null }
}

export async function fetchLeadLists() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null
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
    logSupabaseQueryError({
      table: 'lead_lists',
      operation: 'select many',
      userId,
      pathname,
      error,
    })
    return { rows: [], error }
  }

  return { rows: (data || []).map(toUiList), error: null }
}

export async function fetchLeadListById(id) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null
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
    logSupabaseQueryError({
      table: 'lead_lists',
      operation: 'select maybeSingle',
      userId,
      pathname,
      error,
      extra: { id },
    })
    return { row: null, error }
  }

  return { row: data ? toUiList(data) : null, error: null }
}

export async function fetchLeadListItems(leadListId) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null
  const { userId, error: authError } = await resolveCurrentUserId()
  if (authError || !userId) {
    return { rows: [], error: authError || new Error('Unauthorized.') }
  }

  const { data, error } = await supabase
    .from('lead_list_items')
    .select(
      'id,linkedin_url,full_name,first_name,last_name,job_title,company_name,location,profile_summary,email,phone,email_status,email_confidence,phone_status,contact_source,enrichment_metadata,status,created_at'
    )
    .eq('lead_list_id', leadListId)
    .order('created_at', { ascending: false })

  if (error) {
    logSupabaseQueryError({
      table: 'lead_list_items',
      operation: 'select many',
      userId,
      pathname,
      error,
      extra: { leadListId },
    })
    return { rows: [], error }
  }

  return { rows: (data || []).map(toUiLead), error: null }
}

export async function createLeadListWithItems(params) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null
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
    .maybeSingle()

  if (listError || !listRow?.id) {
    if (listError) {
      logSupabaseQueryError({
        table: 'lead_lists',
        operation: 'insert maybeSingle',
        userId,
        pathname,
        error: listError,
        extra: { name, status, leads_count: normalizedLeads.length },
      })
    }

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
      email: lead.email || lead.email_address || lead.work_email || null,
      phone: lead.phone || lead.phone_number || null,
      email_status: lead.emailStatus || lead.email_status || null,
      email_confidence:
        lead.emailConfidence !== undefined && lead.emailConfidence !== null
          ? Number(lead.emailConfidence)
          : lead.email_confidence !== undefined && lead.email_confidence !== null
            ? Number(lead.email_confidence)
            : null,
      phone_status: lead.phoneStatus || lead.phone_status || null,
      contact_source: lead.contactSource || lead.contact_source || null,
      enrichment_metadata:
        lead.enrichmentMetadata && typeof lead.enrichmentMetadata === 'object'
          ? lead.enrichmentMetadata
          : lead.enrichment_metadata && typeof lead.enrichment_metadata === 'object'
            ? lead.enrichment_metadata
            : {},
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
      logSupabaseQueryError({
        table: 'lead_list_items',
        operation: 'insert many',
        userId,
        pathname,
        error: itemError,
        extra: { lead_list_id: listRow.id, rows: itemRows.length },
      })
      return { id: null, error: itemError }
    }
  }

  return { id: listRow.id, error: null }
}
