// Supabase Edge Function: generate-follow-up-draft
// Real LLM-backed follow-up generation with strict validation and safe fallback.
//
// Stable success contract for frontend:
// {
//   draft: string,
//   source: 'openai' | 'fallback',
//   context: {
//     hasUserProfile: boolean,
//     hasContact: boolean,
//     hasMeeting: boolean
//   }
// }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini'
const LLM_TIMEOUT_MS = 15000
const FUNCTION_VERSION = '2026-04-10-follow-up-llm-v1'

type StringMap = Record<string, string>

type NormalizedUserProfile = {
  id: string | null
  name: string | null
  email: string | null
  role: string | null
  companyName: string | null
}

type NormalizedContact = {
  id: string | null
  name: string | null
  email: string | null
  company: string | null
  status: string | null
  notes: string | null
}

type NormalizedMeeting = {
  id: string | null
  title: string | null
  startsAt: string | null
  agenda: string | null
  notes: string | null
  summary: string | null
  transcript: string | null
  attendees: string[]
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: StringMap
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeString(
  input: unknown,
  field: string,
  errors: StringMap,
  options: { maxLength?: number; email?: boolean } = {}
): string | null {
  if (input === undefined || input === null) return null
  if (typeof input !== 'string') {
    errors[field] = 'Must be a string.'
    return null
  }

  const value = input.trim()
  if (!value) return null

  if (options.maxLength && value.length > options.maxLength) {
    errors[field] = `Must be ${options.maxLength} characters or fewer.`
    return null
  }

  if (options.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(value)) {
      errors[field] = 'Must be a valid email address.'
      return null
    }
  }

  return value
}

function normalizeAttendees(input: unknown, errors: StringMap): string[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    errors['meeting.attendees'] = 'Must be an array of strings.'
    return []
  }

  const attendees: string[] = []
  for (const [index, attendee] of input.entries()) {
    if (typeof attendee !== 'string') {
      errors[`meeting.attendees[${index}]`] = 'Must be a string.'
      continue
    }

    const normalized = attendee.trim()
    if (normalized.length === 0) continue
    if (normalized.length > 120) {
      errors[`meeting.attendees[${index}]`] = 'Must be 120 characters or fewer.'
      continue
    }

    attendees.push(normalized)
  }

  return attendees
}

function normalizeIsoDate(input: unknown, field: string, errors: StringMap): string | null {
  const value = normalizeString(input, field, errors, { maxLength: 64 })
  if (!value) return null

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    errors[field] = 'Must be a valid datetime string.'
    return null
  }

  return parsed.toISOString()
}

function truncate(input: string | null, max: number): string | null {
  if (!input) return null
  return input.length > max ? `${input.slice(0, max)}...` : input
}

function normalizePayload(payload: Record<string, unknown>) {
  const errors: StringMap = {}

  // Accept both userProfile and legacy user for compatibility.
  const userRaw = asRecord(payload.userProfile) ?? asRecord(payload.user)
  const contactRaw = asRecord(payload.contact)
  const meetingRaw = asRecord(payload.meeting)

  if (payload.userProfile !== undefined && !asRecord(payload.userProfile)) {
    errors.userProfile = 'Must be an object.'
  }
  if (payload.user !== undefined && !asRecord(payload.user)) {
    errors.user = 'Must be an object.'
  }
  if (payload.contact !== undefined && !contactRaw) {
    errors.contact = 'Must be an object.'
  }
  if (payload.meeting !== undefined && !meetingRaw) {
    errors.meeting = 'Must be an object.'
  }

  const userProfile: NormalizedUserProfile | null = userRaw
    ? {
        id: normalizeString(userRaw.id, 'userProfile.id', errors, { maxLength: 128 }),
        name: normalizeString(userRaw.name, 'userProfile.name', errors, { maxLength: 120 }),
        email: normalizeString(userRaw.email, 'userProfile.email', errors, {
          maxLength: 254,
          email: true,
        }),
        role: normalizeString(userRaw.role, 'userProfile.role', errors, { maxLength: 80 }),
        companyName: normalizeString(userRaw.companyName, 'userProfile.companyName', errors, {
          maxLength: 160,
        }),
      }
    : null

  const contact: NormalizedContact | null = contactRaw
    ? {
        id: normalizeString(contactRaw.id, 'contact.id', errors, { maxLength: 128 }),
        name: normalizeString(contactRaw.name, 'contact.name', errors, { maxLength: 120 }),
        email: normalizeString(contactRaw.email, 'contact.email', errors, {
          maxLength: 254,
          email: true,
        }),
        company: normalizeString(contactRaw.company, 'contact.company', errors, {
          maxLength: 160,
        }),
        status: normalizeString(contactRaw.status, 'contact.status', errors, { maxLength: 80 }),
        notes: normalizeString(contactRaw.notes, 'contact.notes', errors, { maxLength: 6000 }),
      }
    : null

  const meeting: NormalizedMeeting | null = meetingRaw
    ? {
        id: normalizeString(meetingRaw.id, 'meeting.id', errors, { maxLength: 128 }),
        title: normalizeString(meetingRaw.title, 'meeting.title', errors, { maxLength: 160 }),
        startsAt: normalizeIsoDate(meetingRaw.startsAt, 'meeting.startsAt', errors),
        agenda: normalizeString(meetingRaw.agenda, 'meeting.agenda', errors, { maxLength: 4000 }),
        notes: normalizeString(meetingRaw.notes, 'meeting.notes', errors, { maxLength: 12000 }),
        summary: normalizeString(meetingRaw.summary, 'meeting.summary', errors, {
          maxLength: 20000,
        }),
        transcript: normalizeString(meetingRaw.transcript, 'meeting.transcript', errors, {
          maxLength: 120000,
        }),
        attendees: normalizeAttendees(meetingRaw.attendees, errors),
      }
    : null

  return { userProfile, contact, meeting, errors }
}

