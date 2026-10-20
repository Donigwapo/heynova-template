import {
  JsonRecord,
  RunRow,
  RunStepRow,
  WorkflowStepDef,
  asArray,
  asRecord,
  createStepSnapshot,
  mapStepToJobType,
  mapStepToQueueName,
  mapStepToRunStepStatus,
  nowIso,
  addDaysIso,
  pathWithSelect,
  restGet,
  restInsert,
  restPatch,
} from './workflowShadowAdvancementCore.ts'

export type AdvanceParams = {
  runId: string
  completedRunStepId?: string | null
  initiatedBy: 'manual' | 'scheduler' | 'shadow_activation' | 'worker'
}

export type AdvanceResult = {
  ok: boolean
  runId: string
  advanced: boolean
  runCompleted: boolean
  nextRunStepId: string | null
  nextJobId: string | null
  message: string
  details?: JsonRecord
}

type JobRow = {
  id: string
  user_id: string
  workflow_run_id: string
  workflow_run_step_id: string
  status: string
  idempotency_key: string | null
}

async function fetchRun(supabaseUrl: string, serviceRoleKey: string, runId: string) {
  const result = await restGet(
    supabaseUrl,
    serviceRoleKey,
    pathWithSelect(
      `workflow_runs?id=eq.${encodeURIComponent(runId)}&limit=1`,
      'id,user_id,workflow_id,workflow_version_id,campaign_id,campaign_lead_id,status,started_at,completed_at,updated_at'
    )
  )
  if (!result.ok) return { row: null as RunRow | null, error: new Error('Unable to load workflow_run') }
  const rows = asArray<RunRow>(result.data)
  return { row: rows[0] || null, error: null }
}

async function fetchWorkflowSteps(
  supabaseUrl: string,
  serviceRoleKey: string,
  workflowId: string,
  userId: string,
  workflowVersionId: string | null
) {
  if (workflowVersionId) {
    const versionResult = await restGet(
      supabaseUrl,
      serviceRoleKey,
      pathWithSelect(
        `workflow_version_steps?workflow_version_id=eq.${encodeURIComponent(
          workflowVersionId
        )}&workflow_id=eq.${encodeURIComponent(workflowId)}&user_id=eq.${encodeURIComponent(
          userId
        )}&order=step_order.asc&limit=500`,
        'id,workflow_version_id,workflow_id,user_id,source_workflow_step_id,step_order,step_type,delay_days,subject,body,metadata'
      )
    )

    if (!versionResult.ok) {
      return { rows: [] as WorkflowStepDef[], error: new Error('Unable to load workflow_version_steps') }
    }

    const versionRows = asArray<WorkflowStepDef>(versionResult.data)
    if (versionRows.length > 0) {
      return { rows: versionRows, error: null, source: 'workflow_version_steps' }
    }
  }

  const mutableResult = await restGet(
    supabaseUrl,
    serviceRoleKey,
    pathWithSelect(
      `workflow_steps?workflow_id=eq.${encodeURIComponent(workflowId)}&user_id=eq.${encodeURIComponent(
        userId
      )}&order=step_order.asc&limit=500`,
      'id,workflow_id,user_id,step_order,step_type,delay_days,subject,body,metadata'
    )
  )

  if (!mutableResult.ok) {
    return { rows: [] as WorkflowStepDef[], error: new Error('Unable to load workflow definition steps') }
  }

  return { rows: asArray<WorkflowStepDef>(mutableResult.data), error: null, source: 'workflow_steps' }
}

async function fetchRunStep(supabaseUrl: string, serviceRoleKey: string, runStepId: string) {
  const result = await restGet(
    supabaseUrl,
    serviceRoleKey,
    pathWithSelect(
      `workflow_run_steps?id=eq.${encodeURIComponent(runStepId)}&limit=1`,
      'id,user_id,workflow_run_id,workflow_id,workflow_step_id,workflow_version_id,workflow_version_step_id,status,scheduled_at,completed_at,input_snapshot,metadata,created_at'
    )
  )

  if (!result.ok) {
    return { row: null as RunStepRow | null, error: new Error('Unable to load workflow_run_step') }
  }

  return { row: asArray<RunStepRow>(result.data)[0] || null, error: null }
}

