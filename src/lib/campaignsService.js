import { supabase } from './supabase'
import { logSupabaseQueryError } from './queryLogger'

function normalizeLeadStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'contacted') return 'contacted'
  if (normalized === 'replied') return 'replied'
  if (normalized === 'converted') return 'converted'
  return 'new'
}

function toUiCampaign(row) {
  return {
    id: row.id,
    name: row.name || 'Untitled Campaign',
    status: row.status || 'Active',
    createdAt: row.created_at || null,
  }
}

function toUiCampaignLead(row) {
  return {
    id: row.id,
    fullName: row.full_name || '—',
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    jobTitle: row.job_title || '—',
    companyName: row.company_name || '—',
    location: row.location || '—',
    profileSummary: row.profile_summary || null,
    linkedinUrl: row.linkedin_url || null,
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
    status: normalizeLeadStatus(row.status),
    createdAt: row.created_at || null,
  }
}

function buildCampaignMetrics(campaign, campaignLeads) {
  const metrics = {
    totalLeads: campaignLeads.length,
    newLeads: 0,
    contactedLeads: 0,
    repliedLeads: 0,
    convertedLeads: 0,
  }

  campaignLeads.forEach((lead) => {
    if (lead.status === 'contacted') {
      metrics.contactedLeads += 1
      return
    }
    if (lead.status === 'replied') {
      metrics.repliedLeads += 1
      return
    }
    if (lead.status === 'converted') {
      metrics.convertedLeads += 1
      return
    }

    metrics.newLeads += 1
  })

  return {
    ...campaign,
    ...metrics,
  }
}

// Fetch all campaigns owned by this user
export async function fetchCampaignsByUserId(userId) {
  if (!userId) return { campaigns: [], error: null }
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    logSupabaseQueryError({ table: 'campaigns', operation: 'select by user', userId, error })
    return { campaigns: [], error }
  }

  return { campaigns: data || [], error: null }
}

// Create a campaign with name for this user
export async function createCampaign({ userId, name }) {
  if (!userId || !name) return { campaign: null, error: new Error('Missing userId or name') }

  const { data, error } = await supabase
    .from('campaigns')
    .insert({ user_id: userId, name })
    .select('*')
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({ table: 'campaigns', operation: 'insert', userId, error })
    return { campaign: null, error }
  }

  return { campaign: data || null, error: null }
}

// Add multiple leads to a campaign, prevent duplicates by campaign_id + linkedin_url
export async function addLeadsToCampaign({ campaignId, userId, leads }) {
  // Only allow upsert if linkedin_url is present per lead.
  if (!campaignId || !userId || !Array.isArray(leads) || leads.length === 0) {
    return { insertCount: 0, error: null }
  }

  // Use upsert, on conflict (campaign_id, linkedin_url)
  const insertRows = leads
    .filter((lead) => lead.linkedinUrl) // Only leads with a linkedinUrl can be deduped
    .map((lead) => ({
      campaign_id: campaignId,
      user_id: userId,
      full_name: lead.fullName,
      first_name: lead.firstName,
      last_name: lead.lastName,
      job_title: lead.jobTitle,
      company_name: lead.companyName,
      location: lead.location,
      profile_summary: lead.profileSummary,
      linkedin_url: lead.linkedinUrl,
      email: lead.email || null,
      phone: lead.phone || null,
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
    }))

  if (insertRows.length === 0) return { insertCount: 0, error: null }

  const { error } = await supabase
    .from('campaign_leads')
    .upsert(insertRows, {
      onConflict: 'campaign_id,linkedin_url',
      ignoreDuplicates: true,
      count: 'exact',
      returning: 'minimal',
    })

  if (error) {
    logSupabaseQueryError({
      table: 'campaign_leads',
      operation: 'upsert leads',
      userId,
      error,
      extra: { campaignId, insertRowsCount: insertRows.length },
    })
    return { insertCount: 0, error }
  }

  return { insertCount: insertRows.length, error: null }
}