function buildFallbackDraft(input: {
  userProfile: NormalizedUserProfile | null
  contact: NormalizedContact | null
  meeting: NormalizedMeeting | null
}) {
  const contactName = input.contact?.name || 'there'
  const senderName = input.userProfile?.name || 'Heynova Team'
  const meetingTitle = input.meeting?.title || 'our recent conversation'
  const meetingDate = input.meeting?.startsAt
    ? new Date(input.meeting.startsAt).toLocaleDateString()
    : null

  const intro = meetingDate
    ? `Thanks again for ${meetingTitle} on ${meetingDate}.`
    : `Thanks again for ${meetingTitle}.`

  const contextLine = input.contact?.company
    ? `I appreciate the context you shared about ${input.contact.company}.`
    : 'I appreciate the context you shared in our discussion.'

  return `Hi ${contactName},

${intro} ${contextLine}

Here are the next steps from my side:
• I’ll send the revised proposal and timeline by tomorrow.
• We can schedule a 20-minute check-in next week to confirm rollout details.
• I’ll capture any updates in a concise recap so your team can review quickly.

If priorities changed, reply here and I’ll adjust the plan.

Best,
${senderName}`
}

function buildPromptContext(input: {
  userProfile: NormalizedUserProfile | null
  contact: NormalizedContact | null
  meeting: NormalizedMeeting | null
}) {
  const { userProfile, contact, meeting } = input

  const primaryDiscussionContext =
    truncate(meeting?.summary || meeting?.transcript || null, 2200) || 'None'

  const blocks = [
    `Sender:\n- Name: ${userProfile?.name || 'Unknown'}\n- Role: ${userProfile?.role || 'Unknown'}\n- Company: ${userProfile?.companyName || 'Unknown'}`,
    `Recipient:\n- Name: ${contact?.name || 'Unknown'}\n- Company: ${contact?.company || 'Unknown'}\n- Status: ${contact?.status || 'Unknown'}\n- Notes: ${truncate(contact?.notes || null, 900) || 'None'}`,
    `Meeting Context:\n- Title: ${meeting?.title || 'Unknown'}\n- Starts At: ${meeting?.startsAt || 'Unknown'}\n- Primary Discussion Context: ${primaryDiscussionContext}\n- Summary: ${truncate(meeting?.summary || null, 1200) || 'None'}\n- Transcript Excerpt: ${truncate(meeting?.transcript || null, 1200) || 'None'}\n- Notes: ${truncate(meeting?.notes || null, 800) || 'None'}\n- Agenda: ${truncate(meeting?.agenda || null, 800) || 'None'}\n- Attendees: ${meeting?.attendees?.length ? meeting.attendees.join(', ') : 'None'}`,
  ]

  return blocks.join('\n\n')
}

