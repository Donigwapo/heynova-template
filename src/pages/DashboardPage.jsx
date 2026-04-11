import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarCheck2,
  CalendarDays,
  CheckSquare,
  Circle,
  Clock3,
  LogOut,
  MessageSquareMore,
  Send,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { fetchRecentAIDraftsByUserId } from '../lib/aiDraftsService'
import { fetchMeetingsByUserId } from '../lib/meetingsService'
import { supabase } from '../lib/supabase'
import ActivityList from '../components/ActivityList'
import AIAssistantPanel from '../components/AIAssistantPanel'
import DashboardCard from '../components/DashboardCard'
import RecentAIDraftsCard from '../components/RecentAIDraftsCard'
import Sidebar from '../components/Sidebar'
import StatCard from '../components/StatCard'
import TopHeader from '../components/TopHeader'

const stats = [
  {
    label: 'Open Tasks',
    value: 5,
    icon: CheckSquare,
    dotClassName: 'bg-emerald-400',
  },
  {
    label: 'Meetings Today',
    value: 2,
    icon: CalendarDays,
    dotClassName: 'bg-sky-400',
  },
  {
    label: 'Follow-Ups Due',
    value: 3,
    icon: MessageSquareMore,
    dotClassName: 'bg-amber-400',
  },
  {
    label: 'Active Workflows',
    value: 4,
    icon: Workflow,
    dotClassName: 'bg-violet-400',
  },
]

const todaysOverview = [
  {
    title: '11:00 AM — Client Strategy Call',
    subtext: 'Prep for presentation',
  },
  {
    title: '1:30 PM — Team Sync Meeting',
    subtext: 'Review project updates',
  },
]


const recentActivity = [
  {
    text: 'You updated the “Lead Nurture” workflow',
    timestamp: '2h ago',
    icon: Sparkles,
    iconToneClassName: 'bg-violet-50',
  },
  {
    text: 'Follow-up sent to John Smith',
    timestamp: '3h ago',
    icon: Send,
    iconToneClassName: 'bg-sky-50',
  },
  {
    text: 'New meeting scheduled with Sarah Lee',
    timestamp: 'Yesterday',
    icon: CalendarCheck2,
    iconToneClassName: 'bg-emerald-50',
  },
]

