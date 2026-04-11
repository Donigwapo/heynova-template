// Supabase Edge Function: generate-meeting-summary
// Real LLM-backed transcript summarization with strict validation and safe fallback.
//
// Request:
// {
//   user?: { id?, name?, email? },
//   meeting: {
//     id?: string,
//     title?: string,
//     startsAt?: string,
//     transcript: string
//   }
// }
//
// Success response contract (stable for frontend):
// {
//   ok: true,
//   source: 'openai' | 'fallback',
//   summary: {
//     title: string,
//     keyPoints: string[],
//     decisions: string[],
//     actionItems: string[]
//   },
//   message: string
// }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini'
const LLM_TIMEOUT_MS = 15000

type StringMap = Record<string, string>

type SummaryShape = {
  title: string
  keyPoints: string[]
  decisions: string[]
  actionItems: string[]
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
  options: { maxLength?: number; required?: boolean } = {}
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

  return value
}

function splitSentences(transcript: string): string[] {
  return transcript
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function fallbackSummary(meetingTitle: string, transcript: string): SummaryShape {
  const sentences = splitSentences(transcript)

  const keyPoints = sentences.slice(0, 3)

  const decisions = sentences
    .filter((line) => {
      const lower = line.toLowerCase()
      return (
        lower.includes('decided') ||
        lower.includes('agreed') ||
        lower.includes('approved') ||
        lower.includes('decision')
      )
    })
    .slice(0, 2)

  const actionItems = sentences
    .filter((line) => {
      const lower = line.toLowerCase()
      return (
        lower.includes('will ') ||
        lower.includes('next') ||
        lower.includes('follow up') ||
        lower.includes('action') ||
        lower.includes('deadline')
      )
    })
    .slice(0, 3)

  return {
    title: meetingTitle || 'Meeting Summary',
    keyPoints: keyPoints.length ? keyPoints : ['No key points identified from transcript.'],
    decisions: decisions.length ? decisions : ['No explicit decisions captured.'],
    actionItems: actionItems.length ? actionItems : ['No action items identified from transcript.'],
  }
}

function normalizeSummaryShape(input: unknown, fallbackTitle: string): SummaryShape | null {
  const record = asRecord(input)
  if (!record) return null

  const title = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim().slice(0, 240)
    : fallbackTitle

  const toStringArray = (value: unknown, emptyMessage: string) => {
    if (!Array.isArray(value)) return [emptyMessage]

    const rows = value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => (entry as string).trim())
      .filter(Boolean)
      .slice(0, 8)

    return rows.length ? rows : [emptyMessage]
  }

  return {
    title,
    keyPoints: toStringArray(record.keyPoints, 'No key points identified.'),
    decisions: toStringArray(record.decisions, 'No explicit decisions captured.'),
    actionItems: toStringArray(record.actionItems, 'No action items identified.'),
  }
}

async function generateWithOpenAI({
  transcript,
  meetingTitle,
}: {
  transcript: string
  meetingTitle: string
}): Promise<SummaryShape> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('openai_not_configured')
  }

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
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'meeting_summary',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'keyPoints', 'decisions', 'actionItems'],
              properties: {
                title: { type: 'string' },
                keyPoints: {
                  type: 'array',
                  items: { type: 'string' },
                },
                decisions: {
                  type: 'array',
                  items: { type: 'string' },
                },
                actionItems: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
        messages: [
          {
            role: 'system',
            content:
              'You summarize meeting transcripts for a B2B CRM assistant. Return concise, actionable JSON only.',
          },
          {
            role: 'user',
            content: `Summarize this meeting transcript.\n\nMeeting title: ${meetingTitle}\n\nReturn JSON with:\n- title\n- keyPoints (3-5 bullets)\n- decisions (0-3 bullets)\n- actionItems (1-5 bullets, concrete next actions)\n\nTranscript:\n${transcript}`,
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
      throw new Error('openai_invalid_content')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('openai_invalid_json_output')
    }

    const normalized = normalizeSummaryShape(parsed, meetingTitle)
    if (!normalized) {
      throw new Error('openai_invalid_summary_shape')
    }

    return normalized
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Only POST is supported.')
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
  const meeting = asRecord(payload.meeting)

  if (!meeting) {
    errors.meeting = 'Meeting object is required.'
  }

  const transcript = normalizeString(meeting?.transcript, 'meeting.transcript', errors, {
    required: true,
    maxLength: 120000,
  })

  const meetingTitle = normalizeString(meeting?.title, 'meeting.title', errors, {
    maxLength: 240,
  }) || 'Meeting Summary'

  if (Object.keys(errors).length > 0) {
    return errorResponse(400, 'validation_failed', 'Payload validation failed.', errors)
  }

  const safeTranscript = transcript as string

  try {
    const llmSummary = await generateWithOpenAI({
      transcript: safeTranscript,
      meetingTitle,
    })

    return jsonResponse({
      ok: true,
      source: 'openai',
      summary: llmSummary,
      message: 'Summary generated successfully.',
    })
  } catch (error) {
    const fallback = fallbackSummary(meetingTitle, safeTranscript)

    return jsonResponse({
      ok: true,
      source: 'fallback',
      summary: fallback,
      message:
        error instanceof Error
          ? `LLM unavailable, returned fallback summary: ${error.message}`
          : 'LLM unavailable, returned fallback summary.',
    })
  }
})
