import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { submitTeamForm, teamForm, type Option, type TeamFields } from '../lib/rosterOnboarding'

/**
 * `/join-roster/:token` — a composition team adds its own details to the
 * roster (Andy, 24 Sep 2026). Public: the token in the email is the only
 * credential; the roster-onboarding function checks it and saves.
 *
 * Built like the briefing form (Andy: "one q at a time"): welcome, one
 * question per screen with the rise, Enter to move on, thank you. The same
 * bp-* styles as /brief. The welcome's photo (Andy, 24 Sep) is the one on the
 * old Typeform composer form: "vinyl record near white electronic keyboard" by
 * Anton Shuvalov on Unsplash (free licence), served from Unsplash's CDN.
 */

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1550634912-40b4a12c75ae?auto=format&fit=crop&w=1400&q=80'

type Kind = 'text' | 'long' | 'email' | 'country'
type Question = { key: string; title: string; help?: string; kind: Kind; required?: boolean; max?: number }

/** Enough for an intro, not a life story (Andy, 24 Sep). The server holds the same cap. */
const BIO_MAX = 600

const QUESTIONS: Question[] = [
  {
    key: 'title',
    title: "What's your team or company called?",
    help: "This is how you'll appear on our roster.",
    kind: 'text',
    required: true,
  },
  {
    key: 'legal_name',
    title: 'Who is our agreement with?',
    help: 'The legal name of the person or company our composer agreement is made with.',
    kind: 'text',
    required: true,
  },
  { key: 'business_address', title: "What's your business address?", kind: 'long', required: true },
  { key: 'city', title: 'Which city are you based in?', kind: 'text' },
  { key: 'countries_list_id', title: 'And which country?', kind: 'country' },
  { key: 'brief_email', title: 'Where should we send our briefs?', kind: 'email', required: true },
  {
    key: 'contract_email',
    title: 'Who signs our agreements?',
    help: "Their email address. Leave it blank and we'll use the briefs address.",
    kind: 'email',
  },
  { key: 'finance_email', title: 'Where should remittances go?', help: 'Your finance email, if different.', kind: 'email' },
  { key: 'phone_number', title: "What's the best number to reach you on?", kind: 'text' },
  { key: 'website', title: 'Do you have a website?', kind: 'text' },
  {
    key: 'bio',
    title: 'Give us a short intro to you.',
    help: 'Who you are and what you do, in a few lines.',
    kind: 'long',
    max: BIO_MAX,
  },
  { key: 'strengths', title: 'What are your strengths?', help: 'Genres, styles, what you are known for.', kind: 'long' },
  { key: 'stand_out_work', title: "What's your stand-out work?", kind: 'long' },
  { key: 'studio_setup', title: "What's your studio setup?", kind: 'long' },
  { key: 'composition_showreel', title: 'A link to your composition showreel', kind: 'text' },
  { key: 'sounddesign_showreel', title: 'A link to your sound design showreel', help: 'If you have one.', kind: 'text' },
  { key: 'library_link', title: 'A link to your music library', help: 'If you have one.', kind: 'text' },
]

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MAX_LINES = 4

