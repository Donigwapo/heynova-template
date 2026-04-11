import { supabase } from './supabase'

const meetingSummaryFunctionName =
  import.meta.env.VITE_SUPABASE_MEETING_SUMMARY_FUNCTION || 'generate-meeting-summary'

export async function generateMeetingSummary({ userProfile, meeting }) {
  const payload = {
    user: {
      id: userProfile?.authUserId || userProfile?.id || null,
      name: userProfile?.displayName || null,
      email: userProfile?.email || null,
    },
    meeting: {
      id: meeting?.id || null,
      title: meeting?.title || meeting?.name || null,
      startsAt: meeting?.startsAt || meeting?.starts_at || meeting?.scheduled_at || null,
      transcript: meeting?.transcript || '',
    },
  }

  const { data, error } = await supabase.functions.invoke(meetingSummaryFunctionName, {
    body: payload,
  })

  if (error) {
    return {
      ok: false,
      error,
      source: 'fallback',
      summary: null,
      message: 'Unable to generate meeting summary right now.',
    }
  }

  return {
    ok: Boolean(data?.ok),
    error: null,
    source: data?.source || 'function',
    summary: data?.summary || null,
    message: data?.message || null,
  }
}
