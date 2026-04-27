import { supabase } from './supabase'

const gmailClassifyPreviewFunctionName =
  import.meta.env.VITE_SUPABASE_GMAIL_CLASSIFY_FUNCTION || 'gmail-classify-preview'

export async function fetchGmailInboxIntelligence() {
  const { data, error } = await supabase.functions.invoke(gmailClassifyPreviewFunctionName, {
    body: {},
  })

  if (error) {
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
