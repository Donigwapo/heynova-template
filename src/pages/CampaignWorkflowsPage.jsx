import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import AIModalShell from '../components/AIModalShell'
import { fetchCampaignsByUserId } from '../lib/campaignsService'
import { createWorkflowWithDefaultSteps, fetchWorkflowListForUser } from '../lib/workflowsService'

function formatDate(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusBadgeClass(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (normalized === 'paused') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (normalized === 'draft') return 'border-slate-200 bg-slate-50 text-slate-600'
  if (normalized === 'completed') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function CampaignWorkflowsPage({ userProfile, onRunCommand = () => {} }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createErrorMessage, setCreateErrorMessage] = useState('')
  const [workflowNameInput, setWorkflowNameInput] = useState('')
  const [campaignOptions, setCampaignOptions] = useState([])
  const [selectedCampaignId, setSelectedCampaignId] = useState('')

  const prefilledCampaignIdFromQuery = useMemo(() => {
    const value = searchParams.get('campaignId')
    return value || ''
  }, [searchParams])

  useEffect(() => {
    let isMounted = true

    const loadRows = async () => {
      setIsLoading(true)
      setErrorMessage('')

      const [{ rows, error }, { campaigns, error: campaignsError }] = await Promise.all([
        fetchWorkflowListForUser(userProfile?.authUserId),
        fetchCampaignsByUserId(userProfile?.authUserId),
      ])

      if (!isMounted) return

      if (error) {
        console.error('[CampaignWorkflowsPage] failed loading workflows', {
          table: 'workflows/workflow_steps',
          user_id: userProfile?.authUserId || null,
          pathname: window.location.pathname,
          error,
        })
        setRows([])
        setErrorMessage('Unable to load workflows right now.')
        setIsLoading(false)
        return
      }

      if (campaignsError) {
        console.error('[CampaignWorkflowsPage] failed loading campaigns', {
          table: 'campaigns',
          user_id: userProfile?.authUserId || null,
          pathname: window.location.pathname,
          error: campaignsError,
        })
      }

      const nextCampaignOptions = (campaigns || []).map((campaign) => ({
        id: campaign.id,
        name: campaign.name || 'Untitled Campaign',
      }))

      setCampaignOptions(nextCampaignOptions)
      setRows(rows || [])
      setIsLoading(false)
    }

    loadRows()

    return () => {
      isMounted = false
    }
  }, [userProfile?.authUserId, searchParams])

  useEffect(() => {
    if (!isCreateModalOpen) return

    setCreateErrorMessage('')
    setWorkflowNameInput('')

    if (prefilledCampaignIdFromQuery) {
      const exists = campaignOptions.some((campaign) => campaign.id === prefilledCampaignIdFromQuery)
      setSelectedCampaignId(exists ? prefilledCampaignIdFromQuery : '')
      return
    }

    setSelectedCampaignId('')
  }, [isCreateModalOpen, prefilledCampaignIdFromQuery, campaignOptions])

  async function handleCreateWorkflow(event) {
    event?.preventDefault?.()
    if (isCreating) return

    const name = workflowNameInput.trim()
    if (!name) {
      setCreateErrorMessage('Workflow name is required.')
      return
    }

    setIsCreating(true)
    setCreateErrorMessage('')

    const { workflow, error } = await createWorkflowWithDefaultSteps({
      userId: userProfile?.authUserId,
      campaignId: selectedCampaignId || null,
      name,
    })

    if (error || !workflow?.id) {
      console.error('[CampaignWorkflowsPage] failed creating workflow', {
        table: 'workflows/workflow_steps',
        user_id: userProfile?.authUserId || null,
        campaign_id: selectedCampaignId || null,
        error,
      })
      setCreateErrorMessage('Unable to create workflow right now. Please try again.')
      setIsCreating(false)
      return
    }

    setIsCreating(false)
    setIsCreateModalOpen(false)
    navigate(`/campaigns/workflows/${workflow.id}`)
  }

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Workflows" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-slate-50">
            <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
              <header className="mb-6 flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">
                    Workflows
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Design and manage outreach automation across your campaigns.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(true)}
                  className="rounded-lg border border-indigo-200 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  New Workflow
                </button>
              </header>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {errorMessage ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700">
                    {errorMessage}
                  </div>
                ) : isLoading ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-600">
                    Loading workflows...
                  </div>
                ) : rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-600">
                    No workflows yet. Build your first sequence to automate campaign outreach.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-2">Workflow</th>
                          <th className="px-2 py-2">Campaign</th>
                          <th className="px-2 py-2">Status</th>
                          <th className="px-2 py-2">Steps</th>
                          <th className="px-2 py-2">Created</th>
                          <th className="px-2 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                            <td className="px-2 py-3 font-medium text-slate-800">{row.name}</td>
                            <td className="px-2 py-3 text-slate-700">{row.campaignName || '—'}</td>
                            <td className="px-2 py-3">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}>
                                {row.status || 'draft'}
                              </span>
                            </td>
                            <td className="px-2 py-3 text-slate-700">{row.totalSteps || 0}</td>
                            <td className="px-2 py-3 text-slate-600">{formatDate(row.createdAt)}</td>
                            <td className="px-2 py-3">
                              <button
                                type="button"
                                onClick={() => navigate(`/campaigns/workflows/${row.id}`)}
                                className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>
        <AIModalShell
          isOpen={isCreateModalOpen}
          onClose={() => {
            if (isCreating) return
            setIsCreateModalOpen(false)
          }}
          label="Workflow Setup"
          title="Create Workflow"
          description="Choose a workflow name and optionally link it to a campaign before creating a draft."
          maxWidth="max-w-lg"
          footer={(
            <>
              <button
                type="button"
                disabled={isCreating}
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="create-workflow-form"
                disabled={isCreating}
                className="rounded-lg border border-indigo-200 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreating ? 'Creating...' : 'Create Workflow'}
              </button>
            </>
          )}
        >
          <form id="create-workflow-form" onSubmit={handleCreateWorkflow} className="space-y-4">
            <div>
              <label htmlFor="workflow-name" className="mb-1 block text-sm font-medium text-slate-700">
                Workflow Name <span className="text-rose-600">*</span>
              </label>
              <input
                id="workflow-name"
                type="text"
                value={workflowNameInput}
                onChange={(event) => setWorkflowNameInput(event.target.value)}
                placeholder="Enter workflow name"
                autoFocus
                disabled={isCreating}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor="workflow-campaign" className="mb-1 block text-sm font-medium text-slate-700">
                Associated Campaign
              </label>
              <select
                id="workflow-campaign"
                value={selectedCampaignId}
                onChange={(event) => setSelectedCampaignId(event.target.value)}
                disabled={isCreating}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">No Campaign (Standalone)</option>
                {campaignOptions.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>

            {createErrorMessage && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {createErrorMessage}
              </div>
            )}
          </form>
        </AIModalShell>
      </div>
    </div>
  )
}

export default CampaignWorkflowsPage
