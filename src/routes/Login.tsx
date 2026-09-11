import { useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from '../lib/auth'
import { loginErrorMessage } from '../lib/authErrors'
import { supabase } from '../lib/supabase'

export default function Login() {
  const session = useSession()

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const codeInput = useRef<HTMLInputElement>(null)

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
          {/* "email", not "username". "username" invites the password manager to
              attach to the field, and this flow has no password for it to ever
              save — so it finds nothing and offers a bare "Manage Passwords"
              menu every time. An address is genuinely what we want filled. */}
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
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
          <h1 className="display-heading mb-4">Login</h1>

          <label className="field-label" htmlFor="code">
            Pin
          </label>
          {/* data-* opt-outs for LastPass, 1Password and Dashlane. Without them a
              short numeric field gets treated as something to save and offer
              back, which is useless for a code that is dead in ten minutes.
              These are the same three the Webflow pin field carries. */}
          <input
            id="code"
            name="one-time-code"
            ref={codeInput}
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
            required
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter 6-digit Code"
            className="field-underline mt-2"
          />

          {error && <p className="form-error mt-3">{error}</p>}

          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="btn btn-wide btn-light mt-12 self-start"
          >
            {busy ? 'Checking…' : 'Login'}
          </button>
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
