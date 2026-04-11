import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { fetchProfileByUserId } from './lib/profileService'
import { supabase } from './lib/supabase'
import { getUserProfile } from './lib/userProfile'
import DashboardPage from './pages/DashboardPage'
import IntegrationsPage from './pages/IntegrationsPage'
import LoginPage from './pages/LoginPage'

function App() {
  const [session, setSession] = useState(null)
  const [profileRow, setProfileRow] = useState(null)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession()
      if (!isMounted) return

      setSession(data.session)
      setIsAuthLoading(false)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsAuthLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadProfile = async () => {
      const userId = session?.user?.id

      if (!userId) {
        setProfileRow(null)
        setIsProfileLoading(false)
        return
      }

      setIsProfileLoading(true)

      const { profile, error } = await fetchProfileByUserId(userId)

      if (!isMounted) return

      if (error) {
        // Keep app usable even if profiles row is missing or RLS blocks it.
        console.warn('[Profile] Unable to load profile row:', error.message)
        setProfileRow(null)
        setIsProfileLoading(false)
        return
      }

      setProfileRow(profile)
      setIsProfileLoading(false)
    }

    loadProfile()

    return () => {
      isMounted = false
    }
  }, [session])

  const isAuthenticated = useMemo(() => Boolean(session), [session])
  const userProfile = useMemo(
    () =>
      getUserProfile({
        user: session?.user,
        profile: profileRow,
        isProfileLoading,
      }),
    [session, profileRow, isProfileLoading]
  )

  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 px-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm">
          Loading Heynova...
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute isAuthenticated={isAuthenticated}>
            <DashboardPage userProfile={userProfile} />
          </ProtectedRoute>
        }
      />

      <Route
        path="/integrations"
        element={
          <ProtectedRoute isAuthenticated={isAuthenticated}>
            <IntegrationsPage userProfile={userProfile} />
          </ProtectedRoute>
        }
      />

      <Route
        path="*"
        element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
      />
    </Routes>
  )
}

export default App
