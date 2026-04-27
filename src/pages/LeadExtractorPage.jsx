import { LayoutGrid, List, RefreshCcw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopHeader from '../components/TopHeader'
import { createLeadListWithItems } from '../lib/leadDatabaseStore'
import { supabase } from '../lib/supabase'

const LINKEDIN_SEARCH_PROXY_FUNCTION =
  import.meta.env.VITE_SUPABASE_LINKEDIN_SEARCH_PROXY_FUNCTION || 'linkedin-search-proxy'

const companyHeadcountOptions = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+']
const industryOptions = ['Technology', 'Healthcare', 'Finance', 'Professional Services', 'Retail', 'Manufacturing']

const defaultFilters = {
  jobTitleInput: '',
  jobTitles: ['CEO', 'Founder', 'COO'],
  companyHeadcount: '',
  industry: '',
  location: '',
  keywords: '',
}

function normalizeLead(raw, index) {
  const firstName = typeof raw?.first_name === 'string' ? raw.first_name.trim() : ''
  const lastName = typeof raw?.last_name === 'string' ? raw.last_name.trim() : ''
  const fullNameFromParts = [firstName, lastName].filter(Boolean).join(' ').trim()
  const fullName =
    (typeof raw?.full_name === 'string' && raw.full_name.trim()) || fullNameFromParts || 'Unknown Lead'

  const linkedinUrl =
    typeof raw?.linkedin_profile_url === 'string' && raw.linkedin_profile_url.trim()
      ? raw.linkedin_profile_url.trim()
      : null

  return {
    id: linkedinUrl || `${fullName.replace(/\s+/g, '-').toLowerCase()}-${index}`,
    linkedinUrl,
    fullName,
    firstName: firstName || null,
    lastName: lastName || null,
    jobTitle:
      typeof raw?.job_title === 'string' && raw.job_title.trim() ? raw.job_title.trim() : '—',
    companyName:
      typeof raw?.company_name === 'string' && raw.company_name.trim() ? raw.company_name.trim() : '—',
    location: typeof raw?.location === 'string' && raw.location.trim() ? raw.location.trim() : '—',
    profileSummary:
      typeof raw?.profile_summary === 'string' && raw.profile_summary.trim()
        ? raw.profile_summary.trim()
        : 'No summary available',
    status: typeof raw?.status === 'string' && raw.status.trim() ? raw.status.trim() : '—',
    _index: index,
  }
}

function parseLeadSearchResults(responseData) {
  if (Array.isArray(responseData)) {
    const leads = responseData?.[0]?.results
    return Array.isArray(leads) ? leads : []
  }

  if (responseData && typeof responseData === 'object') {
    if (Array.isArray(responseData.results)) {
      return responseData.results
    }

    if (Array.isArray(responseData.data)) {
      const nestedLeads = responseData?.data?.[0]?.results
      return Array.isArray(nestedLeads) ? nestedLeads : []
    }
  }

  return []
}

function statusBadgeClass(status) {
  const normalized = String(status || '—').toLowerCase()
  if (normalized.includes('qualified') || normalized.includes('ready')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  if (normalized.includes('partial') || normalized.includes('research')) {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  if (normalized.includes('new') || normalized === '—') {
    return 'border-slate-200 bg-slate-50 text-slate-600'
  }
  return 'border-indigo-200 bg-indigo-50 text-indigo-700'
}

function initialsFromName(name) {
  if (!name || name === 'Unknown Lead') return 'UL'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')
}

function ChipInput({
  label,
  placeholder,
  chips,
  inputValue,
  onInputChange,
  onAddChip,
  onRemoveChip,
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-all duration-150 focus-within:border-slate-300 focus-within:ring-2 focus-within:ring-slate-100">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
            >
              {chip}
              <button
                type="button"
                onClick={() => onRemoveChip(chip)}
                className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label={`Remove ${chip}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}

          <input
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                onAddChip()
              }
            }}
            onBlur={() => onAddChip()}
            placeholder={placeholder}
            className="min-w-[12rem] flex-1 border-none bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      </div>
    </div>
  )
}

function FilterCard({ children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">{children}</section>
}

function LeadExtractorPage({ userProfile, onRunCommand = () => {} }) {
  const navigate = useNavigate()
  const [filters, setFilters] = useState(defaultFilters)
  const [hasSearched, setHasSearched] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState([])

  const [selectedLeadIds, setSelectedLeadIds] = useState([])
  const [selectedLead, setSelectedLead] = useState(null)
  const [isLeadPanelOpen, setIsLeadPanelOpen] = useState(false)

  const [resultSearchQuery, setResultSearchQuery] = useState('')
  const [resultSort, setResultSort] = useState('Relevance')
  const [resultView, setResultView] = useState('table')

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [saveSearchName, setSaveSearchName] = useState('')
  const [saveSearchNotes, setSaveSearchNotes] = useState('')

  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false)
  const [campaignName, setCampaignName] = useState('Q2 Outreach Sprint')

  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportListName, setExportListName] = useState('')
  const [exportValidationMessage, setExportValidationMessage] = useState('')
  const [leadLimit, setLeadLimit] = useState(25)

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleAddJobTitle = () => {
    const next = filters.jobTitleInput.trim()
    if (!next) return

    setFilters((prev) => {
      if (prev.jobTitles.some((item) => item.toLowerCase() === next.toLowerCase())) {
        return { ...prev, jobTitleInput: '' }
      }

      return {
        ...prev,
        jobTitles: [...prev.jobTitles, next],
        jobTitleInput: '',
      }
    })
  }

  const resetFilters = () => {
    setFilters(defaultFilters)
    setLeadLimit(25)
    setResults([])
    setHasSearched(false)
    setSelectedLeadIds([])
    setResultSearchQuery('')
    setResultSort('Relevance')
  }

  const handleSearch = async (event) => {
    if (event) event.preventDefault()
    if (isSearching) return

    setHasSearched(true)
    setIsSearching(true)

    const payload = {
      jobTitles: filters.jobTitles,
      industry: filters.industry,
      companyHeadcount: filters.companyHeadcount,
      location: filters.location,
      keywords: filters.keywords,
      limit: leadLimit,
    }

    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        LINKEDIN_SEARCH_PROXY_FUNCTION,
        {
          body: payload,
        }
      )

      console.log('[Lead Extractor] Search response payload', data)

      if (invokeError || !data?.success) {
        throw new Error(
          data?.message || invokeError?.message || 'Unable to send search request right now.'
        )
      }

      const responseData = data?.data
      const leads = parseLeadSearchResults(responseData)

      const normalized = leads
        .map((lead, index) => normalizeLead(lead, index))
        .filter((lead) => lead && lead.id)

      setResults(normalized)
      setSelectedLeadIds([])
      setSelectedLead(null)
      setIsLeadPanelOpen(false)
    } catch (error) {
      console.error('[Lead Extractor] Search request failed', error)
      setResults([])
      setSelectedLeadIds([])
      setSelectedLead(null)
      setIsLeadPanelOpen(false)
    } finally {
      setIsSearching(false)
    }
  }

  const activeFilterChips = useMemo(() => {
    const chips = []

    filters.jobTitles.forEach((title) => chips.push({ key: `jobTitle:${title}`, label: `Job Title: ${title}` }))

    if (filters.companyHeadcount)
      chips.push({ key: 'companyHeadcount', label: `Headcount: ${filters.companyHeadcount}` })
    if (filters.industry.trim()) chips.push({ key: 'industry', label: `Industry: ${filters.industry}` })
    if (filters.location.trim()) chips.push({ key: 'location', label: `Location: ${filters.location}` })
    if (filters.keywords.trim()) chips.push({ key: 'keywords', label: `Keywords: ${filters.keywords}` })

    return chips
  }, [filters])

  const removeFilterChip = (chipKey) => {
    if (chipKey.startsWith('jobTitle:')) {
      const value = chipKey.replace('jobTitle:', '')
      setFilters((prev) => ({
        ...prev,
        jobTitles: prev.jobTitles.filter((item) => item !== value),
      }))
      return
    }

    setFilters((prev) => ({
      ...prev,
      [chipKey]: typeof prev[chipKey] === 'boolean' ? false : '',
    }))
  }

  const visibleResults = useMemo(() => {
    let scoped = results

    if (resultSearchQuery.trim()) {
      const q = resultSearchQuery.toLowerCase()
      scoped = scoped.filter((row) =>
        [row.fullName, row.jobTitle, row.companyName, row.location, row.profileSummary]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
    }

    if (resultSort === 'Name A-Z') {
      return [...scoped].sort((a, b) => a.fullName.localeCompare(b.fullName))
    }

    if (resultSort === 'Recently Added') {
      return [...scoped].sort((a, b) => b._index - a._index)
    }

    return scoped
  }, [results, resultSearchQuery, resultSort])

  const allSelected = visibleResults.length > 0 && selectedLeadIds.length === visibleResults.length

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedLeadIds([])
    } else {
      setSelectedLeadIds(visibleResults.map((row) => row.id))
    }
  }

  const toggleRowSelection = (rowId) => {
    setSelectedLeadIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]
    )
  }

  const openLeadPanel = (lead) => {
    setSelectedLead(lead)
    setIsLeadPanelOpen(true)
  }

  const closeLeadPanel = () => {
    setIsLeadPanelOpen(false)
  }

  const openExportModal = () => {
    setExportValidationMessage('')
    setExportListName(exportListName || `Lead List ${new Date().toLocaleDateString()}`)
    setIsExportModalOpen(true)
  }

  const handleSaveAndViewDatabase = async () => {
    const trimmedName = exportListName.trim()

    if (!trimmedName) {
      setExportValidationMessage('List Name is required.')
      return
    }

    const selectedSet = new Set(selectedLeadIds)
    const leadsForList =
      selectedLeadIds.length > 0
        ? visibleResults.filter((lead) => selectedSet.has(lead.id))
        : visibleResults

    const { id, error } = await createLeadListWithItems({
      name: trimmedName,
      leads: leadsForList,
      status: 'Completed',
    })

    if (error || !id) {
      console.error('[Lead Extractor] Failed to persist lead list to Supabase', error)
      setExportValidationMessage('Unable to save this list right now. Please try again.')
      return
    }

    setIsExportModalOpen(false)
    setExportValidationMessage('')
    navigate('/campaigns/lead-database')
  }

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="flex h-full flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white lg:h-full lg:w-64 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar activeItem="Lead Extractor" userProfile={userProfile} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <TopHeader onRunCommand={onRunCommand} userProfile={userProfile} />

          <main className="flex-1 overflow-auto bg-slate-50">
            <div className="w-full px-4 py-4 lg:px-6 lg:py-6">
              <header className="mb-5">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">
                  Lead Extractor
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Find and organize targeted leads using advanced people filters.
                </p>
              </header>

              <section className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
                <div className="flex flex-col gap-4">
                  <FilterCard>
                    <p className="mb-3 text-sm text-slate-500">
                      Describe who you're looking for. You can keep this simple.
                    </p>

                    <div className="space-y-4">
                      <ChipInput
                        label="Job Title"
                        placeholder="e.g. CEO, Founder, Realtor"
                        chips={filters.jobTitles}
                        inputValue={filters.jobTitleInput}
                        onInputChange={(value) => updateFilter('jobTitleInput', value)}
                        onAddChip={handleAddJobTitle}
                        onRemoveChip={(chip) =>
                          setFilters((prev) => ({
                            ...prev,
                            jobTitles: prev.jobTitles.filter((item) => item !== chip),
                          }))
                        }
                      />

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Industry
                        </label>
                        <select
                          value={filters.industry}
                          onChange={(event) => updateFilter('industry', event.target.value)}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm transition-all duration-150 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-100"
                        >
                          <option value="">Select industry</option>
                          {industryOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Company Headcount
                        </label>
                        <select
                          value={filters.companyHeadcount}
                          onChange={(event) => updateFilter('companyHeadcount', event.target.value)}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm transition-all duration-150 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-100"
                        >
                          <option value="">Select headcount</option>
                          {companyHeadcountOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Location
                        </label>
                        <input
                          value={filters.location}
                          onChange={(event) => updateFilter('location', event.target.value)}
                          placeholder="City, region, or country"
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm transition-all duration-150 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Number of Leads
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={leadLimit}
                          onChange={(event) => {
                            const parsed = Number(event.target.value)
                            if (!Number.isFinite(parsed)) {
                              setLeadLimit(25)
                              return
                            }
                            const clamped = Math.min(500, Math.max(1, parsed))
                            setLeadLimit(clamped)
                          }}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm transition-all duration-150 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Keywords (optional)
                        </label>
                        <input
                          value={filters.keywords}
                          onChange={(event) => updateFilter('keywords', event.target.value)}
                          placeholder="e.g. SaaS, real estate, growth"
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm transition-all duration-150 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-100"
                        />
                      </div>
                    </div>
                  </FilterCard>

                  <div className="sticky bottom-0 z-10 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                    <p className="mb-2 text-xs text-slate-500">
                      {activeFilterChips.length} active filter{activeFilterChips.length === 1 ? '' : 's'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50"
                      >
                        <RefreshCcw size={14} />
                        Reset Filters
                      </button>

                      <button
                        type="button"
                        onClick={handleSearch}
                        disabled={isSearching}
                        className="h-10 rounded-xl border border-indigo-200 bg-indigo-600 px-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSearching ? 'Searching...' : 'Search'}
                      </button>
                    </div>
                  </div>
                </div>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Active Filters
                    </p>

                    {activeFilterChips.length === 0 ? (
                      <p className="mt-1 text-sm text-slate-500">No active filters yet.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {activeFilterChips.map((chip) => (
                          <span
                            key={chip.key}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                          >
                            {chip.label}
                            <button
                              type="button"
                              onClick={() => removeFilterChip(chip.key)}
                              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                              aria-label={`Remove ${chip.label}`}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mb-3 flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Matching Leads</h2>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {hasSearched
                          ? `${visibleResults.length} leads found`
                          : 'Set your filters and run a search to preview matching leads.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={openExportModal}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50"
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsSaveModalOpen(true)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50"
                      >
                        Save Search
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCampaignModalOpen(true)}
                        className="rounded-xl border border-indigo-200 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-all duration-150 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={selectedLeadIds.length === 0}
                      >
                        Add to Campaign ({selectedLeadIds.length})
                      </button>
                    </div>
                  </div>

                  <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative flex-1 sm:max-w-sm">
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        value={resultSearchQuery}
                        onChange={(event) => setResultSearchQuery(event.target.value)}
                        placeholder="Filter results"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={resultSort}
                        onChange={(event) => setResultSort(event.target.value)}
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
                      >
                        <option>Relevance</option>
                        <option>Name A-Z</option>
                        <option>Recently Added</option>
                      </select>

                      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                        <button
                          type="button"
                          onClick={() => setResultView('table')}
                          className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium ${
                            resultView === 'table'
                              ? 'bg-slate-100 text-slate-900'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <List size={14} />
                          Table
                        </button>
                        <button
                          type="button"
                          onClick={() => setResultView('cards')}
                          className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium ${
                            resultView === 'cards'
                              ? 'bg-slate-100 text-slate-900'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <LayoutGrid size={14} />
                          Cards
                        </button>
                      </div>
                    </div>
                  </div>

                  {!hasSearched && (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
                      Set your filters and run a search to preview matching leads.
                    </div>
                  )}

                  {hasSearched && isSearching && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
                      Running lead search...
                    </div>
                  )}

                  {hasSearched && !isSearching && visibleResults.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
                      No matching leads found.
                    </div>
                  )}

                  {hasSearched && !isSearching && visibleResults.length > 0 && resultView === 'table' && (
                    <div className="hidden overflow-x-auto lg:block">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={toggleSelectAll}
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                              />
                            </th>
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
                          {visibleResults.map((row) => {
                            const isSelected = selectedLeadIds.includes(row.id)

                            return (
                              <tr
                                key={row.id}
                                onClick={() => openLeadPanel(row)}
                                className={`cursor-pointer border-b border-slate-100 transition-all duration-150 ${
                                  isSelected ? 'bg-indigo-50/60' : 'hover:bg-slate-50/80'
                                }`}
                              >
                                <td className="px-2 py-3">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={() => toggleRowSelection(row.id)}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                                  />
                                </td>
                                <td className="px-2 py-3 font-medium text-slate-800">{row.fullName || '—'}</td>
                                <td className="px-2 py-3 text-slate-700">{row.jobTitle || '—'}</td>
                                <td className="px-2 py-3 text-slate-700">{row.companyName || '—'}</td>
                                <td className="px-2 py-3 text-slate-600">{row.location || '—'}</td>
                                <td className="px-2 py-3 text-slate-600">
                                  <p className="line-clamp-2 max-w-[22rem]">{row.profileSummary || 'No summary available'}</p>
                                </td>
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
                                  {row.linkedinUrl ? (
                                    <a
                                      href={row.linkedinUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50"
                                    >
                                      View Profile
                                    </a>
                                  ) : (
                                    <span className="text-xs text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {hasSearched && !isSearching && visibleResults.length > 0 && (
                    <div className={`space-y-3 ${resultView === 'table' ? 'lg:hidden' : ''}`}>
                      {visibleResults.map((row) => {
                        const isSelected = selectedLeadIds.includes(row.id)

                        return (
                          <div
                            key={row.id}
                            onClick={() => openLeadPanel(row)}
                            className={`cursor-pointer rounded-xl border p-3 transition-all duration-150 ${
                              isSelected ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200 bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 items-start gap-2">
                                <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                                  {initialsFromName(row.fullName)}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-900">{row.fullName || '—'}</p>
                                  <p className="truncate text-xs text-slate-600">{row.jobTitle || '—'}</p>
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleRowSelection(row.id)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                              />
                            </div>

                            <p className="mt-2 text-sm text-slate-700">{row.companyName || '—'}</p>
                            <p className="text-xs text-slate-500">{row.location || '—'}</p>
                            <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                              {row.profileSummary || 'No summary available'}
                            </p>

                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                                  row.status
                                )}`}
                              >
                                {row.status || '—'}
                              </span>

                              <div className="flex items-center gap-2">
                                {row.linkedinUrl ? (
                                  <a
                                    href={row.linkedinUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50"
                                  >
                                    View Profile
                                  </a>
                                ) : (
                                  <span className="text-xs text-slate-400">No Profile</span>
                                )}
                                <button
                                  type="button"
                                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                                >
                                  Add to Campaign
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              </section>
            </div>
          </main>
        </div>
      </div>

      {isLeadPanelOpen && selectedLead && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 p-0"
          onClick={closeLeadPanel}
        >
          <aside
            className="h-full w-full max-w-md border-l border-slate-200 bg-white p-4 shadow-2xl transition-all duration-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lead Details</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{selectedLead.fullName || '—'}</h3>
              </div>

              <button
                type="button"
                onClick={closeLeadPanel}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                  {initialsFromName(selectedLead.fullName)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{selectedLead.fullName || '—'}</p>
                  <p className="mt-0.5 text-sm text-slate-700">{selectedLead.jobTitle || '—'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{selectedLead.companyName || '—'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{selectedLead.location || '—'}</p>
                </div>
              </div>

              <div className="mt-3">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(selectedLead.status)}`}>
                  {selectedLead.status || '—'}
                </span>
              </div>

              <div className="mt-3">
                {selectedLead.linkedinUrl ? (
                  <a
                    href={selectedLead.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    View LinkedIn Profile
                  </a>
                ) : (
                  <span className="text-sm text-slate-500">LinkedIn profile unavailable</span>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profile Summary</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                {selectedLead.profileSummary || 'No summary available'}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => setIsCampaignModalOpen(true)}
                className="rounded-xl border border-indigo-200 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Add to Campaign
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Save Lead
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Mark Reviewed
              </button>
            </div>
          </aside>
        </div>
      )}

      {isExportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
          onClick={() => setIsExportModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">Export Leads</h3>
            <p className="mt-1 text-sm text-slate-500">
              Save this lead set to your Lead Database.
            </p>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                List Name
              </label>
              <input
                value={exportListName}
                onChange={(event) => {
                  setExportListName(event.target.value)
                  if (exportValidationMessage) setExportValidationMessage('')
                }}
                placeholder="SaaS companies Sweden"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400"
              />
              {exportValidationMessage && (
                <p className="mt-1 text-xs text-rose-600">{exportValidationMessage}</p>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAndViewDatabase}
                className="rounded-xl border border-indigo-200 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Save & View in Database
              </button>
            </div>
          </div>
        </div>
      )}

      {isSaveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
          onClick={() => setIsSaveModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">Save Search</h3>
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Search Name
                </label>
                <input
                  value={saveSearchName}
                  onChange={(event) => setSaveSearchName(event.target.value)}
                  placeholder="e.g. US SaaS C-Level"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Notes (Optional)
                </label>
                <textarea
                  rows={3}
                  value={saveSearchNotes}
                  onChange={(event) => setSaveSearchNotes(event.target.value)}
                  placeholder="Add context for this saved search..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="rounded-xl border border-indigo-200 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Save Search
              </button>
            </div>
          </div>
        </div>
      )}

      {isCampaignModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
          onClick={() => setIsCampaignModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">Add to Campaign</h3>
            <p className="mt-1 text-sm text-slate-500">
              {selectedLeadIds.length} selected lead{selectedLeadIds.length === 1 ? '' : 's'} will be added.
            </p>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Campaign Name
              </label>
              <input
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder="Choose or enter campaign name"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
              />
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Leads will be staged for campaign workflows in a future release.
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCampaignModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setIsCampaignModalOpen(false)}
                className="rounded-xl border border-indigo-200 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Add Leads
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LeadExtractorPage
