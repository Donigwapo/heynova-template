import { supabase } from './supabase'

const gmailSendFunctionName = import.meta.env.VITE_SUPABASE_GMAIL_SEND_FUNCTION || 'gmail-send'

export async function sendWorkflowTestEmail({ to, subject, text, html = null }) {
  const payload = {
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || null

  console.log('[WorkflowEmailTest] invoking gmail-send', {
    functionName: gmailSendFunctionName,
    to,
    subjectLength: typeof subject === 'string' ? subject.length : 0,
    textLength: typeof text === 'string' ? text.length : 0,
    hasHtml: Boolean(html),
    hasSession: Boolean(sessionData?.session),
    hasAccessToken: Boolean(accessToken),
    pathname: typeof window !== 'undefined' ? window.location.pathname : null,
  })

  const { data, error } = await supabase.functions.invoke(gmailSendFunctionName, {
    body: payload,
    headers: accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
        }
      : undefined,
  })

  if (error) {
    let status = null
    let bodyText = null
    let bodyJson = null

    const responseContext = error?.context
    if (responseContext && typeof responseContext.status === 'number') {
      status = responseContext.status
      try {
        bodyText = await responseContext.text()
        try {
          bodyJson = bodyText ? JSON.parse(bodyText) : null
        } catch {
          bodyJson = null
        }
      } catch {
        bodyText = null
      }
    }

    console.error('[WorkflowEmailTest] gmail-send invoke transport failure', {
      message: error.message || 'Unknown invoke error',
      name: error?.name || null,
      status,
      bodyText,
      bodyJson,
      details: error,
    })

    return {
      ok: false,
      errorCode: 'invoke_transport_failed',
      message:
        (bodyJson && bodyJson?.error?.message) ||
        bodyText ||
        error.message ||
        'Unable to reach gmail-send function.',
      providerMessageId: null,
      raw: { data, error, status, bodyText, bodyJson },
    }
  }

  const responseOk = data?.ok === true
  if (!responseOk) {
    const code = data?.error?.code || 'provider_error'
    const message = data?.error?.message || 'gmail-send returned a failed response.'

    console.error('[WorkflowEmailTest] gmail-send returned failed response', {
      code,
      message,
      data,
    })

    return {
      ok: false,
      errorCode: code,
      message,
      providerMessageId: null,
      raw: { data, error: null },
    }
  }

  const providerMessageId = typeof data?.providerMessageId === 'string' ? data.providerMessageId : null

  console.log('[WorkflowEmailTest] gmail-send success', {
    providerMessageId,
  })

  return {
    ok: true,
    errorCode: null,
    message: data?.message || 'Test email sent.',
    providerMessageId,
    raw: { data, error: null },
  }
}
