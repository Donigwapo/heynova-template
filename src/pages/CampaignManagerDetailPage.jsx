import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import { fetchCampaignDetailById } from '../lib/campaignsService'

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
  if (normalized === 'converted') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (normalized === 'replied') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  if (normalized === 'contacted') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function CampaignManagerDetailPage({ userProfile, onRunCommand = () => {} }) {
  const navigate = useNavigate()
  const { campaignId } = useParams()

  const [campaign, setCampaign] = useState(null)
  const [leads, setLeads] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadDetail = async () => {
      setIsLoading(true)
      setErrorMessage('')

      const { campaign, leads, error } = await fetchCampaignDetailById({
        campaignId,
        userId: userProfile?.authUserId,
      })

      if (!isMounted) return

      if (error) {
        setCampaign(null)
        setLeads([])
        setErrorMessage('Unable to load this campaign right now.')
        setIsLoading(false)
        return
      }

      setCampaign(campaign || null)
      setLeads(leads || [])
      setIsLoading(false)
    }

    loadDetail()

    return () => {
      isMounted = false
    }
  }, [campaignId, userProfile?.authUserId])

  const metrics = useMemo(() => {
    const summary = {
      total: leads.length,
      newCount: 0,
      contacted: 0,
      replied: 0,
      converted: 0,
    }

    leads.forEach((lead) => {
      const normalized = String(lead.status || 'new').toLowerCase()
      if (normalized === 'contacted') summary.contacted += 1
      else if (normalized === 'replied') summary.replied += 1
      else if (normalized === 'converted') summary.converted += 1
      else summary.newCount += 1
    })

    return summary
  }, [leads])

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
              <button
                type="button"
                onClick={() => navigate('/campaigns/manager')}
                className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <ArrowLeft size={14} />
                Back to Campaign Manager
              </button>

              {errorMessage ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                  <h1 className="text-xl font-semibold text-amber-800">Campaign unavailable</h1>
                  <p className="mt-1 text-sm text-amber-700">{errorMessage}</p>
                </section>
              ) : isLoading ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h1 className="text-xl font-semibold text-slate-900">Loading campaign...</h1>
                  <p className="mt-1 text-sm text-slate-500">Fetching campaign details and leads.</p>
                </section>
              ) : !campaign ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h1 className="text-xl font-semibold text-slate-900">Campaign not found</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    This campaign may have been deleted or is unavailable.
                  </p>
                </section>
              ) : (
                <>
                  <header className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{campaign.name || 'Untitled Campaign'}</h1>
                    <p className="mt-1 text-sm text-slate-500">Created {formatDate(campaign.createdAt)}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">Total: {metrics.total}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">New: {metrics.newCount}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">Contacted: {metrics.contacted}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">Replied: {metrics.replied}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">Converted: {metrics.converted}</span>
                    </div>
                  </header>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-2 py-2">Name</th>
                            <th className="px-2 py-2">Title</th>
                            <th className="px-2 py-2">Company</th>
                            <th className="px-2 py-2">Email</th>
                            <th className="px-2 py-2">Phone</th>
                            <th className="px-2 py-2">Status</th>
                            <th className="px-2 py-2">LinkedIn</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leads.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-2 py-6 text-center text-sm text-slate-500">
                                No leads in this campaign yet.
                              </td>
                            </tr>
                          ) : (
                            leads.map((lead) => (
                              <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                                <td className="px-2 py-3 font-medium text-slate-800">{lead.fullName || '—'}</td>
                                <td className="px-2 py-3 text-slate-700">{lead.jobTitle || '—'}</td>
                                <td className="px-2 py-3 text-slate-700">{lead.companyName || '—'}</td>
                                <td className="px-2 py-3 text-slate-700">{lead.email || '—'}</td>
                                <td className="px-2 py-3 text-slate-700">{lead.phone || '—'}</td>
                                <td className="px-2 py-3">
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(lead.status)}`}>
                                    {lead.status || 'new'}
                                  </span>
                                </td>
                                <td className="px-2 py-3">
                                  {lead.linkedinUrl ? (
                                    <a
                                      href={lead.linkedinUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      View Profile
                                    </a>
                                  ) : (
                                    <span className="text-xs text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default CampaignManagerDetailPage
