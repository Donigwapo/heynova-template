import { supabase } from './supabase'

const googleOAuthStartFunctionName =
  import.meta.env.VITE_SUPABASE_GOOGLE_OAUTH_START_FUNCTION || 'google-calendar-oauth-start'

const googleSyncFunctionName =
  import.meta.env.VITE_SUPABASE_GOOGLE_SYNC_FUNCTION || 'google-calendar-sync'

const gmailOAuthStartFunctionName =
  import.meta.env.VITE_SUPABASE_GMAIL_OAUTH_START_FUNCTION || 'gmail-oauth-start'

async function fetchIntegrationConnectionByProvider(provider) {
  const { data, error } = await supabase
    .from('integration_connections')
    .select('id, provider, connected_email, scope, expires_at, status, last_synced_at, updated_at')
    .eq('provider', provider)
    .maybeSingle()

  return { connection: data || null, error: error || null }
}

export async function fetchGoogleCalendarConnection() {
  return await fetchIntegrationConnectionByProvider('google_calendar')
}

export async function fetchGmailConnection() {
  return await fetchIntegrationConnectionByProvider('gmail')
}

export async function fetchOutlookConnection() {
  return await fetchIntegrationConnectionByProvider('outlook')
}

export async function fetchLinkedInConnection() {
  return await fetchIntegrationConnectionByProvider('linkedin')
}

export async function startGoogleCalendarOAuth() {
  const { data, error } = await supabase.functions.invoke(googleOAuthStartFunctionName, {
    body: {
      returnPath: '/integrations',
    },
  })

  if (error) {
    return { authUrl: null, error }
  }

  const authUrl = typeof data?.authUrl === 'string' ? data.authUrl : null

  if (!authUrl) {
    return {
      authUrl: null,
      error: {
        message: 'OAuth start endpoint did not return an authorization URL.',
      },
    }
  }

  return { authUrl, error: null }
}

export async function syncGoogleCalendar() {
  const { data, error } = await supabase.functions.invoke(googleSyncFunctionName, {
    body: {
      calendarId: 'primary',
      windowDaysPast: 14,
      windowDaysFuture: 90,
      maxResults: 250,
    },
  })

  return {
    result: data || null,
    error: error || null,
  }
}

export async function startGmailOAuth() {
  const { data, error } = await supabase.functions.invoke(gmailOAuthStartFunctionName, {
    body: {
      returnPath: '/integrations',
    },
  })

  if (error) {
    return { authUrl: null, error }
  }

  const authUrl = typeof data?.authUrl === 'string' ? data.authUrl : null

  if (!authUrl) {
    return {
      authUrl: null,
      error: {
        message: 'OAuth start endpoint did not return an authorization URL.',
      },
    }
  }

  return { authUrl, error: null }
}
