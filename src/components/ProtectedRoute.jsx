import { Navigate, useLocation } from 'react-router-dom'

function ProtectedRoute({ isAuthenticated, children }) {
  const location = useLocation()

  console.log('[RouteTrace] ProtectedRoute render', {
    pathname: location.pathname,
    isAuthenticated,
  })

  if (!isAuthenticated) {
    console.warn('[RouteTrace] ProtectedRoute redirect -> /login', {
      pathname: location.pathname,
    })
    return <Navigate to="/login" replace />
  }

  return children
}

export default ProtectedRoute
