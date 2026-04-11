import { supabase } from './supabase'

const DEFAULT_DUE_HOUR = 17
const DEFAULT_DUE_MINUTE = 0

function cleanTaskTitles(tasks) {
  return tasks
    .map((task) => (typeof task === 'string' ? task.trim() : ''))
    .filter(Boolean)
}

function parseSupabaseError(error) {
  if (!error) return { message: 'Unknown task save error.' }

  return {
    message: error.message || 'Unknown task save error.',
    code: error.code || null,
    details: error.details || null,
    hint: error.hint || null,
  }
}

function atDefaultDueTimeLocal(date) {
  const next = new Date(date)
  next.setHours(DEFAULT_DUE_HOUR, DEFAULT_DUE_MINUTE, 0, 0)
  return next
}

function addDaysLocal(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function inferDueAtFromTaskText(taskText) {
  if (!taskText || typeof taskText !== 'string') return null

  const normalized = taskText.toLowerCase()

  const phraseMatches = [
    { phrase: 'next week', offsetDays: 7 },
    { phrase: 'tomorrow', offsetDays: 1 },
    { phrase: 'today', offsetDays: 0 },
  ]
    .map((entry) => ({
      ...entry,
      index: normalized.indexOf(entry.phrase),
    }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index)

  if (phraseMatches.length === 0) return null

  const match = phraseMatches[0]
  const base = addDaysLocal(new Date(), match.offsetDays)
  return atDefaultDueTimeLocal(base).toISOString()
}

function buildRows({
  userId,
  titles,
  titleColumn,
  includeContact,
  includeMeeting,
  includeStatus,
  includeSourceContext,
  includeCreatedAt,
  includeDueAt,
  contactId,
  meetingId,
  sourceContext,
  nowIso,
}) {
  return titles.map((title) => ({
    user_id: userId,
    ...(includeContact ? { contact_id: contactId } : {}),
    ...(includeMeeting ? { meeting_id: meetingId } : {}),
    [titleColumn]: title,
    ...(includeStatus ? { status: 'open' } : {}),
    ...(includeSourceContext
      ? {
          source_context: {
            source: 'ai',
            ...sourceContext,
          },
        }
      : {}),
    ...(includeCreatedAt ? { created_at: nowIso } : {}),
    ...(includeDueAt ? { due_at: inferDueAtFromTaskText(title) } : {}),
  }))
}

export async function saveAITasks({
  userId,
  tasks = [],
  contactId = null,
  meetingId = null,
  sourceContext = {},
}) {
  if (!userId || !Array.isArray(tasks) || tasks.length === 0) {
    return { savedCount: 0, error: null, debug: null }
  }

  const titles = cleanTaskTitles(tasks)
  if (titles.length === 0) {
    return { savedCount: 0, error: null, debug: null }
  }

  const nowIso = new Date().toISOString()

  const insertStrategies = [
    {
      name: 'full_payload_title',
      rows: buildRows({
        userId,
        titles,
        titleColumn: 'title',
        includeContact: true,
        includeMeeting: true,
        includeStatus: true,
        includeSourceContext: true,
        includeCreatedAt: true,
        includeDueAt: true,
        contactId,
        meetingId,
        sourceContext,
        nowIso,
      }),
    },
    {
      name: 'reduced_payload_title',
      rows: buildRows({
        userId,
        titles,
        titleColumn: 'title',
        includeContact: true,
        includeMeeting: true,
        includeStatus: false,
        includeSourceContext: false,
        includeCreatedAt: false,
        includeDueAt: true,
        contactId,
        meetingId,
        sourceContext,
        nowIso,
      }),
    },
    {
      name: 'minimal_payload_title',
      rows: buildRows({
        userId,
        titles,
        titleColumn: 'title',
        includeContact: false,
        includeMeeting: false,
        includeStatus: false,
        includeSourceContext: false,
        includeCreatedAt: false,
        includeDueAt: true,
        contactId,
        meetingId,
        sourceContext,
        nowIso,
      }),
    },
    {
      name: 'minimal_payload_name',
      rows: buildRows({
        userId,
        titles,
        titleColumn: 'name',
        includeContact: false,
        includeMeeting: false,
        includeStatus: false,
        includeSourceContext: false,
        includeCreatedAt: false,
        includeDueAt: true,
        contactId,
        meetingId,
        sourceContext,
        nowIso,
      }),
    },
    {
      name: 'minimal_payload_task',
      rows: buildRows({
        userId,
        titles,
        titleColumn: 'task',
        includeContact: false,
        includeMeeting: false,
        includeStatus: false,
        includeSourceContext: false,
        includeCreatedAt: false,
        includeDueAt: true,
        contactId,
        meetingId,
        sourceContext,
        nowIso,
      }),
    },
  ]

  const attempts = []

  for (const strategy of insertStrategies) {
    const attemptedFields = Object.keys(strategy.rows[0] || {})
    const { error } = await supabase.from('tasks').insert(strategy.rows)

    if (!error) {
      return {
        savedCount: strategy.rows.length,
        error: null,
        debug: {
          strategy: strategy.name,
          attemptedFields,
        },
      }
    }

    attempts.push({
      strategy: strategy.name,
      attemptedFields,
      error: parseSupabaseError(error),
    })
  }

  const lastAttempt = attempts[attempts.length - 1] || null

  return {
    savedCount: 0,
    error: {
      message: lastAttempt?.error?.message || 'Unable to save tasks right now.',
      code: lastAttempt?.error?.code || null,
    },
    debug: {
      attempts,
    },
  }
}
