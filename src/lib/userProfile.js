function toTitleCase(value) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function deriveNameFromEmail(email = '') {
  const localPart = email.split('@')[0] || ''

  if (!localPart) return 'User'

  const normalized = localPart.replace(/[._-]+/g, ' ').trim()
  if (!normalized) return 'User'

  return toTitleCase(normalized)
}

function getInitials(name = '') {
  const parts = name
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)

  if (!parts.length) return 'U'

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

export function getUserProfile({ user, profile, isProfileLoading = false }) {
  const metadata = user?.user_metadata || {}

  const email = user?.email || ''

  const displayName =
    profile?.full_name ||
    metadata.full_name ||
    metadata.name ||
    metadata.display_name ||
    metadata.preferred_name ||
    deriveNameFromEmail(email)

  const avatarUrl =
    profile?.avatar_url ||
    metadata.avatar_url ||
    metadata.picture ||
    null

  return {
    authUserId: user?.id || null,
    id: profile?.id || user?.id || null,
    email,
    displayName,
    avatarUrl,
    initials: getInitials(displayName),
    role: profile?.role || null,
    companyName: profile?.company_name || null,
    hasProfileRow: Boolean(profile),
    isProfileLoading,
  }
}