async function generateDraftWithOpenAI(input: {
  userProfile: NormalizedUserProfile | null
  contact: NormalizedContact | null
  meeting: NormalizedMeeting | null
}): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn('[generate-follow-up-draft] OPENAI_API_KEY missing; using fallback path', {
      functionVersion: FUNCTION_VERSION,
      model: OPENAI_MODEL,
    })
    throw new Error('openai_not_configured')
  }

  // eslint-disable-next-line no-console
  console.debug('[generate-follow-up-draft] Provider path entered', {
    functionVersion: FUNCTION_VERSION,
    provider: 'openai',
    model: OPENAI_MODEL,
    hasApiKey: Boolean(apiKey),
  })

  const context = buildPromptContext(input)
  const senderName = input.userProfile?.name || 'Heynova Team'
  const recipientName = input.contact?.name || 'there'

  const meeting = input.meeting

  // eslint-disable-next-line no-console
  console.log('[generate-follow-up-draft] Meeting context debug', {
    hasSummary: !!meeting?.summary,
    summaryLength: meeting?.summary?.length ?? 0,
    hasTranscript: !!meeting?.transcript,
    transcriptLength: meeting?.transcript?.length ?? 0,
    hasNotes: !!meeting?.notes,
    hasAgenda: !!meeting?.agenda,
    contextPreview: context?.slice(0, 500) ?? null,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.35,
        messages: [
          {
            role: 'system',
            content:
              'You write concise, practical business follow-up emails. Output plain text only. No markdown. Keep tone professional and natural. Avoid robotic phrasing and filler.',
          },
          {
            role: 'user',
            content: `Write a follow-up email in plain text.

STRICT REQUIREMENTS:
- If meeting summary, transcript, agenda, or notes are present, you MUST reference at least 2 concrete points actually discussed in the meeting.
- The email must sound grounded in that specific conversation, not like a generic sales follow-up.
- Do NOT use generic phrases such as "just checking in", "following up on our last discussion", or "discovery call" unless the context clearly supports them.
- Mention 2 to 3 practical next steps, priorities, or action items from the meeting when available.
- Keep the tone professional, natural, and concise.
- Keep length between 120 and 220 words.
- Output only the final email text in plain text.

Sender name: ${senderName}
Recipient name: ${recipientName}

Meeting and contact context:
${context}`,
          },
        ],
      }),
    })

    const text = await response.text()
    let json: Record<string, unknown> | null = null
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null
    } catch {
      json = null
    }

    if (!response.ok) {
      const providerMessage =
        (typeof json?.error === 'object' && json?.error &&
          typeof (json.error as Record<string, unknown>).message === 'string' &&
          (json.error as Record<string, unknown>).message) ||
        'LLM provider returned an error.'

      // eslint-disable-next-line no-console
      console.warn('[generate-follow-up-draft] OpenAI request failed', {
        functionVersion: FUNCTION_VERSION,
        model: OPENAI_MODEL,
        status: response.status,
        providerMessage,
      })

      throw new Error(`openai_error:${providerMessage}`)
    }

    const content =
      json &&
      Array.isArray(json.choices) &&
      json.choices[0] &&
      typeof json.choices[0] === 'object' &&
      (json.choices[0] as Record<string, unknown>).message &&
      typeof (json.choices[0] as Record<string, unknown>).message === 'object'
        ? ((json.choices[0] as Record<string, unknown>).message as Record<string, unknown>).content
        : null

    if (typeof content !== 'string' || !content.trim()) {
      // eslint-disable-next-line no-console
      console.warn('[generate-follow-up-draft] OpenAI parsing failed: missing content', {
        functionVersion: FUNCTION_VERSION,
        model: OPENAI_MODEL,
      })
      throw new Error('openai_invalid_content')
    }

    return content.trim()
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Only POST is supported for this endpoint.')
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body must be valid JSON.')
  }

  const payload = asRecord(body)
  if (!payload) {
    return errorResponse(400, 'invalid_payload', 'Request body must be a JSON object.')
  }

  const { userProfile, contact, meeting, errors } = normalizePayload(payload)

  if (Object.keys(errors).length > 0) {
    return errorResponse(400, 'validation_failed', 'Payload validation failed.', errors)
  }

  const contextFlags = {
    hasUserProfile: Boolean(userProfile),
    hasContact: Boolean(contact),
    hasMeeting: Boolean(meeting),
  }

  try {
    const draft = await generateDraftWithOpenAI({ userProfile, contact, meeting })

    return jsonResponse({
      draft,
      source: 'openai',
      context: contextFlags,
    })
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : 'unknown_follow_up_generation_error'

    // eslint-disable-next-line no-console
    console.warn('[generate-follow-up-draft] Fallback triggered', {
      functionVersion: FUNCTION_VERSION,
      model: OPENAI_MODEL,
      fallbackReason,
    })

    const draft = buildFallbackDraft({ userProfile, contact, meeting })

    return jsonResponse({
      draft,
      source: 'fallback',
      context: {
        ...contextFlags,
        fallbackReason,
      },
    })
  }
})
