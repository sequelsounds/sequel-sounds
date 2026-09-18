import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { signSchedule, songStatus, submitSong, type ConfirmResult, type Schedule } from '../lib/songSchedule'

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
 * and then, new, the signing step: the Schedule A as it will be signed, a
 * typed name, a consent tick and SIGN. Sequel's own — Firma's embedded
 * signing was tried first and dropped (Andy, 16 Sep: slow, a third party's
 * terms, its own styling in a frame, a long wait after signing).
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
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [signerName, setSignerName] = useState('')
  const [consent, setConsent] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  // Set when this visit did the signing, so "all set" can say so.
  const [justSigned, setJustSigned] = useState(false)

  useEffect(() => {
    document.title = 'Sequel | Song Confirmation'
  }, [])

  /** Applies whatever the function says the song's state now is. */
  const apply = useCallback((r: ConfirmResult) => {
    if (r.state === 'invalid') return setScreen('invalid')
    if (r.state === 'done') return setScreen('done')
    if (r.state === 'open') return setScreen('form')
    if (!r.schedule) return setScreen('invalid')
    setSchedule(r.schedule)
    setScreen('sign')
  }, [])

  // Check_Song_Link_Status: anything but a good answer is "not valid".
  useEffect(() => {
    if (!uuid) return
    let live = true
    songStatus(uuid)
      .then((r) => live && apply(r))
      .catch(() => live && setScreen('invalid'))
    return () => {
      live = false
    }
  }, [uuid, apply])

  const sign = async () => {
    if (!schedule || signing) return
    if (signerName.trim().length < 2) return setSignError('Please type your full name to sign.')
    if (!consent) return setSignError('Please tick the box to agree to sign electronically.')
    setSigning(true)
    setSignError(null)
    try {
      const r = await signSchedule(uuid, signerName.trim(), consent, schedule.details_hash)
      if (r.state === 'done') {
        setJustSigned(true)
        setScreen('done')
      } else if (r.state === 'sign') {
        if (r.schedule) setSchedule(r.schedule)
        setSignError(r.error ?? null)
      } else apply(r)
    } catch (e) {
      setSignError((e as Error).message)
    } finally {
      setSigning(false)
    }
  }

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
        <img
        className="sc-logo qw-logo"
        src="/sequel-wordmark.png"
        alt="Written Sequel Logo"
        width={425}
        height={96}
      />

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
            {justSigned ? (
              <p className="sc-subtext">
                Thanks — your Schedule A is signed.
                {schedule?.email ? ` We've emailed a copy to ${schedule.email}.` : ''} If anything needs
                changing, contact Sequel.
              </p>
            ) : (
              <p className="sc-subtext">
                Thanks — this song's writer details have been confirmed. If you need to make any changes,
                contact Sequel.
              </p>
            )}
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
            <div className="sc-summary-label">Track title</div>
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
              <div className="sc-writer-total">
                <div className="sc-writer-name">Total</div>
                <div className="sc-writer-share">{formatTotal(total)}%</div>
              </div>
            </div>
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
        {screen === 'sign' && schedule && (
          <div className="sc-sign">
            <div className="sc-sign-inner">
              <h2 className="sc-heading">Sign your Schedule A</h2>
              <p className="sc-subtext">
                Check the details below, then type your full name to sign.
                {schedule.email ? ` We'll email a signed copy to ${schedule.email}.` : ''}
              </p>

              <section className="sc-doc" aria-label="Schedule A">
                <div className="sc-doc-head">
                  <div className="sc-doc-title">Schedule A</div>
                  <p className="sc-doc-terms">
                    Musical Works created by the Composer for the Company shall be subject to the Terms and
                    Definitions of this Agreement. In the case that the Company successfully places a Musical
                    Work created by the Composer for any Production, said Musical Work shall be added to this
                    Schedule.
                  </p>
                </div>

                <dl className="sc-doc-fields">
                  <div className="sc-doc-field is-wide">
                    <dt>Musical work title</dt>
                    <dd className="sc-doc-value-lg">{schedule.title}</dd>
                  </div>
                  <div className="sc-doc-field is-wide">
                    <dt>Composer(s)</dt>
                    <dd>
                      <div className="sc-doc-writer is-head">
                        <div>Name</div>
                        <div className="sc-doc-writer-right">
                          <span>IPI/CAE</span>
                          <span>Share</span>
                        </div>
                      </div>
                      {schedule.writers.map((w, i) => (
                        <div className="sc-doc-writer" key={i}>
                          <div className="sc-doc-writer-name">{w.full_name}</div>
                          <div className="sc-doc-writer-right">
                            <span>{w.cae_number || '—'}</span>
                            <span>{formatTotal(w.share_split)}%</span>
                          </div>
                        </div>
                      ))}
                    </dd>
                  </div>
                  <div className="sc-doc-field">
                    <dt>Brand</dt>
                    <dd>{schedule.brand || '—'}</dd>
                  </div>
                  <div className="sc-doc-field">
                    <dt>Production title</dt>
                    <dd>{schedule.productionTitle || '—'}</dd>
                  </div>
                  <div className="sc-doc-field">
                    <dt>Commencement date</dt>
                    <dd>{schedule.commencementDate || '—'}</dd>
                  </div>
                  <div className="sc-doc-field">
                    <dt>Ownership</dt>
                    <dd>{schedule.ownership || '—'}</dd>
                  </div>
                </dl>
              </section>

              <div className="sc-signoff">
                <div className="sc-field-label">Accepted and agreed, for and on behalf of {schedule.team}</div>
                <div className="sc-signature" aria-hidden="true">
                  {signerName.trim() || '\u00a0'}
                </div>
                <label className="sc-field-group" htmlFor="sc-signer">
                  <span className="sc-field-label">Your full name</span>
                  <input
                    id="sc-signer"
                    className="sc-input"
                    placeholder="e.g. Alex Morgan"
                    autoComplete="name"
                    maxLength={120}
                    value={signerName}
                    onChange={(e) => {
                      setSignerName(e.target.value)
                      setSignError(null)
                    }}
                    onKeyDown={onEnter(() => void sign())}
                  />
                </label>
                <label className="sc-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => {
                      setConsent(e.target.checked)
                      setSignError(null)
                    }}
                  />
                  <span>{schedule.consent}</span>
                </label>
                {signError && <p className="sc-warning">{signError}</p>}
                <div className="sc-nav">
                  {/* The brief form's button (Andy, 16 Sep). Never dimmed: pressed
                      too early, it says what is missing. */}
                  <button
                    type="button"
                    className="bp-button"
                    disabled={signing}
                    onClick={() => void sign()}
                  >
                    {signing ? 'SIGNING…' : 'SIGN'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
