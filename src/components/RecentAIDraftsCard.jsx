import { useEffect, useMemo, useState } from 'react'
import { updateAIDraftStatus } from '../lib/aiDraftsService'
import { fetchContactsByIdsForUser } from '../lib/contactsService'
import { fetchMeetingsByIdsForUser } from '../lib/meetingsService'
import { sendFollowUpDraft } from '../lib/followUpSendService'
import AIModalShell from './AIModalShell'
import DashboardCard from './DashboardCard'

function formatDraftTimestamp(value) {
  if (!value) return 'Unknown time'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown time'

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getSourceBadge(sourceContext) {
  const source = sourceContext?.source || sourceContext?.provider || 'unknown'
  if (source === 'function' || source === 'mock') {
    return { label: 'AI', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' }
  }

  if (source === 'fallback') {
    return { label: 'Fallback', className: 'border-amber-200 bg-amber-50 text-amber-700' }
  }

  return { label: 'Unknown', className: 'border-slate-200 bg-slate-100 text-slate-700' }
}

function getStatusBadge(status) {
  const normalized = (status || 'generated').toLowerCase()

  if (normalized === 'sent') {
    return { label: 'Sent', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  }

  if (normalized === 'failed') {
    return { label: 'Failed', className: 'border-rose-200 bg-rose-50 text-rose-700' }
  }

  return { label: 'Generated', className: 'border-slate-200 bg-slate-100 text-slate-700' }
}

function getDraftErrorMessage(draft) {
  if ((draft?.status || '').toLowerCase() !== 'failed') return ''

  const raw = draft?.sendResult?.message || draft?.sendResult?.error || ''
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }

  return 'Delivery failed. Please try sending again.'
}

function normalizeContactLabel(contact) {
  const name = contact?.name || contact?.full_name || null
  const company = contact?.company || contact?.company_name || null

  if (name && company) return `${name} · ${company}`
  return name || company || null
}

function normalizeMeetingLabel(meeting) {
  return meeting?.title || meeting?.name || null
}

function RecentAIDraftsCard({
  drafts,
  isLoading,
  error,
  userId,
  userProfile,
  contacts = [],
  meetings = [],
  onDraftPatched,
}) {
  const [selectedDraftId, setSelectedDraftId] = useState(null)
  const [draftContextMap, setDraftContextMap] = useState({ contactsById: {}, meetingsById: {} })
  const [retryingDraftId, setRetryingDraftId] = useState(null)

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) || null,
    [drafts, selectedDraftId]
  )

  const contactIdsFromDrafts = useMemo(
    () => [...new Set(drafts.map((draft) => draft.contactId).filter(Boolean))],
    [drafts]
  )

  const meetingIdsFromDrafts = useMemo(
    () => [...new Set(drafts.map((draft) => draft.meetingId).filter(Boolean))],
    [drafts]
  )

  const contactsByIdFromProps = useMemo(() => {
    const map = {}
    ;(contacts || []).forEach((contact) => {
      if (!contact?.id) return
      map[contact.id] = contact
    })
    return map
  }, [contacts])

  const meetingsByIdFromProps = useMemo(() => {
    const map = {}
    ;(meetings || []).forEach((meeting) => {
      const meetingId = meeting?.id
      if (!meetingId) return
      map[meetingId] = meeting
    })
    return map
  }, [meetings])

  useEffect(() => {
    let isMounted = true

    const loadDraftContext = async () => {
      const contactsMissingIds = contactIdsFromDrafts.filter((id) => !contactsByIdFromProps[id])
      const meetingsMissingIds = meetingIdsFromDrafts.filter((id) => !meetingsByIdFromProps[id])

      if (!userId || (contactsMissingIds.length === 0 && meetingsMissingIds.length === 0)) {
        if (!isMounted) return
        setDraftContextMap({
          contactsById: contactsByIdFromProps,
          meetingsById: meetingsByIdFromProps,
        })
        return
      }

      const [{ contacts: fetchedContacts }, { meetings: fetchedMeetings }] = await Promise.all([
        fetchContactsByIdsForUser(userId, contactsMissingIds),
        fetchMeetingsByIdsForUser(userId, meetingsMissingIds),
      ])

      if (!isMounted) return

      const contactsById = { ...contactsByIdFromProps }
      const meetingsById = { ...meetingsByIdFromProps }

      ;(fetchedContacts || []).forEach((contact) => {
        if (!contact?.id) return
        contactsById[contact.id] = contact
      })

      ;(fetchedMeetings || []).forEach((meeting) => {
        if (!meeting?.id) return
        meetingsById[meeting.id] = meeting
      })

      setDraftContextMap({ contactsById, meetingsById })
    }

    loadDraftContext()

    return () => {
      isMounted = false
    }
  }, [
    contactIdsFromDrafts,
    meetingIdsFromDrafts,
    userId,
    contactsByIdFromProps,
    meetingsByIdFromProps,
  ])

  const getContactLabel = (contactId) => {
    if (!contactId) return null
    const resolved = draftContextMap.contactsById?.[contactId]
    return normalizeContactLabel(resolved) || contactId
  }

  const getMeetingLabel = (meetingId) => {
    if (!meetingId) return null
    const resolved = draftContextMap.meetingsById?.[meetingId]
    return normalizeMeetingLabel(resolved) || meetingId
  }

  const closeDraftModal = () => {
    setSelectedDraftId(null)
  }

  const openDraftModal = (draftId) => {
    setSelectedDraftId(draftId)
  }

  const handleCopyDraft = async () => {
    if (!selectedDraft?.generatedText) return

    try {
      await navigator.clipboard.writeText(selectedDraft.generatedText)
    } catch {
      // noop for unsupported clipboard environments
    }
  }

  const handleRetrySend = async (draft) => {
    if (!draft?.id || retryingDraftId) return

    const contextContact = draft.contactId ? draftContextMap.contactsById?.[draft.contactId] || null : null
    const contextMeeting = draft.meetingId ? draftContextMap.meetingsById?.[draft.meetingId] || null : null

    setRetryingDraftId(draft.id)

    const sendResponse = await sendFollowUpDraft({
      userProfile,
      contact: contextContact,
      meeting: contextMeeting,
      draftText: draft.generatedText,
    })

    const nextStatus = sendResponse?.ok ? 'sent' : 'failed'

    const { error: updateError } = await updateAIDraftStatus({
      draftId: draft.id,
      status: nextStatus,
      sendResult: sendResponse?.result || null,
      deliveryChannel: 'email',
    })

    if (updateError) {
      console.warn('[AI Drafts] Unable to update draft status after retry.', updateError)
      setRetryingDraftId(null)
      return
    }

    onDraftPatched?.(draft.id, {
      status: nextStatus,
      sendResult: sendResponse?.result || null,
    })

    setRetryingDraftId(null)
  }

  return (
    <>
      <DashboardCard title="Recent AI Drafts">
        {isLoading && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            Loading recent drafts...
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-4 text-sm text-amber-700">
            {error}
          </div>
        )}

        {!isLoading && !error && drafts.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            No AI drafts generated yet.
          </div>
        )}

        {!isLoading &&
          !error &&
          drafts.map((draft, index) => {
            const sourceBadge = getSourceBadge(draft.sourceContext)
            const statusBadge = getStatusBadge(draft.status)
            const draftErrorMessage = getDraftErrorMessage(draft)

            return (
              <article
                key={draft.id || `${draft.createdAt}-${index}`}
                className={`rounded-xl px-1 py-2 ${
                  index !== drafts.length - 1 ? 'border-b border-slate-100' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => openDraftModal(draft.id)}
                  className="w-full rounded-lg text-left transition-colors hover:bg-slate-50/80"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {draft.draftType || 'draft'}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceBadge.className}`}
                    >
                      {sourceBadge.label}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge.className}`}
                    >
                      {statusBadge.label}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDraftTimestamp(draft.createdAt)}
                    </span>
                  </div>

                  <p className="line-clamp-2 text-sm text-slate-700">{draft.generatedText}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {draft.contactId && (
                      <span className="rounded-md bg-slate-100 px-2 py-1">
                        Contact: {getContactLabel(draft.contactId)}
                      </span>
                    )}
                    {draft.meetingId && (
                      <span className="rounded-md bg-slate-100 px-2 py-1">
                        Meeting: {getMeetingLabel(draft.meetingId)}
                      </span>
                    )}
                  </div>

                  {draftErrorMessage && (
                    <p className="mt-2 text-xs text-rose-600">{draftErrorMessage}</p>
                  )}
                </button>

                <div className="mt-2 flex justify-end gap-2">
                  {(draft.status || '').toLowerCase() === 'failed' && (
                    <button
                      type="button"
                      onClick={() => handleRetrySend(draft)}
                      disabled={retryingDraftId === draft.id}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 transition-all duration-150 hover:bg-rose-100 hover:shadow-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {retryingDraftId === draft.id ? 'Retrying...' : 'Retry'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openDraftModal(draft.id)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
                  >
                    View
                  </button>
                </div>
              </article>
            )
          })}
      </DashboardCard>

      <AIModalShell
        isOpen={Boolean(selectedDraft)}
        onClose={closeDraftModal}
        label="AI DRAFT"
        title="Full Draft"
        description={selectedDraft ? formatDraftTimestamp(selectedDraft.createdAt) : undefined}
        maxWidth="max-w-3xl"
        footer={
          <>
            {selectedDraft && (selectedDraft.status || '').toLowerCase() === 'failed' && (
              <button
                type="button"
                onClick={() => handleRetrySend(selectedDraft)}
                disabled={retryingDraftId === selectedDraft.id}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition-all duration-150 hover:bg-rose-100 hover:shadow-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {retryingDraftId === selectedDraft.id ? 'Retrying...' : 'Retry Send'}
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyDraft}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:shadow-sm active:scale-[0.99]"
            >
              Copy Draft
            </button>
            <button
              type="button"
              onClick={closeDraftModal}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100 hover:shadow-sm active:scale-[0.99]"
            >
              Close
            </button>
          </>
        }
      >
        {selectedDraft && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2 py-1 font-medium uppercase tracking-wide text-slate-600">
                {selectedDraft.draftType || 'draft'}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-1 font-medium ${
                  getSourceBadge(selectedDraft.sourceContext).className
                }`}
              >
                {getSourceBadge(selectedDraft.sourceContext).label}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-1 font-medium ${
                  getStatusBadge(selectedDraft.status).className
                }`}
              >
                {getStatusBadge(selectedDraft.status).label}
              </span>
              {selectedDraft.contactId && (
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">
                  Contact: {getContactLabel(selectedDraft.contactId)}
                </span>
              )}
              {selectedDraft.meetingId && (
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">
                  Meeting: {getMeetingLabel(selectedDraft.meetingId)}
                </span>
              )}
            </div>

            {getDraftErrorMessage(selectedDraft) && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {getDraftErrorMessage(selectedDraft)}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {selectedDraft.generatedText || 'No generated text available for this draft.'}
              </p>
            </div>
          </div>
        )}
      </AIModalShell>
    </>
  )
}

export default RecentAIDraftsCard
