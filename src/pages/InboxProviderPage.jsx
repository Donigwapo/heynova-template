import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import { fetchGmailInboxIntelligence } from '../lib/gmailIntelligenceService'
import { fetchGmailConnection } from '../lib/integrationsService'

const GMAIL_CATEGORIES = [
  'All',
  'Needs Reply',
  'High Priority',
  'Opportunity',
  'At Risk',
  'Low Priority',
  'Newsletter',
]

const FOCUS_MODE_CATEGORIES = ['Needs Reply', 'High Priority', 'Opportunity']

function formatTimestamp(value) {
  if (!value) return '—'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getEmailSender(email) {
  return email?.fromName || email?.fromEmail || 'Unknown sender'
}

function getConfidenceLevel(value) {
  const score = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(score)) return 'Medium'
  if (score >= 0.8) return 'High'
  if (score >= 0.55) return 'Medium'
  return 'Low'
}

function getRecommendedAction(email) {
  const tags = Array.isArray(email?.tags) ? email.tags : []

  if (tags.includes('Needs Reply') || tags.includes('High Priority')) {
    return 'Reply within 30 min'
  }

  if (tags.includes('Opportunity')) {
    return 'Track and follow up today'
  }

  if (tags.includes('At Risk')) {
    return 'Escalate and confirm owner'
  }

  if (tags.includes('Meeting Related')) {
    return 'Create follow-up tasks'
  }

  return 'Review and decide next step'
}

function getWhyItMatters(email) {
  const bullets = []
  const tags = Array.isArray(email?.tags) ? email.tags : []

  if (tags.includes('Needs Reply')) {
    bullets.push('A response is pending and delay may stall momentum.')
  }
  if (tags.includes('High Priority')) {
    bullets.push('This thread has high urgency signals and needs near-term attention.')
  }
  if (tags.includes('Opportunity')) {
    bullets.push('This message may impact pipeline or revenue if actioned quickly.')
  }
  if (tags.includes('At Risk')) {
    bullets.push('Risk indicators suggest this conversation needs intervention soon.')
  }

  if (typeof email?.reason === 'string' && email.reason.trim()) {
    bullets.push(email.reason.trim())
  }

  if (bullets.length === 0) {
    bullets.push('AI flagged this thread due to sender and content signal strength.')
  }

  return bullets.slice(0, 3)
}

function getSuggestedNextStep(email) {
  const tags = Array.isArray(email?.tags) ? email.tags : []

  if (tags.includes('Needs Reply') || tags.includes('High Priority')) {
    return 'Send a concise response now and lock next ownership in the thread.'
  }

  if (tags.includes('Opportunity')) {
    return 'Track this thread and send a forward-moving follow-up with timeline.'
  }

  if (tags.includes('At Risk')) {
    return 'Escalate with clear owner and close-loop check-in today.'
  }

  return 'Process quickly and choose whether to track, snooze, or ignore.'
}