async function fetchLastCompletedRunStep(supabaseUrl: string, serviceRoleKey: string, runId: string) {
  const result = await restGet(
    supabaseUrl,
    serviceRoleKey,
    pathWithSelect(
      `workflow_run_steps?workflow_run_id=eq.${encodeURIComponent(
        runId
      )}&status=in.(completed,skipped)&order=created_at.desc&limit=1`,
      'id,user_id,workflow_run_id,workflow_id,workflow_step_id,workflow_version_id,workflow_version_step_id,status,scheduled_at,completed_at,input_snapshot,metadata,created_at'
    )
  )

  if (!result.ok) {
    return { row: null as RunStepRow | null, error: new Error('Unable to query last completed run step') }
  }

  return { row: asArray<RunStepRow>(result.data)[0] || null, error: null }
}

type CompletedStepResolution = {
  ok: boolean
  stepOrder: number | null
  strategy: string
  errorCode?: string
  errorMessage?: string
  details?: JsonRecord
}

function resolveCompletedStepOrder(
  completedRunStep: RunStepRow | null,
  workflowSteps: WorkflowStepDef[],
  definitionSource: string
): CompletedStepResolution {
  if (!completedRunStep) {
    return {
      ok: true,
      stepOrder: null,
      strategy: 'start_no_completed_step',
    }
  }

  // 1) Strongest provenance: workflow_version_step_id -> workflow_version_steps.id
  if (completedRunStep.workflow_version_step_id) {
    const foundByVersionStepId = workflowSteps.find(
      (step) => step.id === completedRunStep.workflow_version_step_id
    )
    if (foundByVersionStepId) {
      return {
        ok: true,
        stepOrder: Number(foundByVersionStepId.step_order),
        strategy: 'workflow_version_step_id',
      }
    }
  }

  // 2) Legacy/source provenance: workflow_step_id -> workflow_version_steps.source_workflow_step_id
  if (completedRunStep.workflow_step_id) {
    if (definitionSource === 'workflow_version_steps') {
      const foundBySourceStepId = workflowSteps.find(
        (step) => step.source_workflow_step_id === completedRunStep.workflow_step_id
      )
      if (foundBySourceStepId) {
        return {
          ok: true,
          stepOrder: Number(foundBySourceStepId.step_order),
          strategy: 'workflow_step_id_to_source_workflow_step_id',
        }
      }
    }

    const foundByStepId = workflowSteps.find((step) => step.id === completedRunStep.workflow_step_id)
    if (foundByStepId) {
      return {
        ok: true,
        stepOrder: Number(foundByStepId.step_order),
        strategy: 'workflow_step_id_direct',
      }
    }
  }

  const snapshot = asRecord(completedRunStep.input_snapshot)
  const metadata = asRecord(completedRunStep.metadata)

  // 3) Snapshot provenance fallback
  const snapshotVersionStepId =
    typeof snapshot?.workflow_version_step_id === 'string' ? snapshot.workflow_version_step_id : null
  if (snapshotVersionStepId) {
    const foundBySnapshotVersionStepId = workflowSteps.find((step) => step.id === snapshotVersionStepId)
    if (foundBySnapshotVersionStepId) {
      return {
        ok: true,
        stepOrder: Number(foundBySnapshotVersionStepId.step_order),
        strategy: 'snapshot.workflow_version_step_id',
      }
    }
  }

  const snapshotSourceStepId =
    typeof snapshot?.original_workflow_step_id === 'string' ? snapshot.original_workflow_step_id : null
  if (snapshotSourceStepId) {
    if (definitionSource === 'workflow_version_steps') {
      const foundBySnapshotSourceStepId = workflowSteps.find(
        (step) => step.source_workflow_step_id === snapshotSourceStepId
      )
      if (foundBySnapshotSourceStepId) {
        return {
          ok: true,
          stepOrder: Number(foundBySnapshotSourceStepId.step_order),
          strategy: 'snapshot.original_workflow_step_id_to_source_workflow_step_id',
        }
      }
    }

    const foundBySnapshotSourceDirect = workflowSteps.find((step) => step.id === snapshotSourceStepId)
    if (foundBySnapshotSourceDirect) {
      return {
        ok: true,
        stepOrder: Number(foundBySnapshotSourceDirect.step_order),
        strategy: 'snapshot.original_workflow_step_id_direct',
      }
    }
  }

  const snapshotOrder = snapshot?.step_order
  if (typeof snapshotOrder === 'number') {
    const foundBySnapshotOrder = workflowSteps.find(
      (step) => Number(step.step_order) === Number(snapshotOrder)
    )
    if (foundBySnapshotOrder) {
      return {
        ok: true,
        stepOrder: Number(foundBySnapshotOrder.step_order),
        strategy: 'snapshot.step_order',
      }
    }
  }

  const metadataSourceStepId =
    typeof metadata?.original_workflow_step_id === 'string' ? metadata.original_workflow_step_id : null
  if (metadataSourceStepId) {
    const foundByMetadataSource = workflowSteps.find(
      (step) => step.source_workflow_step_id === metadataSourceStepId || step.id === metadataSourceStepId
    )
    if (foundByMetadataSource) {
      return {
        ok: true,
        stepOrder: Number(foundByMetadataSource.step_order),
        strategy: 'metadata.original_workflow_step_id',
      }
    }
  }

  return {
    ok: false,
    stepOrder: null,
    strategy: 'unresolved',
    errorCode: 'ADVANCEMENT_STEP_PROVENANCE_UNRESOLVED',
    errorMessage:
      'Unable to resolve completed step provenance against the selected workflow definition source.',
    details: {
      definition_source: definitionSource,
      completed_run_step_id: completedRunStep.id,
      workflow_step_id: completedRunStep.workflow_step_id,
      workflow_version_step_id: completedRunStep.workflow_version_step_id,
      snapshot_workflow_version_step_id: snapshotVersionStepId,
      snapshot_original_workflow_step_id: snapshotSourceStepId,
      snapshot_step_order: typeof snapshotOrder === 'number' ? snapshotOrder : null,
      metadata_original_workflow_step_id: metadataSourceStepId,
    },
  }
}

