import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AIModalShell from './AIModalShell'
import { fetchCampaignsByUserId, createCampaign, addLeadsToCampaign } from '../lib/campaignsService'
import { fetchLeadListItems } from '../lib/leadDatabaseStore'

function CampaignAddLeadsModal({
  isOpen,
  onClose,
  leadList,
  userId,
  onSuccess,
}) {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState([])
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [campaignId, setCampaignId] = useState('')
  const [newCampaignName, setNewCampaignName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!isOpen || !userId) return
    setCampaignsLoading(true)
    fetchCampaignsByUserId(userId).then(({ campaigns, error }) => {
      setCampaigns(campaigns || [])
      setCampaignsLoading(false)
      if (error) setErrorMsg(error.message || 'Failed to fetch campaigns')
    })
  }, [isOpen, userId])

  function resetState() {
    setCampaignId('')
    setNewCampaignName('')
    setErrorMsg('')
  }

  useEffect(() => {
    if (!isOpen) resetState()
  }, [isOpen])

  async function handleSubmit() {
    setIsSubmitting(true)
    setErrorMsg('')
    let finalCampaignId = campaignId
    let finalCampaignName = ''
    // Create new campaign if requested
    if (!finalCampaignId && newCampaignName.trim()) {
      const { campaign, error } = await createCampaign({ userId, name: newCampaignName.trim() })
      if (error || !campaign) {
        setErrorMsg(error?.message || 'Failed to create campaign')
        setIsSubmitting(false)
        return
      }
      finalCampaignId = campaign.id
      finalCampaignName = campaign.name || newCampaignName.trim()
      setCampaigns((prev) => [campaign, ...prev])
    } else if (finalCampaignId) {
      const found = campaigns.find((c) => c.id === finalCampaignId)
      finalCampaignName = found?.name || ''
    }
    if (!finalCampaignId) {
      setErrorMsg('Please select or create a campaign.')
      setIsSubmitting(false)
      return
    }

    // Fetch all leads from list
    const { rows: leads, error: leadsError } = await fetchLeadListItems(leadList.id)
    if (leadsError || !Array.isArray(leads)) {
      setErrorMsg(leadsError?.message || 'Failed to fetch leads for this file')
      setIsSubmitting(false)
      return
    }
    // Add to campaign
    const { insertCount, error } = await addLeadsToCampaign({
      campaignId: finalCampaignId,
      userId,
      leads: leads || [],
    })
    if (error) {
      setErrorMsg(error.message || 'Failed to add leads to campaign')
      setIsSubmitting(false)
      return
    }
    setIsSubmitting(false)
    onSuccess && onSuccess(insertCount, finalCampaignName)
    onClose && onClose()
    navigate(`/campaigns/workflows/new?campaignId=${encodeURIComponent(finalCampaignId)}`)
  }

  return (
    <AIModalShell isOpen={isOpen} onClose={onClose} title="Add to Campaign">
      <div className="mb-2">
        <div className="mb-0.5 text-xs font-semibold text-slate-500">Lead List</div>
        <div className="truncate font-medium text-slate-900">{leadList?.name || ''}</div>
        <div className="text-xs text-slate-500">{leadList?.leadsCount || 0} leads</div>
      </div>
      <div className="mt-3 mb-2">
        <label className="mb-1 block text-xs font-medium text-slate-700">Choose Campaign</label>
        {campaignsLoading ? (
          <div className="text-sm text-slate-500">Loading campaigns…</div>
        ) : (
          <select
            className="w-full rounded-lg border bg-white px-2 py-2 text-sm text-slate-900"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="">Select campaign…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="mb-2 mt-3">
        <label className="mb-1 block text-xs font-medium text-slate-700">Or create new campaign</label>
        <input
          type="text"
          placeholder="New campaign name"
          className="w-full rounded-lg border px-2 py-2 text-sm"
          value={newCampaignName}
          onChange={(e) => setNewCampaignName(e.target.value)}
          disabled={isSubmitting}
        />
      </div>
      {errorMsg && <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-700">{errorMsg}</div>}
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg border border-indigo-200 bg-indigo-600 py-2 px-4 text-sm font-medium text-indigo-50 hover:bg-indigo-700 disabled:bg-indigo-300"
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Adding…' : 'Add to Campaign'}
        </button>
      </div>
    </AIModalShell>
  )
}

export default CampaignAddLeadsModal
