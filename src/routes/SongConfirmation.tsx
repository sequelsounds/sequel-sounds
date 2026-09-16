import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  checkSigned,
  FIRMA_ORIGIN,
  openSigning,
  songStatus,
  submitSong,
  type ConfirmResult,
} from '../lib/songSchedule'

/**
 * `/song-confirmation?uuid=…` — the composer's form, the old app's page of the
 * same name rebuilt, then (new, Andy 16 Sep) the Schedule A signed in place.
 *
 * Public: the song's uuid is the only credential, as it was. Every rule that
 * matters is enforced again by the song-schedule-a edge function and
 * public.song_confirm_details.
 *
 * Layout, copy and CSS: the Webflow page and its song-confirm-* classes, read
 * 16 Sep — `claude/sequel-track-song-confirmation.md` §3–§5. The wizard is
 * the old one step for step:
 *   1 intro · 2 title · 3 how many · 4..3+N one composer each · 4+N summary
 * and then, new, the signing step, which embeds Firma's signing page.
 */

type Composer = { full_name: string; cae_number: string; share_split: string }
type Screen = 'loading' | 'invalid' | 'done' | 'form' | 'sign'

const blank = (): Composer => ({ full_name: '', cae_number: '', share_split: '' })

/** "e.g. 2" — a whole number of composers, at least one. */
function composerCount(v: string): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? n : 0
}

/** The share input keeps digits and a point, as the old page's does. */
const cleanShare = (v: string) => v.replace(/[^0-9.]/g, '')

function shareTotal(list: Composer[]): number {
  return list.reduce((sum, c) => sum + (parseFloat(c.share_split) || 0), 0)
}

function formatTotal(n: number): string {
  return String(Number(n.toFixed(2)))
}