function determineNextStep(workflowSteps: WorkflowStepDef[], completedStepOrder: number | null) {
  if (!Array.isArray(workflowSteps) || workflowSteps.length === 0) return null
  if (completedStepOrder == null) return workflowSteps[0]
  return workflowSteps.find((step) => Number(step.step_order) > Number(completedStepOrder)) || null
}

function stepIdentityForGeneration(step: WorkflowStepDef) {
  return step.workflow_version_id ? `vstep:${step.id}` : `step:${step.id}`
}

function sourceWorkflowStepId(step: WorkflowStepDef) {
  return step.source_workflow_step_id || step.id
}

function buildRunStepGenerationKey(step: WorkflowStepDef, completedRunStepId: string | null) {
  return `linear:${stepIdentityForGeneration(step)}:after:${completedRunStepId || 'start'}`
}

function buildJobIdempotencyKey(params: {
  userId: string
  runId: string
  runStepId: string
  workflowId: string
  workflowStepId: string
  campaignLeadId: string | null
  stepType: string
}) {
  return [
    'shadow-job-v1',
    params.userId,
    params.workflowId,
    params.workflowStepId,
    params.runId,
    params.runStepId,
    params.campaignLeadId || 'none',
    String(params.stepType || 'unknown').toLowerCase(),
  ].join(':')
}

async function findExistingGeneratedRunStep(
  supabaseUrl: string,
  serviceRoleKey: string,
  runId: string,
  generationKey: string
) {
  const result = await restGet(
    supabaseUrl,
    serviceRoleKey,
    pathWithSelect(
      `workflow_run_steps?workflow_run_id=eq.${encodeURIComponent(
        runId
      )}&metadata->>generation_key=eq.${encodeURIComponent(generationKey)}&limit=1`,
      'id,user_id,workflow_run_id,workflow_id,workflow_step_id,workflow_version_id,workflow_version_step_id,status,scheduled_at,completed_at,input_snapshot,metadata,created_at'
    )
  )

  if (!result.ok) {
    return { row: null as RunStepRow | null, error: new Error('Unable to query generated run step') }
  }

  return { row: asArray<RunStepRow>(result.data)[0] || null, error: null }
}

