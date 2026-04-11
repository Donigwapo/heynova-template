import { supabase } from './supabase'

const followUpFunctionName =
  import.meta.env.VITE_SUPABASE_FOLLOW_UP_FUNCTION || 'generate-follow-up-draft'

function buildFallbackDraft({ userProfile, contact, meeting }) {
  const senderName = userProfile?.displayName || 'Heynova Team'
  const contactName = contact?.name || 'there'
  const meetingTitle = meeting?.title || 'our recent meeting'

  const bullets = [
    'I’ll share the revised plan and key milestones by tomorrow.',
    'After your review, we can schedule a 20-minute check-in to align next steps.',
    'If priorities changed on your side, reply here and I’ll adjust the plan.',
  ]

  return `Hi ${contactName},

Thanks again for ${meetingTitle}. I wanted to quickly follow up with a recap and next steps.

• ${bullets.join('\n• ')}

Best,\n${senderName}`
}

export async function generateFollowUpDraft({ userProfile, contact, meeting }) {
  const contextFlags = {
    hasUserProfile: Boolean(userProfile),
    hasContact: Boolean(contact),
    hasMeeting: Boolean(meeting),
  }

  const payload = {
    user: {
      id: userProfile?.authUserId || userProfile?.id || null,
      name: userProfile?.displayName || null,
      email: userProfile?.email || null,
      role: userProfile?.role || null,
      companyName: userProfile?.companyName || null,
    },
    contact: contact
      ? {
          id: contact.id || null,
          name: contact.name || null,
          email: contact.email || null,
          company: contact.company || null,
          status: contact.status || null,
          notes: contact.notes || null,
        }
      : null,
    meeting: meeting
      ? {
          id: meeting.id || null,
          contact_id: meeting.contact_id || meeting.contactId || null,
          title: meeting.title || null,
          startsAt: meeting.startsAt || meeting.starts_at || meeting.scheduled_at || null,
          agenda: meeting.agenda || null,
          notes: meeting.notes || null,
          summary: meeting.summary || null,
          transcript: meeting.transcript || null,
          attendees: meeting.attendees || null,
        }
      : null,
  }

  const { data, error } = await supabase.functions.invoke(followUpFunctionName, {
    body: payload,
  })

  if (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[FollowUp Draft] Function invoke failed', {
        functionName: followUpFunctionName,
        error,
      })
    }

    return {
      draft: buildFallbackDraft({ userProfile, contact, meeting }),
      error,
      source: 'fallback',
      sourceContext: {
        ...contextFlags,
        provider: 'fallback',
        functionName: followUpFunctionName,
      },
    }
  }

  if (data?.draft && typeof data.draft === 'string') {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[FollowUp Draft] Function response', {
        source: data?.source || 'function',
        context: data?.context || null,
        functionName: followUpFunctionName,
      })
    }

    return {
      draft: data.draft,
      error: null,
      source: 'function',
      sourceContext: {
        ...contextFlags,
        provider: data?.source || 'function',
        functionName: followUpFunctionName,
        fallbackReason: data?.context?.fallbackReason || null,
      },
    }
  }

  return {
    draft: buildFallbackDraft({ userProfile, contact, meeting }),
    error: null,
    source: 'fallback',
    sourceContext: {
      ...contextFlags,
      provider: 'fallback',
      functionName: followUpFunctionName,
      reason: 'missing_draft_in_response',
    },
  }
}
