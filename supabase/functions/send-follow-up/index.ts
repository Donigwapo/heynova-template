// Supabase Edge Function: send-follow-up
// Resend-backed follow-up delivery with strict payload validation.
//
// Stable success response contract:
// {
//   ok: boolean,
//   status: "sent" | "failed",
//   source: "resend",
//   message: string,
//   providerMessageId: string | null
// }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

const RESEND_API_URL = 'https://api.resend.com/emails'
const SENDER_EMAIL = 'hello@kynliconsulting.com'

type StringMap = Record<string, string>

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
  options: { maxLength?: number; email?: boolean; required?: boolean } = {}
): string | null {
  if (input === undefined || input === null) {
    if (options.required) errors[field] = 'Field is required.'
    return null
  }

  if (typeof input !== 'string') {
    errors[field] = 'Must be a string.'
    return null
  }

  const value = input.trim()
  if (!value) {
    if (options.required) errors[field] = 'Field is required.'
    return null
  }

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

function buildSubject(contact: Record<string, unknown> | null, meeting: Record<string, unknown> | null) {
  const contactName =
    typeof contact?.name === 'string' && contact.name.trim() ? contact.name.trim() : 'you'
  const meetingTitle =
    typeof meeting?.title === 'string' && meeting.title.trim() ? meeting.title.trim() : 'our recent meeting'

  return `Follow-up: ${meetingTitle} (${contactName})`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Only POST is supported.')
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) {
    return errorResponse(
      500,
      'provider_not_configured',
      'Email provider is not configured. Please set RESEND_API_KEY.'
    )
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

  const errors: StringMap = {}
  const user = asRecord(payload.user)
  const contact = asRecord(payload.contact)
  const meeting = asRecord(payload.meeting)

  if (payload.user !== undefined && !user) errors.user = 'Must be an object.'
  if (payload.contact !== undefined && !contact) errors.contact = 'Must be an object.'
  if (payload.meeting !== undefined && !meeting) errors.meeting = 'Must be an object.'

  const draftText = normalizeString(payload.draftText, 'draftText', errors, {
    required: true,
    maxLength: 12000,
  })

  const contactEmail = normalizeString(contact?.email, 'contact.email', errors, {
    required: true,
    email: true,
    maxLength: 254,
  })

  if (contact) {
    normalizeString(contact.name, 'contact.name', errors, { maxLength: 120 })
  }

  if (user) {
    normalizeString(user.email, 'user.email', errors, { email: true, maxLength: 254 })
  }

  if (meeting) {
    normalizeString(meeting.title, 'meeting.title', errors, { maxLength: 200 })
  }

  if (Object.keys(errors).length > 0) {
    return errorResponse(400, 'validation_failed', 'Payload validation failed.', errors)
  }

  const resendPayload = {
    from: SENDER_EMAIL,
    to: [contactEmail as string],
    subject: buildSubject(contact, meeting),
    text: draftText as string,
  }

  let resendResponse: Response
  try {
    resendResponse = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    })
  } catch {
    return jsonResponse({
      ok: false,
      status: 'failed',
      source: 'resend',
      message: 'Unable to send follow-up right now.',
      providerMessageId: null,
      error: {
        code: 'provider_unreachable',
        message: 'Email provider is currently unreachable.',
      },
    })
  }

  const responseText = await resendResponse.text()
  let responseJson: Record<string, unknown> | null = null
  try {
    responseJson = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : null
  } catch {
    responseJson = null
  }

  if (!resendResponse.ok) {
    const providerErrorMessage =
      (typeof responseJson?.message === 'string' && responseJson.message) ||
      'Unable to deliver follow-up email.'

    return jsonResponse({
      ok: false,
      status: 'failed',
      source: 'resend',
      message: providerErrorMessage,
      providerMessageId: null,
      error: {
        code: 'provider_error',
        message: providerErrorMessage,
      },
    })
  }

  const providerMessageId =
    (typeof responseJson?.id === 'string' && responseJson.id) ||
    (typeof responseJson?.messageId === 'string' && responseJson.messageId) ||
    null

  return jsonResponse({
    ok: true,
    status: 'sent',
    source: 'resend',
    message: 'Follow-up sent successfully.',
    providerMessageId,
  })
})