async function createNextRunStep(params: {
  supabaseUrl: string
  serviceRoleKey: string
  run: RunRow
  nextStep: WorkflowStepDef
  completedRunStepId: string | null
  scheduledAt: string | null
}) {
  const snapshot = createStepSnapshot(params.nextStep)
  const generationKey = buildRunStepGenerationKey(params.nextStep, params.completedRunStepId)
  const status = mapStepToRunStepStatus(params.nextStep.step_type, params.nextStep.delay_days)

  const existing = await findExistingGeneratedRunStep(
    params.supabaseUrl,
    params.serviceRoleKey,
    params.run.id,
    generationKey
  )

  if (existing.row?.id) {
    return {
      row: existing.row,
      created: false,
      error: null,
      generationKey,
      status: existing.row.status,
    }
  }

  const inserted = await restInsert(
    params.supabaseUrl,
    params.serviceRoleKey,
    pathWithSelect('workflow_run_steps', 'id,user_id,workflow_run_id,workflow_id,workflow_step_id,status,scheduled_at'),
    {
      user_id: params.run.user_id,
      workflow_run_id: params.run.id,
      workflow_id: params.run.workflow_id,
      workflow_step_id: sourceWorkflowStepId(params.nextStep),
      workflow_version_id: params.nextStep.workflow_version_id || null,
      workflow_version_step_id: params.nextStep.workflow_version_id ? params.nextStep.id : null,
      path_key: 'main',
      status,
      scheduled_at: params.scheduledAt,
      attempt_count: 0,
      max_attempts: 5,
      input_snapshot: snapshot,
      metadata: {
        shadow_mode: true,
        shadow_source: 'workflow_shadow_advancement_engine',
        generation_key: generationKey,
        created_after_run_step_id: params.completedRunStepId,
        delay_semantics: 'delay_before_this_step',
      },
      updated_at: nowIso(),
    }
  )

  if (!inserted.ok) {
    const rec = asRecord(inserted.data)
    const msg =
      String(rec?.message || rec?.error || 'Unable to create next workflow_run_step')
    return {
      row: null as RunStepRow | null,
      created: false,
      error: new Error(msg),
      generationKey,
      status,
    }
  }

  const row = asArray<RunStepRow>(inserted.data)[0] || null
  return {
    row,
    created: true,
    error: null,
    generationKey,
    status,
  }
}

async function ensureShadowJobForRunStep(params: {
  supabaseUrl: string
  serviceRoleKey: string
  run: RunRow
  runStep: RunStepRow
  stepDef: WorkflowStepDef
  scheduledAt: string | null
}) {
  const stepType = String(params.stepDef.step_type || '').toLowerCase()
  if (stepType === 'wait') {
    return { row: null as JobRow | null, created: false, error: null }
  }

  const idempotencyKey = buildJobIdempotencyKey({
    userId: params.run.user_id,
    runId: params.run.id,
    runStepId: params.runStep.id,
    workflowId: params.run.workflow_id,
    workflowStepId: sourceWorkflowStepId(params.stepDef),
    campaignLeadId: params.run.campaign_lead_id,
    stepType,
  })

  const existing = await restGet(
    params.supabaseUrl,
    params.serviceRoleKey,
    pathWithSelect(
      `workflow_jobs?user_id=eq.${encodeURIComponent(
        params.run.user_id
      )}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`,
      'id,user_id,workflow_run_id,workflow_run_step_id,status,idempotency_key'
    )
  )

  if (!existing.ok) {
    return { row: null as JobRow | null, created: false, error: new Error('Unable to query shadow workflow_job') }
  }

  const existingRow = asArray<JobRow>(existing.data)[0] || null
  if (existingRow?.id) {
    return { row: existingRow, created: false, error: null }
  }

  const inserted = await restInsert(
    params.supabaseUrl,
    params.serviceRoleKey,
    pathWithSelect('workflow_jobs', 'id,user_id,workflow_run_id,workflow_run_step_id,status,idempotency_key'),
    {
      user_id: params.run.user_id,
      workflow_run_id: params.run.id,
      workflow_run_step_id: params.runStep.id,
      workflow_id: params.run.workflow_id,
      workflow_version_id: params.stepDef.workflow_version_id || params.run.workflow_version_id || null,
      workflow_version_step_id: params.stepDef.workflow_version_id ? params.stepDef.id : null,
      campaign_id: params.run.campaign_id,
      campaign_lead_id: params.run.campaign_lead_id,
      job_type: mapStepToJobType(stepType),
      queue_name: mapStepToQueueName(stepType),
      priority: 100,
      status: params.scheduledAt ? 'scheduled' : 'queued',
      scheduled_at: params.scheduledAt,
      available_at: params.scheduledAt || nowIso(),
      attempt_count: 0,
      max_attempts: 5,
      idempotency_key: idempotencyKey,
      payload: {
        shadow_mode: true,
        shadow_source: 'workflow_shadow_advancement_engine',
        execute_disabled: true,
        workflow_version_id: params.stepDef.workflow_version_id || params.run.workflow_version_id || null,
        workflow_version_step_id: params.stepDef.workflow_version_id ? params.stepDef.id : null,
        step_snapshot: createStepSnapshot(params.stepDef),
      },
      result: null,
      updated_at: nowIso(),
    }
  )

  if (!inserted.ok) {
    const rec = asRecord(inserted.data)
    const msg = String(rec?.message || rec?.error || 'Unable to create shadow workflow_job')
    return { row: null as JobRow | null, created: false, error: new Error(msg) }
  }

  const row = asArray<JobRow>(inserted.data)[0] || null
  return { row, created: true, error: null }
}

