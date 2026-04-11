// Supabase Edge Function: generate-followup-suggestion
// Provider-agnostic suggestion stub with strict validation.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

type FieldErrors = Record<string, string>

type SuggestionPayload = {
  user?: {
    id?: string | null
    name?: string | null
    email?: string | null
  }
  contact: {
    id?: string | null
    name?: string | null
    company?: string | null
    status?: string | null
    lastContacted?: string | null
  }
  context?: {
    recentMeetingSummary?: string | null | Record<string, unknown>
    recentMeetingTitle?: string | null
    recentOpenTasks?: string[]
    recentDraftStatus?: string | null
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

function errorResponse(status: number, code: string, message: string, details?: FieldErrors): Response {
  return json(
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

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function normalizeSummary(summary: unknown): string | null {
  if (!summary) return null
  if (typeof summary === 'string') return asString(summary, 1200)
  if (typeof summary === 'object') {
    try {
      return JSON.stringify(summary).slice(0, 1200)
    } catch {
      return null
    }
  }
  return null
}

function createSuggestionAndPriority(input: SuggestionPayload): {
  suggestion: string
  priority: 'high' | 'medium' | 'low'
} {
  const contactName = asString(input.contact?.name, 80) || 'this contact'
  const company = asString(input.contact?.company, 80)
  const status = asString(input.contact?.status, 80)
  const meetingTitle = asString(input.context?.recentMeetingTitle, 120)
  const summary = normalizeSummary(input.context?.recentMeetingSummary)
  const tasks = Array.isArray(input.context?.recentOpenTasks)
    ? input.context?.recentOpenTasks.filter((t) => typeof t === 'string').slice(0, 2)
    : []
  const draftStatus = asString(input.context?.recentDraftStatus, 40)

  if (summary && meetingTitle) {
    return {
      suggestion: `Use ${meetingTitle} notes to send a concise follow-up to ${contactName}${company ? ` at ${company}` : ''} and confirm one next action today.`,
      priority: 'high',
    }
  }

  if (tasks.length > 0) {
    return {
      suggestion: `Follow up with ${contactName}${company ? ` at ${company}` : ''} and close the highest-priority task: ${tasks[0]}.`,
      priority: 'high',
    }
  }

  if (draftStatus === 'failed') {
    return {
      suggestion: `Retry a short follow-up to ${contactName}${company ? ` at ${company}` : ''} and propose a clear check-in time.`,
      priority: 'high',
    }
  }

  if (status) {
    return {
      suggestion: `Send a quick ${status.toLowerCase()} check-in to ${contactName}${company ? ` at ${company}` : ''} with one concrete next step.`,
      priority: 'medium',
    }
  }

  return {
    suggestion: `Check in with ${contactName}${company ? ` at ${company}` : ''} and suggest one clear next step.`,
    priority: 'low',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Only POST is supported.')
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body must be valid JSON.')
  }

  const payload = asObject(body)
  if (!payload) {
    return errorResponse(400, 'invalid_payload', 'Request body must be a JSON object.')
  }

  const errors: FieldErrors = {}
  const contact = asObject(payload.contact)
  if (!contact) {
    errors.contact = 'contact object is required.'
  }

  const contactName = asString(contact?.name)
  if (!contactName) {
    errors['contact.name'] = 'contact.name is required.'
  }

  if (Object.keys(errors).length > 0) {
    return errorResponse(400, 'validation_failed', 'Payload validation failed.', errors)
  }

  const typedPayload = payload as unknown as SuggestionPayload
  const { suggestion, priority } = createSuggestionAndPriority(typedPayload)

  return json({
    ok: true,
    source: 'mock',
    suggestion,
    priority,
  })
})
