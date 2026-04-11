import { supabase } from './supabase'

export async function saveMeetingSummary({ meetingId, userId = null, summary }) {
  if (!meetingId || !summary) {
    return {
      data: null,
      error: {
        code: 'invalid_summary_persistence_payload',
        message: 'meetingId and summary are required.',
      },
    }
  }

  const updatePayload = { summary }

  let query = supabase
    .from('meetings')
    .update(updatePayload)
    .eq('id', meetingId)

  if (userId) {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query.select('id').maybeSingle()

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[Meeting Summary Save] Attempt', {
      meetingId,
      userId,
      updatePayload,
      data,
      error,
    })
  }

  if (error) {
    return { data: null, error }
  }

  if (!data?.id) {
    return {
      data: null,
      error: {
        code: 'meeting_summary_not_persisted',
        message: 'No meeting row was updated. Check id, ownership (RLS), and schema.',
      },
    }
  }

  return { data, error: null }
}

export async function fetchMeetingsByUserId(userId) {
  if (!userId) {
    return { meetings: [], error: null }
  }

  // Keep query column-safe across schema variants.
  // Ordering is handled client-side in DashboardPage normalization.
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    return { meetings: [], error }
  }

  return { meetings: data || [], error: null }
}

export async function fetchMeetingsByIdsForUser(userId, meetingIds) {
  if (!userId || !Array.isArray(meetingIds) || meetingIds.length === 0) {
    return { meetings: [], error: null }
  }

  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, name')
    .eq('user_id', userId)
    .in('id', meetingIds)

  if (error) {
    return { meetings: [], error }
  }

  return { meetings: data || [], error: null }
}
