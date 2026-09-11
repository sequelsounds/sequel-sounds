import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    /* Layout mirrors the Webflow /login page: full-bleed dark ground, the mark
       and copyright pinned 3rem into opposite corners, and the form as a 22rem
       column centred in the viewport. */
    <div className="surface-dark relative flex min-h-screen items-center justify-center">
      <img
        src="/sequel-mark-light.svg"
        alt=""
        width={96}
        height={96}
        className="absolute left-12 top-12 h-16 w-16"
      />

      <form onSubmit={onSubmit} className="flex w-full max-w-[22rem] flex-col">
        <h1 className="display-heading mb-4">Login</h1>

        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email Address"
          className="field-underline mt-2"
        />

        <label className="field-label mt-6" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="field-underline mt-2"
        />

        {error && <p className="form-error mt-3">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-wide btn-light mt-12 self-start"
        >
          {busy ? 'Signing in…' : 'Login'}
        </button>
      </form>

      <div className="corner-note absolute bottom-12 left-12">
        © All rights reserved {new Date().getFullYear()}
      </div>
      <a
        className="corner-note absolute bottom-12 right-12"
        href="mailto:support@sequelsounds.com"
      >
        Trouble signing in?
      </a>
    </div>
  )
}
