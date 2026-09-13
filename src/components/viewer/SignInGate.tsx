import { useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Database } from '../../lib/database.types'
import { supabase } from '../../lib/supabase'
import { useSaveProfile, type Gate } from '../../lib/viewer'

/**
 * Sign-in for a link that wants one: an email, then the six-digit code
 * Supabase mails it. Same mechanism as the staff login, one difference in
 * the request — `shouldCreateUser` is on, because a client is not on a
 * list anywhere. Holding the link is what makes them a viewer; the code
 * is what proves the address.
 */
export default function SignInGate({ gate }: { gate: Gate }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const codeInput = useRef<HTMLInputElement>(null)

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    })
    setBusy(false)
    if (error) {
      setError(message(error.code ?? '', error.message))
      return
    }
    setStep('code')
    setTimeout(() => codeInput.current?.focus(), 0)
  }

  const verify = async (e: React.FormEvent) => {
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
      setError(message(error.code ?? '', error.message))
      setCode('')
      codeInput.current?.focus()
    }
    // The session listener above the router takes it from here.
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
          className="viewer-gate flex flex-col"
          autoComplete="on"
        >
          <p className="eyebrow mb-3">
            {[gate.project_name, gate.name].filter(Boolean).join(' · ')}
          </p>
          <h1 className="display-heading mb-4">Sign in to listen</h1>
          <label className="field-label" htmlFor="viewer-email">
            Email
          </label>
          <input
            id="viewer-email"
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
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={verify}
          className="viewer-gate flex flex-col"
          autoComplete="off"
        >
          <p className="eyebrow mb-3">Sent to {email.trim().toLowerCase()}</p>
          <h1 className="display-heading mb-4">Enter the code</h1>
          <label className="field-label" htmlFor="viewer-verify">
            Code
          </label>
          {/* The same three refusals the staff pin field carries: nothing
              should offer to fill a code that dies in ten minutes. */}
          <input
            id="viewer-verify"
            name="viewer-verify"
            ref={codeInput}
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
            required
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter 6-digit Code"
            className="field-underline mt-2"
          />
          {error && <p className="form-error mt-3">{error}</p>}
          <div className="mt-12 flex items-center gap-6">
            <button
              type="submit"
              disabled={busy || code.length < 6}
              className="btn btn-wide btn-light"
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="corner-note"
              onClick={() => {
                setStep('email')
                setCode('')
                setError(null)
              }}
            >
              Different email
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

function message(code: string, raw: string): string {
  const m = raw.toLowerCase()
  if (code === 'otp_disabled' || m.includes('signups not allowed')) {
    return 'Sign-in is switched off for this link. Ask whoever sent it.'
  }
  if (code === 'over_email_send_rate_limit' || m.includes('rate limit')) {
    return 'Too many requests. Wait a minute and try again.'
  }
  if (code === 'otp_expired' || m.includes('expired')) {
    return 'That code has expired. Request a new one.'
  }
  if (code === 'invalid_credentials' || m.includes('invalid')) {
    return 'That code is not right. Check it and try again.'
  }
  return 'Something went wrong. Try again.'
}

const TYPES: {
  value: Database['public']['Enums']['viewer_type']
  label: string
}[] = [
  { value: 'brand', label: 'Brand' },
  { value: 'agency', label: 'Agency' },
  { value: 'production_company', label: 'Production company' },
  { value: 'director', label: 'Director' },
  { value: 'sound_post', label: 'Sound & post' },
  { value: 'composer', label: 'Composer' },
  { value: 'other', label: 'Other' },
]

/** A company, from the domain of an address: jess@cavendishmusic.com → Cavendishmusic. */
function companyFromEmail(email: string): string {
  const domain = email.split('@')[1]?.split('.')[0] ?? ''
  if (
    !domain ||
    ['gmail', 'hotmail', 'outlook', 'yahoo', 'icloud', 'me', 'live'].includes(
      domain,
    )
  )
    return ''
  return domain.charAt(0).toUpperCase() + domain.slice(1)
}

/** The once-only questions after a first sign-in. */
export function ProfileForm({
  session,
  gate,
}: {
  session: Session
  gate: Gate
}) {
  const email = session.user.email ?? ''
  const [name, setName] = useState('')
  const [company, setCompany] = useState(() => companyFromEmail(email))
  const [type, setType] = useState<
    Database['public']['Enums']['viewer_type'] | null
  >(null)
  const save = useSaveProfile()

  return (
    <div className="surface-dark relative flex min-h-screen items-center justify-center">
      <img
        src="/sequel-mark-light.svg"
        alt=""
        width={96}
        height={96}
        className="absolute left-12 top-12 h-16 w-16"
      />
      <form
        className="viewer-gate flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          save.mutate({
            userId: session.user.id,
            email,
            name: name.trim(),
            company: company.trim() || null,
            userType: type,
          })
        }}
      >
        <div>
          <p className="eyebrow mb-3">{gate.name}</p>
          <h1 className="display-heading">Nearly there</h1>
          <p className="mt-2 text-sm font-light opacity-80">
            Once, so your notes have a name on them.
          </p>
        </div>
        <div>
          <label className="field-label" htmlFor="viewer-name">
            Name
          </label>
          <input
            id="viewer-name"
            autoFocus
            required
            autoComplete="name"
            className="field-underline mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="viewer-company">
            Company
          </label>
          <input
            id="viewer-company"
            autoComplete="organization"
            className="field-underline mt-1"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <div>
          <div className="field-label">You are</div>
          <div className="viewer-pick mt-2">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={type === t.value}
                onClick={() => setType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {save.error && <p className="form-error">{save.error.message}</p>}
        <button
          type="submit"
          disabled={save.isPending || !name.trim()}
          className="btn btn-wide btn-light mt-4 self-start"
        >
          {save.isPending ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
