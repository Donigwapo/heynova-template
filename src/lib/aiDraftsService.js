import { logSupabaseQueryError } from './queryLogger'
import { supabase } from './supabase'

export async function fetchRecentAIDraftsByUserId(userId, limit = 8) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null

  if (!userId) {
    return { drafts: [], error: null }
  }

  const { data, error } = await supabase
    .from('ai_drafts')
    .select('id, draft_type, generated_text, source_context, contact_id, meeting_id, created_at, status, send_result')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    logSupabaseQueryError({
      table: 'ai_drafts',
      operation: 'select many',
      userId,
      pathname,
      error,
      extra: { limit },
    })
    return { drafts: [], error }
  }

  return { drafts: data || [], error: null }
}

export async function saveAIDraft({
  userId,
  contactId = null,
  meetingId = null,
  draftType = 'follow_up',
  generatedText,
  sourceContext = {},
}) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null

  if (!userId || !generatedText) {
    return { draftId: null, error: null }
  }

  const payload = {
    user_id: userId,
    contact_id: contactId,
    meeting_id: meetingId,
    draft_type: draftType,
    generated_text: generatedText,
    source_context: sourceContext,
    status: 'generated',
    created_at: new Date().toISOString(),
  }

  const { data, error } = await supabase.from('ai_drafts').insert(payload).select('id').maybeSingle()

  if (error) {
    logSupabaseQueryError({
      table: 'ai_drafts',
      operation: 'insert maybeSingle',
      userId,
      pathname,
      error,
      extra: {
        contactId,
        meetingId,
        draftType,
      },
    })
  }

  return { draftId: data?.id || null, error }
}

export async function updateAIDraftStatus({
  draftId,
  status,
  sendResult = null,
  deliveryChannel = 'email',
}) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null

  if (!draftId || !status) {
    return { error: null }
  }

  const isSent = status === 'sent'

  const updatePayload = {
    status,
    ...(sendResult ? { send_result: sendResult } : {}),
    ...(isSent
      ? {
          sent_at: new Date().toISOString(),
          delivery_channel: deliveryChannel || 'email',
        }
      : {}),
  }

  const { error } = await supabase
    .from('ai_drafts')
    .update(updatePayload)
    .eq('id', draftId)

  if (error) {
    logSupabaseQueryError({
      table: 'ai_drafts',
      operation: 'update',
      userId: null,
      pathname,
      error,
      extra: { draftId, status },
    })
  }

  return { error }
}
