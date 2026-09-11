import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from '../lib/auth'
import { loginErrorMessage } from '../lib/authErrors'
import { supabase } from '../lib/supabase'

/** Supabase refuses a second code inside a minute; the UI says so rather than
 *  letting someone earn a rate-limit error by pressing the button again. */
const RESEND_SECONDS = 60

export default function Login() {
  const session = useSession()

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const codeInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  // Already signed in — nothing to do here.
  if (session) return <Navigate to="/" replace />

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        // The whole authorisation model. Staff accounts are created by hand, so
        // an address without one cannot sign itself up — and that refusal is
        // what the page reports as "not authorised".
        shouldCreateUser: false,
      },
    })
    setBusy(false)
    if (error) {
      setError(loginErrorMessage(error))
      return
    }
    setStep('code')
    setCooldown(RESEND_SECONDS)
    setTimeout(() => codeInput.current?.focus(), 0)
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (error) {
      setError(loginErrorMessage(error))
      setCode('')
      codeInput.current?.focus()
    }
    // On success the session listener redirects; nothing to do here.
  }

  return (
    <div className="surface-dark relative flex min-h-screen items-center justify-center">
      <img
        src="/sequel-mark-light.svg"
        alt=""
        width={96}
        height={96}
        className="absolute left-12 top-12 h-16 w-16"
      />

      {step === 'email' ? (
        <form
          onSubmit={requestCode}
          name="login"
          id="login-form"
          method="post"
          className="flex w-full max-w-[22rem] flex-col"
        >
          <h1 className="display-heading mb-4">Login</h1>

          <label className="field-label" htmlFor="email">
            Email
          </label>
          {/* autoComplete is "username", not "email". The first tells a password
              manager this is the account identifier for a login, so it offers
              saved sign-ins for this site; the second says it is an address to
              fill from the address book, which is why the suggestions came back
              as a generic contact list. */}
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email Address"
            className="field-underline mt-2"
          />

          {error && <p className="form-error mt-3">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="btn btn-wide btn-light mt-12 self-start"
          >
            {busy ? 'Sending…' : 'Request code'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={verify}
          name="login-code"
          id="login-code-form"
          method="post"
          className="flex w-full max-w-[22rem] flex-col"
        >
          <h1 className="display-heading mb-4">Check your email</h1>
          <p className="field-label mb-6 opacity-65">
            A 6-digit code is on its way to {email}. It expires in 10 minutes.
          </p>

          <label className="field-label" htmlFor="code">
            Code
          </label>
          <input
            id="code"
            name="one-time-code"
            ref={codeInput}
            required
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="field-underline mt-2 tracking-[0.5em]"
          />

          {error && <p className="form-error mt-3">{error}</p>}

          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="btn btn-wide btn-light mt-12 self-start"
          >
            {busy ? 'Checking…' : 'Login'}
          </button>

          <div className="mt-6 flex gap-6">
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => void requestCode()}
              className="corner-note underline disabled:no-underline"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setError(null)
              }}
              className="corner-note underline"
            >
              Use a different email
            </button>
          </div>
        </form>
      )}

      <div className="corner-note absolute bottom-12 left-12">
        © All rights reserved {new Date().getFullYear()}
      </div>
      <a
        className="corner-note absolute bottom-12 right-12"
        href="mailto:support@sequelsounds.com"
      >
        Not receiving your code?
      </a>
    </div>
  )
}
