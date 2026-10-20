export type JsonRecord = Record<string, unknown>

export type WorkflowStepDef = {
  id: string
  workflow_id: string
  user_id: string
  step_order: number
  step_type: string
  delay_days: number
  subject: string | null
  body: string | null
  metadata: JsonRecord | null
  workflow_version_id?: string | null
  source_workflow_step_id?: string | null
}

export type RunRow = {
  id: string
  user_id: string
  workflow_id: string
  workflow_version_id: string | null
  campaign_id: string | null
  campaign_lead_id: string | null
  status: string
}

export type RunStepRow = {
  id: string
  user_id: string
  workflow_run_id: string
  workflow_id: string
  workflow_step_id: string | null
  workflow_version_id: string | null
  workflow_version_step_id: string | null
  status: string
  scheduled_at: string | null
  completed_at: string | null
  input_snapshot: JsonRecord | null
  metadata: JsonRecord | null
  created_at: string | null
}

export type JobRow = {
  id: string
  user_id: string
  workflow_run_id: string
  workflow_run_step_id: string | null
  status: string
  idempotency_key: string | null
}

export type RestResult<T = unknown> = {
  ok: boolean
  status: number
  data: T | null
}

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function querySep(path: string) {
  return path.includes('?') ? '&' : '?'
}

export function pathWithSelect(path: string, select: string) {
  return `${path}${querySep(path)}select=${encodeURIComponent(select)}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function addDaysIso(baseIso: string, days: number) {
  const base = new Date(baseIso)
  const next = new Date(base.getTime())
  next.setUTCDate(next.getUTCDate() + Number(days || 0))
  return next.toISOString()
}

export function getBearerToken(req: Request) {
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

export function decodeJwtPayload(token: string | null) {
  if (!token) return null

  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const base64Url = parts[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return asRecord(JSON.parse(atob(padded)))
  } catch {
    return null
  }
}

export function extractJwtRole(token: string | null) {
  const payload = decodeJwtPayload(token)
  const role = payload?.role
  return typeof role === 'string' ? role : null
}

export async function resolveUserIdFromJwt(req: Request, supabaseUrl: string, serviceRoleKey: string) {
  const token = getBearerToken(req)
  if (!token || !supabaseUrl || !serviceRoleKey) return null

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceRoleKey,
      },
    })

    if (!response.ok) return null
    const user = await response.json()
    return user?.id || null
  } catch {
    return null
  }
}

export async function restGet(supabaseUrl: string, serviceRoleKey: string, path: string): Promise<RestResult> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  return { ok: response.ok, status: response.status, data }
}

export async function restInsert(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  body: unknown,
  prefer = 'return=representation'
): Promise<RestResult> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  return { ok: response.ok, status: response.status, data }
}

export async function restPatch(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  body: unknown,
  prefer = 'return=representation'
): Promise<RestResult> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  return { ok: response.ok, status: response.status, data }
}

export function createStepSnapshot(def: WorkflowStepDef) {
  const sourceWorkflowStepId = def.source_workflow_step_id || def.id
  return {
    source: def.workflow_version_id ? 'workflow_version_steps' : 'workflow_steps',
    workflow_version_id: def.workflow_version_id || null,
    workflow_version_step_id: def.id,
    original_workflow_step_id: sourceWorkflowStepId,
    workflow_id: def.workflow_id,
    step_order: Number(def.step_order || 0),
    step_type: String(def.step_type || 'email'),
    delay_days: Number(def.delay_days || 0),
    subject: def.subject || null,
    body: def.body || null,
    metadata: def.metadata || {},
  }
}

export function mapStepToRunStepStatus(stepType: string, delayDays: number) {
  if (String(stepType || '').toLowerCase() === 'wait') return 'scheduled'
  if (Number(delayDays || 0) > 0) return 'scheduled'
  return 'pending'
}

export function mapStepToQueueName(stepType: string) {
  const normalized = String(stepType || '').toLowerCase()
  if (normalized === 'email') return 'email'
  if (normalized === 'ai_action') return 'ai'
  if (normalized === 'linkedin') return 'integration'
  if (normalized === 'condition') return 'workflow'
  if (normalized === 'stop') return 'workflow'
  return 'integration'
}

export function mapStepToJobType(stepType: string) {
  const normalized = String(stepType || '').toLowerCase()
  if (normalized === 'email') return 'send_email'
  if (normalized === 'ai_action') return 'ai_generate'
  if (normalized === 'linkedin') return 'integration_call'
  if (normalized === 'condition') return 'evaluate_condition'
  if (normalized === 'stop') return 'stop_workflow'
  return 'integration_call'
}