function grow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  const cs = getComputedStyle(el)
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5
  const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
  const max = Math.round(lineHeight * MAX_LINES + padding)
  el.style.height = `${Math.min(el.scrollHeight, max)}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

type Screen = 'loading' | 'invalid' | 'welcome' | 'form' | 'done'

export default function JoinRoster() {
  const { token = '' } = useParams()
  const [screen, setScreen] = useState<Screen>('loading')
  const [step, setStep] = useState(0)
  const [fields, setFields] = useState<TeamFields>({})
  const [countries, setCountries] = useState<Option[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    document.title = 'Sequel | Join the roster'
    let live = true
    teamForm(token)
      .then((r) => {
        if (!live) return
        if (r.state !== 'open') return setScreen(r.state)
        setFields(r.fields)
        setCountries(r.countries)
        setScreen('welcome')
      })
      .catch(() => live && setScreen('invalid'))
    return () => {
      live = false
    }
  }, [token])

  const q = QUESTIONS[step]
  const last = step === QUESTIONS.length - 1
  const value = q ? (fields[q.key] == null ? '' : String(fields[q.key])) : ''
  const missing = !!q?.required && !value.trim()
  const badEmail = q?.kind === 'email' && !!value.trim() && !EMAIL_RE.test(value.trim())
  const canAdvance = !missing && !badEmail

  // The rise, once per question, and the textarea's height — as on /brief.
  const screenRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (screen !== 'form' || !screenRef.current) return
    screenRef.current.querySelectorAll<HTMLElement>('[data-rise]').forEach((node, i) => {
      node.classList.remove('bp-rise')
      void node.offsetWidth
      node.style.animationDelay = `${i * 85}ms`
      node.classList.add('bp-rise')
    })
    grow(areaRef.current)
    screenRef.current.querySelector<HTMLElement>('input, textarea, select')?.focus()
  }, [screen, step])

  const set = (v: string) => {
    if (!q) return
    setFields((f) => ({ ...f, [q.key]: v }))
    setError(null)
  }

  const next = () => {
    if (!canAdvance) return
    setStep((s) => Math.min(QUESTIONS.length - 1, s + 1))
  }
  const back = () => {
    setError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  const send = async () => {
    if (!canAdvance || saving) return
    setSaving(true)
    setError(null)
    try {
      const r = await submitTeamForm(token, fields)
      if (r.state === 'done') setScreen('done')
      else if (r.state === 'invalid') setScreen('invalid')
      else setError(r.error ?? "We couldn't save your details just now. Please try again in a minute.")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Enter moves on; Shift+Enter is a line break in the long answers.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    if (e.shiftKey && q?.kind === 'long') return
    e.preventDefault()
    if (last) void send()
    else next()
  }

  const shown =
    error ?? (badEmail ? "That doesn't look like an email address." : null)

  return (
    <div className="bp-wrap jr-wrap">
      <img
        // Brown on every screen, the welcome photo included (Andy, 24 Sep).
        className="bp-logo qw-logo"
        src="/sequel-wordmark.png"
        alt="Written Sequel Logo"
        width={425}
        height={96}
      />

      {screen === 'invalid' && (
        <div className="bp-screen">
          <h2 className="bp-heading">This link isn't valid.</h2>
          <p className="bp-help">It may have already been used. Please ask your Sequel contact for a new one.</p>
        </div>
      )}

      {screen === 'welcome' && (
        <div className="bp-welcome">
          <div className="bp-hero jr-hero" style={{ backgroundImage: `url('${HERO_IMAGE}')` }} />
          <div className="bp-welcome-content">
            <h1 className="bp-welcome-heading">
              Sign up to the
              <br />
              Sequel Roster
            </h1>
            <p className="bp-help">
              All we need is some details on you and your work, it&rsquo;ll only take 5 minutes.
            </p>
            <button
              type="button"
              className="bp-button"
              onClick={() => {
                setStep(0)
                setScreen('form')
              }}
            >
              START
            </button>
          </div>
        </div>
      )}

      {screen === 'done' && (
        <div className="bp-screen">
          <h2 className="bp-heading">Thank you — we've got your details.</h2>
          <p className="bp-help">
            We'll be in touch when a brief comes up that suits you. You can close this window.
          </p>
        </div>
      )}

      {screen === 'form' && q && (
        <div className="bp-screen" ref={screenRef} onKeyDown={onKeyDown}>
          <h2 className="bp-heading" data-rise>
            {q.title}
          </h2>
          {q.help && (
            <p className="bp-help" data-rise>
              {q.help}
            </p>
          )}

          {(q.kind === 'text' || q.kind === 'email') && (
            <div className="bp-panel" data-rise>
              <input
                type={q.kind === 'email' ? 'email' : 'text'}
                className="bp-input"
                value={value}
                onChange={(e) => set(e.target.value)}
              />
            </div>
          )}

          {q.kind === 'long' && (
            <div className="bp-panel" data-rise>
              <textarea
                ref={areaRef}
                rows={1}
                className="bp-input"
                maxLength={q.max}
                value={value}
                onChange={(e) => {
                  set(e.target.value)
                  grow(e.target)
                }}
              />
              <p className="bp-hint">
                {q.max ? `${value.length} / ${q.max} characters · ` : ''}Shift ⇧ + Enter ↵ to make a line break
              </p>
            </div>
          )}

          {q.kind === 'country' && (
            <div className="bp-panel" data-rise>
              <select className="bp-input jr-select" value={value} onChange={(e) => set(e.target.value)}>
                <option value="">Choose a country…</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.country}
                  </option>
                ))}
              </select>
            </div>
          )}

          {shown && <p className="bp-help">{shown}</p>}

          <div className="bp-nav" data-rise>
            {step > 0 && (
              <button type="button" className="bp-button is-ghost" onClick={back}>
                BACK
              </button>
            )}
            {!last && (
              <button type="button" className={`bp-button${canAdvance ? '' : ' is-disabled'}`} onClick={next}>
                NEXT
              </button>
            )}
            {last && (
              <button type="button" className="bp-button" disabled={saving} onClick={() => void send()}>
                {saving ? 'SENDING…' : 'SEND MY DETAILS'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
