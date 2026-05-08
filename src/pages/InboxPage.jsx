import { Mail, CalendarClock, Briefcase } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchGmailConnection,
  fetchGoogleCalendarConnection,
  fetchLinkedInConnection,
  fetchOutlookConnection,
} from '../lib/integrationsService'

const providersConfig = [
  {
    key: 'gmail',
    name: 'Gmail',
    description: 'Email conversations and follow-ups powered by AI insights.',
    icon: Mail,
  },
  {
    key: 'outlook',
    name: 'Outlook',
    description: 'Microsoft email workspace integration for client communication.',
    icon: CalendarClock,
  },
  {
    key: 'linkedin',
    name: 'LinkedIn',
    description: 'Track social conversations and outreach touchpoints.',
    icon: Briefcase,
  },
]

function InboxPage() {
  console.log('[RouteTrace] InboxPage render', {
    pathname: window.location.pathname,
  })
  const navigate = useNavigate()
  const [connections, setConnections] = useState({})
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const loadConnections = async () => {
      setIsLoading(true)

      const [gmail, outlook, linkedIn, googleCalendar] = await Promise.all([
        fetchGmailConnection(),
        fetchOutlookConnection(),
        fetchLinkedInConnection(),
        fetchGoogleCalendarConnection(),
      ])

      if (!isMounted) return

      if (gmail?.error) {
        console.error('[InboxPage] failed loading connection', {
          table: 'integration_connections',
          user_id: null,
          pathname: window.location.pathname,
          provider: 'gmail',
          error: gmail.error,
        })
      }

      if (outlook?.error) {
        console.error('[InboxPage] failed loading connection', {
          table: 'integration_connections',
          user_id: null,
          pathname: window.location.pathname,
          provider: 'outlook',
          error: outlook.error,
        })
      }

      if (linkedIn?.error) {
        console.error('[InboxPage] failed loading connection', {
          table: 'integration_connections',
          user_id: null,
          pathname: window.location.pathname,
          provider: 'linkedin',
          error: linkedIn.error,
        })
      }

      if (googleCalendar?.error) {
        console.error('[InboxPage] failed loading connection', {
          table: 'integration_connections',
          user_id: null,
          pathname: window.location.pathname,
          provider: 'google_calendar',
          error: googleCalendar.error,
        })
      }

      setConnections({
        gmail: gmail?.connection || null,
        outlook: outlook?.connection || null,
        linkedin: linkedIn?.connection || null,
        google_calendar: googleCalendar?.connection || null,
      })
      setIsLoading(false)
    }

    loadConnections()

    return () => {
      isMounted = false
    }
  }, [])

  const providerCards = useMemo(() => {
    return providersConfig.map((provider) => {
      const row = connections?.[provider.key] || null
      const isConnected = row?.status === 'connected'

      return {
        ...provider,
        isConnected,
        connectedEmail: row?.connected_email || null,
      }
    })
  }, [connections])

  const handleProviderClick = (provider) => {
    if (!provider.isConnected) {
      navigate('/integrations')
      return
    }

    navigate(`/inbox/${provider.key}`)
  }

  return (
    <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">Inbox</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage and prioritize all your conversations with AI
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {providerCards.map((provider) => {
          const Icon = provider.icon

          return (
            <button
              key={provider.key}
              type="button"
              onClick={() => handleProviderClick(provider)}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-700 ring-1 ring-slate-200">
                  <Icon size={18} aria-hidden="true" />
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                    provider.isConnected
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}
                >
                  {isLoading ? 'Checking…' : provider.isConnected ? 'Connected' : 'Not Connected'}
                </span>
              </div>

              <h2 className="mt-4 text-base font-semibold text-slate-900">{provider.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{provider.description}</p>

              <p className="mt-3 text-xs text-slate-500">
                {provider.connectedEmail || 'Connect to enable inbox intelligence.'}
              </p>
            </button>
          )
        })}
      </section>
    </div>
  )
}

export default InboxPage
