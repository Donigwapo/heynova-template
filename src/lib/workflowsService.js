import { supabase } from './supabase'
import { logSupabaseQueryError } from './queryLogger'

const DEFAULT_WORKFLOW_STEPS = [
  {
    step_order: 1,
    step_type: 'email',
    delay_days: 0,
    subject: 'Initial Outreach',
    body: '',
    metadata: {},
  },
  {
    step_order: 2,
    step_type: 'email',
    delay_days: 3,
    subject: 'Follow-up',
    body: '',
    metadata: {},
  },
  {
    step_order: 3,
    step_type: 'email',
    delay_days: 7,
    subject: 'Final Follow-up',
    body: '',
    metadata: {},
  },
]

function toUiWorkflow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id || null,
    name: row.name || 'Untitled Workflow',
    status: row.status || 'draft',
    triggerType: row.trigger_type || 'manual',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

function toUiWorkflowStep(row) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    stepOrder: Number(row.step_order || 0),
    stepType: row.step_type || 'email',
    delayDays: Number(row.delay_days || 0),
    subject: row.subject || '',
    body: row.body || '',
    metadata: row.metadata || {},
  }
}

function toDbStep(step, index, workflowId, userId) {
  return {
    workflow_id: workflowId,
    user_id: userId,
    step_order: Number(step.stepOrder ?? step.step_order ?? index + 1),
    step_type: step.stepType || step.step_type || 'email',
    delay_days: Number(step.delayDays ?? step.delay_days ?? 0),
    subject: step.subject || null,
    body: step.body || null,
    metadata: step.metadata || {},
  }
}

export function getDefaultWorkflowSteps() {
  return DEFAULT_WORKFLOW_STEPS.map((step) => ({
    stepOrder: step.step_order,
    stepType: step.step_type,
    delayDays: step.delay_days,
    subject: step.subject,
    body: step.body,
    metadata: step.metadata,
  }))
}

export async function fetchWorkflowByCampaignId({ campaignId, userId }) {
  if (!campaignId || !userId) return { workflow: null, error: null }

  const { data, error } = await supabase
    .from('workflows')
    .select('id,user_id,campaign_id,name,status,trigger_type,created_at,updated_at')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'workflows',
      operation: 'select maybeSingle by campaign',
      userId,
      error,
      extra: { campaignId },
    })
    return { workflow: null, error }
  }

  return {
    workflow: data ? toUiWorkflow(data) : null,
    error: null,
  }
}

export async function fetchWorkflowMapByCampaignIds({ userId, campaignIds }) {
  if (!userId || !Array.isArray(campaignIds) || campaignIds.length === 0) {
    return { map: {}, error: null }
  }

  const { data, error } = await supabase
    .from('workflows')
    .select('id,campaign_id,name,status,created_at')
    .eq('user_id', userId)
    .in('campaign_id', campaignIds)
    .order('created_at', { ascending: false })

  if (error) {
    logSupabaseQueryError({
      table: 'workflows',
      operation: 'select many by campaign ids',
      userId,
      error,
      extra: { campaignIdsCount: campaignIds.length },
    })
    return { map: {}, error }
  }

  const map = {}
  ;(data || []).forEach((row) => {
    if (!row.campaign_id) return
    if (map[row.campaign_id]) return
    map[row.campaign_id] = toUiWorkflow(row)
  })

  return { map, error: null }
}

