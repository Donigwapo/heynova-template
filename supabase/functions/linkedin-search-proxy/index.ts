const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const N8N_LINKEDIN_SEARCH_WEBHOOK_URL =
  'https://n8n.automatenow.live/webhook/linkedin-search'

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

function generateId(prefix: string) {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Ignore and fallback below.
  }

  return `${prefix}_${Date.now()}`
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

async function resolveUserFromJwt(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null

  const token = getBearerToken(req)
  if (!token) return null

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    })

    if (!response.ok) return null

    const user = await response.json()
    return user?.id || null
  } catch {
    return null
  }
}

async function insertLeadExtractionJob(params: {
  jobId: string
  userId: string | null
  payload: Record<string, unknown>
}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, data: null }
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/lead_extraction_jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([
        {
          id: params.jobId,
          user_id: params.userId,
          filters: params.payload,
          status: 'queued',
          result_count: 0,
        },
      ]),
    })

    let data: unknown = null
    try {
      data = await response.json()
    } catch {
      data = null
    }

    return { ok: response.ok, status: response.status, data }
  } catch {
    return { ok: false, status: 500, data: null }
  }
}

async function markJobFailed(jobId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lead_extraction_jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'failed',
        error_message: 'Failed to reach n8n',
        updated_at: new Date().toISOString(),
      }),
    })
  } catch {
    // Non-blocking: best effort failure marker.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: CORS_HEADERS,
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, {
      success: false,
      message: 'Method not allowed.',
    })
  }

  try {
    const payload = await req.json()

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResponse(400, {
        success: false,
        message: 'Invalid request payload.',
      })
    }

    const userId = await resolveUserFromJwt(req)
    const jobId = generateId('job')

    const createJob = await insertLeadExtractionJob({
      jobId,
      userId,
      payload: payload as Record<string, unknown>,
    })

    if (!createJob.ok) {
      return jsonResponse(500, {
        success: false,
        message: 'Failed to create search job.',
      })
    }

    const enrichedPayload = {
      ...(payload as Record<string, unknown>),
      meta: {
        source: 'heynova-lead-extractor',
        requestedAt: new Date().toISOString(),
        requestId: generateId('req'),
        jobId,
        userId,
      },
    }

    try {
      const forwardResponse = await fetch(N8N_LINKEDIN_SEARCH_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(enrichedPayload),
      })

      let n8nResponseJson: unknown = null
      try {
        n8nResponseJson = await forwardResponse.json()
      } catch {
        n8nResponseJson = null
      }

      if (!forwardResponse.ok) {
        await markJobFailed(jobId)
        return jsonResponse(502, {
          success: false,
          message: 'Unable to queue search request right now.',
        })
      }

      return jsonResponse(200, {
        success: true,
        message: 'Search queued successfully.',
        jobId,
        status: 'queued',
        data: n8nResponseJson,
      })
    } catch {
      await markJobFailed(jobId)
      return jsonResponse(502, {
        success: false,
        message: 'Unable to queue search request right now.',
      })
    }
  } catch (error) {
    console.error('[linkedin-search-proxy] forwarding failed', error)

    return jsonResponse(500, {
      success: false,
      message: 'Unable to send search request right now.',
    })
  }
})
