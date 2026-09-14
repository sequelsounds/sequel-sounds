import { useMemo, useState } from 'react'
import {
  FEE_SCREENS,
  QUOTE_TYPES,
  emptyFees,
  quoteTotal,
  toAmount,
  useCreateQuote,
  useQuoteLookups,
  type FeeCategory,
  type FeeKey,
  type Option,
} from '../../lib/quoteWrites'

/**
 * The New Quote wizard, rebuilt from the old app's rather than designed here.
 *
 * It is a full-screen takeover, not a modal: SEQUEL and a close X in a thin
 * header, one question in the middle of an empty screen, BACK and NEXT in a
 * footer bar — with a running TOTAL in the middle of that bar on the fee
 * screens. Walked step by step on the old app's Commercial path before any of
 * this was written; the wording is copied off those screens.
 *
 * The steps, for all six non-MCPS paths:
 *
 *    1  Give this quote a short description:
 *    2  Who is the quote for?          the client
 *    3  Currency                       advances on choice
 *    4  Quote type                     six buttons
 *    5  Terms                          six fields, prefilled from the project
 *    6-12  the seven fee screens
 *    13 Do you need to add a song name?
 *    14 / 15  the song, then the artist   (only if YES)
 *    16 How many tracks does this quote cover?
 *    17 Summary                        → CREATE QUOTE
 *
 * ⚠️ Two of the old app's screens are deliberately NOT reproduced:
 *
 *   - **its step 5 is blank.** After picking Commercial you get an empty
 *     screen — no question, no buttons — and press NEXT on faith. It is the
 *     `searches_only_2` step: ungated, and no one could say which variable it
 *     wrote. Dropped, which also makes every non-MCPS path the same shape.
 *   - **four fee boxes all labelled "Sequel Licensing Fee"**, and a fifth
 *     called "Sequel Consultancy", none of which match the name the line is
 *     stored under. Each box is named for what it writes.
 *
 * ⚠️ Library (MCPS) is missing from the type buttons on purpose: that path
 * prices itself in Xano and the engine is not ported. Raising one still means
 * the old app until it is.
 *
 * ⚠️ A quote raised here is DELETED on the hour — `quotes` is still in the sync
 * and on the blocked side of it. See `lib/quoteWrites.ts`.
 */

type Props = {
  projectId: number
  /** Prefilled from the project, exactly as the old app prefills them. */
  prefill: {
    clientId: number | null
    term: string
    territory: string
    media: string
    scripts: string
    duration: string
    cutdowns: boolean | null
    songName: string
    artistName: string
  }
  onClose: () => void
  onCreated: (uuid: string) => void
}

type Answers = {
  description: string
  clientId: number | null
  currencyId: number | null
  serviceId: number | null
  term: string
  territory: string
  media: string
  scripts: string
  duration: string
  cutdowns: boolean | null
  hasSong: boolean | null
  songName: string
  artistName: string
  tracks: string
  fees: Record<FeeKey, FeeCategory>
}

/* The step list, built for the answers so far. A key per screen, so a question
   can be inserted without renumbering anything — the mistake the old app made
   with hardcoded step numbers and then had to undo. */
type StepKey =
  | 'description'
  | 'client'
  | 'currency'
  | 'type'
  | 'terms'
  | `fee:${FeeKey}`
  | 'song_gate'
  | 'song'
  | 'artist'
  | 'tracks'
  | 'summary'

function flowFor(a: Answers): StepKey[] {
  const steps: StepKey[] = ['description', 'client', 'currency', 'type', 'terms']
  for (const screen of FEE_SCREENS) steps.push(`fee:${screen.key}` as StepKey)
  steps.push('song_gate')
  if (a.hasSong === true) steps.push('song', 'artist')
  steps.push('tracks', 'summary')
  return steps
}

function Question({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="wizard-question">
      <h2 className="wizard-title">{title}</h2>
      {children}
    </div>
  )
}

function YesNo({
  value,
  onPick,
}: {
  value: boolean | null
  onPick: (next: boolean) => void
}) {
  return (
    <div className="wizard-yesno">
      <button
        type="button"
        className={`wizard-choice${value === true ? ' is-picked' : ''}`}
        onClick={() => onPick(true)}
      >
        YES
      </button>
      <button
        type="button"
        className={`wizard-choice${value === false ? ' is-picked' : ''}`}
        onClick={() => onPick(false)}
      >
        NO
      </button>
    </div>
  )
}