function DashboardPage({ userProfile }) {
  const MIN_AI_PANEL_WIDTH = 280
  const MAX_AI_PANEL_WIDTH = 420

  const [aiPanelWidth, setAiPanelWidth] = useState(320)
  const [isResizingAiPanel, setIsResizingAiPanel] = useState(false)
  const [commandAction, setCommandAction] = useState(null)
  const [meetings, setMeetings] = useState([])
  const [isMeetingsLoading, setIsMeetingsLoading] = useState(false)
  const [meetingsError, setMeetingsError] = useState('')
  const [recentAIDrafts, setRecentAIDrafts] = useState([])
  const [isRecentAIDraftsLoading, setIsRecentAIDraftsLoading] = useState(false)
  const [recentAIDraftsError, setRecentAIDraftsError] = useState('')

  const resizeStateRef = useRef({
    startX: 0,
    startWidth: 320,
  })

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!isResizingAiPanel) return

      const delta = resizeStateRef.current.startX - event.clientX
      const nextWidth = resizeStateRef.current.startWidth + delta
      const clampedWidth = Math.min(
        MAX_AI_PANEL_WIDTH,
        Math.max(MIN_AI_PANEL_WIDTH, nextWidth)
      )

      setAiPanelWidth(clampedWidth)
    }

    const handleMouseUp = () => {
      if (!isResizingAiPanel) return
      setIsResizingAiPanel(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingAiPanel])

  const startAiPanelResize = (event) => {
    if (window.innerWidth < 1024) return

    setIsResizingAiPanel(true)
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: aiPanelWidth,
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const handleRunCommand = (action) => {
    setCommandAction({ ...action, id: Date.now() })
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  useEffect(() => {
    let isMounted = true

    const loadMeetings = async () => {
      const userId = userProfile?.authUserId

      if (!userId) {
        setMeetings([])
        setMeetingsError('')
        setIsMeetingsLoading(false)
        return
      }

      setIsMeetingsLoading(true)
      setMeetingsError('')

      const { meetings: rows, error } = await fetchMeetingsByUserId(userId)

      if (!isMounted) return

      if (error) {
        setMeetings([])
        setMeetingsError('Unable to load meetings right now.')
        setIsMeetingsLoading(false)
        return
      }

      setMeetings(rows || [])
      setIsMeetingsLoading(false)
    }

    loadMeetings()

    return () => {
      isMounted = false
    }
  }, [userProfile?.authUserId])

  useEffect(() => {
    let isMounted = true

    const loadRecentAIDrafts = async () => {
      const userId = userProfile?.authUserId

      if (!userId) {
        setRecentAIDrafts([])
        setRecentAIDraftsError('')
        setIsRecentAIDraftsLoading(false)
        return
      }

      setIsRecentAIDraftsLoading(true)
      setRecentAIDraftsError('')

      const { drafts, error } = await fetchRecentAIDraftsByUserId(userId, 8)

      if (!isMounted) return

      if (error) {
        setRecentAIDrafts([])
        setRecentAIDraftsError('Unable to load recent AI drafts right now.')
        setIsRecentAIDraftsLoading(false)
        return
      }

      const normalizedDrafts = (drafts || []).map((draft) => ({
        id: draft?.id || null,
        draftType: draft?.draft_type || 'follow_up',
        generatedText: draft?.generated_text || '',
        sourceContext: draft?.source_context || {},
        contactId: draft?.contact_id || null,
        meetingId: draft?.meeting_id || null,
        createdAt: draft?.created_at || null,
        status: draft?.status || 'generated',
        sendResult: draft?.send_result || null,
      }))

      setRecentAIDrafts(normalizedDrafts)
      setIsRecentAIDraftsLoading(false)
    }

    loadRecentAIDrafts()

    return () => {
      isMounted = false
    }
  }, [userProfile?.authUserId])

  const handleDraftPatched = useCallback((draftId, patch) => {
    if (!draftId || !patch) return

    setRecentAIDrafts((prev) =>
      prev.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft))
    )
  }, [])

  const normalizedUpcomingMeetings = useMemo(() => {
    return meetings
      .map((meeting) => {
        const startsAt =
          meeting?.starts_at || meeting?.scheduled_at || meeting?.start_time || null
        const parsed = startsAt ? new Date(startsAt) : null

        const timeLabel = parsed && !Number.isNaN(parsed.getTime())
          ? parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : 'TBD'

        const title = meeting?.title || meeting?.name || 'Untitled Meeting'

        return {
          id: meeting?.id || `${title}-${startsAt || 'no-time'}`,
          title,
          startsAt,
          timestamp: parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null,
          display: `${timeLabel} — ${title}`,
        }
      })
      .sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0
        if (!a.timestamp) return 1
        if (!b.timestamp) return -1
        return a.timestamp - b.timestamp
      })
      .slice(0, 6)
  }, [meetings])

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Dashboard" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={handleRunCommand} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-slate-50">
            <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">
                    Welcome back, {userProfile?.displayName || 'there'}!
                  </h1>
                  {userProfile?.email && (
                    <p className="mt-1 truncate text-sm text-slate-500">{userProfile.email}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm"
                >
                  <LogOut size={15} aria-hidden="true" />
                  Sign Out
                </button>
              </div>

              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((stat) => (
                  <StatCard key={stat.label} {...stat} />
                ))}
              </section>

              <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <DashboardCard title="Today’s Overview">
                  {todaysOverview.map((item) => (
                    <div
                      key={item.title}
                      className="flex items-start gap-3 rounded-xl px-1 py-2"
                    >
                      <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                        <Clock3 size={13} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{item.title}</p>
                        <p className="mt-0.5 text-sm text-slate-500">{item.subtext}</p>
                      </div>
                    </div>
                  ))}

                  <div className="mt-1 flex items-center gap-3 rounded-xl px-1 py-2">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                      <Circle size={12} fill="currentColor" aria-hidden="true" />
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        Follow-Up with Acme Corp
                      </p>
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Due Today
                      </span>
                    </div>
                  </div>
                </DashboardCard>

                <DashboardCard title="Upcoming Meetings">
                  {isMeetingsLoading && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                      Loading meetings...
                    </div>
                  )}

                  {!isMeetingsLoading && meetingsError && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-4 text-sm text-amber-700">
                      {meetingsError}
                    </div>
                  )}

                  {!isMeetingsLoading && !meetingsError && normalizedUpcomingMeetings.map((meeting, index) => (
                    <div
                      key={meeting.id}
                      className={`flex items-start gap-3 px-1 py-2 ${
                        index !== normalizedUpcomingMeetings.length - 1
                          ? 'border-b border-slate-100'
                          : ''
                      }`}
                    >
                      <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                        <CalendarDays size={13} aria-hidden="true" />
                      </span>
                      <p className="text-sm font-medium text-slate-800">{meeting.display}</p>
                    </div>
                  ))}

                  {!isMeetingsLoading && !meetingsError && normalizedUpcomingMeetings.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                      No meetings scheduled yet.
                    </div>
                  )}
                </DashboardCard>
              </section>

              <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ActivityList title="Recent Activity" items={recentActivity} />
                <RecentAIDraftsCard
                  drafts={recentAIDrafts}
                  isLoading={isRecentAIDraftsLoading}
                  error={recentAIDraftsError}
                  userId={userProfile?.authUserId}
                  userProfile={userProfile}
                  meetings={meetings}
                  onDraftPatched={handleDraftPatched}
                />
              </section>
            </div>
          </main>
        </div>

        <aside
          style={{ '--ai-panel-width': `${aiPanelWidth}px` }}
          className={`relative w-full border-t border-slate-200 bg-white lg:h-full lg:w-[var(--ai-panel-width)] lg:flex-shrink-0 lg:border-t-0 lg:border-l ${
            isResizingAiPanel
              ? 'lg:transition-none'
              : 'lg:transition-[width] lg:duration-150'
          }`}
        >
          <button
            type="button"
            aria-label="Resize AI assistant panel"
            onMouseDown={startAiPanelResize}
            className={`absolute inset-y-0 left-0 hidden w-2 -translate-x-1/2 cursor-col-resize items-center justify-center lg:flex ${
              isResizingAiPanel ? 'z-30' : 'z-20'
            }`}
          >
            <span
              className={`h-full w-px transition-colors duration-150 ${
                isResizingAiPanel
                  ? 'bg-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.35)]'
                  : 'bg-slate-200 hover:bg-slate-300'
              }`}
            />
          </button>

          <AIAssistantPanel
            commandAction={commandAction}
            userId={userProfile?.authUserId}
            userProfile={userProfile}
            meetings={meetings}
            isMeetingsLoading={isMeetingsLoading}
            meetingsError={meetingsError}
          />
        </aside>
      </div>
    </div>
  )
}

export default DashboardPage
