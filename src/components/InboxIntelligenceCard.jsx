const DISPLAY_TAGS = [
  'Needs Reply',
  'Follow-Up Required',
  'High Priority',
  'Opportunity',
  'At Risk',
  'Meeting Related',
  'Low Priority',
  'Newsletter',
]

function InboxIntelligenceCard({
  counts,
  attentionCount,
  isLoading,
  onTagClick = () => {},
}) {
  if (isLoading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-[17px] font-semibold text-slate-900">Inbox Intelligence</h2>
          <p className="mt-1 text-sm text-slate-500">Loading Gmail intelligence…</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {DISPLAY_TAGS.map((tag) => (
            <div
              key={tag}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
            >
              <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-5 w-10 animate-pulse rounded bg-slate-300" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md">
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold text-slate-900">Inbox Intelligence</h2>
        <p className="mt-1 text-sm text-slate-500">
          You have {attentionCount} email{attentionCount === 1 ? '' : 's'} that need attention
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {DISPLAY_TAGS.map((tag) => {
          const count = counts?.[tag] || 0

          return (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick(tag)}
              className="group rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition-all duration-150 hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 transition-colors duration-150 group-hover:text-slate-600">
                {tag}
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{count}</p>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default InboxIntelligenceCard