/** A fee screen: any number of supplier lines, then the one Sequel fee. */
function FeeScreen({
  heading,
  sequelLabel,
  category,
  showQuantity,
  onChange,
}: {
  heading: string
  sequelLabel: string
  category: FeeCategory
  showQuantity: boolean
  onChange: (next: FeeCategory) => void
}) {
  const setLine = (i: number, patch: Partial<{ description: string; cost: string }>) => {
    const lines = category.lines.map((l, j) => (i === j ? { ...l, ...patch } : l))
    onChange({ ...category, lines })
  }

  return (
    <div className="wizard-question is-wide">
      <div className="wizard-fee-head">
        <h2 className="wizard-title">{heading}</h2>
        <button
          type="button"
          className="btn btn-mono btn-outline"
          onClick={() => onChange({ ...category, lines: [...category.lines, { description: '', cost: '' }] })}
        >
          + ENTRY
        </button>
      </div>

      {category.lines.map((line, i) => (
        <div key={i} className="wizard-fee-row">
          <input
            className="wizard-input"
            placeholder="Description"
            value={line.description}
            onChange={(e) => setLine(i, { description: e.target.value })}
          />
          <input
            className="wizard-input wizard-input-amount"
            inputMode="decimal"
            placeholder="0"
            value={line.cost}
            onChange={(e) => setLine(i, { cost: e.target.value })}
          />
          {/* The old app's delete X. Never on the last remaining row — a fee
              screen with no line at all has nothing to type into. */}
          {category.lines.length > 1 ? (
            <button
              type="button"
              className="wizard-fee-delete"
              aria-label="Remove this line"
              onClick={() =>
                onChange({ ...category, lines: category.lines.filter((_, j) => j !== i) })
              }
            >
              ×
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}

      {showQuantity && (
        <div className="wizard-fee-row">
          <span className="wizard-fee-label">Sequel Search Quantity</span>
          <input
            className="wizard-input wizard-input-amount"
            inputMode="numeric"
            placeholder="0"
            value={category.searchQuantity ?? ''}
            onChange={(e) => onChange({ ...category, searchQuantity: e.target.value })}
          />
          <span />
        </div>
      )}

      <div className="wizard-fee-row">
        <span className="wizard-fee-label">{sequelLabel}</span>
        <input
          className="wizard-input wizard-input-amount"
          inputMode="decimal"
          placeholder="0"
          value={category.sequel}
          onChange={(e) => onChange({ ...category, sequel: e.target.value })}
        />
        <span />
      </div>

      {showQuantity && (
        /* ⚠️ Confirmed intentional, and worth saying on the screen: a search
           fee is typed as a TOTAL, not a rate. 2,000 against a quantity of two
           means 2,000 for both searches. */
        <p className="wizard-note">A total for all the searches, not a price each.</p>
      )}
    </div>
  )
}

const amount = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function NewQuote({ projectId, prefill, onClose, onCreated }: Props) {
  const lookups = useQuoteLookups()
  const create = useCreateQuote(projectId)

  const [a, setA] = useState<Answers>({
    description: '',
    clientId: prefill.clientId,
    currencyId: null,
    serviceId: null,
    term: prefill.term,
    territory: prefill.territory,
    media: prefill.media,
    scripts: prefill.scripts,
    duration: prefill.duration,
    cutdowns: prefill.cutdowns,
    hasSong: null,
    songName: prefill.songName,
    artistName: prefill.artistName,
    tracks: '',
    fees: emptyFees(),
  })
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const flow = useMemo(() => flowFor(a), [a])
  const key = flow[Math.min(step, flow.length - 1)]
  const patch = (next: Partial<Answers>) => setA((prev) => ({ ...prev, ...next }))

  const tracks = a.tracks.trim() === '' ? null : Number(a.tracks)
  const total = quoteTotal(a.fees, tracks)

  /**
   * NEXT is hidden until the question is answered, rather than shown and then
   * refused — the same call Andy made on the New Project wizard. The old app
   * shows "PLEASE COMPLETE ALL SECTIONS" after the fact instead.
   *
   * The fee screens and the terms screen are all optional: a quote can be
   * raised with nothing in a category.
   */
  const answered = (): boolean => {
    switch (key) {
      case 'description':
        return a.description.trim() !== ''
      case 'client':
        return a.clientId !== null
      case 'currency':
        return a.currencyId !== null
      case 'type':
        return a.serviceId !== null
      case 'song_gate':
        return a.hasSong !== null
      default:
        return true
    }
  }

  const showNext = key !== 'type' && key !== 'song_gate' && key !== 'summary' && answered()
  const canCreate = a.clientId !== null && a.currencyId !== null && a.serviceId !== null

  const next = () => {
    setError(null)
    setStep((s) => Math.min(s + 1, flow.length - 1))
  }
  const back = () => {
    setError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function submit() {
    if (!canCreate) return
    setError(null)
    try {
      const row = await create.mutateAsync({
        projectId,
        clientId: a.clientId!,
        currencyId: a.currencyId!,
        serviceId: a.serviceId!,
        description: a.description.trim(),
        term: a.term.trim(),
        territory: a.territory.trim(),
        media: a.media.trim(),
        scripts: a.scripts.trim(),
        duration: a.duration.trim(),
        cutdowns: a.cutdowns,
        songName: a.hasSong ? a.songName.trim() : '',
        artistName: a.hasSong ? a.artistName.trim() : '',
        tracksQuoted: tracks !== null && Number.isFinite(tracks) ? Math.trunc(tracks) : null,
        fees: a.fees,
      })
      onCreated(row.uuid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not raise that quote.')
    }
  }

  const feeKey = key.startsWith('fee:') ? (key.slice(4) as FeeKey) : null
  const screen = feeKey ? FEE_SCREENS.find((s) => s.key === feeKey)! : null

  return (
    <div className="wizard" role="dialog" aria-modal="true" aria-label="New quote">
      <div className="wizard-head">
        <span className="wizard-mark">SEQUEL</span>
        <button type="button" className="wizard-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="wizard-body">
        {key === 'description' && (
          <Question title="Give this quote a short description:">
            <input
              className="wizard-input"
              autoFocus
              placeholder="Example: Demos &amp; License (Worldwide)"
              value={a.description}
              onChange={(e) => patch({ description: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && a.description.trim() !== '') next()
              }}
            />
          </Question>
        )}

        {key === 'client' && (
          <Question title="Who is the quote for?">
            <select
              className="wizard-input"
              value={a.clientId ?? ''}
              onChange={(e) => patch({ clientId: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">Please Select</option>
              {(lookups.data?.clients ?? []).map((c: Option) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Question>
        )}

        {key === 'currency' && (
          <Question title="Currency">
            {/* Advances on choice, as the old app's does. */}
            <select
              className="wizard-input"
              value={a.currencyId ?? ''}
              onChange={(e) => {
                if (e.target.value === '') return
                patch({ currencyId: Number(e.target.value) })
                next()
              }}
            >
              <option value="">Please Select</option>
              {(lookups.data?.currencies ?? []).map((c: Option) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Question>
        )}

        {key === 'type' && (
          <Question title="Quote type">
            <div className="wizard-types">
              {QUOTE_TYPES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  className={`wizard-choice${a.serviceId === t.id && t.label !== 'Library (Manual)' ? ' is-picked' : ''}`}
                  onClick={() => {
                    patch({ serviceId: t.id })
                    next()
                  }}
                >
                  {t.label.toUpperCase()}
                </button>
              ))}
              {/* ⚠️ Present and unusable rather than absent, so nobody hunts for
                  it. The MCPS path prices itself and the engine is not ported. */}
              <button type="button" className="wizard-choice" disabled title="Raise MCPS library quotes in the old app until the pricing engine is ported">
                LIBRARY (MCPS)
              </button>
            </div>
            <p className="wizard-note">
              Library (MCPS) prices itself. Until that engine is rebuilt, raise those in the old app.
            </p>
          </Question>
        )}

        {key === 'terms' && (
          <div className="wizard-question is-wide">
            {/* Prefilled from the project, then edited freely. ⚠️ Editing here
                never writes back to the project: the project's terms are a
                working pool and the quote takes a snapshot. */}
            <label className="wizard-field-label">Term</label>
            <input className="wizard-input" value={a.term} onChange={(e) => patch({ term: e.target.value })} />
            <label className="wizard-field-label">Territory</label>
            <input className="wizard-input" value={a.territory} onChange={(e) => patch({ territory: e.target.value })} />
            <label className="wizard-field-label">Media</label>
            <input className="wizard-input" value={a.media} onChange={(e) => patch({ media: e.target.value })} />
            <label className="wizard-field-label">Scripts</label>
            <input className="wizard-input" value={a.scripts} onChange={(e) => patch({ scripts: e.target.value })} />
            <label className="wizard-field-label">Duration</label>
            <input className="wizard-input" value={a.duration} onChange={(e) => patch({ duration: e.target.value })} />
            <label className="wizard-field-label">Cutdowns Required?</label>
            <YesNo value={a.cutdowns} onPick={(v) => patch({ cutdowns: v })} />
          </div>
        )}

        {screen && feeKey && (
          <FeeScreen
            heading={screen.heading}
            sequelLabel={screen.sequelLabel}
            category={a.fees[feeKey]}
            showQuantity={feeKey === 'searches'}
            onChange={(next) => patch({ fees: { ...a.fees, [feeKey]: next } })}
          />
        )}

        {key === 'song_gate' && (
          <Question title="Do you need to add a song name?">
            <YesNo
              value={a.hasSong}
              onPick={(v) => {
                // ⚠️ NO blanks the track, so a late change of mind cannot leave
                // a stale song on the quote.
                patch(v ? { hasSong: true } : { hasSong: false, songName: '', artistName: '' })
                next()
              }}
            />
          </Question>
        )}

        {key === 'song' && (
          <Question title="What is the song called?">
            <input
              className="wizard-input"
              autoFocus
              value={a.songName}
              onChange={(e) => patch({ songName: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
          </Question>
        )}

        {key === 'artist' && (
          <Question title="And the artist?">
            <input
              className="wizard-input"
              autoFocus
              value={a.artistName}
              onChange={(e) => patch({ artistName: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
          </Question>
        )}

        {key === 'tracks' && (
          <Question title="How many tracks does this quote cover?">
            {/* Digits only. Blank and 0 are both allowed and both price as one
                track — a quote covering no tracks still charges its fees once,
                it does not charge nothing. */}
            <input
              className="wizard-input"
              autoFocus
              inputMode="numeric"
              value={a.tracks}
              onChange={(e) => patch({ tracks: e.target.value.replace(/[^\d]/g, '') })}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
          </Question>
        )}

        {key === 'summary' && (
          <div className="wizard-question is-wide">
            <h2 className="wizard-title">Summary</h2>
            {FEE_SCREENS.map((s) => {
              const cat = a.fees[s.key]
              const sum =
                cat.lines.reduce((t, l) => t + toAmount(l.cost), 0) + toAmount(cat.sequel)
              const shown = s.multiply && tracks && tracks > 0 ? sum * tracks : sum
              return (
                <div key={s.key} className="wizard-summary-row">
                  <span>{s.heading}</span>
                  <span className="wizard-summary-amount">{amount.format(shown)}</span>
                </div>
              )
            })}
            <div className="wizard-summary-row is-total">
              <span>QUOTE TOTAL</span>
              <span className="wizard-summary-amount">{amount.format(total)}</span>
            </div>
            {error && <p className="form-error">{error}</p>}
          </div>
        )}
      </div>

      <div className="wizard-foot">
        {step > 0 ? (
          <button type="button" className="btn btn-mono btn-outline" onClick={back}>
            BACK
          </button>
        ) : (
          <span />
        )}

        {/* The middle cell is always rendered, empty or not: the footer is a
            three-column grid, and leaving it out slides NEXT into the middle. */}
        {feeKey || key === 'summary' ? (
          <span className="wizard-total">
            TOTAL <strong>{amount.format(total)}</strong>
          </span>
        ) : (
          <span />
        )}

        {key === 'summary' ? (
          <button
            type="button"
            className="btn btn-mono btn-outline"
            disabled={!canCreate || create.isPending}
            onClick={() => void submit()}
          >
            {create.isPending ? 'CREATING…' : 'CREATE QUOTE'}
          </button>
        ) : showNext ? (
          <button type="button" className="btn btn-mono btn-outline" onClick={next}>
            NEXT
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
