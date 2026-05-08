import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import { fetchCampaignsWithMetrics } from '../lib/campaignsService'

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
  if (normalized === 'completed') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function CampaignManagerPage({ userProfile, onRunCommand = () => {} }) {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadCampaigns = async () => {
      setIsLoading(true)
      setErrorMessage('')

      const { rows, error } = await fetchCampaignsWithMetrics(userProfile?.authUserId)
      if (!isMounted) return

      if (error) {
        console.error('[CampaignManagerPage] Unable to load campaigns', {
          table: 'campaigns/campaign_leads',
          user_id: userProfile?.authUserId || null,
          pathname: window.location.pathname,
          error,
        })
        setCampaigns([])
        setErrorMessage('Unable to load campaign data right now.')
        setIsLoading(false)
        return
      }

      setCampaigns(rows || [])
      setIsLoading(false)
    }

    loadCampaigns()

    return () => {
      isMounted = false
    }
  }, [userProfile?.authUserId])

  const totals = useMemo(() => {
    return (campaigns || []).reduce(
      (acc, row) => {
        acc.campaigns += 1
        acc.totalLeads += row.totalLeads || 0
        acc.contacted += row.contactedLeads || 0
        acc.replied += row.repliedLeads || 0
        acc.converted += row.convertedLeads || 0
        return acc
      },
      {
        campaigns: 0,
        totalLeads: 0,
        contacted: 0,
        replied: 0,
        converted: 0,
      }
    )
  }, [campaigns])

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Campaign Manager" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-slate-50">
            <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
              <header className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">
                  Campaign Manager
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Track your campaigns, leads, and performance.
                </p>
              </header>

              <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Campaigns</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{totals.campaigns}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Leads</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{totals.totalLeads}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Contacted</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{totals.contacted}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Replied</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{totals.replied}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Converted</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{totals.converted}</p>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {errorMessage ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700">
                    {errorMessage}
                  </div>
                ) : isLoading ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-600">
                    Loading campaigns...
                  </div>
                ) : campaigns.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-600">
                    No campaigns yet. Add leads to a campaign from Lead Database to get started.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-2">Campaign</th>
                          <th className="px-2 py-2">Status</th>
                          <th className="px-2 py-2">Total</th>
                          <th className="px-2 py-2">New</th>
                          <th className="px-2 py-2">Contacted</th>
                          <th className="px-2 py-2">Replied</th>
                          <th className="px-2 py-2">Converted</th>
                          <th className="px-2 py-2">Created</th>
                          <th className="px-2 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map((campaign) => (
                          <tr key={campaign.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                            <td className="px-2 py-3 font-medium text-slate-800">{campaign.name || 'Untitled Campaign'}</td>
                            <td className="px-2 py-3">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                                  campaign.status
                                )}`}
                              >
                                {campaign.status || 'Active'}
                              </span>
                            </td>
                            <td className="px-2 py-3 text-slate-700">{campaign.totalLeads || 0}</td>
                            <td className="px-2 py-3 text-slate-700">{campaign.newLeads || 0}</td>
                            <td className="px-2 py-3 text-slate-700">{campaign.contactedLeads || 0}</td>
                            <td className="px-2 py-3 text-slate-700">{campaign.repliedLeads || 0}</td>
                            <td className="px-2 py-3 text-slate-700">{campaign.convertedLeads || 0}</td>
                            <td className="px-2 py-3 text-slate-600">{formatDate(campaign.createdAt)}</td>
                            <td className="px-2 py-3">
                              <button
                                type="button"
                                onClick={() => navigate(`/campaigns/manager/${campaign.id}`)}
                                className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                              >
                                View
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
      </div>
    </div>
  )
}

export default CampaignManagerPage
