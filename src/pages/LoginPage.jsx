import { useState } from 'react'
import { LogIn, Mail, Sparkles } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')

    if (!isSupabaseConfigured) {
      setErrorMessage('Auth is not configured yet. Add Supabase environment variables to continue.')
      return
    }

    setIsSubmitting(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setErrorMessage(error.message || 'Unable to sign in. Please try again.')
    }

    setIsSubmitting(false)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
            <img
              src="/brand/heynova-logo.png"
              alt="Heynova logo"
              className="h-5 w-5 rounded-sm object-cover opacity-90"
            />
          </span>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-600">
              Heynova
            </p>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Welcome back</h1>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
            <div className="relative">
              <Mail
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm transition-all duration-150 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm transition-all duration-150 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>

          {errorMessage && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <Sparkles size={15} aria-hidden="true" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn size={15} aria-hidden="true" />
                Sign In
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
