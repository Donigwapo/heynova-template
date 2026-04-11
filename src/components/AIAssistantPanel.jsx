import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckSquare,
  CheckCircle2,
  FilePenLine,
  ListChecks,
  MessageSquareText,
  Search,
  User,
  UserRoundSearch,
  Users,
  Workflow,
} from 'lucide-react'
import { generateFollowUpDraft } from '../lib/aiService'
import { saveAIDraft, updateAIDraftStatus } from '../lib/aiDraftsService'
import { sendFollowUpDraft } from '../lib/followUpSendService'
import { fetchContactsByUserId } from '../lib/contactsService'
import {
  fetchContactSuggestionContexts,
  generateContactFollowUpSuggestion,
  getFallbackContactPriority,
  getFallbackContactSuggestion,
} from '../lib/contactSuggestionsService'
import { generateMeetingSummary } from '../lib/meetingSummaryService'
import { saveMeetingSummary } from '../lib/meetingsService'
import { saveAITasks } from '../lib/tasksService'
import AIModalShell from './AIModalShell'
import ContactDetailsDrawer from './ContactDetailsDrawer'

const quickActions = [
  { label: 'Draft Follow-Up', icon: FilePenLine },
  { label: 'Summarize Meeting', icon: MessageSquareText },
  { label: 'Find a Contact', icon: UserRoundSearch },
  { label: 'Create Workflow', icon: Workflow },
]

