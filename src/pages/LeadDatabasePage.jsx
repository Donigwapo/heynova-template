import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import { fetchLeadLists } from '../lib/leadDatabaseStore'

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

function LeadDatabasePage({ userProfile, onRunCommand = () => {} }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState([])
  const [isLoadingRows, setIsLoadingRows] = useState(true)
  const [rowsError, setRowsError] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadRows = async () => {
      setIsLoadingRows(true)
      setRowsError('')

      const { rows: dataRows, error } = await fetchLeadLists()
      if (!isMounted) return

      if (error) {
        console.error('[LeadDatabasePage] Unable to load lead lists from Supabase', error)
        setRows([])
        setRowsError('Unable to load your saved lead lists right now.')
        setIsLoadingRows(false)
        return
      }

      setRows(dataRows || [])
      setIsLoadingRows(false)
    }

    loadRows()

    return () => {
      isMounted = false
    }
  }, [])

  const visibleRows = useMemo(() => {
    if (!query.trim()) return rows

    const q = query.toLowerCase()
    return rows.filter((row) =>
      [row.name, row.status, String(row.leadsCount)].join(' ').toLowerCase().includes(q)
    )
  }, [rows, query])

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
              <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">
                    My Files
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Manage and download your exported lead lists.
                  </p>
                </div>

                <div className="relative w-full sm:max-w-xs">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search files..."
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400"
                  />
                </div>
              </header>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {rowsError ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700">
                    {rowsError}
                  </div>
                ) : isLoadingRows ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-600">
                    Loading lead lists...
                  </div>
                ) : visibleRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-600">
                    No lead lists found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-2">File Name</th>
                          <th className="px-2 py-2">Date Created</th>
                          <th className="px-2 py-2">Leads Count</th>
                          <th className="px-2 py-2">Status</th>
                          <th className="px-2 py-2">Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {visibleRows.map((row) => (
                          <tr
                            key={row.id}
                            onClick={() => {
                              console.log('[LeadDatabasePage] clicked row id', row.id)
                              navigate(`/campaigns/lead-database/${row.id}`)
                            }}
                            className="cursor-pointer border-b border-slate-100 transition-all duration-150 hover:bg-slate-50/80"
                          >
                            <td className="px-2 py-3 font-medium text-slate-800">{row.name}</td>
                            <td className="px-2 py-3 text-slate-600">{formatDate(row.createdAt)}</td>
                            <td className="px-2 py-3 text-slate-700">{row.leadsCount ?? 0}</td>
                            <td className="px-2 py-3">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                                  row.status
                                )}`}
                              >
                                {row.status || '—'}
                              </span>
                            </td>
                            <td className="px-2 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => event.stopPropagation()}
                                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Export CSV
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => event.stopPropagation()}
                                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                                >
                                  Add to Campaign
                                </button>
                              </div>
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

export default LeadDatabasePage