function getSignalTone(tag) {
  if (tag === 'High Priority' || tag === 'At Risk') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (tag === 'Opportunity') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tag === 'Needs Reply' || tag === 'Follow-Up Required')
    return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  if (tag === 'Low Priority' || tag === 'Newsletter') return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function InboxProviderPage({ userProfile, onRunCommand = () => {} }) {
  const { provider } = useParams()
  const navigate = useNavigate()

  const [classifiedEmails, setClassifiedEmails] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const [selectedCategory, setSelectedCategory] = useState('Needs Reply')
  const [selectedEmailId, setSelectedEmailId] = useState(null)
  const [isCheckingGmailConnection, setIsCheckingGmailConnection] = useState(false)
  const [isGmailConnected, setIsGmailConnected] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [handledEmailIds, setHandledEmailIds] = useState([])

  useEffect(() => {
    let isMounted = true

    const guardGmailConnection = async () => {
      if (provider !== 'gmail') return

      setIsCheckingGmailConnection(true)

      const { connection, error: connectionError } = await fetchGmailConnection()

      if (!isMounted) return

      const connected = Boolean(connection && connection.status === 'connected')

      if (connectionError || !connected) {
        setIsGmailConnected(false)
        setIsCheckingGmailConnection(false)
        navigate('/integrations', { replace: true })
        return
      }

      setIsGmailConnected(true)
      setIsCheckingGmailConnection(false)
    }

    guardGmailConnection()

    return () => {
      isMounted = false
    }
  }, [navigate, provider])

  useEffect(() => {
    let isMounted = true

    const loadGmailClassifiedEmails = async () => {
      if (provider !== 'gmail' || !isGmailConnected) return

      setIsLoading(true)
      setError('')

      const { result, error: invokeError } = await fetchGmailInboxIntelligence()

      if (!isMounted) return

      if (invokeError || !result?.ok || !Array.isArray(result?.emails)) {
        setClassifiedEmails([])
        setError('Unable to load Gmail intelligence right now.')
        setIsLoading(false)
        return
      }

      setClassifiedEmails(result.emails)
      setIsLoading(false)
    }

    loadGmailClassifiedEmails()

    return () => {
      isMounted = false
    }
  }, [isGmailConnected, provider])

  useEffect(() => {
    if (provider !== 'gmail') return

    const timer = setTimeout(() => {
      const hasNeedsReply = classifiedEmails.some((email) =>
        Array.isArray(email?.tags) ? email.tags.includes('Needs Reply') : false
      )

      const nextDefault = hasNeedsReply ? 'Needs Reply' : 'High Priority'
      setSelectedCategory(nextDefault)
    }, 0)

    return () => clearTimeout(timer)
  }, [classifiedEmails, provider])

  const visibleCategories = useMemo(() => {
    if (!isFocusMode) return GMAIL_CATEGORIES
    return ['All', ...FOCUS_MODE_CATEGORIES]
  }, [isFocusMode])

  useEffect(() => {
    if (visibleCategories.includes(selectedCategory)) return

    const timer = setTimeout(() => {
      setSelectedCategory(visibleCategories[0] || 'All')
    }, 0)

    return () => clearTimeout(timer)
  }, [selectedCategory, visibleCategories])

  const filteredEmails = useMemo(() => {
    let scoped = classifiedEmails

    if (isFocusMode) {
      scoped = classifiedEmails.filter((email) => {
        const tags = Array.isArray(email?.tags) ? email.tags : []
        return tags.some((tag) => FOCUS_MODE_CATEGORIES.includes(tag))
      })
    }

    if (selectedCategory === 'All') return scoped

    return scoped.filter((email) =>
      Array.isArray(email?.tags) ? email.tags.includes(selectedCategory) : false
    )
  }, [classifiedEmails, isFocusMode, selectedCategory])

  const briefing = useMemo(() => {
    const urgentCount = classifiedEmails.filter((email) => {
      const tags = Array.isArray(email?.tags) ? email.tags : []
      return tags.includes('Needs Reply') || tags.includes('High Priority') || tags.includes('At Risk')
    }).length

    const opportunityCount = classifiedEmails.filter((email) => {
      const tags = Array.isArray(email?.tags) ? email.tags : []
      return tags.includes('Opportunity')
    }).length

    const lowPriorityCount = classifiedEmails.filter((email) => {
      const tags = Array.isArray(email?.tags) ? email.tags : []
      return tags.includes('Low Priority') || tags.includes('Newsletter')
    }).length

    const clearedToday = handledEmailIds.length
    const totalConsidered = Math.max(classifiedEmails.length, 1)
    const inboxScore = Math.max(40, Math.min(96, Math.round(((clearedToday + 3) / (totalConsidered + 3)) * 100)))
    const avgResponseSpeed = urgentCount > 0 ? '38 min' : '52 min'
    const streakDays = Math.min(14, 2 + Math.floor(clearedToday / 2))

    return {
      urgentCount,
      opportunityCount,
      lowPriorityCount,
      inboxScore,
      clearedToday,
      avgResponseSpeed,
      streakDays,
    }
  }, [classifiedEmails, handledEmailIds])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!filteredEmails.length) {
        setSelectedEmailId(null)
        return
      }

      const stillVisible = filteredEmails.some((email) => email.id === selectedEmailId)
      if (!stillVisible) {
        setSelectedEmailId(filteredEmails[0]?.id || null)
      }
    }, 0)

    return () => clearTimeout(timer)
  }, [filteredEmails, selectedEmailId])

  const selectedEmail = useMemo(() => {
    if (!selectedEmailId) return null
    return filteredEmails.find((email) => email.id === selectedEmailId) || null
  }, [filteredEmails, selectedEmailId])

  const focusProgress = useMemo(() => {
    if (!isFocusMode || filteredEmails.length === 0) return null

    const currentIndex = Math.max(
      0,
      filteredEmails.findIndex((email) => email.id === selectedEmailId)
    )

    const reviewed = currentIndex
    const total = filteredEmails.length
    const remaining = Math.max(total - reviewed, 0)
    const approxMinutesLeft = Math.max(1, Math.ceil((remaining * 18) / 60))

    return {
      current: Math.min(currentIndex + 1, total),
      total,
      reviewed,
      approxMinutesLeft,
    }
  }, [filteredEmails, isFocusMode, selectedEmailId])

  if (provider === 'gmail' && isCheckingGmailConnection) {
    return (
      <div className="h-full bg-slate-50 text-slate-900">
        <div className="flex h-full flex-col lg:flex-row">
          <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
            <Sidebar activeItem="Inbox" userProfile={userProfile} />
          </aside>

          <div className="flex min-h-0 flex-1 flex-col">
            <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />
            <main className="flex-1 overflow-auto bg-slate-50">
              <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                  Checking Gmail connection...
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    )
  }

  if (provider !== 'gmail') {
    return (
      <div className="h-full bg-slate-50 text-slate-900">
        <div className="flex h-full flex-col lg:flex-row">
          <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
            <Sidebar activeItem="Inbox" userProfile={userProfile} />
          </aside>

          <div className="flex min-h-0 flex-1 flex-col">
            <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />
            <main className="flex-1 overflow-auto bg-slate-50">
              <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">
                    Inbox / {provider}
                  </h1>
                  <p className="mt-2 text-sm text-slate-500">
                    Smart inbox workspace is currently enabled for Gmail only.
                  </p>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-slate-100/60 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Inbox" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-slate-100/60">
            <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
              <header className="mb-4">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">
                  Inbox / Gmail
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  AI-first decision workspace. Try: Summarize today · Review urgent · Draft follow-ups · Start focus session
                </p>
              </header>

              <section className="mb-4 rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Urgent</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{briefing.urgentCount}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Opportunity</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{briefing.opportunityCount}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Low Priority</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{briefing.lowPriorityCount}</p>
                    </div>
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-indigo-700">Inbox Score</p>
                      <p className="mt-1 text-lg font-semibold text-indigo-900">{briefing.inboxScore}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Cleared today</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{briefing.clearedToday}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Avg response</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{briefing.avgResponseSpeed}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Streak</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{briefing.streakDays}d</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsFocusMode(true)
                        if (filteredEmails.length > 0) {
                          setSelectedEmailId(filteredEmails[0]?.id || null)
                        }
                      }}
                      className="inline-flex items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100"
                    >
                      Start focus session
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsFocusMode((prev) => !prev)}
                      className={`inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-150 ${
                        isFocusMode
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Focus Mode {isFocusMode ? 'On' : 'Off'}
                    </button>
                  </div>
                </div>
              </section>

              {error && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {error}
                </div>
              )}

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(210px,20%)_minmax(0,47%)_minmax(320px,33%)]">
                <aside className={`rounded-3xl border border-slate-200 bg-white p-3 shadow-sm transition-opacity duration-200 ${isFocusMode ? 'opacity-80' : 'opacity-100'}`}>
                  <div className="mb-3 px-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Focus</p>
                    <div className="mt-1 space-y-1">
                      {visibleCategories
                        .filter((category) => category === 'All' || FOCUS_MODE_CATEGORIES.includes(category))
                        .map((category) => {
                          const isActive = selectedCategory === category
                          const count =
                            category === 'All'
                              ? classifiedEmails.length
                              : classifiedEmails.filter((email) =>
                                  Array.isArray(email?.tags) ? email.tags.includes(category) : false
                                ).length

                          return (
                            <button
                              key={category}
                              type="button"
                              onClick={() => setSelectedCategory(category)}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-all duration-150 ${
                                isActive
                                  ? 'bg-indigo-50 text-indigo-800'
                                  : 'text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <span className="font-medium">{category}</span>
                              <span className="text-xs text-slate-500">{count}</span>
                            </button>
                          )
                        })}
                    </div>
                  </div>

                  {!isFocusMode && (
                    <div className="border-t border-slate-100 px-1 pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Background</p>
                      <div className="mt-1 space-y-1">
                        {['At Risk', 'Low Priority', 'Newsletter'].map((category) => {
                          const isActive = selectedCategory === category
                          const count = classifiedEmails.filter((email) =>
                            Array.isArray(email?.tags) ? email.tags.includes(category) : false
                          ).length

                          return (
                            <button
                              key={category}
                              type="button"
                              onClick={() => setSelectedCategory(category)}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-all duration-150 ${
                                isActive
                                  ? 'bg-slate-100 text-slate-800'
                                  : 'text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <span className="font-medium">{category}</span>
                              <span className="text-xs text-slate-500">{count}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </aside>

                <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                  <h2 className="mb-2 px-1 text-sm font-semibold text-slate-800">Processing Queue</h2>

                  {isLoading && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                      Loading Gmail intelligence...
                    </div>
                  )}

                  {!isLoading && filteredEmails.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                      No emails in this category right now.
                    </div>
                  )}

                  {!isLoading && filteredEmails.length > 0 && !isFocusMode && (
                    <div className="space-y-1.5">
                      {filteredEmails.map((email) => {
                        const isSelected = email.id === selectedEmailId

                        return (
                          <article
                            key={email.id}
                            onClick={() => setSelectedEmailId(email.id)}
                            className={`group cursor-pointer rounded-2xl border px-3 py-2.5 transition-all duration-200 ${
                              isSelected
                                ? 'border-slate-300 bg-white shadow-sm ring-1 ring-slate-200'
                                : 'border-slate-100 bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50/60'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="truncate text-sm font-medium text-slate-800">{getEmailSender(email)}</p>
                              <p className="whitespace-nowrap text-xs text-slate-500">
                                {formatTimestamp(email?.internalDate || null)}
                              </p>
                            </div>

                            <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                              {email?.subject || 'No subject'}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                              {email?.snippet || 'No preview available.'}
                            </p>

                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {Array.isArray(email?.tags) && email.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={`${email.id}-${tag}`}
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getSignalTone(tag)}`}
                                >
                                  {tag}
                                </span>
                              ))}
                              <span className="text-xs text-slate-500">
                                Confidence: {getConfidenceLevel(email?.confidence)}
                              </span>
                            </div>

                            <div className="mt-2 flex items-center justify-between">
                              <p className="text-xs font-medium text-indigo-700">
                                Recommended: {getRecommendedAction(email)}
                              </p>

                              <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                                {['Reply', 'Snooze', 'Auto-Handle', 'Ignore'].map((action) => (
                                  <button
                                    key={action}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                    }}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                                  >
                                    {action}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}

                  {!isLoading && filteredEmails.length > 0 && isFocusMode && (
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
                      {focusProgress && (
                        <div className="mb-3 flex items-center justify-between text-xs text-indigo-700">
                          <span>
                            {focusProgress.current} of {focusProgress.total} reviewed
                          </span>
                          <span>Approx. {focusProgress.approxMinutesLeft} min left</span>
                        </div>
                      )}

                      {selectedEmail && (
                        <div>
                          <p className="text-sm font-medium text-slate-800">{getEmailSender(selectedEmail)}</p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {selectedEmail?.subject || 'No subject'}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {selectedEmail?.snippet || 'No preview available.'}
                          </p>

                          <p className="mt-2 text-xs font-medium text-indigo-700">
                            Recommended: {getRecommendedAction(selectedEmail)}
                          </p>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {['Reply now', 'Snooze', 'Auto-handle', 'Skip', 'Mark handled'].map((label) => (
                              <button
                                key={label}
                                type="button"
                                onClick={() => {
                                  if (label === 'Mark handled' && selectedEmail?.id) {
                                    setHandledEmailIds((prev) =>
                                      prev.includes(selectedEmail.id) ? prev : [...prev, selectedEmail.id]
                                    )
                                  }
                                }}
                                className={`rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-150 ${
                                  label === 'Reply now'
                                    ? 'col-span-2 border-indigo-200 bg-indigo-600 text-white hover:bg-indigo-700'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold text-slate-800">AI Command Panel</h2>

                  {!selectedEmail && (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                      Select an email to view AI context.
                    </div>
                  )}

                  {selectedEmail && (
                    <div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-sm font-medium text-slate-800">
                          {selectedEmail?.fromName || selectedEmail?.fromEmail || 'Unknown sender'}
                        </p>
                        {selectedEmail?.fromName && selectedEmail?.fromEmail && (
                          <p className="mt-0.5 text-xs text-slate-500">{selectedEmail.fromEmail}</p>
                        )}
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {selectedEmail?.subject || 'No subject'}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {selectedEmail?.snippet || 'No preview available.'}
                        </p>
                      </div>

                      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Sender intelligence
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">Relationship</p>
                            <p className="mt-1 font-medium text-slate-700">Business Contact</p>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">Urgency</p>
                            <p className="mt-1 font-medium text-slate-700">{getConfidenceLevel(selectedEmail?.confidence)}</p>
                          </div>
                          <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">Last interaction</p>
                            <p className="mt-1 font-medium text-slate-700">Recent thread in active inbox cycle.</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-3 text-sm text-slate-700">
                        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">AI Insight</p>
                        <p className="mt-1 text-sm font-medium text-indigo-800">
                          Recommended: {getRecommendedAction(selectedEmail)}
                        </p>

                        <div className="mt-2 rounded-lg border border-indigo-100 bg-white/70 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Why this matters</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-700">
                            {getWhyItMatters(selectedEmail).map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="mt-2 rounded-lg border border-indigo-100 bg-white/70 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Suggested next step</p>
                          <p className="mt-1 text-sm text-slate-700">{getSuggestedNextStep(selectedEmail)}</p>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Auto-Handle</p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-700">
                          <li>• Draft a context-aware response</li>
                          <li>• Keep send as approval-required</li>
                          <li>• Mark as handled after approval</li>
                          <li>• Save summary for later context</li>
                        </ul>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            className="flex-1 rounded-xl border border-indigo-200 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-all duration-150 hover:bg-indigo-700"
                          >
                            Approve Auto-Handle
                          </button>
                          <button
                            type="button"
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Preview
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          className="w-full rounded-xl border border-indigo-200 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-all duration-150 hover:bg-indigo-700"
                        >
                          Reply now
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                          {['Track this', 'Remind me later'].map((label) => (
                            <button
                              key={label}
                              type="button"
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="w-full rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm font-medium text-slate-500 transition-all duration-150 hover:bg-slate-100"
                        >
                          Ignore
                        </button>
                      </div>
                    </div>
                  )}
                </aside>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default InboxProviderPage
