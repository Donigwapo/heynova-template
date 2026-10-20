import { Bot, FlaskConical, PauseCircle, PlayCircle, Plus, Rocket, Save, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import WorkflowStepNode from '../components/WorkflowStepNode'
import { fetchCampaignsByUserId, fetchSingleCampaignLeadForEmailTest } from '../lib/campaignsService'
import {
  fetchWorkflowByCampaignId,
  fetchWorkflowDetail,
  getDefaultWorkflowSteps,
  replaceWorkflowSteps,
  updateWorkflow,
} from '../lib/workflowsService'
import { sendWorkflowTestEmail } from '../lib/workflowEmailTestService'
import { enqueueWorkflowEmailJobsOnActivate } from '../lib/workflowOutboxQueueService'
import { syncWorkflowActivationShadow } from '../lib/workflowExecutionShadowService'

const COPILOT_COLLAPSE_STORAGE_KEY = 'heynova.workflow.aiCopilotCollapsed'

const stepTypeOptions = [
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'wait', label: 'Wait' },
  { value: 'condition', label: 'Condition / Branch' },
  { value: 'ai_action', label: 'AI Action' },
  { value: 'stop', label: 'Stop' },
]

const quickNodeTypes = [
  { value: 'email', label: 'Send Email' },
  { value: 'linkedin', label: 'LinkedIn Action' },
  { value: 'wait', label: 'Wait' },
  { value: 'condition', label: 'Condition / Branch' },
  { value: 'ai_action', label: 'AI Action' },
  { value: 'stop', label: 'Stop' },
]

const aiTemplatePrompts = [
  'Generate a 4-step real estate investor outreach workflow',
  'Create a SaaS founder outbound sequence with LinkedIn + email',
  'Build a re-engagement workflow for warm leads',
]

