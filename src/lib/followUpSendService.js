import { supabase } from './supabase'

const sendFollowUpFunctionName =
  import.meta.env.VITE_SUPABASE_SEND_FOLLOW_UP_FUNCTION || 'send-follow-up'

export async function sendFollowUpDraft({ userProfile, contact, meeting, draftText }) {
  const payload = {
    user: {
      id: userProfile?.authUserId || userProfile?.id || null,
      name: userProfile?.displayName || null,
      email: userProfile?.email || null,
    },
    contact: contact
      ? {
          id: contact.id || null,
          name: contact.name || null,
          email: contact.email || null,
          company: contact.company || null,
        }
      : null,
    meeting: meeting
      ? {
          id: meeting.id || null,
          title: meeting.title || null,
          startsAt: meeting.startsAt || null,
        }
      : null,
    draftText: draftText || '',
  }

  const { data, error } = await supabase.functions.invoke(sendFollowUpFunctionName, {
    body: payload,
  })

  if (error) {
    return {
      ok: false,
      error,
      source: 'fallback',
      result: {
        status: 'failed',
        message: 'Unable to send follow-up right now.',
      },
    }
  }

  return {
    ok: Boolean(data?.ok),
    error: null,
    source: data?.source || 'function',
    result: {
      status: data?.status || (data?.ok ? 'sent' : 'failed'),
      message: data?.message || (data?.ok ? 'Follow-up sent.' : 'Follow-up failed.'),
      providerMessageId: data?.providerMessageId || null,
    },
  }
}
