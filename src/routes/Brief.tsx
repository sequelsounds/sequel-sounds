import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  briefFlow,
  deadlineTooSoon,
  usePublicBrief,
  useSubmitBrief,
  type BriefAnswers,
} from '../lib/briefs'

/**
 * `/brief?token=…` — the client's briefing form, the old app's `/brief`
 * rebuilt. Public: the token is the only credential, and every rule that
 * matters is enforced again by `public.submit_brief`.
 *
 * Three screens, as the old page has them: welcome (photo left, greeting
 * right), one question at a time, thank you. A token that is unknown, used or
 * lapsed gets the "isn't valid" screen instead of the form.
 *
 * `&mode=staff` is added by Create brief so a supervisor filling the form in
 * is not greeted as the client. Wording only — it grants nothing.
 *
 * Layout and copy: the Webflow page, its stylesheet, the Wized bindings and
 * the page's own embed (rise animation, growing textarea, Enter to advance),
 * all read 16 Sep. Spec: `sequel-track-briefs.md`.
 */

type Stage = 'welcome' | 'form' | 'submitted'

/** The textarea starts at one line and grows to four, then scrolls. */
const MAX_LINES = 4

function grow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  const cs = getComputedStyle(el)
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5
  const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
  const max = Math.round(lineHeight * MAX_LINES + padding)
  if (el.scrollHeight > max) {
    el.style.height = `${max}px`
    el.style.overflowY = 'auto'
  } else {
    el.style.height = `${el.scrollHeight}px`
    el.style.overflowY = 'hidden'
  }
}