function statusBadgeClass(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (normalized === 'paused') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (normalized === 'completed') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function formatDate(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function createStepByType({ stepType, stepOrder, delayDays = 0, metadata = null }) {
  const normalizedType = String(stepType || '').toLowerCase()
  const type = stepTypeOptions.some((option) => option.value === normalizedType)
    ? normalizedType
    : 'email'

  const typeLabel =
    type === 'ai_action'
      ? 'AI Action'
      : type === 'condition'
        ? 'Condition / Branch'
        : type === 'linkedin'
          ? 'LinkedIn Action'
          : type === 'wait'
            ? 'Wait'
            : type === 'stop'
              ? 'Stop'
              : 'Send Email'

  const baseMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}

  return {
    stepOrder,
    stepType: type,
    delayDays: type === 'wait' ? delayDays || 1 : delayDays,
    subject: `${typeLabel} Node`,
    body: '',
    metadata:
      type === 'condition'
        ? {
            conditionLabel: 'Did lead reply?',
            yesLabel: 'Yes',
            noLabel: 'No',
            branchingPhase: 'visual-foundation',
            ...baseMetadata,
          }
        : {
            ...baseMetadata,
          },
  }
}

function normalizeStepOrder(list) {
  return [...(list || [])]
    .map((step, index) => ({ ...step, stepOrder: index + 1 }))
    .sort((a, b) => Number(a.stepOrder || 0) - Number(b.stepOrder || 0))
}

function SortableWorkflowNode({
  item,
  index,
  isExpanded,
  onToggle,
  onChange,
  onRemove,
  stepTypeOptions,
  onOpenYesBranchMenu,
  onOpenNoBranchMenu,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.dragId,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <WorkflowStepNode
        step={item.step}
        index={index}
        isExpanded={isExpanded}
        isDragging={isDragging}
        onToggle={onToggle}
        onChange={onChange}
        onRemove={onRemove}
        stepTypeOptions={stepTypeOptions}
        onOpenYesBranchMenu={onOpenYesBranchMenu}
        onOpenNoBranchMenu={onOpenNoBranchMenu}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

function AddNodePopover({ isOpen, onAdd, onClose, align = 'center' }) {
  if (!isOpen) return null

  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2'

  return (
    <div className={`absolute z-30 mt-2 w-52 ${alignClass}`}>
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
        <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Add Action</p>
        <div className="flex flex-col gap-1">
          {quickNodeTypes.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                onAdd(item.value)
                onClose?.()
              }}
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ConnectorAddButton({ menuOpen, onToggle, onAdd, onClose, align = 'center' }) {
  return (
    <div data-insert-menu-root="true" className="relative flex flex-col items-center">
      <button
        type="button"
        aria-label="Add action"
        onClick={onToggle}
        className={`group inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold shadow-sm transition-all ${
          menuOpen
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-100'
            : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700'
        }`}
      >
        <Plus size={14} />
      </button>

      <AddNodePopover isOpen={menuOpen} onAdd={onAdd} onClose={onClose} align={align} />
    </div>
  )
}

function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset }) {
  return (
    <div className="absolute left-3 top-3 z-10 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={onZoomIn}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          +
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          -
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          100%
        </button>
      </div>
      <p className="mt-1 text-center text-[10px] font-medium text-slate-500">{Math.round(zoom * 100)}%</p>
    </div>
  )
}

function CampaignWorkflowBuilderPage({ userProfile, onRunCommand = () => {} }) {
  const navigate = useNavigate()
  const { workflowId } = useParams()
  const [searchParams] = useSearchParams()
  const campaignIdFromQuery = searchParams.get('campaignId')

  const [workflow, setWorkflow] = useState(null)
  const [campaignOptions, setCampaignOptions] = useState([])
  const [campaignName, setCampaignName] = useState('Not linked')
  const [steps, setSteps] = useState([])
  const [expandedStepKey, setExpandedStepKey] = useState('step-0')

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const [aiPrompt, setAiPrompt] = useState('')
  const [activeDragId, setActiveDragId] = useState(null)
  const [isAICopilotCollapsed, setIsAICopilotCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(COPILOT_COLLAPSE_STORAGE_KEY) === '1'
  })

  const [zoom, setZoom] = useState(1)
  const [openInsertMenuKey, setOpenInsertMenuKey] = useState(null)

  const isEditMode = Boolean(workflowId)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(COPILOT_COLLAPSE_STORAGE_KEY, isAICopilotCollapsed ? '1' : '0')
  }, [isAICopilotCollapsed])

  useEffect(() => {
    let isMounted = true

    const loadCampaignOptions = async () => {
      const { campaigns, error } = await fetchCampaignsByUserId(userProfile?.authUserId)
      if (!isMounted) return

      if (error) {
        console.error('[CampaignWorkflowBuilderPage] failed loading campaign options', {
          table: 'campaigns',
          user_id: userProfile?.authUserId || null,
          pathname: window.location.pathname,
          error,
        })
        setCampaignOptions([])
        return
      }

      setCampaignOptions((campaigns || []).map((row) => ({ id: row.id, name: row.name || 'Untitled Campaign' })))
    }

    loadCampaignOptions()

    return () => {
      isMounted = false
    }
  }, [userProfile?.authUserId])

  useEffect(() => {
    let isMounted = true

    const loadBuilderState = async () => {
      if (!userProfile?.authUserId) {
        if (!isMounted) return
        setErrorMessage('Please sign in again to edit workflows.')
        setWorkflow(null)
        setSteps([])
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setErrorMessage('')
      setSaveMessage('')

      if (workflowId) {
        const { workflow, steps, campaignName, error } = await fetchWorkflowDetail({
          workflowId,
          userId: userProfile.authUserId,
        })

        if (!isMounted) return

        if (error) {
          setErrorMessage('Unable to load workflow details right now.')
          setWorkflow(null)
          setSteps([])
          setCampaignName('Not linked')
          setIsLoading(false)
          return
        }

        if (!workflow) {
          setErrorMessage('Workflow not found.')
          setWorkflow(null)
          setSteps([])
          setCampaignName('Not linked')
          setIsLoading(false)
          return
        }

        setWorkflow(workflow)
        setSteps(normalizeStepOrder(steps || []))
        setExpandedStepKey('step-0')
        setCampaignName(campaignName || 'Not linked')
        setIsLoading(false)
        return
      }

      const campaignId = campaignIdFromQuery
      if (campaignId) {
        const { workflow: existingWorkflow, error: existingWorkflowError } = await fetchWorkflowByCampaignId({
          campaignId,
          userId: userProfile.authUserId,
        })

        if (!isMounted) return

        if (existingWorkflowError) {
          setErrorMessage('Unable to check existing workflow for this campaign.')
          setWorkflow(null)
          setSteps([])
          setIsLoading(false)
          return
        }

        if (existingWorkflow?.id) {
          navigate(`/campaigns/workflows/${existingWorkflow.id}`, { replace: true })
          return
        }
      }

      setWorkflow(null)
      setSteps([])
      setCampaignName('Not linked')
      setIsLoading(false)
      navigate(campaignId ? `/campaigns/workflows?campaignId=${encodeURIComponent(campaignId)}` : '/campaigns/workflows', {
        replace: true,
      })
    }

    loadBuilderState()

    return () => {
      isMounted = false
    }
  }, [workflowId, campaignIdFromQuery, userProfile?.authUserId, navigate, campaignOptions])

  const normalizedSteps = useMemo(() => normalizeStepOrder(steps), [steps])

  const stepItems = useMemo(
    () =>
      normalizedSteps.map((step, index) => ({
        step,
        dragId: step.id ? `db-${step.id}` : `temp-${index}`,
      })),
    [normalizedSteps]
  )

  const selectedCampaignId = workflow?.campaignId || ''

  function updateStepAtIndex(index, patch) {
    setSteps((previous) => {
      const next = [...previous]
      const current = next[index] || {}
      next[index] = {
        ...current,
        ...patch,
      }
      return normalizeStepOrder(next)
    })
  }

  function removeStepAtIndex(index) {
    setSteps((previous) => {
      const next = previous.filter((_, stepIndex) => stepIndex !== index)
      if (next.length === 0) {
        setExpandedStepKey('step-0')
      } else if (index >= next.length) {
        setExpandedStepKey(`step-${next.length - 1}`)
      }
      return normalizeStepOrder(next)
    })
  }

  function insertStepAt(index, stepType = 'email', options = {}) {
    setSteps((previous) => {
      const next = [...previous]
      const delayTemplate = index === 0 ? 0 : Number(next[index - 1]?.delayDays || 0)
      next.splice(
        index,
        0,
        createStepByType({
          stepType,
          stepOrder: index + 1,
          delayDays: delayTemplate,
          metadata: options?.metadata || null,
        })
      )
      const normalized = normalizeStepOrder(next)
      setExpandedStepKey(`step-${index}`)
      return normalized
    })
  }

  function addStep(stepType = 'email') {
    setSteps((previous) => {
      const next = [
        ...previous,
        createStepByType({
          stepType,
          stepOrder: previous.length + 1,
          delayDays: previous.length === 0 ? 0 : 3,
        }),
      ]
      const normalized = normalizeStepOrder(next)
      setExpandedStepKey(`step-${normalized.length - 1}`)
      return normalized
    })
  }

  function handleDragStart(event) {
    setActiveDragId(event.active?.id || null)
  }

  function handleDragEnd(event) {
    setActiveDragId(null)

    const { active, over } = event
    if (!active?.id || !over?.id || active.id === over.id) return

    setSteps((previous) => {
      const currentItems = normalizeStepOrder(previous).map((step, index) => ({
        step,
        dragId: step.id ? `db-${step.id}` : `temp-${index}`,
      }))

      const oldIndex = currentItems.findIndex((item) => item.dragId === active.id)
      const newIndex = currentItems.findIndex((item) => item.dragId === over.id)

      if (oldIndex < 0 || newIndex < 0) return previous

      const moved = arrayMove(currentItems.map((item) => item.step), oldIndex, newIndex)
      const normalized = normalizeStepOrder(moved)

      if (expandedStepKey === `step-${oldIndex}`) {
        setExpandedStepKey(`step-${newIndex}`)
      }

      return normalized
    })
  }

  async function saveWorkflowWithStatus(nextStatus) {
    if (!workflow?.id || !userProfile?.authUserId) return

    setIsSaving(true)
    setErrorMessage('')
    setSaveMessage('')

    const { workflow: updatedWorkflow, error: workflowError } = await updateWorkflow({
      workflowId: workflow.id,
      userId: userProfile.authUserId,
      patch: {
        name: workflow.name,
        status: nextStatus || workflow.status,
        triggerType: workflow.triggerType,
        campaignId: workflow.campaignId,
      },
    })

    if (workflowError || !updatedWorkflow) {
      setErrorMessage('Unable to save workflow settings.')
      setIsSaving(false)
      return
    }

    const { error: stepError } = await replaceWorkflowSteps({
      workflowId: workflow.id,
      userId: userProfile.authUserId,
      steps: normalizedSteps,
    })

    if (stepError) {
      setErrorMessage('Unable to save workflow steps.')
      setIsSaving(false)
      return
    }

    if ((nextStatus || workflow.status) === 'active') {
      const { queuedCount, requeuedCount, skippedCount, skippedActiveRunCount, error: enqueueError } =
        await enqueueWorkflowEmailJobsOnActivate({
          workflowId: workflow.id,
          userId: userProfile.authUserId,
          campaignId: updatedWorkflow.campaignId,
        })

      if (enqueueError) {
        setErrorMessage(`Workflow saved, but enqueue failed: ${enqueueError.message || 'Unknown enqueue error.'}`)
        setWorkflow(updatedWorkflow)
        setIsSaving(false)
        return
      }

      // Phase 2A.3 shadow sync is best-effort and must never block legacy execution.
      const shadowResult = await syncWorkflowActivationShadow({
        workflowId: workflow.id,
        campaignId: updatedWorkflow.campaignId,
      })

      const activeSkipSegment = skippedActiveRunCount > 0 ? `, skipped active executions: ${skippedActiveRunCount}` : ''
      let activationMessage = `Workflow activated. Outbox queued: ${queuedCount}, re-queued failed: ${requeuedCount}, skipped: ${skippedCount}${activeSkipSegment}.`

      if (!shadowResult.ok) {
        console.warn('[WorkflowShadow] activation sync invocation failed (non-blocking)', {
          workflowId: workflow.id,
          campaignId: updatedWorkflow.campaignId,
          message: shadowResult.error?.message || 'Unknown shadow sync error',
        })

        activationMessage =
          `Workflow activated and emails queued, but execution sync did not complete. ` +
          `Outbox queued: ${queuedCount}, re-queued failed: ${requeuedCount}, skipped: ${skippedCount}${activeSkipSegment}.`
      } else {
        const processed = Number(shadowResult.data?.processed || 0)
        const failures = Array.isArray(shadowResult.data?.failures) ? shadowResult.data.failures : []
        const failureCount = failures.length

        if (failureCount > 0) {
          console.warn('[WorkflowShadow] activation sync completed with row-level failures (non-blocking)', {
            workflowId: workflow.id,
            campaignId: updatedWorkflow.campaignId,
            workflowVersionId: shadowResult.data?.workflowVersionId || null,
            processed,
            failureCount,
          })

          activationMessage =
            `Workflow activated and emails queued, but execution sync encountered ${failureCount} issue(s). ` +
            `Outbox queued: ${queuedCount}, re-queued failed: ${requeuedCount}, skipped: ${skippedCount}${activeSkipSegment}.`
        } else {
          console.log('[WorkflowShadow] activation sync complete', {
            workflowId: workflow.id,
            campaignId: updatedWorkflow.campaignId,
            workflowVersionId: shadowResult.data?.workflowVersionId || null,
            processed,
            failureCount,
          })
        }
      }

      setWorkflow(updatedWorkflow)
      setSaveMessage(activationMessage)
      setIsSaving(false)
      return
    }

    setWorkflow(updatedWorkflow)
    setSaveMessage('Workflow saved successfully.')
    setIsSaving(false)
  }

  async function handleTestWorkflowEmailSend() {
    setErrorMessage('')
    setSaveMessage('')

    const userId = userProfile?.authUserId || null
    const workflowIdValue = workflow?.id || null
    const campaignId = workflow?.campaignId || null

    console.log('[WorkflowEmailTest] test start', {
      userId,
      workflowId: workflowIdValue,
      campaignId,
      stepsCount: normalizedSteps.length,
    })

    if (!userId) {
      console.error('[WorkflowEmailTest] auth/JWT issue: missing user id in session')
      setErrorMessage('Please sign in again before sending a workflow test email.')
      return
    }

    if (!campaignId) {
      console.error('[WorkflowEmailTest] missing campaign id on workflow')
      setErrorMessage('Connect this workflow to a campaign before running test email send.')
      return
    }

    const emailStep = normalizedSteps.find(
      (step) => String(step.stepType || '').toLowerCase() === 'email'
    )

    if (!emailStep) {
      console.error('[WorkflowEmailTest] workflow step parsing: no email step found')
      setErrorMessage('No email step found in this workflow. Add an email step first.')
      return
    }

    if (!emailStep?.id) {
      console.error('[WorkflowEmailTest][Manual] missing stable workflow_step_id', {
        workflowId: workflowIdValue,
        emailStepId: emailStep?.id || null,
      })
      setErrorMessage('Please save the workflow before testing.')
      return
    }

    const subject = String(emailStep.subject || '').trim()
    const text = String(emailStep.body || '').trim()

    if (!subject || !text) {
      console.error('[WorkflowEmailTest] workflow step parsing: subject/body missing', {
        hasSubject: Boolean(subject),
        hasBody: Boolean(text),
      })
      setErrorMessage('Email step subject and body are required for test send.')
      return
    }

    console.log('[WorkflowEmailTest] resolving campaign lead for test send', {
      userId,
      campaignId,
    })

    const { lead, error: leadError } = await fetchSingleCampaignLeadForEmailTest({ campaignId, userId })

    if (leadError) {
      console.error('[WorkflowEmailTest] missing campaign lead email: query failure', {
        campaignId,
        userId,
        error: leadError,
      })
      setErrorMessage('Unable to load campaign lead email for test send.')
      return
    }

    if (!lead?.email) {
      console.error('[WorkflowEmailTest] missing campaign lead email: no eligible lead', {
        campaignId,
        userId,
      })
      setErrorMessage('No campaign lead with a valid email found for test send.')
      return
    }

    console.log('[WorkflowEmailTest][Manual] invoking gmail-send edge function', {
      to: lead.email,
      workflowId: workflowIdValue,
      emailStepId: emailStep.id || null,
    })

    const sendResult = await sendWorkflowTestEmail({
      to: lead.email,
      subject,
      text,
    })

    if (!sendResult.ok) {
      const errorCode = sendResult.errorCode || 'send_failed'

      console.error('[WorkflowEmailTest][Manual] gmail-send function failure', {
        errorCode,
        message: sendResult.message,
        raw: sendResult.raw,
      })
      setErrorMessage(`Test email failed (${errorCode}): ${sendResult.message}`)
      return
    }

    console.log('[WorkflowEmailTest][Manual] send success', {
      to: lead.email,
      providerMessageId: sendResult.providerMessageId,
    })

    setSaveMessage(
      `Test email sent to ${lead.email}${sendResult.providerMessageId ? ` (id: ${sendResult.providerMessageId})` : ''}.`
    )
  }

  function handleTemplateApply(templatePrompt) {
    setAiPrompt(templatePrompt)
  }

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(1.8, Number((prev + 0.1).toFixed(2))))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))
  }, [])

  const handleZoomReset = useCallback(() => {
    setZoom(1)
  }, [])

  useEffect(() => {
    function onGlobalPointerDown(event) {
      const target = event?.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-insert-menu-root="true"]')) return
      setOpenInsertMenuKey(null)
    }

    function onGlobalEscape(event) {
      if (event.key === 'Escape') {
        setOpenInsertMenuKey(null)
      }
    }

    window.addEventListener('pointerdown', onGlobalPointerDown)
    window.addEventListener('keydown', onGlobalEscape)

    return () => {
      window.removeEventListener('pointerdown', onGlobalPointerDown)
      window.removeEventListener('keydown', onGlobalEscape)
    }
  }, [])

  useEffect(() => {
    function isEditableTarget(target) {
      if (!target || !(target instanceof HTMLElement)) return false

      const tag = target.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
      if (target.isContentEditable) return true
      if (target.closest('[contenteditable="true"]')) return true

      return false
    }

    function onKeyDown(event) {
      if (event.defaultPrevented) return
      if (isEditableTarget(event.target)) return

      const key = event.key
      if (key === '+' || key === '=') {
        event.preventDefault()
        handleZoomIn()
        return
      }

      if (key === '-') {
        event.preventDefault()
        handleZoomOut()
        return
      }

      if (key === '0') {
        event.preventDefault()
        handleZoomReset()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleZoomIn, handleZoomOut, handleZoomReset])

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Workflows" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />

          <main className="relative flex-1 overflow-auto bg-gradient-to-b from-slate-50 to-slate-100/50">
            <div className="w-full px-2 py-3 sm:px-3 lg:px-4 lg:py-4">
              {isLoading ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-600">Loading workflow workspace...</p>
                </section>
              ) : !workflow ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-600">Workflow unavailable.</p>
                </section>
              ) : (
                <>
                  {isAICopilotCollapsed && (
                    <button
                      type="button"
                      onClick={() => setIsAICopilotCollapsed(false)}
                      className="fixed right-4 top-28 z-20 rounded-lg border border-fuchsia-200 bg-white px-3 py-1.5 text-sm font-semibold text-fuchsia-700 shadow-sm hover:bg-fuchsia-50"
                    >
                      {'>>'} Show Copilot
                    </button>
                  )}

                  <div className="flex flex-col gap-3 xl:flex-row">
                    <aside
                      className={`overflow-hidden transition-all duration-300 ease-out ${
                        isAICopilotCollapsed
                          ? 'pointer-events-none w-0 opacity-0'
                          : 'w-full opacity-100 xl:w-[clamp(280px,28%,420px)]'
                      }`}
                    >
                      <section className="rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-indigo-50 p-4 shadow-sm">
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-100 p-2 text-fuchsia-700">
                              <Sparkles size={18} />
                            </div>
                            <div>
                              <h2 className="text-base font-semibold text-slate-900">AI Workflow Generator</h2>
                              <p className="text-sm text-slate-600">
                                Describe what you want to achieve. Heynova helps scaffold your automation.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsAICopilotCollapsed(true)}
                            className="rounded-lg border border-fuchsia-200 bg-white px-2 py-1 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-50"
                          >
                            {'<<'} Hide
                          </button>
                        </div>

                        <textarea
                          rows={6}
                          value={aiPrompt}
                          onChange={(event) => setAiPrompt(event.target.value)}
                          placeholder="Describe your outreach goal... e.g. Generate a 4-step workflow for real estate investor outreach"
                          className="w-full rounded-xl border border-fuchsia-200 bg-white px-3 py-2 text-sm text-slate-800"
                        />

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {aiTemplatePrompts.map((template) => (
                            <button
                              key={template}
                              type="button"
                              onClick={() => handleTemplateApply(template)}
                              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                            >
                              {template}
                            </button>
                          ))}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-slate-500">
                            AI suggestions and generation states can plug in here.
                          </p>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-200 bg-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-fuchsia-700"
                          >
                            <Bot size={14} /> Generate Workflow
                          </button>
                        </div>
                      </section>

                      {errorMessage && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                          {errorMessage}
                        </div>
                      )}

                      {saveMessage && (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                          {saveMessage}
                        </div>
                      )}
                    </aside>

                    <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition-all duration-300 ease-out sm:p-4">
                      <header className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 className="text-lg font-semibold text-slate-900">Automation Node Canvas</h2>
                            <p className="text-sm text-slate-500">Compose automation as connected action nodes</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => saveWorkflowWithStatus('draft')}
                              disabled={isSaving || !workflow?.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:bg-slate-100"
                            >
                              <Save size={13} /> Save Draft
                            </button>
                            <button
                              type="button"
                              onClick={() => saveWorkflowWithStatus('paused')}
                              disabled={isSaving || !workflow?.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:bg-amber-50/60"
                            >
                              <PauseCircle size={13} /> Pause
                            </button>
                            <button
                              type="button"
                              onClick={handleTestWorkflowEmailSend}
                              disabled={!workflow?.id || isSaving}
                              className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:bg-violet-50/60"
                            >
                              <FlaskConical size={13} /> Test
                            </button>
                            <button
                              type="button"
                              onClick={() => saveWorkflowWithStatus('active')}
                              disabled={isSaving || !workflow?.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:bg-emerald-50/60"
                            >
                              <PlayCircle size={13} /> Activate
                            </button>
                            <button
                              type="button"
                              onClick={() => saveWorkflowWithStatus('active')}
                              disabled={isSaving || !workflow?.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300"
                            >
                              <Rocket size={13} /> Publish
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
                          <input
                            value={workflow?.name || ''}
                            onChange={(event) =>
                              setWorkflow((previous) => ({
                                ...previous,
                                name: event.target.value,
                              }))
                            }
                            placeholder="Workflow name"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
                          />

                          <select
                            value={selectedCampaignId}
                            onChange={(event) => {
                              const nextCampaignId = event.target.value || null
                              setWorkflow((previous) => ({
                                ...previous,
                                campaignId: nextCampaignId,
                              }))

                              const nextCampaign = campaignOptions.find((item) => item.id === nextCampaignId)
                              setCampaignName(nextCampaign?.name || 'Not linked')
                            }}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
                          >
                            <option value="">Campaign: Not linked</option>
                            {campaignOptions.map((campaign) => (
                              <option key={campaign.id} value={campaign.id}>
                                Campaign: {campaign.name}
                              </option>
                            ))}
                          </select>

                          <select
                            value={workflow?.status || 'draft'}
                            onChange={(event) =>
                              setWorkflow((previous) => ({
                                ...previous,
                                status: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
                          >
                            <option value="draft">Status: Draft</option>
                            <option value="active">Status: Active</option>
                            <option value="paused">Status: Paused</option>
                            <option value="completed">Status: Completed</option>
                          </select>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${statusBadgeClass(workflow?.status)}`}>
                            {workflow?.status || 'draft'}
                          </span>
                          <span>{campaignName || 'Not linked'}</span>
                          <span>•</span>
                          <span>{normalizedSteps.length} nodes</span>
                          <span>•</span>
                          <span>Last edited {formatDate(workflow?.updatedAt)}</span>
                        </div>
                      </header>

                      <div className="relative rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                        <ZoomControls
                          zoom={zoom}
                          onZoomIn={handleZoomIn}
                          onZoomOut={handleZoomOut}
                          onReset={handleZoomReset}
                        />

                        <div className="min-h-[560px] overflow-auto rounded-lg border border-dashed border-slate-300 bg-white">
                          <div
                            className="origin-top transition-transform duration-200 ease-out"
                            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
                          >
                            <div className="mx-auto w-full max-w-3xl px-4 py-8">
                              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/90 px-3 py-2 text-center">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Trigger / Start</p>
                                <p className="mt-0.5 text-sm font-medium text-indigo-900">Manual Start</p>
                              </div>

                              <div className="mx-auto h-6 w-px bg-slate-300" />

                              {normalizedSteps.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                                  No nodes yet.
                                  <div className="mt-3 flex justify-center">
                                    <ConnectorAddButton
                                      menuOpen={openInsertMenuKey === 'empty'}
                                      onToggle={() =>
                                        setOpenInsertMenuKey((current) =>
                                          current === 'empty' ? null : 'empty'
                                        )
                                      }
                                      onClose={() => setOpenInsertMenuKey(null)}
                                      onAdd={(type) => addStep(type)}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <DndContext
                                  sensors={sensors}
                                  collisionDetection={closestCenter}
                                  onDragStart={handleDragStart}
                                  onDragEnd={handleDragEnd}
                                  onDragCancel={() => setActiveDragId(null)}
                                >
                                  <SortableContext
                                    items={stepItems.map((item) => item.dragId)}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    <div className="space-y-0">
                                      {stepItems.map((item, index) => {
                                        const connectorKey = `between-${index}`
                                        const isConditionNode = String(item?.step?.stepType || '').toLowerCase() === 'condition'
                                        const prevStep = stepItems[index - 1]?.step || null
                                        const prevIsCondition = String(prevStep?.stepType || '').toLowerCase() === 'condition'
                                        const branchIntent = String(item?.step?.metadata?.branchIntent || '').toLowerCase()
                                        const lane =
                                          (branchIntent === 'yes' || branchIntent === 'no') && prevIsCondition
                                            ? branchIntent
                                            : 'main'

                                        const nodeWidthClass = isConditionNode ? 'max-w-[480px]' : 'max-w-[420px]'

                                        return (
                                          <div key={item.dragId} className="flex w-full flex-col items-center">
                                            {lane !== 'main' ? (
                                              <div className="mt-1 mb-2 flex w-full items-center justify-center">
                                                <div className="relative h-7 w-full max-w-5xl">
                                                  <div className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-slate-300" />
                                                  <div
                                                    className={`absolute top-3 h-px ${
                                                      lane === 'yes'
                                                        ? 'left-[16.666%] right-1/2 bg-emerald-300'
                                                        : 'left-1/2 right-[16.666%] bg-rose-300'
                                                    }`}
                                                  />
                                                  <div
                                                    className={`absolute top-3 h-4 w-px ${
                                                      lane === 'yes' ? 'left-[16.666%] bg-emerald-300' : 'right-[16.666%] bg-rose-300'
                                                    }`}
                                                  />
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="mt-2 h-4 w-px bg-slate-300" />
                                            )}

                                            <div className="grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-3">
                                              <div className="flex justify-center sm:justify-end">
                                                {lane === 'yes' ? (
                                                  <div className={`w-full ${nodeWidthClass}`}>
                                                    <SortableWorkflowNode
                                                      item={item}
                                                      index={index}
                                                      isExpanded={expandedStepKey === `step-${index}`}
                                                      onToggle={() =>
                                                        setExpandedStepKey((current) =>
                                                          current === `step-${index}` ? 'none' : `step-${index}`
                                                        )
                                                      }
                                                      onChange={(patch) => updateStepAtIndex(index, patch)}
                                                      onRemove={() => removeStepAtIndex(index)}
                                                      stepTypeOptions={stepTypeOptions}
                                                      onOpenYesBranchMenu={() =>
                                                        setOpenInsertMenuKey((current) =>
                                                          current === `condition-yes-${index}` ? null : `condition-yes-${index}`
                                                        )
                                                      }
                                                      onOpenNoBranchMenu={() =>
                                                        setOpenInsertMenuKey((current) =>
                                                          current === `condition-no-${index}` ? null : `condition-no-${index}`
                                                        )
                                                      }
                                                    />
                                                  </div>
                                                ) : null}
                                              </div>

                                              <div className="flex justify-center">
                                                {lane === 'main' ? (
                                                  <div className={`w-full ${nodeWidthClass}`}>
                                                    <SortableWorkflowNode
                                                      item={item}
                                                      index={index}
                                                      isExpanded={expandedStepKey === `step-${index}`}
                                                      onToggle={() =>
                                                        setExpandedStepKey((current) =>
                                                          current === `step-${index}` ? 'none' : `step-${index}`
                                                        )
                                                      }
                                                      onChange={(patch) => updateStepAtIndex(index, patch)}
                                                      onRemove={() => removeStepAtIndex(index)}
                                                      stepTypeOptions={stepTypeOptions}
                                                      onOpenYesBranchMenu={() =>
                                                        setOpenInsertMenuKey((current) =>
                                                          current === `condition-yes-${index}` ? null : `condition-yes-${index}`
                                                        )
                                                      }
                                                      onOpenNoBranchMenu={() =>
                                                        setOpenInsertMenuKey((current) =>
                                                          current === `condition-no-${index}` ? null : `condition-no-${index}`
                                                        )
                                                      }
                                                    />
                                                  </div>
                                                ) : null}
                                              </div>

                                              <div className="flex justify-center sm:justify-start">
                                                {lane === 'no' ? (
                                                  <div className={`w-full ${nodeWidthClass}`}>
                                                    <SortableWorkflowNode
                                                      item={item}
                                                      index={index}
                                                      isExpanded={expandedStepKey === `step-${index}`}
                                                      onToggle={() =>
                                                        setExpandedStepKey((current) =>
                                                          current === `step-${index}` ? 'none' : `step-${index}`
                                                        )
                                                      }
                                                      onChange={(patch) => updateStepAtIndex(index, patch)}
                                                      onRemove={() => removeStepAtIndex(index)}
                                                      stepTypeOptions={stepTypeOptions}
                                                      onOpenYesBranchMenu={() =>
                                                        setOpenInsertMenuKey((current) =>
                                                          current === `condition-yes-${index}` ? null : `condition-yes-${index}`
                                                        )
                                                      }
                                                      onOpenNoBranchMenu={() =>
                                                        setOpenInsertMenuKey((current) =>
                                                          current === `condition-no-${index}` ? null : `condition-no-${index}`
                                                        )
                                                      }
                                                    />
                                                  </div>
                                                ) : null}
                                              </div>
                                            </div>

                                            <div className="mt-3 h-4 w-px bg-slate-300" />

                                            <ConnectorAddButton
                                              menuOpen={openInsertMenuKey === connectorKey}
                                              onToggle={() =>
                                                setOpenInsertMenuKey((current) =>
                                                  current === connectorKey ? null : connectorKey
                                                )
                                              }
                                              onClose={() => setOpenInsertMenuKey(null)}
                                              onAdd={(type) => insertStepAt(index + 1, type)}
                                            />

                                            {isConditionNode && (
                                              <div className="mt-3 grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-3">
                                                <div className="flex flex-col items-center sm:items-end">
                                                  <div className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                                    <span>↙</span>
                                                    <span>Yes</span>
                                                  </div>
                                                  <div className="mt-1 h-3 w-px bg-emerald-300" />
                                                  <ConnectorAddButton
                                                    menuOpen={openInsertMenuKey === `condition-yes-${index}`}
                                                    onToggle={() =>
                                                      setOpenInsertMenuKey((current) =>
                                                        current === `condition-yes-${index}` ? null : `condition-yes-${index}`
                                                      )
                                                    }
                                                    onClose={() => setOpenInsertMenuKey(null)}
                                                    onAdd={(type) =>
                                                      insertStepAt(index + 1, type, {
                                                        metadata: {
                                                          branchIntent: 'yes',
                                                          branchFromStepId: item?.step?.id || null,
                                                        },
                                                      })
                                                    }
                                                    align="left"
                                                  />
                                                </div>
                                                <div className="hidden sm:block" />
                                                <div className="flex flex-col items-center sm:items-start">
                                                  <div className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                                                    <span>No</span>
                                                    <span>↘</span>
                                                  </div>
                                                  <div className="mt-1 h-3 w-px bg-rose-300" />
                                                  <ConnectorAddButton
                                                    menuOpen={openInsertMenuKey === `condition-no-${index}`}
                                                    onToggle={() =>
                                                      setOpenInsertMenuKey((current) =>
                                                        current === `condition-no-${index}` ? null : `condition-no-${index}`
                                                      )
                                                    }
                                                    onClose={() => setOpenInsertMenuKey(null)}
                                                    onAdd={(type) =>
                                                      insertStepAt(index + 1, type, {
                                                        metadata: {
                                                          branchIntent: 'no',
                                                          branchFromStepId: item?.step?.id || null,
                                                        },
                                                      })
                                                    }
                                                    align="right"
                                                  />
                                                </div>
                                              </div>
                                            )}

                                            <div className="mt-2 mb-2 h-3 w-px bg-slate-300" />
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </SortableContext>
                                </DndContext>
                              )}

                              <div className="mx-auto mt-1 mb-2 h-4 w-px bg-slate-300" />

                              <div className="mb-3 flex justify-center">
                                <ConnectorAddButton
                                  menuOpen={openInsertMenuKey === 'end'}
                                  onToggle={() =>
                                    setOpenInsertMenuKey((current) => (current === 'end' ? null : 'end'))
                                  }
                                  onClose={() => setOpenInsertMenuKey(null)}
                                  onAdd={(type) => addStep(type)}
                                />
                              </div>

                              <div className="mx-auto mt-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-center">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Stop / End</p>
                                <p className="mt-0.5 text-sm font-medium text-rose-900">Flow Completed</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default CampaignWorkflowBuilderPage
