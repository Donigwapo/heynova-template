import { logSupabaseQueryError } from './queryLogger'
import { supabase } from './supabase'

const googleOAuthStartFunctionName =
  import.meta.env.VITE_SUPABASE_GOOGLE_OAUTH_START_FUNCTION || 'google-calendar-oauth-start'

const googleSyncFunctionName =
  import.meta.env.VITE_SUPABASE_GOOGLE_SYNC_FUNCTION || 'google-calendar-sync'

const gmailOAuthStartFunctionName =
  import.meta.env.VITE_SUPABASE_GMAIL_OAUTH_START_FUNCTION || 'gmail-oauth-start'

async function fetchIntegrationConnectionByProvider(provider) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null
  const { data: authData, error: authError } = await supabase.auth.getUser()

  if (authError) {
    logSupabaseQueryError({
      table: 'auth.users',
      operation: 'getUser',
      userId: null,
      pathname,
      error: authError,
      extra: { provider },
    })

    return {
      connection: null,
      error: authError,
    }
  }

  const userId = authData?.user?.id || null

  // For unauthenticated/cleared sessions, return a clean "not connected" state
  // so UI can still render without hard failures.
  if (!userId) {
    return {
      connection: null,
      error: null,
    }
  }

  const { data, error } = await supabase
    .from('integration_connections')
    .select('id, provider, connected_email, scope, expires_at, status, last_synced_at, updated_at')
    .eq('provider', provider)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'integration_connections',
      operation: 'select maybeSingle',
      userId,
      pathname,
      error,
      extra: { provider },
    })
  }

  // No row should be treated as not connected (null connection), not as a hard failure.
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
