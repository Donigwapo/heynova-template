import { Bot, FlaskConical, PauseCircle, PlayCircle, Plus, Rocket, Save, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import WorkflowStepCard from '../components/WorkflowStepCard'
import { fetchCampaignsByUserId } from '../lib/campaignsService'
import {
  createWorkflowWithDefaultSteps,
  fetchWorkflowByCampaignId,
  fetchWorkflowDetail,
  getDefaultWorkflowSteps,
  replaceWorkflowSteps,
  updateWorkflow,
} from '../lib/workflowsService'

const stepTypeOptions = [
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'wait', label: 'Wait' },
  { value: 'ai_action', label: 'AI Action' },
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

function createStepByType({ stepType, stepOrder, delayDays = 0 }) {
  const normalizedType = String(stepType || '').toLowerCase()
  const type = stepTypeOptions.some((option) => option.value === normalizedType)
    ? normalizedType
    : 'email'

  const typeLabel =
    type === 'ai_action'
      ? 'AI Action'
      : stepTypeOptions.find((option) => option.value === type)?.label || 'Email'

  return {
    stepOrder,
    stepType: type,
    delayDays,
    subject: `${typeLabel} Step`,
    body: '',
    metadata: {},
  }
}

function normalizeStepOrder(list) {
  return [...(list || [])]
    .map((step, index) => ({ ...step, stepOrder: index + 1 }))
    .sort((a, b) => Number(a.stepOrder || 0) - Number(b.stepOrder || 0))
}

function SortableWorkflowStep({
  item,
  index,
  isExpanded,
  onToggle,
  onChange,
  onRemove,
  stepTypeOptions,
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
      <WorkflowStepCard
        step={item.step}
        index={index}
        isExpanded={isExpanded}
        isDragging={isDragging}
        onToggle={onToggle}
        onChange={onChange}
        onRemove={onRemove}
        stepTypeOptions={stepTypeOptions}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
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

      const initialCampaignName =
        campaignOptions.find((campaign) => campaign.id === campaignId)?.name ||
        (campaignId ? 'Campaign' : 'Not linked')

      const workflowName = campaignId ? `${initialCampaignName} Workflow` : 'New Workflow'

      const { workflow: createdWorkflow, error: createError } = await createWorkflowWithDefaultSteps({
        userId: userProfile.authUserId,
        campaignId,
        name: workflowName,
      })

      if (!isMounted) return

      if (createError || !createdWorkflow) {
        setErrorMessage('Unable to create a workflow draft right now.')
        setWorkflow(null)
        setSteps([])
        setIsLoading(false)
        return
      }

      setWorkflow(createdWorkflow)
      setSteps(normalizeStepOrder(getDefaultWorkflowSteps()))
      setExpandedStepKey('step-0')
      setCampaignName(initialCampaignName || 'Not linked')
      setIsLoading(false)
      navigate(`/campaigns/workflows/${createdWorkflow.id}`, { replace: true })
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

  function insertStepAt(index, stepType = 'email') {
    setSteps((previous) => {
      const next = [...previous]
      const delayTemplate = index === 0 ? 0 : Number(next[index - 1]?.delayDays || 0)
      next.splice(index, 0, createStepByType({ stepType, stepOrder: index + 1, delayDays: delayTemplate }))
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

    setWorkflow(updatedWorkflow)
    setSaveMessage('Workflow saved successfully.')
    setIsSaving(false)
  }

  function handleTemplateApply(templatePrompt) {
    setAiPrompt(templatePrompt)
  }

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Workflows" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-gradient-to-b from-slate-50 to-slate-100/50">
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
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,28%)_minmax(0,72%)]">
                  <aside className="space-y-3 xl:sticky xl:top-3 xl:self-start">
                    <section className="rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-indigo-50 p-4 shadow-sm">
                      <div className="mb-3 flex items-start gap-2">
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
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        {errorMessage}
                      </div>
                    )}

                    {saveMessage && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        {saveMessage}
                      </div>
                    )}
                  </aside>

                  <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                    <header className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900">Automation Timeline Canvas</h2>
                          <p className="text-sm text-slate-500">Build and orchestrate your sequence flow</p>
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
                            onClick={() => setSaveMessage('Test Workflow is coming soon.')}
                            disabled={!workflow?.id}
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
                        <span>{normalizedSteps.length} steps</span>
                        <span>•</span>
                        <span>Last edited {formatDate(workflow?.updatedAt)}</span>
                      </div>
                    </header>

                    <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Trigger</p>
                      <p className="mt-0.5 text-sm font-medium text-indigo-900">
                        Manual Start • Launch when your campaign is ready
                      </p>
                    </div>

                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      {stepTypeOptions.map((insertType) => (
                        <button
                          key={insertType.value}
                          type="button"
                          onClick={() => addStep(insertType.value)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Plus size={13} /> {insertType.label}
                        </button>
                      ))}
                    </div>

                    <div className="relative space-y-2 pl-0 sm:pl-8">
                      <div className="absolute bottom-0 left-[0.68rem] top-0 hidden w-px bg-gradient-to-b from-indigo-100 via-slate-300 to-indigo-100 sm:block" />

                      {normalizedSteps.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                          No steps yet. Add your first automation step.
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
                            <div className="space-y-2">
                              {stepItems.map((item, index) => (
                                <div key={item.dragId} className="space-y-2">
                                  <SortableWorkflowStep
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
                                  />

                                  <div className="pl-0 sm:pl-6">
                                    <div
                                      className={`flex flex-wrap items-center gap-1 rounded-lg border px-2 py-1 transition-all ${
                                        activeDragId
                                          ? 'border-indigo-200 bg-indigo-50/40'
                                          : 'border-slate-200 bg-slate-50/70'
                                      }`}
                                    >
                                      <span className="text-[11px] font-medium text-slate-500">Insert below:</span>
                                      {stepTypeOptions.map((insertType) => (
                                        <button
                                          key={`${item.dragId}-${insertType.value}`}
                                          type="button"
                                          onClick={() => insertStepAt(index + 1, insertType.value)}
                                          className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                                        >
                                          + {insertType.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default CampaignWorkflowBuilderPage
