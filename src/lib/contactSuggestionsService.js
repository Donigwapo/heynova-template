import { supabase } from './supabase'

const suggestionFunctionName =
  import.meta.env.VITE_SUPABASE_CONTACT_SUGGESTION_FUNCTION || 'generate-followup-suggestion'

function toTimestamp(value) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function pickMostRecentByTimestamp(rows, timestampKeys = []) {
  if (!Array.isArray(rows) || rows.length === 0) return null

  return [...rows].sort((a, b) => {
    const aTs = Math.max(...timestampKeys.map((key) => toTimestamp(a?.[key])))
    const bTs = Math.max(...timestampKeys.map((key) => toTimestamp(b?.[key])))
    return bTs - aTs
  })[0]
}

export async function fetchContactSuggestionContexts({ userId, contactIds = [], meetings = [] }) {
  const normalizedIds = Array.from(new Set((contactIds || []).filter(Boolean)))

  if (!userId || normalizedIds.length === 0) {
    return {
      contextsByContactId: {},
      error: null,
    }
  }

  const localMeetingsByContactId = {}

  for (const contactId of normalizedIds) {
    const relatedMeetings = (meetings || []).filter((meeting) => meeting?.contact_id === contactId)
    const recentMeeting = pickMostRecentByTimestamp(relatedMeetings, [
      'starts_at',
      'scheduled_at',
      'start_time',
      'updated_at',
      'created_at',
    ])

    if (recentMeeting) {
      localMeetingsByContactId[contactId] = {
        id: recentMeeting?.id || null,
        title: recentMeeting?.title || recentMeeting?.name || null,
        summary: recentMeeting?.summary || null,
      }
    }
  }

  const [tasksResult, draftsResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .in('contact_id', normalizedIds),
    supabase
      .from('ai_drafts')
      .select('*')
      .eq('user_id', userId)
      .in('contact_id', normalizedIds),
  ])

  const tasksError = tasksResult?.error || null
  const draftsError = draftsResult?.error || null

  const tasks = tasksResult?.data || []
  const drafts = draftsResult?.data || []

  const contextsByContactId = {}

  for (const contactId of normalizedIds) {
    const tasksForContact = tasks
      .filter((task) => task?.contact_id === contactId)
      .sort((a, b) => toTimestamp(b?.updated_at || b?.created_at) - toTimestamp(a?.updated_at || a?.created_at))

    const openTasks = tasksForContact
      .filter((task) => {
        const status = (task?.status || '').toString().toLowerCase()
        if (!status) return true
        return ['open', 'todo', 'pending', 'in_progress'].includes(status)
      })
      .slice(0, 3)
      .map((task) => task?.title || task?.name || task?.task)
      .filter(Boolean)

    const draftsForContact = drafts
      .filter((draft) => draft?.contact_id === contactId)
      .sort(
        (a, b) =>
          toTimestamp(b?.created_at || b?.updated_at || b?.sent_at) -
          toTimestamp(a?.created_at || a?.updated_at || a?.sent_at)
      )

    const recentDraft = draftsForContact[0] || null

    contextsByContactId[contactId] = {
      recentMeeting: localMeetingsByContactId[contactId] || null,
      recentOpenTasks: openTasks,
      recentDraftStatus: recentDraft?.status || null,
    }
  }

  const error = tasksError || draftsError

  return {
    contextsByContactId,
    error,
  }
}

function normalizePriority(value) {
  const normalized = (value || '').toString().trim().toLowerCase()
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized
  }
  return null
}

export async function generateContactFollowUpSuggestion({ userProfile, contact, context = {} }) {
  const payload = {
    user: {
      id: userProfile?.authUserId || userProfile?.id || null,
      name: userProfile?.displayName || null,
      email: userProfile?.email || null,
    },
    contact: {
      id: contact?.persistedId || contact?.contact_id || contact?.id || null,
      name: contact?.name || null,
      company: contact?.company || null,
      status: contact?.status || null,
      lastContacted: contact?.last_contacted || contact?.last_contacted_at || contact?.lastContacted || null,
    },
    context: {
      recentMeetingSummary: context?.recentMeeting?.summary || null,
      recentMeetingTitle: context?.recentMeeting?.title || null,
      recentOpenTasks: context?.recentOpenTasks || [],
      recentDraftStatus: context?.recentDraftStatus || null,
    },
  }

  const timeoutMs = 7000

  const invokePromise = supabase.functions.invoke(suggestionFunctionName, {
    body: payload,
  })

  const timeoutPromise = new Promise((_, reject) => {
    window.setTimeout(() => {
      reject(new Error('suggestion_timeout'))
    }, timeoutMs)
  })

  try {
    const { data, error } = await Promise.race([invokePromise, timeoutPromise])

    if (error) {
      return {
        suggestion: null,
        priority: null,
        source: 'fallback',
        error,
      }
    }

    return {
      suggestion: typeof data?.suggestion === 'string' ? data.suggestion.trim() : null,
      priority: normalizePriority(data?.priority),
      source: data?.source || 'function',
      error: null,
    }
  } catch (error) {
    return {
      suggestion: null,
      priority: null,
      source: 'fallback',
      error,
    }
  }
}

export function getFallbackContactSuggestion(contact) {
  const name = contact?.name || 'this contact'
  return `Check in with ${name} and propose one clear next step.`
}

export function getFallbackContactPriority(contact) {
  const status = (contact?.status || '').toString().toLowerCase()
  if (status.includes('overdue') || status.includes('follow-up')) return 'high'
  if (status.includes('active') || status.includes('in progress')) return 'medium'
  return null
}
