import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import {
  fetchGmailConnection,
  fetchGoogleCalendarConnection,
  startGmailOAuth,
  startGoogleCalendarOAuth,
  syncGoogleCalendar,
} from '../lib/integrationsService'

const nonGoogleIntegrations = [
  {
    key: 'zoom',
    name: 'Zoom',
    description: 'Sync meeting recordings and call metadata into Heynova workflows.',
    connected: true,
    accountEmail: 'ops@brightpath.co',
    lastSynced: 'Today, 10:42 AM',
  },
  {
    key: 'fathom',
    name: 'Fathom',
    description: 'Bring AI call notes and summaries into your follow-up and reporting flows.',
    connected: false,
    accountEmail: null,
    lastSynced: null,
  },
]

function formatSyncTimestamp(value) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function IntegrationsPage({ userProfile, onRunCommand = () => {} }) {
  console.log('[RouteTrace] IntegrationsPage render', {
    pathname: window.location.pathname,
    userId: userProfile?.authUserId || null,
  })
  const [googleConnection, setGoogleConnection] = useState(null)
  const [isLoadingGoogleConnection, setIsLoadingGoogleConnection] = useState(false)
  const [googleConnectionError, setGoogleConnectionError] = useState('')
  const [isStartingGoogleOAuth, setIsStartingGoogleOAuth] = useState(false)
  const [isGoogleSyncing, setIsGoogleSyncing] = useState(false)
  const [googleStatusMessage, setGoogleStatusMessage] = useState('')

  const [gmailConnection, setGmailConnection] = useState(null)
  const [isLoadingGmailConnection, setIsLoadingGmailConnection] = useState(false)
  const [gmailConnectionError, setGmailConnectionError] = useState('')
  const [isStartingGmailOAuth, setIsStartingGmailOAuth] = useState(false)
  const [gmailStatusMessage, setGmailStatusMessage] = useState('')

  const loadGoogleConnection = async () => {
    setIsLoadingGoogleConnection(true)
    setGoogleConnectionError('')

    const { connection, error } = await fetchGoogleCalendarConnection()

    if (error) {
      setGoogleConnection(null)
      setGoogleConnectionError('Unable to load Google Calendar connection status right now.')
      setIsLoadingGoogleConnection(false)
      return
    }

    setGoogleConnection(connection)
    setIsLoadingGoogleConnection(false)
  }

  const loadGmailConnection = async () => {
    setIsLoadingGmailConnection(true)
    setGmailConnectionError('')

    const { connection, error } = await fetchGmailConnection()

    if (error) {
      setGmailConnection(null)
      setGmailConnectionError('Unable to load Gmail connection status right now.')
      setIsLoadingGmailConnection(false)
      return
    }

    setGmailConnection(connection)
    setIsLoadingGmailConnection(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadGoogleConnection()
      loadGmailConnection()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gcal = params.get('gcal')
    const gmail = params.get('gmail')
    const reason = params.get('reason')

    if (!gcal && !gmail) return

    const timer = window.setTimeout(() => {
      if (gcal === 'connected') {
        setGoogleStatusMessage('Google Calendar connected successfully.')
        loadGoogleConnection()
      }

      if (gcal === 'error') {
        setGoogleStatusMessage(
          reason ? `Google Calendar connection failed: ${reason}` : 'Google Calendar connection failed.'
        )
      }

      if (gmail === 'connected') {
        setGmailStatusMessage('Gmail connected successfully.')
        loadGmailConnection()
      }

      if (gmail === 'error') {
        setGmailStatusMessage(reason ? `Gmail connection failed: ${reason}` : 'Gmail connection failed.')
      }

      params.delete('gcal')
      params.delete('gmail')
      params.delete('reason')
      const nextQuery = params.toString()
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`
      window.history.replaceState({}, '', nextUrl)
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  const handleStartGoogleOAuth = async () => {
    if (isStartingGoogleOAuth) return

    setGoogleStatusMessage('')
    setIsStartingGoogleOAuth(true)

    const { authUrl, error } = await startGoogleCalendarOAuth()

    if (error || !authUrl) {
      setGoogleStatusMessage('Unable to start Google Calendar connection. Please try again.')
      setIsStartingGoogleOAuth(false)
      return
    }

    window.location.href = authUrl
  }

  const handleStartGmailOAuth = async () => {
    if (isStartingGmailOAuth) return

    if (!userProfile?.authUserId && !userProfile?.id) {
      setGmailStatusMessage('Please sign in again before connecting Gmail.')
      return
    }

    setGmailStatusMessage('')
    setIsStartingGmailOAuth(true)

    const { authUrl, error } = await startGmailOAuth()

    if (error || !authUrl) {
      setGmailStatusMessage('Unable to start Gmail connection. Please try again.')
      setIsStartingGmailOAuth(false)
      return
    }

    window.location.href = authUrl
  }

  const handleManualGoogleSync = async () => {
    if (isGoogleSyncing) return

    setGoogleStatusMessage('')
    setIsGoogleSyncing(true)

    const { result, error } = await syncGoogleCalendar()

    if (error) {
      setGoogleStatusMessage('Google Calendar sync failed. Please try again.')
      setIsGoogleSyncing(false)
      return
    }

    const syncedCount = result?.syncedCount || 0
    setGoogleStatusMessage(
      `Google Calendar sync complete. Synced ${syncedCount} event${syncedCount === 1 ? '' : 's'}.`
    )
    setIsGoogleSyncing(false)
    loadGoogleConnection()
  }

  const googleCard = useMemo(() => {
    const connected = googleConnection?.status === 'connected'

    return {
      key: 'google_calendar',
      name: 'Google Calendar',
      description: 'Auto-sync meetings, availability, and reminders across teams.',
      connected,
      accountEmail: googleConnection?.connected_email || null,
      lastSynced: formatSyncTimestamp(googleConnection?.last_synced_at),
      isLoading: isLoadingGoogleConnection,
    }
  }, [googleConnection, isLoadingGoogleConnection])

  const gmailCard = useMemo(() => {
    const connected = gmailConnection?.status === 'connected'

    return {
      key: 'gmail',
      name: 'Gmail',
      description: 'Send and track client follow-ups directly from your workspace.',
      connected,
      accountEmail: gmailConnection?.connected_email || null,
      lastSynced: formatSyncTimestamp(gmailConnection?.last_synced_at),
      isLoading: isLoadingGmailConnection,
    }
  }, [gmailConnection, isLoadingGmailConnection])

  const integrations = useMemo(() => {
    return [...nonGoogleIntegrations, googleCard, gmailCard]
  }, [googleCard, gmailCard])

  const totalIntegrations = integrations.length
  const connectedCount = integrations.filter((item) => item.connected).length
  const availableCount = totalIntegrations - connectedCount

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Integrations" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-slate-50">
            <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
              <header className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">Integrations</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Connect your tools to unlock automation and AI-powered workflows.
                </p>
              </header>

              {googleStatusMessage && (
                <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                  {googleStatusMessage}
                </div>
              )}

              {googleConnectionError && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {googleConnectionError}
                </div>
              )}

              {gmailStatusMessage && (
                <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                  {gmailStatusMessage}
                </div>
              )}

              {gmailConnectionError && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {gmailConnectionError}
                </div>
              )}

              <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Integrations</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{totalIntegrations}</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Connected</p>
                  <p className="mt-1 text-xl font-semibold text-emerald-700">{connectedCount}</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Available</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{availableCount}</p>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {integrations.map((integration) => {
                  const isConnected = integration.connected

                  return (
                    <article
                      key={integration.key}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold text-slate-900">{integration.name}</h2>
                          <p className="mt-1 text-sm text-slate-500">{integration.description}</p>
                        </div>

                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                            isConnected
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-slate-50 text-slate-600'
                          }`}
                        >
                          {integration.isLoading ? 'Checking…' : isConnected ? 'Connected' : 'Not connected'}
                        </span>
                      </div>

                      <div className="mt-4 space-y-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
                          <p>
                            <span className="font-medium text-slate-700">Account:</span>{' '}
                            {integration.accountEmail || 'Not connected'}
                          </p>
                          <p className="mt-1">
                            <span className="font-medium text-slate-700">Last synced:</span>{' '}
                            {integration.lastSynced || '—'}
                          </p>
                        </div>

                        {integration.key === 'google_calendar' ? (
                          isConnected ? (
                            <button
                              type="button"
                              onClick={handleManualGoogleSync}
                              disabled={isGoogleSyncing}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isGoogleSyncing ? 'Syncing…' : 'Sync Now'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleStartGoogleOAuth}
                              disabled={isStartingGoogleOAuth}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isStartingGoogleOAuth ? 'Redirecting…' : 'Connect Integration'}
                            </button>
                          )
                        ) : integration.key === 'gmail' ? (
                          isConnected ? (
                            <button
                              type="button"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:border-slate-300 hover:bg-slate-100"
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleStartGmailOAuth}
                              disabled={isStartingGmailOAuth}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isStartingGmailOAuth ? 'Redirecting…' : 'Connect Gmail'}
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:border-slate-300 hover:bg-slate-100"
                          >
                            {isConnected ? 'Manage Integration' : 'Connect Integration'}
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default IntegrationsPage
