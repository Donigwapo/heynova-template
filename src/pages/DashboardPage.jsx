import { useCallback, useEffect, useState } from 'react'
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
import { fetchGmailInboxIntelligence } from '../lib/gmailIntelligenceService'
import { supabase } from '../lib/supabase'
import ActivityList from '../components/ActivityList'
import AIAssistantPanel from '../components/AIAssistantPanel'
import DashboardCard from '../components/DashboardCard'
import InboxIntelligenceCard from '../components/InboxIntelligenceCard'
import InboxIntelligenceDrawer from '../components/InboxIntelligenceDrawer'
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

const upcomingMeetings = [
  { id: 'm1', display: '11:00 AM — Client Strategy Call' },
  { id: 'm2', display: '1:30 PM — Team Sync Meeting' },
  { id: 'm3', display: '3:00 PM — Sales Review' },
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
  console.log('[RouteTrace] DashboardPage render', {
    pathname: window.location.pathname,
    userId: userProfile?.authUserId || null,
  })
  const [recentAIDrafts, setRecentAIDrafts] = useState([])
  const [isRecentAIDraftsLoading, setIsRecentAIDraftsLoading] = useState(false)
  const [recentAIDraftsError, setRecentAIDraftsError] = useState('')
  const [inboxIntelligenceCounts, setInboxIntelligenceCounts] = useState(null)
  const [inboxIntelligenceAttentionCount, setInboxIntelligenceAttentionCount] = useState(0)
  const [isInboxIntelligenceLoading, setIsInboxIntelligenceLoading] = useState(false)
  const [classifiedEmails, setClassifiedEmails] = useState([])
  const [selectedInboxTag, setSelectedInboxTag] = useState(null)
  const [isInboxDrawerOpen, setIsInboxDrawerOpen] = useState(false)
  const [commandAction, setCommandAction] = useState(null)

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

  useEffect(() => {
    let isMounted = true

    const loadInboxIntelligence = async () => {
      const userId = userProfile?.authUserId

      if (!userId) {
        setInboxIntelligenceCounts(null)
        setInboxIntelligenceAttentionCount(0)
        setClassifiedEmails([])
        setIsInboxIntelligenceLoading(false)
        return
      }

      setIsInboxIntelligenceLoading(true)

      const { result, error } = await fetchGmailInboxIntelligence()

      if (!isMounted) return

      if (error || !result?.ok || !Array.isArray(result?.emails)) {
        setInboxIntelligenceCounts(null)
        setInboxIntelligenceAttentionCount(0)
        setClassifiedEmails([])
        setIsInboxIntelligenceLoading(false)
        return
      }

      const emails = result.emails
      setClassifiedEmails(emails)

      const baseCounts = {
        'Needs Reply': 0,
        'Follow-Up Required': 0,
        'High Priority': 0,
        Opportunity: 0,
        'At Risk': 0,
        'Meeting Related': 0,
        'Low Priority': 0,
        Newsletter: 0,
      }

      emails.forEach((email) => {
        const tags = Array.isArray(email?.tags) ? email.tags : []
        tags.forEach((tag) => {
          if (Object.prototype.hasOwnProperty.call(baseCounts, tag)) {
            baseCounts[tag] += 1
          }
        })
      })

      const attentionCount =
        baseCounts['Needs Reply'] +
        baseCounts['Follow-Up Required'] +
        baseCounts['High Priority'] +
        baseCounts.Opportunity +
        baseCounts['At Risk']

      const hasAnyCount = Object.values(baseCounts).some((value) => value > 0)

      setInboxIntelligenceCounts(hasAnyCount ? baseCounts : null)
      setInboxIntelligenceAttentionCount(attentionCount)
      setIsInboxIntelligenceLoading(false)
    }

    loadInboxIntelligence()

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

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Dashboard" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={(action) => setCommandAction({ ...action, id: Date.now() })} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-slate-50">
            <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
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

              {inboxIntelligenceCounts && (
                <section className="mb-4">
                  <InboxIntelligenceCard
                    counts={inboxIntelligenceCounts}
                    attentionCount={inboxIntelligenceAttentionCount}
                    isLoading={isInboxIntelligenceLoading}
                    onTagClick={(tag) => {
                      setSelectedInboxTag(tag)
                      setIsInboxDrawerOpen(true)
                    }}
                  />
                </section>
              )}

              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((stat) => (
                  <StatCard key={stat.label} {...stat} />
                ))}
              </section>

              <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <DashboardCard title="Today’s Overview">
                  {todaysOverview.map((item) => (
                    <div key={item.title} className="flex items-start gap-3 rounded-xl px-1 py-2">
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
                      <p className="text-sm font-medium text-slate-800">Follow-Up with Acme Corp</p>
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Due Today
                      </span>
                    </div>
                  </div>
                </DashboardCard>

                <DashboardCard title="Upcoming Meetings">
                  {upcomingMeetings.map((meeting, index) => (
                    <div
                      key={meeting.id}
                      className={`flex items-start gap-3 px-1 py-2 ${
                        index !== upcomingMeetings.length - 1 ? 'border-b border-slate-100' : ''
                      }`}
                    >
                      <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                        <CalendarDays size={13} aria-hidden="true" />
                      </span>
                      <p className="text-sm font-medium text-slate-800">{meeting.display}</p>
                    </div>
                  ))}
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
                  meetings={[]}
                  onDraftPatched={handleDraftPatched}
                />
              </section>
            </div>
          </main>
        </div>

        <aside className="hidden border-l border-slate-200 bg-white xl:block xl:w-80 xl:flex-shrink-0">
          <AIAssistantPanel
            commandAction={commandAction}
            userId={userProfile?.authUserId}
            userProfile={userProfile}
            meetings={[]}
            isMeetingsLoading={false}
            meetingsError=""
          />
        </aside>
      </div>

      <InboxIntelligenceDrawer
        isOpen={isInboxDrawerOpen}
        selectedTag={selectedInboxTag}
        emails={classifiedEmails}
        onClose={() => {
          setIsInboxDrawerOpen(false)
          setSelectedInboxTag(null)
        }}
      />
    </div>
  )
}

export default DashboardPage