export async function fetchWorkflowListForUser(userId) {
  if (!userId) return { rows: [], error: null }

  const { data: workflowRows, error: workflowError } = await supabase
    .from('workflows')
    .select('id,user_id,campaign_id,name,status,trigger_type,created_at,updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (workflowError) {
    logSupabaseQueryError({
      table: 'workflows',
      operation: 'select many',
      userId,
      error: workflowError,
    })
    return { rows: [], error: workflowError }
  }

  const workflows = (workflowRows || []).map(toUiWorkflow)
  if (workflows.length === 0) return { rows: [], error: null }

  const workflowIds = workflows.map((workflow) => workflow.id)
  const campaignIds = workflows.map((workflow) => workflow.campaignId).filter(Boolean)

  const [{ data: stepsRows, error: stepsError }, { data: campaignsRows, error: campaignsError }] =
    await Promise.all([
      supabase
        .from('workflow_steps')
        .select('workflow_id')
        .eq('user_id', userId)
        .in('workflow_id', workflowIds),
      campaignIds.length
        ? supabase
            .from('campaigns')
            .select('id,name')
            .eq('user_id', userId)
            .in('id', campaignIds)
        : Promise.resolve({ data: [], error: null }),
    ])

  if (stepsError) {
    logSupabaseQueryError({
      table: 'workflow_steps',
      operation: 'select many for counts',
      userId,
      error: stepsError,
      extra: { workflowIdsCount: workflowIds.length },
    })
    return { rows: [], error: stepsError }
  }

  if (campaignsError) {
    logSupabaseQueryError({
      table: 'campaigns',
      operation: 'select many for workflow list',
      userId,
      error: campaignsError,
      extra: { campaignIdsCount: campaignIds.length },
    })
    return { rows: [], error: campaignsError }
  }

  const stepCountByWorkflowId = {}
  ;(stepsRows || []).forEach((row) => {
    if (!row.workflow_id) return
    stepCountByWorkflowId[row.workflow_id] = (stepCountByWorkflowId[row.workflow_id] || 0) + 1
  })

  const campaignNameById = {}
  ;(campaignsRows || []).forEach((row) => {
    campaignNameById[row.id] = row.name || 'Untitled Campaign'
  })

  return {
    rows: workflows.map((workflow) => ({
      ...workflow,
      totalSteps: stepCountByWorkflowId[workflow.id] || 0,
      campaignName: workflow.campaignId ? campaignNameById[workflow.campaignId] || '—' : '—',
    })),
    error: null,
  }
}

export async function fetchWorkflowDetail({ workflowId, userId }) {
  if (!workflowId || !userId) {
    return { workflow: null, steps: [], campaignName: '—', error: new Error('Missing workflowId or userId') }
  }

  const { data: workflowRow, error: workflowError } = await supabase
    .from('workflows')
    .select('id,user_id,campaign_id,name,status,trigger_type,created_at,updated_at')
    .eq('id', workflowId)
    .eq('user_id', userId)
    .maybeSingle()

  if (workflowError) {
    logSupabaseQueryError({
      table: 'workflows',
      operation: 'select maybeSingle by id',
      userId,
      error: workflowError,
      extra: { workflowId },
    })
    return { workflow: null, steps: [], campaignName: '—', error: workflowError }
  }

  if (!workflowRow) {
    return { workflow: null, steps: [], campaignName: '—', error: null }
  }

  const workflow = toUiWorkflow(workflowRow)

  const [{ data: stepRows, error: stepsError }, { data: campaignRow, error: campaignError }] =
    await Promise.all([
      supabase
        .from('workflow_steps')
        .select('id,workflow_id,user_id,step_order,step_type,delay_days,subject,body,metadata')
        .eq('workflow_id', workflow.id)
        .eq('user_id', userId)
        .order('step_order', { ascending: true }),
      workflow.campaignId
        ? supabase
            .from('campaigns')
            .select('id,name')
            .eq('id', workflow.campaignId)
            .eq('user_id', userId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

  if (stepsError) {
    logSupabaseQueryError({
      table: 'workflow_steps',
      operation: 'select many by workflow',
      userId,
      error: stepsError,
      extra: { workflowId },
    })
    return { workflow: null, steps: [], campaignName: '—', error: stepsError }
  }

  if (campaignError) {
    logSupabaseQueryError({
      table: 'campaigns',
      operation: 'select maybeSingle for workflow detail',
      userId,
      error: campaignError,
      extra: { campaignId: workflow.campaignId },
    })
    return { workflow: null, steps: [], campaignName: '—', error: campaignError }
  }

  return {
    workflow,
    steps: (stepRows || []).map(toUiWorkflowStep),
    campaignName: campaignRow?.name || '—',
    error: null,
  }
}

export async function createWorkflow({ userId, campaignId = null, name, status = 'draft', triggerType = 'manual' }) {
  if (!userId || !name) {
    return { workflow: null, error: new Error('Missing userId or workflow name') }
  }

  const { data, error } = await supabase
    .from('workflows')
    .insert({
      user_id: userId,
      campaign_id: campaignId,
      name,
      status,
      trigger_type: triggerType,
    })
    .select('id,user_id,campaign_id,name,status,trigger_type,created_at,updated_at')
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'workflows',
      operation: 'insert maybeSingle',
      userId,
      error,
      extra: { campaignId, name, status, triggerType },
    })
    return { workflow: null, error }
  }

  return { workflow: data ? toUiWorkflow(data) : null, error: null }
}

