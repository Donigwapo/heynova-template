// Supabase Edge Function: gmail-classify-preview
// Component 2 - Email Classification Engine
// Fetches preview emails via gmail-preview-sync and classifies actionable intelligence.
// No DB writes in this component.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

const PREVIEW_FUNCTION_NAME = 'gmail-preview-sync'
const LLM_TIMEOUT_MS = 15000
const BATCH_SIZE = 10

type JsonMap = Record<string, unknown>

type PreviewEmail = {
  id: string
  fromEmail: string | null
  fromName: string | null
  subject: string | null
  snippet: string | null
  internalDate: string | null
  labelIds: string[]
  isUnread: boolean
}

type ClassifiedEmail = {
  id: string
  tags: string[]
  priority: 'high' | 'medium' | 'low'
  should_store: boolean
  confidence: number
  reason: string
  fromEmail: string | null
  fromName: string | null
  subject: string | null
  snippet: string | null
  internalDate: string | null
  labelIds: string[]
  isUnread: boolean
}

const ALLOWED_TAGS = [
  'Needs Reply',
  'Follow-Up Required',
  'High Priority',
  'Low Priority',
  'Opportunity',
  'At Risk',
  'Meeting Related',
  'Newsletter',
  'Cold Outreach',
] as const

const ALLOWED_TAG_SET = new Set<string>(ALLOWED_TAGS)

const NEWSLETTER_KEYWORDS = [
  'unsubscribe',
  'sale',
  'discount',
  'promo',
  'promotion',
  'deal',
  'offer',
  'newsletter',
  'weekly digest',
  'black friday',
  'cyber monday',
  'limited time',
  'coupon',
]

function jsonResponse(body: JsonMap, status = 200) {
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
  code:
    | 'validation_failed'
    | 'unauthorized'
    | 'provider_error'
    | 'provider_unreachable'
    | 'internal_error',
  message: string,
  details?: JsonMap
) {
  return jsonResponse(
    {
      ok: false,
      status: 'failed',
      source: 'gmail',
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status
  )
}

function getBearerToken(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

function chunkArray<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return ['Low Priority']

  const filtered = tags
    .filter((tag): tag is string => typeof tag === 'string' && ALLOWED_TAG_SET.has(tag))
    .slice(0, 3)

  if (filtered.length === 0) return ['Low Priority']
  return Array.from(new Set(filtered)).slice(0, 3)
}

function normalizePriority(value: unknown): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'low'
}

function normalizeConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.5
  if (n < 0) return 0
  if (n > 1) return 1
  return Number(n.toFixed(3))
}

function computeShouldStore(tags: string[]): boolean {
  if (tags.includes('Needs Reply')) return true
  if (tags.includes('Opportunity')) return true
  if (tags.includes('At Risk')) return true
  if (tags.includes('High Priority')) return true

  if (tags.includes('Newsletter')) return false
  if (tags.includes('Cold Outreach')) return false
  if (tags.includes('Low Priority')) return false

  return false
}

function validateOutput(email: PreviewEmail, result: unknown): ClassifiedEmail {
  const record = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}

  const tags = sanitizeTags(record.tags)
  const priority = normalizePriority(record.priority)
  const confidence = normalizeConfidence(record.confidence)
  const reason =
    typeof record.reason === 'string' && record.reason.trim()
      ? record.reason.trim().slice(0, 320)
      : 'Low-signal message; defaulted to low-priority classification.'

  return {
    id: email.id,
    tags,
    priority,
    should_store: computeShouldStore(tags),
    confidence,
    reason,
    fromEmail: email.fromEmail,
    fromName: email.fromName,
    subject: email.subject,
    snippet: email.snippet,
    internalDate: email.internalDate || null,
    labelIds: email.labelIds,
    isUnread: email.isUnread,
  }
}

function defaultLowPriority(email: PreviewEmail, reason: string): ClassifiedEmail {
  return {
    id: email.id,
    tags: ['Low Priority'],
    priority: 'low',
    should_store: false,
    confidence: 0.55,
    reason,
    fromEmail: email.fromEmail,
    fromName: email.fromName,
    subject: email.subject,
    snippet: email.snippet,
    internalDate: email.internalDate || null,
    labelIds: email.labelIds,
    isUnread: email.isUnread,
  }
}

