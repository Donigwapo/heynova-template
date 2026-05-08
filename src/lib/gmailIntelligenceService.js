import { logSupabaseQueryError } from './queryLogger'
import { supabase } from './supabase'

const gmailClassifyPreviewFunctionName =
  import.meta.env.VITE_SUPABASE_GMAIL_CLASSIFY_FUNCTION || 'gmail-classify-preview'

export async function fetchGmailInboxIntelligence() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : null
  const { data, error } = await supabase.functions.invoke(gmailClassifyPreviewFunctionName, {
    body: {},
  })

  if (error) {
    logSupabaseQueryError({
      table: 'gmail_classify_preview_function',
      operation: 'functions.invoke',
      userId: null,
      pathname,
      error,
      extra: { functionName: gmailClassifyPreviewFunctionName },
    })

    return {
      result: null,
      error,
    }
  }

  return {
    result: data || null,
    error: null,
  }
}