export async function fetchSingleCampaignLeadForEmailTest({ campaignId, userId }) {
  if (!campaignId || !userId) {
    return { lead: null, error: new Error('Missing campaignId or userId') }
  }

  const { data, error } = await supabase
    .from('campaign_leads')
    .select(
      'id,full_name,first_name,last_name,job_title,company_name,location,profile_summary,linkedin_url,email,phone,email_status,email_confidence,phone_status,contact_source,enrichment_metadata,status,created_at'
    )
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .not('email', 'is', null)
    .neq('email', '')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    logSupabaseQueryError({
      table: 'campaign_leads',
      operation: 'select one email lead for workflow test',
      userId,
      error,
      extra: { campaignId },
    })
    return { lead: null, error }
  }

  const row = Array.isArray(data) ? data[0] : null
  return { lead: row ? toUiCampaignLead(row) : null, error: null }
}

export async function fetchCampaignsWithMetrics(userId) {
  if (!userId) return { rows: [], error: null }

  const { campaigns, error: campaignsError } = await fetchCampaignsByUserId(userId)
  if (campaignsError) {
    return { rows: [], error: campaignsError }
  }

  const normalizedCampaigns = (campaigns || []).map(toUiCampaign)
  if (normalizedCampaigns.length === 0) {
    return { rows: [], error: null }
  }

  const campaignIds = normalizedCampaigns.map((campaign) => campaign.id)

  const { data: leadsData, error: leadsError } = await supabase
    .from('campaign_leads')
    .select('id,campaign_id,status')
    .eq('user_id', userId)
    .in('campaign_id', campaignIds)

  if (leadsError) {
    logSupabaseQueryError({
      table: 'campaign_leads',
      operation: 'select metrics many',
      userId,
      error: leadsError,
      extra: { campaignIdsCount: campaignIds.length },
    })
    return { rows: [], error: leadsError }
  }

  const leadsByCampaignId = {}
  ;(leadsData || []).forEach((row) => {
    const rowCampaignId = row.campaign_id
    if (!rowCampaignId) return

    if (!Array.isArray(leadsByCampaignId[rowCampaignId])) {
      leadsByCampaignId[rowCampaignId] = []
    }

    leadsByCampaignId[rowCampaignId].push({
      id: row.id,
      status: normalizeLeadStatus(row.status),
    })
  })

  const rows = normalizedCampaigns.map((campaign) => {
    const campaignLeads = leadsByCampaignId[campaign.id] || []
    return buildCampaignMetrics(campaign, campaignLeads)
  })

  return { rows, error: null }
}

export async function fetchCampaignDetailById({ campaignId, userId }) {
  if (!campaignId || !userId) {
    return { campaign: null, leads: [], error: new Error('Missing campaignId or userId') }
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaigns')
    .select('id,name,status,created_at')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle()

  if (campaignError) {
    logSupabaseQueryError({
      table: 'campaigns',
      operation: 'select maybeSingle',
      userId,
      error: campaignError,
      extra: { campaignId },
    })
    return { campaign: null, leads: [], error: campaignError }
  }

  if (!campaignRow) {
    return { campaign: null, leads: [], error: null }
  }

  const { data: leadsRows, error: leadsError } = await supabase
    .from('campaign_leads')
    .select(
      'id,full_name,first_name,last_name,job_title,company_name,location,profile_summary,linkedin_url,email,phone,email_status,email_confidence,phone_status,contact_source,enrichment_metadata,status,created_at'
    )
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (leadsError) {
    logSupabaseQueryError({
      table: 'campaign_leads',
      operation: 'select many by campaign',
      userId,
      error: leadsError,
      extra: { campaignId },
    })
    return { campaign: null, leads: [], error: leadsError }
  }

  return {
    campaign: toUiCampaign(campaignRow),
    leads: (leadsRows || []).map(toUiCampaignLead),
    error: null,
  }
}
