import { CalendarDays, Mail, Phone, Sparkles, X } from 'lucide-react'

function ContactDetailsDrawer({
  isOpen,
  contact,
  onClose,
  onDraftFollowUp,
  onSummarizeMeeting,
  onScheduleCheckIn,
}) {
  if (!contact) return null

  return (
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-[70] transition-all duration-300 ease-out ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      <button
        type="button"
        aria-label="Close contact details"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/30 transition-opacity duration-300 ease-out ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-md border-l border-slate-200 bg-white shadow-2xl transition-all duration-300 ease-out ${
          isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-95'
        }`}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-600">
                Contact Overview
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
                {contact.name}
              </h3>
              <p className="mt-0.5 text-sm text-slate-600">{contact.company}</p>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-all duration-150 hover:bg-slate-50 hover:text-slate-700 active:scale-95"
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${contact.statusClassName}`}
                >
                  {contact.status}
                </span>
                <span className="text-xs font-medium text-slate-500">
                  Last contacted {contact.lastContacted}
                </span>
              </div>

              <dl className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Mail size={14} className="text-slate-400" />
                  <span>{contact.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Phone size={14} className="text-slate-400" />
                  <span>{contact.phone}</span>
                </div>
              </dl>

              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Notes Summary
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{contact.notes}</p>
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-slate-900">Recent Meetings</h4>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {contact.recentMeetings.map((meeting) => (
                  <div key={`${meeting.title}-${meeting.time}`} className="px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                        <CalendarDays size={13} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{meeting.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{meeting.time}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-slate-900">AI Suggestions</h4>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => onDraftFollowUp(contact)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 active:translate-y-0"
                >
                  Draft a follow-up email
                </button>
                <button
                  type="button"
                  onClick={() => onSummarizeMeeting(contact)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 active:translate-y-0"
                >
                  Summarize last meeting notes
                </button>
                <button
                  type="button"
                  onClick={() => onScheduleCheckIn(contact)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 active:translate-y-0"
                >
                  Schedule next check-in task
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5">
              <div className="flex items-start gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-indigo-600 ring-1 ring-indigo-200">
                  <Sparkles size={13} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-600">
                    Suggested next action
                  </p>
                  <p className="mt-1 text-sm text-indigo-900">
                    Send a concise follow-up this week to keep momentum on next steps.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </aside>
    </div>
  )
}

export default ContactDetailsDrawer