async function appendEvent(params: {
  supabaseUrl: string
  serviceRoleKey: string
  userId: string
  workflowId: string
  campaignId: string | null
  campaignLeadId: string | null
  runId: string
  runStepId: string | null
  jobId: string | null
  eventType: string
  idempotencyKey: string
  payload: JsonRecord
}) {
  const inserted = await restInsert(
    params.supabaseUrl,
    params.serviceRoleKey,
    pathWithSelect('workflow_events', 'id'),
    {
      user_id: params.userId,
      workflow_run_id: params.runId,
      workflow_run_step_id: params.runStepId,
      workflow_job_id: params.jobId,
      workflow_id: params.workflowId,
      campaign_id: params.campaignId,
      campaign_lead_id: params.campaignLeadId,
      event_type: params.eventType,
      event_source: 'workflow_shadow_advancement_engine',
      severity: 'info',
      idempotency_key: params.idempotencyKey,
      payload: params.payload,
      occurred_at: nowIso(),
    }
  )

  if (!inserted.ok) {
    const rec = asRecord(inserted.data)
    const message = String(rec?.message || rec?.error || '')
    if (message.toLowerCase().includes('duplicate key value')) {
      return { ok: true, duplicate: true }
    }
    return { ok: false, duplicate: false, error: new Error(message || 'Unable to append workflow_event') }
  }

  return { ok: true, duplicate: false }
}

async function markRunCompleted(supabaseUrl: string, serviceRoleKey: string, run: RunRow, reason: string) {
  const result = await restPatch(
    supabaseUrl,
    serviceRoleKey,
    `workflow_runs?id=eq.${encodeURIComponent(run.id)}`,
    {
      status: 'completed',
      completed_at: nowIso(),
      updated_at: nowIso(),
      current_step_ref: {
        status: 'completed',
        reason,
      },
    },
    'return=minimal'
  )

  return result.ok
}