export default function Brief() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const staff = params.get('mode') === 'staff'
  const brief = usePublicBrief(token)
  const submit = useSubmitBrief(token)

  const [stage, setStage] = useState<Stage>('welcome')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<BriefAnswers>({})
  // The date as typed, kept apart from the composed answer so a half-typed
  // day survives — composing it back from the answer wiped the first digit.
  const [dateParts, setDateParts] = useState({ day: '', month: '', year: '' })

  useEffect(() => {
    document.title = 'Sequel | Brief'
  }, [])

  const flow = briefFlow(answers)
  const question = flow[step]
  const value = question ? (answers[question.key] ?? '') : ''
  const last = step === flow.length - 1
  const dateInvalid = question?.type === 'date' && deadlineTooSoon(value)
  const missing = !!question?.required && !String(value).trim()
  const canAdvance = !dateInvalid && !missing

  // ---- the rise, once per question, and the textarea's height
  const screenRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const title = question?.title
  useLayoutEffect(() => {
    if (stage !== 'form' || !screenRef.current) return
    const nodes = screenRef.current.querySelectorAll<HTMLElement>('[data-rise]')
    nodes.forEach((node, i) => {
      node.classList.remove('bp-rise')
      void node.offsetWidth
      node.style.animationDelay = `${i * 85}ms`
      node.classList.add('bp-rise')
    })
    grow(areaRef.current)
  }, [stage, title])

  const set = (key: string, v: string) => setAnswers((a) => ({ ...a, [key]: v }))

  const setDate = (part: 'day' | 'month' | 'year', v: string) => {
    const parts = { ...dateParts, [part]: v }
    setDateParts(parts)
    const day = parts.day.trim()
    const month = parts.month.trim()
    const year = parts.year.trim()
    const composed =
      day && month && year.length === 4 ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : ''
    if (question) set(question.key, composed)
  }

  const next = () => {
    if (!canAdvance) return
    setStep((s) => Math.min(flow.length - 1, s + 1))
  }
  const back = () => setStep((s) => Math.max(0, s - 1))
  const send = () => {
    if (!canAdvance || submit.isPending) return
    submit.mutate(answers, { onSuccess: () => setStage('submitted') })
  }

  // Enter moves on; Shift+Enter is a line break in the long answers.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    if (e.shiftKey && question?.type === 'long') return
    e.preventDefault()
    if (last) send()
    else next()
  }

  // ---- which screen
  const data = brief.data
  const lapsed = !!data?.expires_at && new Date(data.expires_at) < new Date()
  const invalid = !token || brief.isError || (brief.isSuccess && (!data || !!data.submitted_at || lapsed))
  const loading = !!token && brief.isPending
  // Submitting sets submitted_at, so the thank-you must win over "invalid".
  const screen: Stage | 'invalid' | 'loading' =
    stage === 'submitted' ? 'submitted' : loading ? 'loading' : invalid ? 'invalid' : stage

  const agency = (data?.agency ?? '').trim()
  const job = [(data?.brand ?? '').trim(), (data?.project_title ?? '').trim()].filter(Boolean).join(' - ')

  const welcomeHeading = staff
    ? agency
      ? `New brief for ${agency}`
      : 'New brief'
    : agency
      ? `Hey ${agency}, tell us what you're hearing.`
      : "Tell us what you're hearing."
  const welcomeSub = staff
    ? `You're filling this in on the client's behalf. It saves straight to the ${job ? job + ' ' : ''}project.`
    : job
      ? `Click start to submit your ${job} brief.`
      : 'Click start to submit your brief.'

  // A failed send warns only on the last question, where the button is.
  const error = dateInvalid
    ? 'We need at least 48 hours. Please choose a date from the day after tomorrow onwards.'
    : last && submit.isError
      ? submit.error.message || "That didn't send. Please try again."
      : null

  return (
    <div className="bp-wrap">
      <img
        className={`bp-logo${screen === 'welcome' ? ' is-on-dark' : ''}`}
        src="/sequel-wordmark.png"
        alt="Written Sequel Logo"
        width={425}
        height={96}
      />

      {screen === 'invalid' && (
        <div className="bp-screen">
          <h2 className="bp-heading">This link isn't valid.</h2>
          <p className="bp-help">
            It may have expired or already been submitted. Please ask your Sequel contact for a new one.
          </p>
        </div>
      )}

      {screen === 'welcome' && (
        <div className="bp-welcome">
          <div className="bp-hero" />
          <div className="bp-welcome-content">
            <h1 className="bp-welcome-heading">{welcomeHeading}</h1>
            <p className="bp-help">{welcomeSub}</p>
            <button
              type="button"
              className="bp-button"
              onClick={() => {
                // Always in at the first question.
                setStep(0)
                setStage('form')
              }}
            >
              START
            </button>
          </div>
        </div>
      )}

      {screen === 'submitted' && (
        <div className="bp-screen">
          <h2 className="bp-heading">{staff ? 'Brief saved.' : 'Thank you — brief received.'}</h2>
          <p className="bp-help">
            {staff
              ? "It's on the project now. You can close this tab."
              : "We'll be in touch shortly. You can close this window."}
          </p>
        </div>
      )}

      {screen === 'form' && question && (
        <div className="bp-screen" ref={screenRef} onKeyDown={onKeyDown}>
          <h2 className="bp-heading" data-rise>
            {question.title}
          </h2>
          {question.help && (
            <p className="bp-help" data-rise>
              {question.help}
            </p>
          )}

          {question.type === 'text' && (
            <div className="bp-panel" data-rise>
              {/* No key: the same box carries on from question to question, as
                  the old page's does, so focus stays put and Enter keeps
                  moving on. */}
              <input
                type="text"
                className="bp-input"
                value={value}
                onChange={(e) => set(question.key, e.target.value)}
              />
            </div>
          )}

          {question.type === 'long' && (
            <div className="bp-panel" data-rise>
              <textarea
                ref={areaRef}
                rows={1}
                className="bp-input"
                value={value}
                onChange={(e) => {
                  set(question.key, e.target.value)
                  grow(e.target)
                }}
              />
              <p className="bp-hint">Shift ⇧ + Enter ↵ to make a line break</p>
            </div>
          )}

          {question.type === 'choice' && (
            <div className="bp-panel" data-rise>
              {question.choices?.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`bp-choice${value === c.value ? ' is-selected' : ''}`}
                  onClick={() => set(question.key, c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {question.type === 'date' && (
            <div className="bp-panel" data-rise>
              <div className="bp-date-row">
                <div className="bp-date-field">
                  <p className="bp-date-label">Day</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    className="bp-date-part"
                    value={dateParts.day}
                    onChange={(e) => setDate('day', e.target.value)}
                  />
                </div>
                <p className="bp-date-sep">-</p>
                <div className="bp-date-field">
                  <p className="bp-date-label">Month</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    className="bp-date-part"
                    value={dateParts.month}
                    onChange={(e) => setDate('month', e.target.value)}
                  />
                </div>
                <p className="bp-date-sep">-</p>
                <div className="bp-date-field">
                  <p className="bp-date-label">Year</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    className="bp-date-part is-year"
                    value={dateParts.year}
                    onChange={(e) => setDate('year', e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {error && <p className="bp-help">{error}</p>}

          <div className="bp-nav" data-rise>
            {step > 0 && (
              <button type="button" className="bp-button is-ghost" onClick={back}>
                BACK
              </button>
            )}
            {!last && (
              <button
                type="button"
                className={`bp-button${canAdvance ? '' : ' is-disabled'}`}
                onClick={next}
              >
                NEXT
              </button>
            )}
            {/* Replaces NEXT on the last question, and only once it is answered. */}
            {last && !missing && (
              <button type="button" className="bp-button" onClick={send}>
                SUBMIT BRIEF
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