export async function updateWorkflow({ workflowId, userId, patch }) {
  if (!workflowId || !userId || !patch || typeof patch !== 'object') {
    return { workflow: null, error: new Error('Missing workflowId, userId, or patch') }
  }

  const { data, error } = await supabase
    .from('workflows')
    .update({
      name: patch.name,
      status: patch.status,
      trigger_type: patch.triggerType,
      campaign_id: patch.campaignId,
    })
    .eq('id', workflowId)
    .eq('user_id', userId)
    .select('id,user_id,campaign_id,name,status,trigger_type,created_at,updated_at')
    .maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'workflows',
      operation: 'update maybeSingle',
      userId,
      error,
      extra: { workflowId },
    })
    return { workflow: null, error }
  }

  return { workflow: data ? toUiWorkflow(data) : null, error: null }
}

export async function replaceWorkflowSteps({ workflowId, userId, steps }) {
  if (!workflowId || !userId) {
    return { error: new Error('Missing workflowId or userId') }
  }

  const normalizedSteps = Array.isArray(steps) ? steps : []

  const { error: deleteError } = await supabase
    .from('workflow_steps')
    .delete()
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)

  if (deleteError) {
    logSupabaseQueryError({
      table: 'workflow_steps',
      operation: 'delete existing steps',
      userId,
      error: deleteError,
      extra: { workflowId },
    })
    return { error: deleteError }
  }

  if (normalizedSteps.length === 0) {
    return { error: null }
  }

  const insertRows = normalizedSteps.map((step, index) => toDbStep(step, index, workflowId, userId))

  const { error: insertError } = await supabase.from('workflow_steps').insert(insertRows)
  if (insertError) {
    logSupabaseQueryError({
      table: 'workflow_steps',
      operation: 'insert many',
      userId,
      error: insertError,
      extra: { workflowId, rows: insertRows.length },
    })
    return { error: insertError }
  }

  return { error: null }
}

export async function fetchCampaignOverview({ campaignId, userId }) {
  if (!campaignId || !userId) {
    return { campaignName: 'Not linked', leadCount: 0, error: null }
  }

  const [{ data: campaignRow, error: campaignError }, { count: leadCount, error: leadCountError }] =
    await Promise.all([
      supabase
        .from('campaigns')
        .select('id,name')
        .eq('id', campaignId)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('campaign_leads')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('user_id', userId),
    ])

  if (campaignError) {
    logSupabaseQueryError({
      table: 'campaigns',
      operation: 'select maybeSingle overview',
      userId,
      error: campaignError,
      extra: { campaignId },
    })
    return { campaignName: 'Not linked', leadCount: 0, error: campaignError }
  }

  if (leadCountError) {
    logSupabaseQueryError({
      table: 'campaign_leads',
      operation: 'count by campaign',
      userId,
      error: leadCountError,
      extra: { campaignId },
    })
    return { campaignName: campaignRow?.name || 'Not linked', leadCount: 0, error: leadCountError }
  }

  return {
    campaignName: campaignRow?.name || 'Not linked',
    leadCount: Number(leadCount || 0),
    error: null,
  }
}

export async function createWorkflowWithDefaultSteps({ userId, campaignId = null, name }) {
  const defaultName = name || 'New Workflow'
  const { workflow, error: createError } = await createWorkflow({
    userId,
    campaignId,
    name: defaultName,
    status: 'draft',
    triggerType: 'manual',
  })

  if (createError || !workflow) {
    return { workflow: null, error: createError || new Error('Unable to create workflow') }
  }

  const { error: stepsError } = await replaceWorkflowSteps({
    workflowId: workflow.id,
    userId,
    steps: getDefaultWorkflowSteps(),
  })

  if (stepsError) {
    return { workflow: null, error: stepsError }
  }

  return { workflow, error: null }
}