export default function SongConfirmation() {
  const [params] = useSearchParams()
  const uuid = (params.get('uuid') ?? '').trim()

  // No uuid at all is "not valid" from the first paint.
  const [screen, setScreen] = useState<Screen>(() => (uuid ? 'loading' : 'invalid'))
  const [step, setStep] = useState(1)
  const [title, setTitle] = useState('')
  const [countText, setCountText] = useState('')
  const [composers, setComposers] = useState<Composer[]>([])
  const [titleError, setTitleError] = useState(false)
  const [countError, setCountError] = useState(false)
  const [composerError, setComposerError] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The signing step.
  const [signingUrl, setSigningUrl] = useState<string | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [slowFinish, setSlowFinish] = useState(false)
  // Bumped on every "still preparing" answer, so the retry runs again even
  // when `preparing` was already true.
  const [prepTick, setPrepTick] = useState(0)
  const finishingRef = useRef(false)

  useEffect(() => {
    document.title = 'Sequel | Song Confirmation'
  }, [])

  /** Applies whatever the function says the song's state now is. */
  const apply = useCallback((r: ConfirmResult) => {
    if (r.state === 'invalid') return setScreen('invalid')
    if (r.state === 'done') return setScreen('done')
    if (r.state === 'open') return setScreen('form')
    setScreen('sign')
    setPreparing(r.state === 'preparing')
    if (r.state === 'preparing') setPrepTick((t) => t + 1)
    setDeclined(!!r.declined)
    setSignError(r.error ?? null)
    if (r.signing_url) setSigningUrl(r.signing_url)
    else if (r.state === 'sign' && !r.error && !r.declined) {
      setSignError(
        "We couldn't prepare your Schedule A just now. Please try again in a minute, or contact Sequel if the problem continues.",
      )
    }
  }, [])

  const openSign = useCallback(async () => {
    if (!uuid) return
    setSignError(null)
    try {
      apply(await openSigning(uuid))
    } catch {
      setSignError(
        "We couldn't prepare your Schedule A just now. Please try again in a minute, or contact Sequel if the problem continues.",
      )
    }
  }, [uuid, apply])

  // Check_Song_Link_Status: anything but a good answer is "not valid".
  useEffect(() => {
    if (!uuid) return
    let live = true
    songStatus(uuid)
      .then((r) => {
        if (!live) return
        if (r.state === 'sign' || r.state === 'preparing') {
          setScreen('sign')
          void openSign()
        } else apply(r)
      })
      .catch(() => live && setScreen('invalid'))
    return () => {
      live = false
    }
  }, [uuid, apply, openSign])

  // A signing request another tab is still making: ask again shortly.
  useEffect(() => {
    if (screen !== 'sign' || !preparing) return
    const t = window.setTimeout(() => void openSign(), 3000)
    return () => window.clearTimeout(t)
  }, [screen, preparing, prepTick, openSign])

  // Firma's frame says it is done: ask the server, which asks Firma, until the
  // signed copy is ready. It usually is within seconds.
  const finish = useCallback(async () => {
    if (!uuid || finishingRef.current) return
    finishingRef.current = true
    setFinishing(true)
    for (let i = 0; i < 30; i++) {
      try {
        const r = await checkSigned(uuid)
        if (r.state === 'done') {
          finishingRef.current = false
          setFinishing(false)
          setScreen('done')
          return
        }
        if (r.declined) {
          finishingRef.current = false
          setFinishing(false)
          setDeclined(true)
          return
        }
      } catch {
        /* try again */
      }
      await new Promise((res) => window.setTimeout(res, 2000))
    }
    // Still not there: say so, and let the slow poll below carry on.
    finishingRef.current = false
    setFinishing(false)
    setSlowFinish(true)
  }, [uuid])

  useEffect(() => {
    if (screen !== 'sign') return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== FIRMA_ORIGIN) return
      const d = e.data as unknown
      const kind =
        typeof d === 'string'
          ? d
          : d && typeof d === 'object'
            ? String((d as { type?: unknown; event?: unknown }).type ?? (d as { event?: unknown }).event ?? '')
            : ''
      if (kind.includes('completed') || kind.includes('declined')) void finish()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [screen, finish])

  // And in case the frame's message never comes: look every 20 seconds.
  useEffect(() => {
    if (screen !== 'sign' || !signingUrl || finishing || declined) return
    const t = window.setInterval(() => {
      checkSigned(uuid)
        .then((r) => {
          if (r.state === 'done') setScreen('done')
          if (r.declined) setDeclined(true)
        })
        .catch(() => {})
    }, 20000)
    return () => window.clearInterval(t)
  }, [screen, signingUrl, finishing, declined, uuid])

  // ---- the wizard
  const n = composers.length
  const summaryStep = 4 + n
  const composerIndex = step - 4 // 0-based, on a composer step

  const toCount = () => {
    if (!title.trim()) return setTitleError(true)
    setTitleError(false)
    setStep(3)
  }

  const toComposers = () => {
    const count = composerCount(countText)
    if (!count) return setCountError(true)
    setCountError(false)
    // Keeps what was already typed for the writers that remain.
    setComposers((prev) => Array.from({ length: count }, (_, i) => prev[i] ?? blank()))
    setStep(4)
  }

  const nextComposer = () => {
    const c = composers[composerIndex]
    const share = parseFloat(c?.share_split ?? '')
    // Above 0 as the old page has it; at most 100, which the database also holds to.
    if (!c || !c.full_name.trim() || !(share > 0 && share <= 100)) return setComposerError(true)
    setComposerError(false)
    setStep(step + 1)
  }

  const backComposer = () => {
    setComposerError(false)
    setStep(Math.max(3, step - 1))
  }

  const setComposer = (patch: Partial<Composer>) =>
    setComposers((list) => list.map((c, i) => (i === composerIndex ? { ...c, ...patch } : c)))

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const r = await submitSong(
        uuid,
        title.trim(),
        composers.map((c) => ({
          full_name: c.full_name.trim(),
          cae_number: c.cae_number.trim(),
          share_split: parseFloat(c.share_split),
        })),
      )
      if (r.state === 'open') {
        setSubmitError(
          'Something went wrong submitting your details. Please try again, or contact Sequel if the problem continues.',
        )
      } else apply(r)
    } catch {
      setSubmitError(
        'Something went wrong submitting your details. Please try again, or contact Sequel if the problem continues.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  // Enter moves on from every input, as the old page's does.
  const onEnter = (go: () => void) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    go()
  }

  // song_progress_fill: (step - 1) / (4 + N), never past 95% until the end.
  const progress =
    screen === 'done'
      ? 100
      : screen === 'sign'
        ? 95
        : screen === 'form'
          ? Math.min(95, ((step - 1) / (4 + n)) * 100)
          : 0

  const total = shareTotal(composers)
  const focusRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    focusRef.current?.focus()
  }, [step, screen])

  return (
    <>
      <div className="sc-progress">
        <div className="sc-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="sc-body">
        <img className="sc-logo" src="/sequel-wordmark.png" alt="Written Sequel Logo" width={425} height={96} />

        {screen === 'invalid' && (
          <div className="sc-state">
            <h2 className="sc-heading">This link isn't valid</h2>
            <p className="sc-subtext">
              Please check the link in your email, or contact Sequel if you think this is a mistake.
            </p>
          </div>
        )}

        {screen === 'done' && (
          <div className="sc-state">
            <h2 className="sc-heading">You're all set</h2>
            <p className="sc-subtext">
              Thanks — this song's writer details have been confirmed. If you need to make any changes,
              contact Sequel.
            </p>
          </div>
        )}

        {screen === 'form' && step === 1 && (
          <div className="sc-intro">
            <div className="sc-intro-image-col">
              <img
                className="sc-intro-image"
                src="https://s3.amazonaws.com/webflow-prod-assets/68e6c2e8dbcd39de2547a97d/6a749a0bb96f4d8b7d86b215_Composition%20REgistration%20image-p-1600.jpg"
                alt="Sheet music"
              />
            </div>
            <div className="sc-intro-content">
              <h2 className="sc-heading">Congrats on the win. Let's get your paperwork in order.</h2>
              <p className="sc-subtext">
                We'll need your CAE/IPI numbers for each writer, so make sure you have them to hand.
              </p>
              {/* A block in the column, so it runs the column's width. */}
              <button type="button" className="sc-button is-block" onClick={() => setStep(2)}>
                Start
              </button>
            </div>
          </div>
        )}

        {screen === 'form' && step === 2 && (
          <div className="sc-step-title">
            <h2 className="sc-heading">Let's start by naming your winning track</h2>
            <p className="sc-subtext">This is also what we'll register it as.</p>
            <div className="sc-field-group">
              <input
                ref={focusRef}
                type="text"
                className="sc-input"
                placeholder="Type your answer here..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={onEnter(toCount)}
              />
            </div>
            {titleError && <p className="sc-warning">Please enter a track title.</p>}
            <div className="sc-nav">
              <button type="button" className="sc-button" onClick={toCount}>
                Submit
              </button>
              <button type="button" className="sc-back" onClick={() => setStep(1)}>
                Back
              </button>
            </div>
          </div>
        )}

        {screen === 'form' && step === 3 && (
          <div className="sc-state">
            <h2 className="sc-heading">How many composers wrote the track?</h2>
            <p className="sc-subtext">We'll ask for each writer's name, CAE number, and share split next.</p>
            <div className="sc-field-group">
              <input
                ref={focusRef}
                type="number"
                min={1}
                className="sc-input"
                placeholder="e.g. 2"
                value={countText}
                onChange={(e) => setCountText(e.target.value)}
                onKeyDown={onEnter(toComposers)}
              />
            </div>
            {countError && <p className="sc-warning">Please enter how many composers wrote the track.</p>}
            <div className="sc-nav">
              <button type="button" className="sc-button" onClick={toComposers}>
                Submit
              </button>
              <button type="button" className="sc-back" onClick={() => setStep(2)}>
                Back
              </button>
            </div>
          </div>
        )}

        {screen === 'form' && step >= 4 && step < summaryStep && composers[composerIndex] && (
          <div className="sc-state" key={step}>
            <h2 className="sc-heading">
              Composer {composerIndex + 1} of {n}
            </h2>
            <p className="sc-subtext">This should match their PRO registration.</p>
            <div className="sc-row-outer">
              <div className="sc-composer-row" onKeyDown={onEnter(nextComposer)}>
                <div className="sc-field-group">
                  <label className="sc-field-label" htmlFor="sc-name">
                    Full name
                  </label>
                  <input
                    ref={focusRef}
                    id="sc-name"
                    type="text"
                    className="sc-input"
                    placeholder="Type your answer here..."
                    value={composers[composerIndex].full_name}
                    onChange={(e) => setComposer({ full_name: e.target.value })}
                  />
                </div>
                <div className="sc-field-group">
                  <label className="sc-field-label" htmlFor="sc-cae">
                    CAE number
                  </label>
                  <input
                    id="sc-cae"
                    type="text"
                    className="sc-input"
                    placeholder="Type your answer here..."
                    value={composers[composerIndex].cae_number}
                    onChange={(e) => setComposer({ cae_number: e.target.value })}
                  />
                </div>
                <div className="sc-field-group">
                  <label className="sc-field-label" htmlFor="sc-share">
                    Share split %
                  </label>
                  <input
                    id="sc-share"
                    type="text"
                    inputMode="decimal"
                    className="sc-input"
                    placeholder="Type your answer here..."
                    value={composers[composerIndex].share_split}
                    onChange={(e) => setComposer({ share_split: cleanShare(e.target.value) })}
                  />
                </div>
              </div>
            </div>
            {composerError && (
              <p className="sc-warning">Please enter a name and share split for every composer.</p>
            )}
            <div className="sc-nav">
              <button type="button" className="sc-button" onClick={nextComposer}>
                Submit
              </button>
              <button type="button" className="sc-back" onClick={backComposer}>
                Back
              </button>
            </div>
          </div>
        )}

        {screen === 'form' && step === summaryStep && n > 0 && (
          <div className="sc-state">
            <h2 className="sc-heading">Check everything looks right</h2>
            <p className="sc-summary-title">{title.trim()}</p>
            <div className="sc-writers">
              <div className="sc-writer-header">
                <div className="sc-writer-name">Writer</div>
                <div className="sc-writer-cae">CAE</div>
                <div className="sc-writer-share">Share</div>
              </div>
              {composers.map((c, i) => (
                <div className="sc-writer-row" key={i}>
                  <div className="sc-writer-name">{c.full_name.trim()}</div>
                  <div className="sc-writer-cae">{c.cae_number.trim()}</div>
                  <div className="sc-writer-share">{formatTotal(parseFloat(c.share_split) || 0)}%</div>
                </div>
              ))}
            </div>
            <div className="sc-total">The share total is {formatTotal(total)}%</div>
            {Math.abs(total - 100) > 0.001 && (
              <p className="sc-warning">
                Typically, this value should equal 100%. Please double check before submitting.
              </p>
            )}
            {submitError && <p className="sc-warning">{submitError}</p>}
            <div className="sc-nav">
              <button type="button" className="sc-button" disabled={submitting} onClick={() => void submit()}>
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
              <button type="button" className="sc-back" onClick={() => setStep(step - 1)}>
                Back
              </button>
            </div>
          </div>
        )}

        {/* New, Andy 16 Sep: the Schedule A, filled in, signed here. */}
        {screen === 'sign' && (
          <div className="sc-sign">
            <h2 className="sc-heading">
              {declined ? 'This Schedule A was declined' : 'Sign your Schedule A'}
            </h2>
            {declined ? (
              <p className="sc-subtext">Contact Sequel if you think this is a mistake.</p>
            ) : slowFinish ? (
              <p className="sc-subtext">
                Thanks — we're finishing your Schedule A and will email you a copy. You can close this page.
              </p>
            ) : (
              <p className="sc-subtext">
                Check the details, then add your name and signature where marked. We'll email you a signed
                copy.
              </p>
            )}
            {signError && !declined && (
              <>
                <p className="sc-warning">{signError}</p>
                <div className="sc-nav">
                  <button type="button" className="sc-button" onClick={() => void openSign()}>
                    Try again
                  </button>
                </div>
              </>
            )}
            {!signError && !declined && !slowFinish && !signingUrl && (
              <p className="sc-subtext">Preparing your Schedule A…</p>
            )}
            {!signError && !declined && !slowFinish && signingUrl && (
              <div className="sc-sign-frame">
                <iframe
                  src={signingUrl}
                  title="Document Signing"
                  allow="camera;microphone;clipboard-write"
                />
                {finishing && <div className="sc-sign-finishing">Finishing up…</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
