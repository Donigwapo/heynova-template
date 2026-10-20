import { supabase } from './supabase'

const shadowActivationFunctionName =
  import.meta.env.VITE_SUPABASE_WORKFLOW_SHADOW_ACTIVATION_FUNCTION ||
  'workflow-shadow-activation-sync'

export async function syncWorkflowActivationShadow({ workflowId, campaignId = null }) {
  if (!workflowId) {
    return {
      ok: false,
      error: new Error('Missing workflowId for shadow activation sync.'),
      data: null,
    }
  }

  const { data, error } = await supabase.functions.invoke(shadowActivationFunctionName, {
    body: {
      workflowId,
      campaignId,
    },
  })

  if (error) {
    return {
      ok: false,
      error,
      data: null,
    }
  }

  return {
    ok: Boolean(data?.ok),
    error: null,
    data: data || null,
  }
}