const focusItems = [
  {
    text: '3 follow-ups overdue',
    icon: AlertCircle,
    tone: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  {
    text: '1 meeting needs summary',
    icon: MessageSquareText,
    tone: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  {
    text: '2 contacts inactive for 7 days',
    icon: Users,
    tone: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
]

const suggestions = [
  '3 follow-ups due today',
  'Summarize the last meeting',
  'Show my open tasks',
]

const sampleFollowUp = `Hi there,

Great speaking with you earlier today. I wanted to quickly follow up on the next steps we discussed.

• I’ll send over the revised proposal by tomorrow morning.
• Once you review it, we can schedule a 20-minute check-in to align on rollout timing.

If anything changed on your side, feel free to reply here and I’ll adjust accordingly.

Best,
Heynova Team`

const defaultSummaryTemplate = {
  title: 'Client Strategy Call — April 6, 2026',
  keyPoints: [
    'Client wants faster lead qualification for inbound requests.',
    'Current follow-up response time is inconsistent across the team.',
    'They requested a simple weekly performance snapshot.',
  ],
  decisions: [
    'Pilot Heynova follow-up workflow for the Enterprise pipeline.',
    'Start with two SDRs for a 14-day trial period.',
  ],
  actionItems: [
    'Share workflow setup checklist by EOD.',
    'Schedule onboarding with SDR team for Wednesday 10:00 AM.',
    'Create weekly summary template and send for approval.',
  ],
}

function toSummaryTemplate(rawSummary, meetingTitle = 'Meeting Summary') {
  if (!rawSummary || typeof rawSummary !== 'object') {
    return {
      title: meetingTitle,
      keyPoints: [],
      decisions: [],
      actionItems: [],
    }
  }

  const normalizeList = (value) => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  }

  return {
    title:
      (typeof rawSummary.title === 'string' && rawSummary.title.trim()) ||
      meetingTitle,
    keyPoints: normalizeList(rawSummary.keyPoints),
    decisions: normalizeList(rawSummary.decisions),
    actionItems: normalizeList(rawSummary.actionItems),
  }
}

function parseMeetingSummary(rawSummary, meetingTitle) {
  if (!rawSummary) return null

  if (typeof rawSummary === 'object') {
    return toSummaryTemplate(rawSummary, meetingTitle)
  }

  if (typeof rawSummary === 'string') {
    const trimmed = rawSummary.trim()
    if (!trimmed) return null

    try {
      const parsed = JSON.parse(trimmed)
      return toSummaryTemplate(parsed, meetingTitle)
    } catch {
      return toSummaryTemplate(
        {
          title: meetingTitle,
          keyPoints: [trimmed],
          decisions: [],
          actionItems: [],
        },
        meetingTitle
      )
    }
  }

  return null
}

function formatSummaryText(summary) {
  const keyPoints = summary?.keyPoints?.length
    ? summary.keyPoints
    : ['No key points captured.']
  const decisions = summary?.decisions?.length
    ? summary.decisions
    : ['No decisions recorded.']
  const actionItems = summary?.actionItems?.length
    ? summary.actionItems
    : ['No action items identified.']

  return `${summary?.title || 'Meeting Summary'}\n\nKey Points:\n- ${keyPoints.join(
    '\n- '
  )}\n\nDecisions:\n- ${decisions.join('\n- ')}\n\nAction Items:\n- ${actionItems.join('\n- ')}`
}

const suggestedTasks = [
  'Send revised proposal by tomorrow',
  'Schedule a 20-minute check-in next week',
  'Confirm rollout timing with John',
]

const workflowDraft = {
  name: 'Lead Re-Engagement Sequence',
  trigger: 'When a contact has no activity for 7 days',
  steps: [
    'Send personalized check-in email with value-focused opener.',
    'If no reply in 48 hours, create follow-up task for account owner.',
    'If still inactive after 5 days, send meeting invite suggestion.',
    'Notify sales lead and add contact to weekly re-engagement report.',
  ],
}

const statusClassByValue = {
  'Follow-up needed': 'border-amber-200 bg-amber-50 text-amber-700',
  Inactive: 'border-violet-200 bg-violet-50 text-violet-700',
  'Warm lead': 'border-sky-200 bg-sky-50 text-sky-700',
}

const defaultStatusClassName = 'border-slate-200 bg-slate-100 text-slate-700'

function formatRelativeLastContacted(value) {
  if (!value) return 'unknown'

  const parsedDate = new Date(value)
  if (Number.isNaN(parsedDate.getTime())) return 'unknown'

  const now = new Date()
  const diffMs = now.getTime() - parsedDate.getTime()
  const dayMs = 1000 * 60 * 60 * 24

  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)))
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  const days = Math.floor(diffMs / dayMs)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`

  return parsedDate.toLocaleDateString()
}

function getMeetingDate(meeting) {
  return (
    meeting?.startsAt ||
    meeting?.meeting_date ||
    meeting?.starts_at ||
    meeting?.scheduled_at ||
    meeting?.start_time ||
    null
  )
}

function getMeetingTimestamp(meeting) {
  const value = getMeetingDate(meeting)
  if (!value) return 0

  const parsed = new Date(value).getTime()
  if (Number.isNaN(parsed)) return 0

  return parsed
}

function formatMeetingTime(value) {
  if (!value) return 'Time TBD'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Time TBD'

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function normalizeContact(contact) {
  const displayName = contact?.name || contact?.full_name || 'Unknown Contact'
  const company = contact?.company || contact?.company_name || 'Unknown company'
  const status = contact?.status || 'Active'
  const recentMeetings = Array.isArray(contact?.recent_meetings)
    ? contact.recent_meetings
    : []
  const persistedId = contact?.id || contact?.contact_id || null

  return {
    id: persistedId || `local-${displayName}-${company}`,
    persistedId,
    name: displayName,
    company,
    status,
    statusClassName: statusClassByValue[status] || defaultStatusClassName,
    email: contact?.email || '',
    phone: contact?.phone || '',
    notes: contact?.notes || 'No notes available yet.',
    lastContacted: formatRelativeLastContacted(
      contact?.last_contacted_at || contact?.updated_at || contact?.created_at
    ),
    recentMeetings,
  }
}

const overdueFollowUps = [
  {
    contact: 'John Smith',
    company: 'Acme Corp',
    overdue: 'Overdue by 2 days',
  },
  {
    contact: 'Sarah Lee',
    company: 'Northstar Labs',
    overdue: 'Overdue by 3 days',
  },
  {
    contact: 'Michael Rivera',
    company: 'Pioneer Health',
    overdue: 'Overdue by 1 day',
  },
]

function useTypingText(text, enabled, speed = 12) {
  const [value, setValue] = useState(enabled ? '' : text)

  useEffect(() => {
    if (!enabled) return

    const resetTimer = window.setTimeout(() => setValue(''), 0)

    let index = 0
    const timer = setInterval(() => {
      index += 1
      setValue(text.slice(0, index))

      if (index >= text.length) {
        clearInterval(timer)
      }
    }, speed)

    return () => {
      window.clearTimeout(resetTimer)
      clearInterval(timer)
    }
  }, [text, enabled, speed])

  return enabled ? value : text
}

function AIAssistantPanel({
  commandAction = null,
  userId = null,
  userProfile = null,
  meetings = [],
  isMeetingsLoading = false,
  meetingsError = '',
}) {
  const [modalType, setModalType] = useState(null)
  const [contactQuery, setContactQuery] = useState('')
  const [selectedContact, setSelectedContact] = useState(null)
  const [isContactDrawerOpen, setIsContactDrawerOpen] = useState(false)
  const [followUpSent, setFollowUpSent] = useState(false)
  const [followUpDraftText, setFollowUpDraftText] = useState('')
  const [isFollowUpDraftLoading, setIsFollowUpDraftLoading] = useState(false)
  const [isFollowUpSending, setIsFollowUpSending] = useState(false)
  const [followUpSendError, setFollowUpSendError] = useState('')
  const [summaryTypingEnabled, setSummaryTypingEnabled] = useState(false)
  const [selectedMeetingId, setSelectedMeetingId] = useState(null)
  const [summaryData, setSummaryData] = useState(defaultSummaryTemplate)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [summaryEmptyState, setSummaryEmptyState] = useState('')
  const [contacts, setContacts] = useState([])
  const [isContactsLoading, setIsContactsLoading] = useState(false)
  const [contactsError, setContactsError] = useState('')
  const [contactSuggestionById, setContactSuggestionById] = useState({})
  const [contactSuggestionPriorityById, setContactSuggestionPriorityById] = useState({})
  const [contactSuggestionLoadingById, setContactSuggestionLoadingById] = useState({})
  const [isSavingTasks, setIsSavingTasks] = useState(false)
  const [tasksSaveError, setTasksSaveError] = useState('')
  const [tasksSaveSuccess, setTasksSaveSuccess] = useState('')
  const followUpRequestIdRef = useRef(0)
  const followUpDraftContextRef = useRef({ contact: null, meeting: null })
  const followUpDraftIdRef = useRef(null)

  const normalizedMeetings = useMemo(() => {
    return (meetings || []).map((meeting) => {
      const startsAt =
        meeting?.meeting_date ||
        meeting?.starts_at ||
        meeting?.scheduled_at ||
        meeting?.start_time ||
        null

      const id =
        meeting?.id ||
        `${meeting?.title || meeting?.name || 'meeting'}-${startsAt || ''}`
      const title = meeting?.title || meeting?.name || 'Untitled Meeting'

      return {
        ...meeting,
        id,
        title,
        startsAt,
        timeLabel: formatMeetingTime(startsAt),
        subtitle: meeting?.agenda || meeting?.contact_name || meeting?.notes || '',
      }
    })
  }, [meetings])

  const recentMeetings = useMemo(() => {
    return [...normalizedMeetings].sort((a, b) => getMeetingTimestamp(b) - getMeetingTimestamp(a))
  }, [normalizedMeetings])

  const latestMeeting = recentMeetings[0] || null

  const selectedMeeting = selectedMeetingId
    ? normalizedMeetings.find((meeting) => meeting.id === selectedMeetingId) || null
    : latestMeeting

  const selectedSummary = summaryData

  const contactsByPersistedId = useMemo(() => {
    const map = {}
    contacts.forEach((contact) => {
      const key = contact?.persistedId || contact?.contact_id || contact?.id || null
      if (!key) return
      map[key] = contact
    })
    return map
  }, [contacts])

  const getMeetingLinkedContact = useCallback(
    (meeting) => {
      const meetingContactId = meeting?.contact_id || meeting?.contactId || null
      if (!meetingContactId) return null
      return contactsByPersistedId[meetingContactId] || null
    },
    [contactsByPersistedId]
  )

  const openFindContact = (query = '') => {
    setContactQuery(query)
    setContactSuggestionById({})
    setContactSuggestionPriorityById({})
    setContactSuggestionLoadingById({})
    setModalType('findContact')
  }

  const openMeetingSummary = useCallback(
    async (meetingId = null) => {
      const nextMeetingId = meetingId || latestMeeting?.id || null
      const meeting = nextMeetingId
        ? normalizedMeetings.find((item) => item.id === nextMeetingId) || null
        : latestMeeting

      setSelectedMeetingId(nextMeetingId)
      setSummaryError('')
      setSummaryEmptyState('')

      if (!meeting) {
        setSummaryData(defaultSummaryTemplate)
        setSummaryTypingEnabled(false)
        setModalType('meetingSummary')
        return
      }

      const meetingTitle = `${meeting.title} — ${meeting.timeLabel}`
      const parsedSavedSummary = parseMeetingSummary(meeting?.summary, meetingTitle)
      const transcript = typeof meeting?.transcript === 'string' ? meeting.transcript.trim() : ''

      if (!transcript) {
        setSummaryData(toSummaryTemplate({ title: meetingTitle }, meetingTitle))
        setSummaryTypingEnabled(false)
        setIsSummaryLoading(false)
        setSummaryEmptyState('No transcript is available for this meeting yet.')
        setModalType('meetingSummary')

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug('[Meeting Summary] Transcript missing', {
            meetingId: meeting?.id || nextMeetingId || null,
            title: meeting?.title || null,
          })
        }
        return
      }

      // Explicit summarize action always regenerates from transcript.
      // If a cached summary exists, we can show it as temporary content while regenerating.
      setSummaryData(parsedSavedSummary || toSummaryTemplate({ title: meetingTitle }, meetingTitle))
      setSummaryTypingEnabled(true)
      setIsSummaryLoading(true)
      setModalType('meetingSummary')

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[Meeting Summary] Transcript input', {
          meetingId: meeting?.id || nextMeetingId || null,
          transcriptLength: transcript.length,
          transcriptPreview: transcript.slice(0, 240),
        })
      }

      const result = await generateMeetingSummary({
        userProfile,
        meeting: {
          ...meeting,
          transcript,
        },
      })

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[Meeting Summary] Generated summary result', {
          ok: result?.ok,
          source: result?.source,
          message: result?.message,
          summary: result?.summary,
        })
      }

      if (!result?.ok || !result?.summary) {
        setIsSummaryLoading(false)
        setSummaryTypingEnabled(false)
        setSummaryError(result?.message || 'Unable to generate summary from transcript right now.')

        setSummaryData(
          parsedSavedSummary ||
            toSummaryTemplate(
              {
                title: meetingTitle,
                keyPoints: [
                  meeting?.agenda || 'Reviewed current priorities and transcript highlights.',
                  meeting?.notes || 'Captured key discussion points.',
                ],
                decisions: ['No confirmed decisions extracted.'],
                actionItems: ['Review transcript and summarize manually if needed.'],
              },
              meetingTitle
            )
        )
        return
      }

      const normalized = toSummaryTemplate(result.summary, meetingTitle)
      setSummaryData(normalized)
      setSummaryTypingEnabled(false)
      setIsSummaryLoading(false)

      const meetingIdForSave = meeting?.id || nextMeetingId || null
      const summaryPayloadForSave = normalized

      const { data: savedMeeting, error: saveError } = await saveMeetingSummary({
        meetingId: meetingIdForSave,
        userId: userProfile?.authUserId || userProfile?.id || null,
        summary: summaryPayloadForSave,
      })

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[Meeting Summary] Save result', {
          meetingId: meetingIdForSave,
          summary: summaryPayloadForSave,
          savedMeeting,
          saveError,
        })
      }

      if (saveError && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[Meeting Summary] Unable to persist generated summary.', saveError)
      }
    },
    [latestMeeting, normalizedMeetings, userProfile]
  )

  const openMeetingPicker = () => {
    setSummaryTypingEnabled(false)
    setModalType('meetingPicker')
  }

  const openFollowUpModal = async ({ contact = null, meetingId = null } = {}) => {
    const explicitMeeting = meetingId
      ? normalizedMeetings.find((meeting) => meeting.id === meetingId) || null
      : null

    const linkedMeetingContact = getMeetingLinkedContact(explicitMeeting)
    const resolvedContact = contact || linkedMeetingContact || selectedContact
    const nextContact = resolvedContact

    const resolvedContactId =
      resolvedContact?.persistedId || resolvedContact?.contact_id || resolvedContact?.id || null

    const contactMeetings = resolvedContactId
      ? normalizedMeetings
          .filter((meeting) => {
            const meetingContactId = meeting?.contact_id || meeting?.contactId || null
            return Boolean(meetingContactId && meetingContactId === resolvedContactId)
          })
          .sort((a, b) => getMeetingTimestamp(b) - getMeetingTimestamp(a))
      : []

    const latestContactMeeting = contactMeetings[0] || null

    let nextMeeting = null

    if (explicitMeeting) {
      nextMeeting = explicitMeeting
    } else if (resolvedContact) {
      nextMeeting = latestContactMeeting || null
    } else {
      nextMeeting = selectedMeeting || latestMeeting || null
    }

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[follow-up] Safe meeting resolution', {
        resolvedContactId:
          resolvedContact?.persistedId || resolvedContact?.contact_id || resolvedContact?.id || null,
        passedMeetingId: meetingId ?? null,
        contactMeetingsCount: contactMeetings.length,
        usedExplicitMeeting: !!explicitMeeting,
        usedLatestContactMeeting: !!latestContactMeeting,
        nextMeetingId: nextMeeting?.id ?? null,
        nextMeetingTitle: nextMeeting?.title ?? null,
        noContactMeetingFound: !!resolvedContact && contactMeetings.length === 0,
      })
    }

    if (contact) {
      setSelectedContact(contact)
    }

    if (meetingId && explicitMeeting) {
      setSelectedMeetingId(explicitMeeting.id)
    } else if (!meetingId && nextMeeting?.id) {
      setSelectedMeetingId(nextMeeting.id)
    } else if (!meetingId && resolvedContact && !latestContactMeeting) {
      setSelectedMeetingId(null)
    }

    setFollowUpSent(false)
    setFollowUpDraftText('')
    setIsFollowUpDraftLoading(true)
    setIsFollowUpSending(false)
    setFollowUpSendError('')
    followUpDraftIdRef.current = null
    setModalType('followUp')

    const requestId = followUpRequestIdRef.current + 1
    followUpRequestIdRef.current = requestId

    const result = await generateFollowUpDraft({
      userProfile,
      contact: nextContact,
      meeting: nextMeeting,
    })

    if (followUpRequestIdRef.current !== requestId) return

    const finalDraftText = result?.draft || ''
    followUpDraftContextRef.current = {
      contact: nextContact,
      meeting: nextMeeting,
      sourceContext: result?.sourceContext || null,
      source: result?.source || 'fallback',
    }

    setFollowUpDraftText(finalDraftText)
    setIsFollowUpDraftLoading(false)

    const linkedContactIdForDraft =
      nextMeeting?.contact_id || nextContact?.persistedId || nextContact?.contact_id || nextContact?.id || null

    const { draftId, error: saveError } = await saveAIDraft({
      userId: userProfile?.authUserId || userProfile?.id || null,
      contactId: linkedContactIdForDraft,
      meetingId: nextMeeting?.id || null,
      draftType: 'follow_up',
      generatedText: finalDraftText,
      sourceContext: {
        ...(result?.sourceContext || {}),
        source: result?.source || 'fallback',
      },
    })

    if (saveError) {
      console.warn('[AI Drafts] Unable to persist follow-up draft.', saveError)
      followUpDraftIdRef.current = null
      return
    }

    followUpDraftIdRef.current = draftId || null
  }

  const handleQuickActionClick = (label) => {
    if (label === 'Draft Follow-Up') {
      openFollowUpModal()
    }
    if (label === 'Summarize Meeting') {
      openMeetingPicker()
    }
    if (label === 'Find a Contact') openFindContact('')
    if (label === 'Create Workflow') setModalType('workflowDraft')
  }

  const handleFocusItemClick = (text) => {
    if (text === '3 follow-ups overdue') setModalType('overdueFollowUps')
    if (text === '1 meeting needs summary') {
      openMeetingPicker()
    }
    if (text === '2 contacts inactive for 7 days') openFindContact('inactive')
  }

  const handleSuggestionClick = (suggestion) => {
    if (suggestion === '3 follow-ups due today') setModalType('overdueFollowUps')
    if (suggestion === 'Summarize the last meeting') {
      openMeetingSummary(latestMeeting?.id || null)
    }
    if (suggestion === 'Show my open tasks') setModalType('aiTasks')
  }

  const handleSaveTasks = useCallback(async () => {
    if (isSavingTasks) return

    setTasksSaveError('')
    setTasksSaveSuccess('')
    setIsSavingTasks(true)

    const resolvedContactId =
      selectedMeeting?.contact_id ||
      selectedMeeting?.contactId ||
      selectedContact?.persistedId ||
      selectedContact?.contact_id ||
      null

    const payloadPreview = {
      userId: userProfile?.authUserId || userProfile?.id || null,
      tasksCount: suggestedTasks.length,
      contactId: resolvedContactId,
      selectedContactId: selectedContact?.id || null,
      selectedContactPersistedId: selectedContact?.persistedId || null,
      meetingId: selectedMeeting?.id || null,
    }

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[Tasks Save] Payload context', payloadPreview)
    }

    const { error, savedCount, debug } = await saveAITasks({
      userId: payloadPreview.userId,
      tasks: suggestedTasks,
      contactId: resolvedContactId,
      meetingId: selectedMeeting?.id || null,
      sourceContext: {
        flow: 'meeting_summary_create_tasks',
        meetingTitle: selectedMeeting?.title || null,
      },
    })

    if (error) {
      if (import.meta.env.DEV) {
        const firstAttempt = debug?.attempts?.[0]
        const fieldsPreview = firstAttempt?.attemptedFields?.join(', ') || 'unknown'
        const reason = error?.message || 'Unknown error'
        setTasksSaveError(`Unable to save tasks. ${reason} (fields: ${fieldsPreview})`)
        // eslint-disable-next-line no-console
        console.error('[Tasks Save] Debug', debug)
      } else {
        setTasksSaveError('Unable to save tasks right now.')
      }
      setIsSavingTasks(false)
      return
    }

    if (!savedCount) {
      setTasksSaveError('No tasks were saved.')
      setIsSavingTasks(false)
      return
    }

    setTasksSaveSuccess(`Saved ${savedCount} task${savedCount === 1 ? '' : 's'} to Tasks.`)
    setIsSavingTasks(false)
  }, [isSavingTasks, selectedContact, selectedMeeting, userProfile])

  const handleSendFollowUp = useCallback(async () => {
    if (isFollowUpSending || isFollowUpDraftLoading || followUpSent) return

    setFollowUpSendError('')
    setIsFollowUpSending(true)

    const context = followUpDraftContextRef.current || {}
    const sendResponse = await sendFollowUpDraft({
      userProfile,
      contact: context.contact || selectedContact || null,
      meeting: context.meeting || selectedMeeting || null,
      draftText: followUpDraftText,
    })

    const nextStatus = sendResponse?.ok ? 'sent' : 'failed'

    if (followUpDraftIdRef.current) {
      const { error: updateError } = await updateAIDraftStatus({
        draftId: followUpDraftIdRef.current,
        status: nextStatus,
        sendResult: sendResponse?.result || null,
      })

      if (updateError) {
        console.warn('[AI Drafts] Unable to update follow-up draft status.', updateError)
      }
    }

    if (sendResponse?.ok) {
      setFollowUpSent(true)
      setIsFollowUpSending(false)
      return
    }

    setFollowUpSendError(sendResponse?.result?.message || 'Unable to send follow-up right now.')
    setIsFollowUpSending(false)
  }, [
    followUpDraftText,
    followUpSent,
    isFollowUpDraftLoading,
    isFollowUpSending,
    selectedContact,
    selectedMeeting,
    userProfile,
  ])

  const closeModal = () => {
    followUpRequestIdRef.current += 1
    setModalType(null)
    setFollowUpSent(false)
    setFollowUpDraftText('')
    setSummaryTypingEnabled(false)
    setSelectedMeetingId(null)
    setIsSummaryLoading(false)
    setSummaryError('')
    setSummaryEmptyState('')
    setIsFollowUpDraftLoading(false)
    setIsFollowUpSending(false)
    setFollowUpSendError('')
    setIsSavingTasks(false)
    setTasksSaveError('')
    setTasksSaveSuccess('')
  }

  const openModalFromDrawer = (type, meetingId = null) => {
    closeContactDrawer()
    window.setTimeout(() => {
      if (type === 'followUp') {
        openFollowUpModal({ contact: selectedContact, meetingId })
        return
      }
      if (type === 'meetingSummary') {
        openMeetingSummary(meetingId)
        return
      }
      setModalType(type)
    }, 140)
  }

  const openContactDrawer = (contact) => {
    const persistedContactId = contact?.persistedId || contact?.contact_id || contact?.id || null

    const relatedMeetings = normalizedMeetings
      .filter((meeting) => {
        return (
          persistedContactId &&
          (meeting?.contact_id === persistedContactId || meeting?.contactId === persistedContactId)
        )
      })
      .slice(0, 3)
      .map((meeting) => ({
        id: meeting.id,
        title: meeting.title,
        time: meeting.timeLabel,
      }))

    setSelectedContact({
      ...contact,
      persistedId: contact?.persistedId || contact?.id || contact?.contact_id || null,
      recentMeetings: relatedMeetings.length ? relatedMeetings : contact.recentMeetings,
    })
    setIsContactDrawerOpen(true)
  }

  const closeContactDrawer = () => {
    setIsContactDrawerOpen(false)
  }

  const handleCopySummary = async () => {
    const summaryText = formatSummaryText(selectedSummary)

    try {
      await navigator.clipboard.writeText(summaryText)
    } catch {
      // noop for unsupported clipboard environments
    }
  }

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase()

    if (!q) return contacts

    return contacts.filter((contact) => {
      return (
        contact.name.toLowerCase().includes(q) ||
        contact.company.toLowerCase().includes(q) ||
        contact.status.toLowerCase().includes(q) ||
        contact.notes.toLowerCase().includes(q)
      )
    })
  }, [contacts, contactQuery])

  useEffect(() => {
    if (!commandAction?.type) return

    const timer = window.setTimeout(() => {
      if (commandAction.type === 'followUp') {
        openFollowUpModal()
        return
      }

      if (commandAction.type === 'meetingSummary') {
        openMeetingSummary(latestMeeting?.id || null)
        return
      }

      if (commandAction.type === 'overdueFollowUps') {
        setModalType('overdueFollowUps')
        return
      }

      if (commandAction.type === 'aiTasks') {
        setModalType('aiTasks')
        return
      }

      if (commandAction.type === 'findContact') {
        openFindContact(commandAction.query || '')
        return
      }

      if (commandAction.type === 'workflowDraft') {
        setModalType('workflowDraft')
      }
    }, 0)

    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandAction, latestMeeting?.id, openMeetingSummary])

  useEffect(() => {
    let isMounted = true

    const loadContacts = async () => {
      if (!userId) {
        setContacts([])
        setContactsError('')
        setIsContactsLoading(false)
        return
      }

      setIsContactsLoading(true)
      setContactsError('')

      const { contacts: rows, error } = await fetchContactsByUserId(userId)

      if (!isMounted) return

      if (error) {
        setContacts([])
        setContactsError('Unable to load contacts right now.')
        setIsContactsLoading(false)
        return
      }

      setContacts(rows.map(normalizeContact))
      setIsContactsLoading(false)
    }

    loadContacts()

    return () => {
      isMounted = false
    }
  }, [userId])

  useEffect(() => {
    let cancelled = false

    const generateSuggestionsForVisibleContacts = async () => {
      if (modalType !== 'findContact') return
      if (isContactsLoading || contactsError) return
      if (!userId || filteredContacts.length === 0) return

      const loadingUpdates = {}
      filteredContacts.forEach((contact) => {
        const key = contact?.id
        if (!key) return
        loadingUpdates[key] = true
      })
      setContactSuggestionLoadingById((prev) => ({ ...prev, ...loadingUpdates }))

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[Contact Suggestions] Request start', {
          userId,
          visibleContacts: filteredContacts.map((contact) => ({
            id: contact?.id || null,
            persistedId: contact?.persistedId || contact?.contact_id || contact?.id || null,
            name: contact?.name || null,
          })),
        })
      }

      try {
        const contactIds = filteredContacts
          .map((contact) => contact?.persistedId || contact?.contact_id || contact?.id || null)
          .filter(Boolean)

        const { contextsByContactId = {}, error: contextError } = await fetchContactSuggestionContexts({
          userId,
          contactIds,
          meetings: normalizedMeetings,
        })

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug('[Contact Suggestions] Context payload', {
            userId,
            contactIds,
            contextError,
            contextsByContactId,
          })
        }

        const updates = {}
        const priorityUpdates = {}

        await Promise.allSettled(
          filteredContacts.map(async (contact) => {
            const viewId = contact?.id
            const persistedContactId =
              contact?.persistedId || contact?.contact_id || contact?.id || null

            if (!viewId) return

            const context = contextsByContactId[persistedContactId] || {}

            const payloadPreview = {
              contact: {
                id: persistedContactId,
                name: contact?.name,
                company: contact?.company,
                status: contact?.status,
                lastContacted: contact?.lastContacted,
              },
              context,
            }

            if (import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.debug('[Contact Suggestions] Request start', {
                viewId,
                payload: payloadPreview,
              })
            }

            try {
              const result = await generateContactFollowUpSuggestion({
                userProfile,
                contact: {
                  ...contact,
                  persistedId: persistedContactId,
                  last_contacted: contact?.lastContacted,
                },
                context,
              })

              if (cancelled) return

              if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.debug('[Contact Suggestions] Raw function response', {
                  viewId,
                  contactId: persistedContactId,
                  raw: result,
                })
              }

              const hasValidSuggestion = typeof result?.suggestion === 'string' && result.suggestion.trim()
              const suggestion = hasValidSuggestion
                ? result.suggestion.trim()
                : getFallbackContactSuggestion(contact)
              const priority = result?.priority || getFallbackContactPriority(contact)

              updates[viewId] = suggestion
              priorityUpdates[viewId] = priority || null

              if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.debug('[Contact Suggestions] Parsed suggestion', {
                  viewId,
                  contactId: persistedContactId,
                  suggestion,
                  priority,
                  source: result?.source || 'fallback',
                  error: result?.error || null,
                })
              }
            } catch (error) {
              if (cancelled) return

              updates[viewId] = getFallbackContactSuggestion(contact)
              priorityUpdates[viewId] = getFallbackContactPriority(contact)

              if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.warn('[Contact Suggestions] Error', {
                  viewId,
                  contactId: persistedContactId,
                  error,
                })
              }
            } finally {
              if (!cancelled) {
                setContactSuggestionLoadingById((prev) => ({
                  ...prev,
                  [viewId]: false,
                }))

                if (import.meta.env.DEV) {
                  // eslint-disable-next-line no-console
                  console.debug('[Contact Suggestions] Loading-state completion per-contact', {
                    viewId,
                    contactId: persistedContactId,
                  })
                }
              }
            }
          })
        )

        if (cancelled) return

        setContactSuggestionById((prev) => ({ ...prev, ...updates }))
        setContactSuggestionPriorityById((prev) => ({ ...prev, ...priorityUpdates }))
      } catch (error) {
        if (!cancelled) {
          const fallbackUpdates = {}
          const fallbackPriorityUpdates = {}
          filteredContacts.forEach((contact) => {
            if (!contact?.id) return
            fallbackUpdates[contact.id] = getFallbackContactSuggestion(contact)
            fallbackPriorityUpdates[contact.id] = getFallbackContactPriority(contact)
          })

          setContactSuggestionById((prev) => ({ ...prev, ...fallbackUpdates }))
          setContactSuggestionPriorityById((prev) => ({ ...prev, ...fallbackPriorityUpdates }))
        }

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn('[Contact Suggestions] Batch error', error)
        }
      } finally {
        if (!cancelled && import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug('[Contact Suggestions] Loading-state completion batch', {
            candidateIds: Object.keys(loadingUpdates),
          })
        }
      }
    }

    generateSuggestionsForVisibleContacts()

    return () => {
      cancelled = true
    }
  }, [
    contactsError,
    filteredContacts,
    isContactsLoading,
    meetings,
    modalType,
    normalizedMeetings,
    userId,
    userProfile,
  ])

  const typedFollowUp = useTypingText(
    followUpDraftText,
    modalType === 'followUp' && !followUpSent,
    8
  )

  const summaryText = formatSummaryText(selectedSummary)

  const typedSummaryText = useTypingText(
    summaryText,
    modalType === 'meetingSummary' && summaryTypingEnabled,
    6
  )

  return (
    <>
      <div className="flex h-full flex-col gap-5 bg-white p-4 lg:p-5">
        <section className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-100 via-indigo-50 to-sky-50 p-4 shadow-sm ring-1 ring-indigo-100/80">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-sm ring-1 ring-indigo-200/70">
              <img
                src="/brand/heynova-logo.png"
                alt="Heynova logo"
                className="h-4 w-4 rounded-sm object-cover opacity-85"
              />
            </span>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-700/80">
                AI Workspace
              </p>
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
                Heynova AI Assistant
              </h2>
            </div>
          </div>
        </section>

        <label className="relative block">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Ask Heynova anything..."
            className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm transition-all duration-150 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 shadow-sm">
          <h3 className="mb-3.5 text-[15px] font-semibold tracking-tight text-slate-900">
            Today’s Focus
          </h3>

          <div className="space-y-2">
            {focusItems.map(({ text, icon, tone }) => (
              <button
                key={text}
                type="button"
                onClick={() => handleFocusItemClick(text)}
                className="group flex w-full items-center gap-2.5 rounded-xl border border-transparent bg-white/85 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:text-slate-900 hover:shadow-sm"
              >
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform duration-150 group-hover:scale-105 ${tone}`}
                >
                  {createElement(icon, { size: 13, 'aria-hidden': 'true' })}
                </span>
                <span>{text}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2.5">
          {quickActions.map(({ label, icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => handleQuickActionClick(label)}
              className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50 hover:shadow-md"
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200 transition-all duration-150 group-hover:text-indigo-600 group-hover:ring-indigo-200">
                {createElement(icon, { size: 13, 'aria-hidden': 'true' })}
              </span>
              <span className="leading-tight">{label}</span>
            </button>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4 shadow-sm">
          <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-slate-900">
            Quick Suggestions
          </h3>

          <div className="space-y-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleSuggestionClick(suggestion)}
                className="group flex w-full items-center gap-2.5 rounded-xl border border-transparent bg-white/80 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:text-slate-900 hover:shadow-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 transition-transform duration-150 group-hover:scale-125" />
                <span>{suggestion}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <AIModalShell
        isOpen={modalType === 'followUp'}
        onClose={closeModal}
        label="AI Draft"
        title={followUpSent ? 'Follow-Up Sent' : 'Follow-Up Message'}
        description={
          !followUpSent && isFollowUpDraftLoading
            ? 'Generating draft…'
            : !followUpSent && typedFollowUp.length < followUpDraftText.length
              ? 'Generating draft…'
              : undefined
        }
        maxWidth="max-w-lg"
        footer={
          followUpSent ? (
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSendFollowUp}
                disabled={isFollowUpSending || isFollowUpDraftLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100 hover:shadow-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FilePenLine size={15} aria-hidden="true" />
                {isFollowUpSending ? 'Sending...' : 'Send Follow-Up'}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
              >
                Close
              </button>
            </>
          )
        }
      >
        {followUpSent ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-emerald-600 ring-1 ring-emerald-200">
              <CheckCircle2 size={14} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium text-emerald-700">
                Follow-up sent successfully..
              </p>
              <p className="text-xs text-emerald-700/80">
                A confirmation message has been queued.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {followUpSendError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {followUpSendError}
              </div>
            )}

            {isFollowUpDraftLoading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Generating draft...</p>
              </div>
            ) : followUpDraftText ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="whitespace-pre-line text-sm leading-6 text-slate-700">
                  {typedFollowUp}
                  {typedFollowUp.length < followUpDraftText.length && (
                    <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-slate-400 align-middle" />
                  )}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm text-amber-700">
                  Unable to generate a draft right now. Please try again.
                </p>
              </div>
            )}
          </div>
        )}
      </AIModalShell>

      <AIModalShell
        isOpen={modalType === 'overdueFollowUps'}
        onClose={closeModal}
        label="AI INSIGHTS"
        title="Overdue Follow-Ups"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-2.5">
          {overdueFollowUps.map((item) => (
            <article
              key={`${item.contact}-${item.company}`}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{item.contact}</p>
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {item.overdue}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600">{item.company}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
                  >
                    Review Contact
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      openFollowUpModal({
                        contact: { name: item.contact, company: item.company },
                      })
                    }
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100 hover:shadow-sm active:scale-[0.99]"
                  >
                    Draft Follow-Up
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </AIModalShell>

      <AIModalShell
        isOpen={modalType === 'meetingPicker'}
        onClose={closeModal}
        label="AI Summary"
        title="Choose a Meeting to Summarize"
        description={
          isMeetingsLoading
            ? 'Loading recent meetings…'
            : meetingsError
              ? 'Unable to load meetings right now.'
              : 'Select a meeting to generate a focused AI summary.'
        }
        maxWidth="max-w-2xl"
      >
        <div className="space-y-2.5">
          {!isMeetingsLoading && recentMeetings.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">
              No recent meetings found.
            </div>
          )}

          {recentMeetings.map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              onClick={() => openMeetingSummary(meeting.id)}
              className="group flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3 text-left transition-all duration-150 hover:border-indigo-200 hover:bg-white hover:shadow-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{meeting.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{meeting.timeLabel}</p>
                {meeting.subtitle ? (
                  <p className="mt-1 truncate text-xs text-slate-600">{meeting.subtitle}</p>
                ) : null}
              </div>

              <span className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors group-hover:bg-indigo-100">
                Summarize
              </span>
            </button>
          ))}
        </div>
      </AIModalShell>

      <AIModalShell
        isOpen={modalType === 'meetingSummary'}
        onClose={closeModal}
        label="AI Summary"
        title={selectedSummary.title}
        description={
          isMeetingsLoading || isSummaryLoading
            ? 'Loading meeting context…'
            : summaryEmptyState
              ? 'Transcript unavailable for this meeting.'
              : summaryError
                ? 'Using fallback summary context.'
                : typedSummaryText.length < summaryText.length
                  ? 'Analyzing meeting context…'
                  : undefined
        }
        maxWidth="max-w-2xl"
        footer={
          <>
            <button
              type="button"
              onClick={handleCopySummary}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
            >
              Copy Summary
            </button>
            <button
              type="button"
              onClick={() => setModalType('aiTasks')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100 hover:shadow-sm active:scale-[0.99]"
            >
              <ListChecks size={15} aria-hidden="true" />
              Create Tasks
            </button>
          </>
        }
      >
        {summaryEmptyState ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            {summaryEmptyState}
          </div>
        ) : (
          <>
            {summaryError && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {summaryError}
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="whitespace-pre-line text-sm leading-6 text-slate-700">
                {typedSummaryText}
                {typedSummaryText.length < summaryText.length && (
                  <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-slate-400 align-middle" />
                )}
              </p>
            </div>
          </>
        )}
      </AIModalShell>

      <AIModalShell
        isOpen={modalType === 'aiTasks'}
        onClose={closeModal}
        label="AI TASKS"
        title="Suggested Action Items"
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={handleSaveTasks}
              disabled={isSavingTasks}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingTasks ? 'Saving...' : 'Save to Tasks'}
            </button>
            <button
              type="button"
              onClick={() => openFollowUpModal()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100 hover:shadow-sm active:scale-[0.99]"
            >
              <FilePenLine size={15} aria-hidden="true" />
              Draft Follow-Up
            </button>
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
            >
              Close
            </button>
          </>
        }
      >
        <div className="space-y-2.5">
          {tasksSaveError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {tasksSaveError}
            </div>
          )}

          {tasksSaveSuccess && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {tasksSaveSuccess}
            </div>
          )}

          {suggestedTasks.map((task) => (
            <div
              key={task}
              className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
            >
              <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-white text-slate-500 ring-1 ring-slate-200">
                <CheckSquare size={13} aria-hidden="true" />
              </span>
              <p className="text-sm text-slate-700">{task}</p>
            </div>
          ))}
        </div>
      </AIModalShell>

      <AIModalShell
        isOpen={modalType === 'findContact'}
        onClose={closeModal}
        label="AI Contact Search"
        title="Find a Contact"
        maxWidth="max-w-2xl"
      >
        <label className="relative mb-4 block">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            autoFocus
            type="text"
            value={contactQuery}
            onChange={(event) => setContactQuery(event.target.value)}
            placeholder="Search by name, company, or notes..."
            className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm transition-all duration-150 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <div className="space-y-2.5">
          {isContactsLoading && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm text-slate-600">Loading contacts...</p>
            </div>
          )}

          {!isContactsLoading && contactsError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
              <p className="text-sm text-amber-700">{contactsError}</p>
            </div>
          )}

          {!isContactsLoading && !contactsError && filteredContacts.map((contact) => (
            <article
              key={contact.id}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
                    <User size={16} aria-hidden="true" />
                  </span>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{contact.name}</p>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${contact.statusClassName}`}
                      >
                        {contact.status}
                      </span>
                    </div>

                    <p className="mt-0.5 text-sm text-slate-600">{contact.company}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Last contacted {contact.lastContacted}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-xs font-medium text-indigo-600">
                      {contactSuggestionLoadingById[contact.id] ? (
                        'AI suggestion: generating...'
                      ) : (
                        <>
                          <span>
                            AI suggestion:{' '}
                            {contactSuggestionById[contact.id] ||
                              getFallbackContactSuggestion(contact)}
                          </span>
                          {contactSuggestionPriorityById[contact.id] ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                contactSuggestionPriorityById[contact.id] === 'high'
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : contactSuggestionPriorityById[contact.id] === 'medium'
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-600'
                              }`}
                            >
                              {contactSuggestionPriorityById[contact.id]}
                            </span>
                          ) : null}
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openContactDrawer(contact)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
                  >
                    View Contact
                  </button>
                  <button
                    type="button"
                    onClick={() => openFollowUpModal({ contact })}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100 hover:shadow-sm active:scale-[0.99]"
                  >
                    Draft Follow-Up
                  </button>
                </div>
              </div>
            </article>
          ))}

          {!isContactsLoading && !contactsError && filteredContacts.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm text-slate-600">No contacts found. Try a name, company, status, or notes.</p>
            </div>
          )}
        </div>
      </AIModalShell>

      <AIModalShell
        isOpen={modalType === 'workflowDraft'}
        onClose={closeModal}
        label="AI Workflow Draft"
        title={workflowDraft.name}
        maxWidth="max-w-2xl"
        footer={
          <>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
            >
              Edit Workflow
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100 hover:shadow-sm active:scale-[0.99]"
            >
              <Workflow size={15} aria-hidden="true" />
              Activate
            </button>
          </>
        }
      >
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">Trigger</h4>
            <p className="text-sm text-slate-700">{workflowDraft.trigger}</p>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">Steps</h4>
            <ol className="space-y-2">
              {workflowDraft.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </AIModalShell>

      <ContactDetailsDrawer
        isOpen={isContactDrawerOpen}
        contact={selectedContact}
        onClose={closeContactDrawer}
        onDraftFollowUp={() => openModalFromDrawer('followUp')}
        onSummarizeMeeting={(contact) =>
          openModalFromDrawer('meetingSummary', contact?.recentMeetings?.[0]?.id || null)
        }
        onScheduleCheckIn={() => openModalFromDrawer('aiTasks')}
      />
    </>
  )
}

export default AIAssistantPanel