export async function advanceWorkflowRunShadow(
  supabaseUrl: string,
  serviceRoleKey: string,
  params: AdvanceParams
): Promise<AdvanceResult> {
  const runResult = await fetchRun(supabaseUrl, serviceRoleKey, params.runId)
  if (runResult.error || !runResult.row?.id) {
    return {
      ok: false,
      runId: params.runId,
      advanced: false,
      runCompleted: false,
      nextRunStepId: null,
      nextJobId: null,
      message: runResult.error?.message || 'workflow_run not found',
    }
  }

  const run = runResult.row

  if (['completed', 'cancelled', 'failed'].includes(String(run.status || '').toLowerCase())) {
    return {
      ok: true,
      runId: run.id,
      advanced: false,
      runCompleted: String(run.status).toLowerCase() === 'completed',
      nextRunStepId: null,
      nextJobId: null,
      message: `Run already terminal (${run.status})`,
    }
  }

  const defResult = await fetchWorkflowSteps(
    supabaseUrl,
    serviceRoleKey,
    run.workflow_id,
    run.user_id,
    run.workflow_version_id || null
  )
  if (defResult.error) {
    return {
      ok: false,
      runId: run.id,
      advanced: false,
      runCompleted: false,
      nextRunStepId: null,
      nextJobId: null,
      message: defResult.error.message,
    }
  }

  const definitionSteps = defResult.rows
  if (definitionSteps.length === 0) {
    return {
      ok: false,
      runId: run.id,
      advanced: false,
      runCompleted: false,
      nextRunStepId: null,
      nextJobId: null,
      message: 'No workflow definition steps found',
    }
  }

  let completedRunStep: RunStepRow | null = null

  if (params.completedRunStepId) {
    const completedResult = await fetchRunStep(supabaseUrl, serviceRoleKey, params.completedRunStepId)
    if (completedResult.error || !completedResult.row?.id) {
      return {
        ok: false,
        runId: run.id,
        advanced: false,
        runCompleted: false,
        nextRunStepId: null,
        nextJobId: null,
        message: completedResult.error?.message || 'completedRunStepId not found',
      }
    }
    completedRunStep = completedResult.row
  } else {
    const lastResult = await fetchLastCompletedRunStep(supabaseUrl, serviceRoleKey, run.id)
    if (lastResult.error) {
      return {
        ok: false,
        runId: run.id,
        advanced: false,
        runCompleted: false,
        nextRunStepId: null,
        nextJobId: null,
        message: lastResult.error.message,
      }
    }
    completedRunStep = lastResult.row
  }

  const completedResolution = resolveCompletedStepOrder(
    completedRunStep,
    definitionSteps,
    defResult.source || 'unknown'
  )

  if (!completedResolution.ok) {
    const errorCode = completedResolution.errorCode || 'ADVANCEMENT_STEP_PROVENANCE_UNRESOLVED'
    const errorMessage =
      completedResolution.errorMessage ||
      'Unable to resolve completed step provenance against workflow definition source.'

    await appendEvent({
      supabaseUrl,
      serviceRoleKey,
      userId: run.user_id,
      workflowId: run.workflow_id,
      campaignId: run.campaign_id,
      campaignLeadId: run.campaign_lead_id,
      runId: run.id,
      runStepId: completedRunStep?.id || null,
      jobId: null,
      eventType: 'advancement_error',
      idempotencyKey: `shadow:advancement_error:${run.id}:${completedRunStep?.id || 'none'}:${errorCode}`,
      payload: {
        shadow_mode: true,
        initiated_by: params.initiatedBy,
        error_code: errorCode,
        error_message: errorMessage,
        definition_source: defResult.source || 'unknown',
        resolution_strategy: completedResolution.strategy,
        details: completedResolution.details || {},
      },
    })

    console.error('[WorkflowShadow][Advance] provenance unresolved', {
      runId: run.id,
      errorCode,
      resolutionStrategy: completedResolution.strategy,
      details: completedResolution.details || {},
    })

    return {
      ok: false,
      runId: run.id,
      advanced: false,
      runCompleted: false,
      nextRunStepId: null,
      nextJobId: null,
      message: errorMessage,
      details: {
        errorCode,
        resolutionStrategy: completedResolution.strategy,
        definitionSource: defResult.source || 'unknown',
        ...(completedResolution.details || {}),
      },
    }
  }

  const completedStepOrder = completedResolution.stepOrder
  const nextStep = determineNextStep(definitionSteps, completedStepOrder)

  if (!nextStep) {
    const marked = await markRunCompleted(supabaseUrl, serviceRoleKey, run, 'no_next_step')
    if (!marked) {
      return {
        ok: false,
        runId: run.id,
        advanced: false,
        runCompleted: false,
        nextRunStepId: null,
        nextJobId: null,
        message: 'Unable to mark workflow_run completed',
      }
    }

    await appendEvent({
      supabaseUrl,
      serviceRoleKey,
      userId: run.user_id,
      workflowId: run.workflow_id,
      campaignId: run.campaign_id,
      campaignLeadId: run.campaign_lead_id,
      runId: run.id,
      runStepId: null,
      jobId: null,
      eventType: 'run_completed',
      idempotencyKey: `shadow:run_completed:${run.id}:${completedRunStep?.id || 'none'}`,
      payload: {
        shadow_mode: true,
        initiated_by: params.initiatedBy,
        definition_source: defResult.source || 'unknown',
        workflow_version_id: run.workflow_version_id || null,
      },
    })

    console.log('[WorkflowShadow][Advance] run completed', { runId: run.id })

    return {
      ok: true,
      runId: run.id,
      advanced: true,
      runCompleted: true,
      nextRunStepId: null,
      nextJobId: null,
      message: 'Run completed in shadow advancement',
      details: {
        definitionSource: defResult.source || 'unknown',
      },
    }
  }

  // delay_days semantics discovered from current builder UX:
  // delay is configured on each step node as "Delay (days)" and displayed per-node,
  // so it is interpreted as wait BEFORE this step executes.
  const baseIso = completedRunStep?.completed_at || nowIso()
  const delayDays = Number(nextStep.delay_days || 0)
  const scheduledAt = delayDays > 0 ? addDaysIso(baseIso, delayDays) : null

  const runStepCreate = await createNextRunStep({
    supabaseUrl,
    serviceRoleKey,
    run,
    nextStep,
    completedRunStepId: completedRunStep?.id || null,
    scheduledAt,
  })

  if (runStepCreate.error || !runStepCreate.row?.id) {
    return {
      ok: false,
      runId: run.id,
      advanced: false,
      runCompleted: false,
      nextRunStepId: null,
      nextJobId: null,
      message: runStepCreate.error?.message || 'Unable to create/reuse next run step',
    }
  }

  const runStep = runStepCreate.row
  let nextJobId: string | null = null

  const stepType = String(nextStep.step_type || '').toLowerCase()
  if (stepType !== 'wait') {
    const jobResult = await ensureShadowJobForRunStep({
      supabaseUrl,
      serviceRoleKey,
      run,
      runStep,
      stepDef: nextStep,
      scheduledAt,
    })

    if (jobResult.error) {
      return {
        ok: false,
        runId: run.id,
        advanced: false,
        runCompleted: false,
        nextRunStepId: runStep.id,
        nextJobId: null,
        message: jobResult.error.message,
      }
    }

    nextJobId = jobResult.row?.id || null

    await appendEvent({
      supabaseUrl,
      serviceRoleKey,
      userId: run.user_id,
      workflowId: run.workflow_id,
      campaignId: run.campaign_id,
      campaignLeadId: run.campaign_lead_id,
      runId: run.id,
      runStepId: runStep.id,
      jobId: nextJobId,
      eventType: 'job_created',
      idempotencyKey: `shadow:job_created:${run.id}:${runStep.id}`,
      payload: {
        shadow_mode: true,
        created: Boolean(nextJobId),
        step_type: stepType,
      },
    })
  }

  await appendEvent({
    supabaseUrl,
    serviceRoleKey,
    userId: run.user_id,
    workflowId: run.workflow_id,
    campaignId: run.campaign_id,
    campaignLeadId: run.campaign_lead_id,
    runId: run.id,
    runStepId: runStep.id,
    jobId: nextJobId,
    eventType: scheduledAt ? 'next_step_scheduled' : 'next_step_created',
    idempotencyKey: `shadow:next_step:${run.id}:${runStep.id}`,
    payload: {
      shadow_mode: true,
      step_type: stepType,
      step_order: Number(nextStep.step_order || 0),
      scheduled_at: scheduledAt,
      initiated_by: params.initiatedBy,
      created: runStepCreate.created,
    },
  })

  await restPatch(
    supabaseUrl,
    serviceRoleKey,
    `workflow_runs?id=eq.${encodeURIComponent(run.id)}`,
    {
      status: 'running',
      current_step_ref: {
        workflow_step_id: sourceWorkflowStepId(nextStep),
        workflow_version_id: nextStep.workflow_version_id || run.workflow_version_id || null,
        workflow_version_step_id: nextStep.workflow_version_id ? nextStep.id : null,
        step_order: Number(nextStep.step_order || 0),
        step_type: stepType,
        run_step_id: runStep.id,
        scheduled_at: scheduledAt,
      },
      updated_at: nowIso(),
    },
    'return=minimal'
  )

  console.log('[WorkflowShadow][Advance] next step resolved', {
    runId: run.id,
    nextStepId: nextStep.id,
    nextStepType: stepType,
    scheduledAt,
    runStepId: runStep.id,
    nextJobId,
    createdRunStep: runStepCreate.created,
  })

  return {
    ok: true,
    runId: run.id,
    advanced: true,
    runCompleted: false,
    nextRunStepId: runStep.id,
    nextJobId,
    message: 'Shadow run advanced',
    details: {
      scheduledAt,
      nextStepOrder: Number(nextStep.step_order || 0),
      nextStepType: stepType,
      delayDays,
      runStepCreated: runStepCreate.created,
      definitionSource: defResult.source || 'unknown',
      workflowVersionId: run.workflow_version_id || null,
    },
  }
}
