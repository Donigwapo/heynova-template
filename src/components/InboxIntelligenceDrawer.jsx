import { X } from 'lucide-react'

function formatTimestamp(value) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function InboxIntelligenceDrawer({
  isOpen,
  selectedTag,
  emails = [],
  onClose = () => {},
}) {
  if (!isOpen) return null

  const filteredEmails = emails.filter((email) =>
    Array.isArray(email?.tags) ? email.tags.includes(selectedTag) : false
  )

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close Inbox Intelligence drawer"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30"
      />

      <aside className="absolute right-0 top-0 h-full w-full max-w-xl border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-slate-900">{selectedTag || 'Inbox Intelligence'}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {filteredEmails.length} email{filteredEmails.length === 1 ? '' : 's'} in this category
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-all duration-150 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-auto p-4">
            {filteredEmails.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                No emails in this category right now.
              </div>
            )}

            {filteredEmails.map((email) => {
              const fromName = email?.fromName || null
              const fromEmail = email?.fromEmail || null
              const senderPrimary = fromName || fromEmail || 'Unknown sender'
              const subject = email?.subject || 'No subject'
              const snippet = email?.snippet || email?.reason || 'No preview available.'

              return (
                <article
                  key={email.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{senderPrimary}</p>
                      {fromName && fromEmail && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{fromEmail}</p>
                      )}
                    </div>
                    <p className="whitespace-nowrap text-xs text-slate-500">
                      {formatTimestamp(email?.internalDate || null)}
                    </p>
                  </div>

                  <h3 className="mt-2 text-sm font-semibold text-slate-900">{subject}</h3>
                  <p className="mt-1 text-sm text-slate-600">{snippet}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {Array.isArray(email?.tags) && email.tags.map((tag) => (
                      <span
                        key={`${email.id}-${tag}`}
                        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}

                    <span className="text-xs text-slate-500">
                      Confidence: {typeof email?.confidence === 'number' ? email.confidence.toFixed(2) : '—'}
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </aside>
    </div>
  )
}

export default InboxIntelligenceDrawer