function classifyByRule(email: PreviewEmail): ClassifiedEmail | null {
  const text = `${email.subject || ''} ${email.snippet || ''}`.toLowerCase()

  const isNewsletterLike = NEWSLETTER_KEYWORDS.some((keyword) => text.includes(keyword))

  if (isNewsletterLike) {
    return {
      id: email.id,
      tags: ['Newsletter', 'Low Priority'],
      priority: 'low',
      should_store: false,
      confidence: 0.95,
      reason: 'Detected marketing/newsletter signals (e.g., unsubscribe/promo language).',
      fromEmail: email.fromEmail,
      fromName: email.fromName,
      subject: email.subject,
      snippet: email.snippet,
      internalDate: email.internalDate || null,
      labelIds: email.labelIds,
      isUnread: email.isUnread,
    }
  }

  return null
}

function classifyEmail(email: PreviewEmail): ClassifiedEmail | null {
  return classifyByRule(email)
}

async function callPreviewSync(accessToken: string) {
  const url = `${SUPABASE_URL}/functions/v1/${PREVIEW_FUNCTION_NAME}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
      unreachable: true,
    }
  }

  let payload: JsonMap | null = null
  try {
    payload = (await response.json()) as JsonMap
  } catch {
    payload = null
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    error: null,
    unreachable: false,
  }
}

function extractPreviewEmails(payload: JsonMap | null): PreviewEmail[] {
  const rows = Array.isArray(payload?.emails) ? payload?.emails : []

  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      if (typeof r.id !== 'string' || !r.id) return null

      const labelIds = Array.isArray(r.labelIds)
        ? r.labelIds.filter((label): label is string => typeof label === 'string')
        : []

      return {
        id: r.id,
        fromEmail: typeof r.fromEmail === 'string' ? r.fromEmail : null,
        fromName: typeof r.fromName === 'string' ? r.fromName : null,
        subject: typeof r.subject === 'string' ? r.subject : null,
        snippet: typeof r.snippet === 'string' ? r.snippet : null,
        internalDate: typeof r.internalDate === 'string' ? r.internalDate : null,
        labelIds,
        isUnread: Boolean(r.isUnread),
      } as PreviewEmail & { internalDate?: string | null }
    })
    .filter((row): row is PreviewEmail => Boolean(row))
}

async function classifyEmailsBatchWithLLM(batch: PreviewEmail[]): Promise<Record<string, ClassifiedEmail>> {
  if (!OPENAI_API_KEY) {
    const fallback: Record<string, ClassifiedEmail> = {}
    for (const email of batch) {
      fallback[email.id] = defaultLowPriority(email, 'LLM not configured; default classification applied.')
    }
    return fallback
  }

  const signalPayload = batch.map((email) => ({
    id: email.id,
    fromEmail: email.fromEmail,
    fromName: email.fromName,
    subject: email.subject,
    snippet: email.snippet,
    labelIds: email.labelIds,
    isUnread: email.isUnread,
  }))

  const systemPrompt = `You are an email intelligence classifier for a CFO consulting platform.
Return STRICT JSON only. No markdown. No explanations.

Allowed tags ONLY:
- Needs Reply
- Follow-Up Required
- High Priority
- Low Priority
- Opportunity
- At Risk
- Meeting Related
- Newsletter
- Cold Outreach

Rules:
- Maximum 3 tags per email.
- At least 1 tag per email.
- priority must be one of: high, medium, low.
- confidence must be a number between 0 and 1.
- reason must be short and specific.
- Use sender context, subject, snippet, and unread status.`

  const userPrompt = `Classify these emails and return this exact JSON object:
{
  "results": [
    {
      "id": "string",
      "tags": ["string"],
      "priority": "high|medium|low",
      "confidence": 0.0,
      "reason": "string"
    }
  ]
}

Emails:
${JSON.stringify(signalPayload)}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    })
  } catch {
    clearTimeout(timeout)
    const fallback: Record<string, ClassifiedEmail> = {}
    for (const email of batch) {
      fallback[email.id] = defaultLowPriority(email, 'LLM request failed; fallback classification applied.')
    }
    return fallback
  }

  clearTimeout(timeout)

  let completion: Record<string, unknown> | null = null
  try {
    completion = (await response.json()) as Record<string, unknown>
  } catch {
    completion = null
  }

  if (!response.ok) {
    const fallback: Record<string, ClassifiedEmail> = {}
    for (const email of batch) {
      fallback[email.id] = defaultLowPriority(
        email,
        `LLM provider error (${response.status}); fallback classification applied.`
      )
    }
    return fallback
  }

  const content =
    (((completion?.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<
      string,
      unknown
    > | undefined)?.content as string | undefined) || ''

  let parsed: Record<string, unknown> | null = null
  try {
    parsed = content ? (JSON.parse(content) as Record<string, unknown>) : null
  } catch {
    parsed = null
  }

  const resultsRaw = Array.isArray(parsed?.results) ? parsed?.results : []
  const byId: Record<string, ClassifiedEmail> = {}

  for (const email of batch) {
    const matched = resultsRaw.find(
      (row) => row && typeof row === 'object' && (row as Record<string, unknown>).id === email.id
    )

    if (!matched) {
      byId[email.id] = defaultLowPriority(
        email,
        'LLM output missing this email; fallback classification applied.'
      )
      continue
    }

    byId[email.id] = validateOutput(email, matched)
  }

  return byId
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return errorResponse(405, 'validation_failed', 'Only POST is supported.')

  if (!SUPABASE_URL) {
    return errorResponse(500, 'internal_error', 'SUPABASE_URL is not configured.')
  }

  const token = getBearerToken(req)
  if (!token) {
    return errorResponse(401, 'unauthorized', 'Missing authorization token.')
  }

  const preview = await callPreviewSync(token)

  if (!preview.ok) {
    if (preview.unreachable) {
      return errorResponse(502, 'provider_unreachable', 'Unable to reach gmail-preview-sync.')
    }

    const code =
      typeof (preview.payload?.error as Record<string, unknown> | undefined)?.code === 'string'
        ? ((preview.payload?.error as Record<string, unknown>).code as string)
        : 'provider_error'

    const message =
      typeof (preview.payload?.error as Record<string, unknown> | undefined)?.message === 'string'
        ? ((preview.payload?.error as Record<string, unknown>).message as string)
        : 'gmail-preview-sync failed.'

    if (preview.status === 401) return errorResponse(401, 'unauthorized', message)
    return errorResponse(502, code as 'provider_error', message)
  }

  const previewEmails = extractPreviewEmails(preview.payload)
  const requestedCount =
    typeof preview.payload?.requestedCount === 'number'
      ? preview.payload.requestedCount
      : previewEmails.length

  const resultsById: Record<string, ClassifiedEmail> = {}
  const needsAI: PreviewEmail[] = []

  for (const email of previewEmails) {
    const pre = classifyEmail(email)
    if (pre) {
      resultsById[email.id] = pre
    } else {
      needsAI.push(email)
    }
  }

  if (needsAI.length > 0) {
    const chunks = chunkArray(needsAI, BATCH_SIZE)
    for (const chunk of chunks) {
      const chunkResults = await classifyEmailsBatchWithLLM(chunk)
      for (const email of chunk) {
        resultsById[email.id] =
          chunkResults[email.id] ||
          defaultLowPriority(email, 'Batch classification fallback applied.')
      }
    }
  }

  const emails: ClassifiedEmail[] = previewEmails.map((email) => {
    const row = resultsById[email.id]
    if (!row) return defaultLowPriority(email, 'No classification output found; fallback applied.')

    // Ensure deterministic final contract and business rules server-side.
    return validateOutput(email, row)
  })

  if (emails.length > 0) {
    console.log('[gmail-classify-preview] sample classified email', {
      sample: emails[0],
    })
  }

  return jsonResponse({
    ok: true,
    status: 'success',
    source: 'gmail',
    emails,
    count: emails.length,
    requestedCount,
  })
})
