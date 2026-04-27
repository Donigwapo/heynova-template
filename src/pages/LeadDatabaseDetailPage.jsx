import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import { fetchLeadListById, fetchLeadListItems } from '../lib/leadDatabaseStore'

function formatDate(dateString) {
  if (!dateString) return '—'
  const parsed = new Date(dateString)
  if (Number.isNaN(parsed.getTime())) return '—'

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusBadgeClass(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'completed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (normalized === 'processing') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function LeadDatabaseDetailPage({ userProfile, onRunCommand = () => {} }) {
  const navigate = useNavigate()
  const { id } = useParams()

  const [row, setRow] = useState(null)
  const [leadItems, setLeadItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadDetail = async () => {
      if (!id) {
        if (!isMounted) return
        setRow(null)
        setLeadItems([])
        setErrorMessage('Lead list not found.')
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setErrorMessage('')

      const [listResult, itemsResult] = await Promise.all([
        fetchLeadListById(id),
        fetchLeadListItems(id),
      ])

      if (!isMounted) return

      if (listResult.error || itemsResult.error) {
        console.error('[LeadDatabaseDetailPage] Failed to load list detail from Supabase', {
          listError: listResult.error,
          itemsError: itemsResult.error,
          routeId: id,
        })
        setRow(null)
        setLeadItems([])
        setErrorMessage('Unable to load this lead list right now.')
        setIsLoading(false)
        return
      }

      setRow(listResult.row || null)
      setLeadItems(itemsResult.rows || [])
      setIsLoading(false)
    }

    loadDetail()

    return () => {
      isMounted = false
    }
  }, [id])

  console.log('[LeadDatabaseDetailPage] route param id', id)

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Lead Database" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-slate-50">
            <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
              <button
                type="button"
                onClick={() => navigate('/campaigns/lead-database')}
                className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <ArrowLeft size={14} />
                Back to My Files
              </button>

              {isLoading ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h1 className="text-xl font-semibold text-slate-900">Loading lead list...</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Fetching list details and lead items.
                  </p>
                </section>
              ) : errorMessage ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                  <h1 className="text-xl font-semibold text-amber-800">Lead list not found.</h1>
                  <p className="mt-1 text-sm text-amber-700">{errorMessage}</p>
                </section>
              ) : !row ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h1 className="text-xl font-semibold text-slate-900">Lead list not found.</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    This lead list may have been deleted or is unavailable.
                  </p>
                </section>
              ) : (
                <>
                  <header className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{row.name}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span>Date Created: {formatDate(row.createdAt)}</span>
                      <span className="text-slate-300">•</span>
                      <span>Leads Count: {row.leadsCount ?? 0}</span>
                      <span className="text-slate-300">•</span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                          row.status
                        )}`}
                      >
                        {row.status || '—'}
                      </span>
                    </div>
                  </header>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-2 py-2">Name</th>
                            <th className="px-2 py-2">Job Title</th>
                            <th className="px-2 py-2">Company</th>
                            <th className="px-2 py-2">Location</th>
                            <th className="px-2 py-2">Summary</th>
                            <th className="px-2 py-2">Status</th>
                            <th className="px-2 py-2">LinkedIn</th>
                          </tr>
                        </thead>

                        <tbody>
                          {(Array.isArray(leadItems) ? leadItems : []).map((lead) => (
                            <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                              <td className="px-2 py-3 font-medium text-slate-800">{lead.fullName || '—'}</td>
                              <td className="px-2 py-3 text-slate-700">{lead.jobTitle || '—'}</td>
                              <td className="px-2 py-3 text-slate-700">{lead.companyName || '—'}</td>
                              <td className="px-2 py-3 text-slate-700">{lead.location || '—'}</td>
                              <td className="max-w-[20rem] px-2 py-3 text-slate-600">
                                <p className="line-clamp-2">{lead.profileSummary || 'No summary available'}</p>
                              </td>
                              <td className="px-2 py-3">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                                    lead.status
                                  )}`}
                                >
                                  {lead.status || '—'}
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
                          ))}
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

export default LeadDatabaseDetailPage
