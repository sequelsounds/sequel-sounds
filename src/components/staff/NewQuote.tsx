import { useMemo, useState } from 'react'
import SequelLogo from '../SequelLogo'
import { InfoIcon } from './icons'
import {
  FEE_SCREENS,
  formatAmount,
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
import {
  classifyTerritory,
  DURATION_LONGER,
  DURATION_SHORTER,
  MEDIA_BUTTONS,
  quoteEstimate,
  SEARCH_COUNTS,
  useClientRegion,
  useCreateMcpsQuote,
  useMcpsReference,
} from '../../lib/mcpsQuote'
import { MCPS_SERVICE_ID } from '../../lib/quoteWrites'
import { ONLINE_INCL_SOCIAL, SOCIAL_ONLY, type TerritoryStructure } from '../../lib/mcpsPricing'

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
 * ⚠️ Library (MCPS) is the seventh path and it does not look like the other
 * six. It asks eight questions of its own — media, worldwide, territories,
 * online worldwide, scripts, duration, cutdowns, searches — because each one
 * drives a PRICE rather than describing the licence, and it has no terms
 * screen and no fee screens at all: nobody types an amount on this path. The
 * engine works the price out (`lib/mcpsPricing.ts`) from the rate card.
 *
 *    4  Are you quoting for Sequel searches only?   YES stops after searches
 *    5  Media                                       eight buttons, multi-pick
 *    6  Is the Territory Worldwide?
 *    7  Please list the territories you need to cover:   (only if NO)
 *    8  Is the online usage worldwide?              (only if online media)
 *    9  Multiple Scripts?
 *   10  How long is the longest film?
 *   11  Cutdowns required?
 *   12-14  the song gate and track count, shared with the other six
 *   15  How many searches?
 *   16  Summary                                     → CREATE ESTIMATE
 *
 * The wording is the old app's, read off the live page on 14 September. The
 * LOOK is this wizard's, not the old page's — Andy's call the same day: seven
 * paths through one wizard should not look like two products.
 *
 * DEMOS is the eighth path, added to the old app on 17 Sep 2026 and copied
 * here the same day (`claude/sequel-track-demos-estimate.md` in the project):
 *
 *    4  DEMOS                                       saved as Composition
 *    5  Production                                  the only fee screen
 *    6  Summary                                     → CREATE QUOTE
 *
 * No terms, no song, no track count. Terms, song and artist are sent BLANK and
 * tracks as null, so the estimate's terms block hides itself and production is
 * charged once — otherwise the project's terms, prefilled below, would land on
 * a demos estimate.
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

  /* ── The MCPS path. Untouched on the other six. ────────────────────────── */

  /** Library (MCPS) and Library (Manual) are BOTH service 3, so the service id
      cannot tell them apart. This is what picks the flow. */
  isMcps: boolean
  /** DEMOS is service 1, the same as Composition. This is what picks the flow. */
  isDemos: boolean
  searchesOnly: boolean | null
  /** Rate card media names, NOT the button labels. See MEDIA_BUTTONS. */
  mcpsMedia: string[]
  worldwide: boolean | null
  territories: string
  /** The classifier's reading of `territories`. Null until it has answered. */
  structure: TerritoryStructure | null
  /** Defaults TRUE — online usage is worldwide in the large majority of cases. */
  onlineWorldwide: boolean | null
  multipleScripts: boolean | null
  mcpsDuration: string
  mcpsCutdowns: boolean | null
  searchesCount: number | null
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
  | 'searches_only'
  | 'media'
  | 'worldwide'
  | 'territories'
  | 'online_ww'
  | 'scripts'
  | 'duration'
  | 'cutdowns'
  | 'mcps_searches'

/** Is any online medium selected? Decides whether the online question applies. */
function hasOnline(media: string[]): boolean {
  return media.includes(ONLINE_INCL_SOCIAL) || media.includes(SOCIAL_ONLY)
}

function flowFor(a: Answers): StepKey[] {
  const steps: StepKey[] = ['description', 'client', 'currency', 'type']

  if (a.isDemos) {
    steps.push('fee:production', 'summary')
    return steps
  }

  if (a.isMcps) {
    steps.push('searches_only')
    // A searches-only estimate stops here. It buys no licence, so every
    // question after this one would be asking about something nobody is
    // paying for — and the old app used to STORE the answers to questions it
    // never asked, asserting a perpetual worldwide licence on a £750 quote.
    if (a.searchesOnly === true) {
      steps.push('mcps_searches', 'summary')
      return steps
    }
    steps.push('media', 'worldwide')
    if (a.worldwide === false) steps.push('territories')
    // Only worth asking when there is an online medium to apply it to, and
    // only when the licence is not worldwide already.
    if (a.worldwide === false && hasOnline(a.mcpsMedia)) steps.push('online_ww')
    steps.push('scripts', 'duration', 'cutdowns', 'song_gate')
    if (a.hasSong === true) steps.push('song', 'artist')
    steps.push('tracks', 'mcps_searches', 'summary')
    return steps
  }

  steps.push('terms')
  for (const screen of FEE_SCREENS) steps.push(`fee:${screen.key}` as StepKey)
  steps.push('song_gate')
  if (a.hasSong === true) steps.push('song', 'artist')
  steps.push('tracks', 'summary')
  return steps
}

/**
 * `info` puts an i beside the title; the note shows under the question only
 * once it is clicked (Andy, 26 Sep 2026 — the Media note was always on show).
 */
function Question({
  title,
  info,
  children,
}: {
  title: string
  info?: React.ReactNode
  children?: React.ReactNode
}) {
  const [showInfo, setShowInfo] = useState(false)
  return (
    <div className="qw-question">
      <h2 className="qw-title">
        {title}
        {info && (
          <button
            type="button"
            className="qw-info"
            aria-label={showInfo ? 'Hide the note' : 'Show the note'}
            aria-expanded={showInfo}
            onClick={() => setShowInfo(!showInfo)}
          >
            <InfoIcon size="1.1rem" />
          </button>
        )}
      </h2>
      {children}
      {info && showInfo && <p className="qw-note">{info}</p>}
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
    <div className="qw-yesno">
      <button
        type="button"
        className={`qw-choice${value === true ? ' is-picked' : ''}`}
        onClick={() => onPick(true)}
      >
        YES
      </button>
      <button
        type="button"
        className={`qw-choice${value === false ? ' is-picked' : ''}`}
        onClick={() => onPick(false)}
      >
        NO
      </button>
    </div>
  )
}

/**
 * The eight media buttons — multi-pick, unlike every other button group here.
 *
 * ⚠️ The label and the value are different strings. What is shown is the old
 * app's shorthand (VOD, CINEMA DVD); what is stored has to be the rate card's
 * media name exactly, because the engine looks rows up by it and a near miss
 * matches nothing, prices the medium at zero and quietly falls the whole quote
 * back to the All Media cap.
 */
function MediaPicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="qw-media">
      {MEDIA_BUTTONS.map((m) => {
        const picked = value.includes(m.value)
        return (
          <button
            key={m.value}
            type="button"
            className={`qw-choice${picked ? ' is-picked' : ''}`}
            aria-pressed={picked}
            onClick={() =>
              onChange(picked ? value.filter((v) => v !== m.value) : [...value, m.value])
            }
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * An amount field. Holds the raw text, shows it grouped when it is not focused.
 *
 * ⚠️ Not formatted on change: reformatting mid-keystroke moves the caret to the
 * front of the field, so 2500 becomes 2,500 with the cursor in the wrong place
 * and the next digit lands inside the number.
 */
function AmountInput({
  value,
  onChange,
  numeric,
}: {
  value: string
  onChange: (next: string) => void
  /** Whole numbers only — the search count. */
  numeric?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      className="qw-input qw-input-amount"
      inputMode={numeric ? 'numeric' : 'decimal'}
      placeholder="0"
      value={focused ? value : formatAmount(value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(/,/g, '')
        onChange(numeric ? raw.replace(/[^\d]/g, '') : raw.replace(/[^\d.]/g, ''))
      }}
    />
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
    <div className="qw-question is-wide">
      <div className="qw-fee-head">
        <h2 className="qw-title">{heading}</h2>
        <button
          type="button"
          className="qw-choice"
          onClick={() => onChange({ ...category, lines: [...category.lines, { description: '', cost: '' }] })}
        >
          + ENTRY
        </button>
      </div>

      {category.lines.map((line, i) => (
        <div key={i} className="qw-fee-row">
          <input
            className="qw-input"
            placeholder="Description"
            value={line.description}
            onChange={(e) => setLine(i, { description: e.target.value })}
          />
          <AmountInput value={line.cost} onChange={(cost) => setLine(i, { cost })} />
          {/* The old app's delete X. Never on the last remaining row — a fee
              screen with no line at all has nothing to type into. */}
          {category.lines.length > 1 ? (
            <button
              type="button"
              className="qw-fee-delete"
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
        <div className="qw-fee-row">
          <span className="qw-fee-label">Sequel Search Quantity</span>
          <AmountInput
            numeric
            value={category.searchQuantity ?? ''}
            onChange={(searchQuantity) => onChange({ ...category, searchQuantity })}
          />
          <span />
        </div>
      )}

      <div className="qw-fee-row">
        <span className="qw-fee-label">{sequelLabel}</span>
        <AmountInput value={category.sequel} onChange={(sequel) => onChange({ ...category, sequel })} />
        <span />
      </div>

      {showQuantity && (
        /* ⚠️ Confirmed intentional, and worth saying on the screen: a search
           fee is typed as a TOTAL, not a rate. 2,000 against a quantity of two
           means 2,000 for both searches. */
        <p className="qw-note">A total for all the searches, not a price each.</p>
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

    isMcps: false,
    isDemos: false,
    searchesOnly: null,
    mcpsMedia: [],
    worldwide: null,
    territories: '',
    structure: null,
    // ⚠️ Defaults TRUE, matching the old app's input default. Online usage is
    // worldwide in the large majority of cases, and online often ends up
    // worldwide anyway because it is cheaper than three separate countries.
    onlineWorldwide: true,
    multipleScripts: null,
    mcpsDuration: '',
    mcpsCutdowns: null,
    searchesCount: null,
  })
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** The classifier is a network call, and NEXT waits for it. */
  const [classifying, setClassifying] = useState(false)

  const reference = useMcpsReference()
  const region = useClientRegion(a.isMcps ? a.clientId : null)
  const createMcps = useCreateMcpsQuote(projectId)

  const flow = useMemo(() => flowFor(a), [a])
  const key = flow[Math.min(step, flow.length - 1)]
  const patch = (next: Partial<Answers>) => setA((prev) => ({ ...prev, ...next }))

  // A demos estimate has no track count, even if one was typed on another
  // path before BACK: production is charged once.
  const tracks = a.isDemos || a.tracks.trim() === '' ? null : Number(a.tracks)
  const total = quoteTotal(a.fees, tracks)

  const currencyLabel =
    (lookups.data?.currencies ?? []).find((c: Option) => c.id === a.currencyId)?.label ?? ''

  /**
   * The answers the engine takes. Assembled here rather than held in state so
   * there is one shape, not two that can drift.
   *
   * ⚠️ `worldwideAnswer` is the BUTTON, and it replaces the typed territory
   * rather than sitting beside it — the old app stores "Worldwide" as the
   * requested territory in that case, not an empty string.
   */
  const mcpsAnswers = {
    media: a.mcpsMedia,
    territoryText: a.territories.trim(),
    worldwideAnswer: a.worldwide === true,
    territory:
      a.structure ??
      ({
        is_worldwide: a.worldwide === true,
        whole_continents: [],
        countries: [],
        distinct_continents: [],
      } as TerritoryStructure),
    multipleScripts: a.multipleScripts === true,
    duration: a.mcpsDuration,
    cutdowns: a.mcpsCutdowns === true,
    onlineWorldwide: a.onlineWorldwide !== false,
    tracks: tracks !== null && Number.isFinite(tracks) ? Math.trunc(tracks) : null,
    searchesCount: a.searchesCount ?? 0,
    searchesOnly: a.searchesOnly === true,
  }

  const estimate = a.isMcps
    ? quoteEstimate(mcpsAnswers, reference.data, region.data, currencyLabel)
    : null

  /**
   * The running total carries its CURRENCY CODE, because a quote can be raised
   * in any of the currencies in table 48 and `$` is stored for both USD and
   * SGD — the same reason the document shows codes rather than symbols.
   *
   * ⚠️ The track count was tried here too and taken out again — Andy's call,
   * 14 Sep: not helpful. Six of the seven fee screens do multiply by it, so
   * the figure still changes on the way to the summary; it just is not
   * something the bar needs to explain.
   *
   * Currency is chosen at step three, before any fee screen, so by the time
   * this bar appears it is always set. The fallback covers the lookup not
   * having landed yet.
   */
  const shownTotal = a.isMcps ? (estimate ? estimate.grandTotal / 100 : 0) : total
  const totalText = [currencyLabel, amount.format(shownTotal)].filter(Boolean).join(' ')

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
      case 'media':
        return a.mcpsMedia.length > 0
      case 'territories':
        return a.territories.trim() !== ''
      default:
        return true
    }
  }

  /* Steps carrying their own action buttons, so the footer shows no NEXT. */
  const selfDriven: StepKey[] = [
    'type',
    'song_gate',
    'summary',
    'searches_only',
    'worldwide',
    'online_ww',
    'scripts',
    'duration',
    'cutdowns',
    'mcps_searches',
  ]
  const showNext = !selfDriven.includes(key) && answered()

  const canCreate =
    a.clientId !== null &&
    a.currencyId !== null &&
    a.serviceId !== null &&
    (!a.isMcps || estimate !== null)

  /**
   * Leaving the territories step is the one move that waits on the network.
   *
   * ⚠️ If the classifier refuses, the wizard STOPS here. It does not fall back
   * to Worldwide the way the old app does — silently pricing at the dearest
   * cell on the card when it could not read the text. Andy's call, 14 Sep.
   */
  const next = async () => {
    setError(null)
    if (key === 'territories') {
      setClassifying(true)
      try {
        const result = await classifyTerritory(a.territories.trim())
        if (!result.ok) {
          setError(result.error)
          return
        }
        patch({ structure: result.territory })
      } finally {
        setClassifying(false)
      }
    }
    setStep((s) => Math.min(s + 1, flow.length - 1))
  }
  const back = () => {
    setError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function submit() {
    if (!canCreate) return
    setError(null)

    // The MCPS path writes a different row: Status "Submitted" rather than
    // "Draft", the prices the engine worked out, and three line items instead
    // of seven categories. Nobody typed an amount anywhere on this path.
    if (a.isMcps) {
      if (!estimate) return
      try {
        const row = await createMcps.mutateAsync({
          projectId,
          clientId: a.clientId!,
          currencyId: a.currencyId!,
          description: a.description.trim(),
          songName: a.hasSong ? a.songName.trim() : '',
          artistName: a.hasSong ? a.artistName.trim() : '',
          answers: mcpsAnswers,
          price: estimate,
        })
        onCreated(row.uuid)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not raise that estimate.')
      }
      return
    }

    try {
      const row = await create.mutateAsync({
        projectId,
        clientId: a.clientId!,
        currencyId: a.currencyId!,
        serviceId: a.serviceId!,
        description: a.description.trim(),
        // DEMOS: terms, song and artist blank, cutdowns null — see the header.
        term: a.isDemos ? '' : a.term.trim(),
        territory: a.isDemos ? '' : a.territory.trim(),
        media: a.isDemos ? '' : a.media.trim(),
        scripts: a.isDemos ? '' : a.scripts.trim(),
        duration: a.isDemos ? '' : a.duration.trim(),
        cutdowns: a.isDemos ? null : a.cutdowns,
        songName: !a.isDemos && a.hasSong ? a.songName.trim() : '',
        artistName: !a.isDemos && a.hasSong ? a.artistName.trim() : '',
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
    <div className="qw" role="dialog" aria-modal="true" aria-label="New quote">
      <div className="qw-head">
        {/* The old app's header carries the wordmark IMAGE, not the word set
            in Fahkwang — which is the page title's typeface, not the logo. */}
        <SequelLogo wordmark className="qw-logo !h-auto !w-20" />
        {/* Two crossed rules, as the old app draws it. A × glyph sits on the
            text baseline and reads a size larger. */}
        <button type="button" className="qw-close" aria-label="Close" onClick={onClose}>
          <span className="qw-x" />
          <span className="qw-x is-counter" />
        </button>
      </div>

      <div className="qw-body">
        {key === 'description' && (
          <Question title="Give this quote a short description:">
            <input
              className="qw-input"
              autoFocus
              placeholder="Example: Demos &amp; License (Worldwide)"
              value={a.description}
              onChange={(e) => patch({ description: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && a.description.trim() !== '') void next()
              }}
            />
          </Question>
        )}

        {key === 'client' && (
          <Question title="Who is the quote for?">
            <select
              className="qw-input"
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
              className="qw-input"
              value={a.currencyId ?? ''}
              onChange={(e) => {
                if (e.target.value === '') return
                patch({ currencyId: Number(e.target.value) })
                void next()
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
            <div className="qw-types">
              {QUOTE_TYPES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  className={`qw-choice${a.serviceId === t.id && !a.isDemos && t.label !== 'Library (Manual)' ? ' is-picked' : ''}`}
                  onClick={() => {
                    patch({ serviceId: t.id, isMcps: false, isDemos: false })
                    void next()
                  }}
                >
                  {t.label.toUpperCase()}
                </button>
              ))}
              {/* ⚠️ Service 3, the SAME id as Library (Manual). What separates
                  them is `isMcps`, which picks the flow and the engine. */}
              <button
                type="button"
                className={`qw-choice${a.isMcps ? ' is-picked' : ''}`}
                onClick={() => {
                  patch({ serviceId: MCPS_SERVICE_ID, isMcps: true, isDemos: false })
                  void next()
                }}
              >
                LIBRARY (MCPS)
              </button>
              {/* ⚠️ Service 1, the SAME id as Composition. Every fee category
                  but production is cleared, as the old app does, so amounts
                  typed on another path cannot ride along after BACK. */}
              <button
                type="button"
                className={`qw-choice${a.isDemos ? ' is-picked' : ''}`}
                onClick={() => {
                  patch({
                    serviceId: 1,
                    isMcps: false,
                    isDemos: true,
                    fees: { ...emptyFees(), production: a.fees.production },
                  })
                  void next()
                }}
              >
                DEMOS
              </button>
            </div>
          </Question>
        )}

        {key === 'terms' && (
          <div className="qw-question is-wide">
            {/* Prefilled from the project, then edited freely. ⚠️ Editing here
                never writes back to the project: the project's terms are a
                working pool and the quote takes a snapshot. */}
            <label className="qw-field-label">Term</label>
            <input className="qw-input" value={a.term} onChange={(e) => patch({ term: e.target.value })} />
            <label className="qw-field-label">Territory</label>
            <input className="qw-input" value={a.territory} onChange={(e) => patch({ territory: e.target.value })} />
            <label className="qw-field-label">Media</label>
            <input className="qw-input" value={a.media} onChange={(e) => patch({ media: e.target.value })} />
            <label className="qw-field-label">Scripts</label>
            <input className="qw-input" value={a.scripts} onChange={(e) => patch({ scripts: e.target.value })} />
            <label className="qw-field-label">Duration</label>
            <input className="qw-input" value={a.duration} onChange={(e) => patch({ duration: e.target.value })} />
            <label className="qw-field-label">Cutdowns Required?</label>
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
                void next()
              }}
            />
          </Question>
        )}

        {key === 'song' && (
          <Question title="What is the song called?">
            <input
              className="qw-input"
              autoFocus
              value={a.songName}
              onChange={(e) => patch({ songName: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void next()}
            />
          </Question>
        )}

        {key === 'artist' && (
          <Question title="And the artist?">
            <input
              className="qw-input"
              autoFocus
              value={a.artistName}
              onChange={(e) => patch({ artistName: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void next()}
            />
          </Question>
        )}

        {key === 'tracks' && (
          <Question title="How many tracks does this quote cover?">
            {/* Digits only. Blank and 0 are both allowed and both price as one
                track — a quote covering no tracks still charges its fees once,
                it does not charge nothing. */}
            <input
              className="qw-input"
              autoFocus
              inputMode="numeric"
              value={a.tracks}
              onChange={(e) => patch({ tracks: e.target.value.replace(/[^\d]/g, '') })}
              onKeyDown={(e) => e.key === 'Enter' && void next()}
            />
          </Question>
        )}

        {key === 'searches_only' && (
          <Question title="Are you quoting for Sequel searches only?">
            {/* YES stops the flow after the search count. A searches-only
                estimate buys no licence, and the old app used to store answers
                to questions it never asked — a £750 quote asserting a
                perpetual worldwide licence nobody had paid for. */}
            <YesNo
              value={a.searchesOnly}
              onPick={(v) => {
                patch({ searchesOnly: v })
                void next()
              }}
            />
          </Question>
        )}

        {key === 'media' && (
          /* ⚠️ The narrow, centred Question, NOT the wide container the fee
             screens use. These are the quote type buttons and they have to sit
             where the quote type buttons sit — same width, same centre line.
             is-wide left-aligns them and stretches them half the screen. */
          /* The note is worth having, because the price often comes back
             lower than the sum of the parts and it looks like a mistake — but
             behind the i, not always on show. */
          <Question
            title="Media"
            info="Every lawful way of buying these is priced and the cheapest is taken, then capped against All Media."
          >
            <MediaPicker value={a.mcpsMedia} onChange={(mcpsMedia) => patch({ mcpsMedia })} />
          </Question>
        )}

        {key === 'worldwide' && (
          <Question title="Is the Territory Worldwide?">
            <YesNo
              value={a.worldwide}
              onPick={(v) => {
                // ⚠️ YES also settles the online question, which is skipped
                // from here on. Leaving it null would be read as NO and record
                // the wrong answer on a quote that is worldwide anyway.
                patch(
                  v
                    ? { worldwide: true, onlineWorldwide: true, territories: '', structure: null }
                    : { worldwide: false, structure: null },
                )
                void next()
              }}
            />
          </Question>
        )}

        {key === 'territories' && (
          <Question title="Please list the territories you need to cover:">
            <input
              className="qw-input"
              autoFocus
              placeholder="Example: Spain, France"
              value={a.territories}
              onChange={(e) => patch({ territories: e.target.value, structure: null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && a.territories.trim() !== '' && !classifying) void next()
              }}
            />
            {error && <p className="form-error">{error}</p>}
          </Question>
        )}

        {key === 'online_ww' && (
          <Question title="Is the online usage worldwide?">
            <YesNo
              value={a.onlineWorldwide}
              onPick={(v) => {
                patch({ onlineWorldwide: v })
                void next()
              }}
            />
            {/* Answering NO does not guarantee a narrower online licence: up to
                two countries it is cheaper to restrict, at three it is not, and
                the engine buys whichever is cheaper. */}
            <p className="qw-note">
              Online is often worldwide anyway, because above two countries it costs less than
              buying them separately.
            </p>
          </Question>
        )}

        {key === 'scripts' && (
          <Question title="Multiple Scripts?">
            <YesNo
              value={a.multipleScripts}
              onPick={(v) => {
                patch({ multipleScripts: v })
                void next()
              }}
            />
          </Question>
        )}

        {key === 'duration' && (
          <Question title="How long is the longest film?">
            <div className="qw-yesno">
              {[DURATION_LONGER, DURATION_SHORTER].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`qw-choice${a.mcpsDuration === d ? ' is-picked' : ''}`}
                  onClick={() => {
                    patch({ mcpsDuration: d })
                    void next()
                  }}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </Question>
        )}

        {key === 'cutdowns' && (
          <Question title="Cutdowns required?">
            <YesNo
              value={a.mcpsCutdowns}
              onPick={(v) => {
                patch({ mcpsCutdowns: v })
                void next()
              }}
            />
          </Question>
        )}

        {key === 'mcps_searches' && (
          <Question title="How many searches?">
            <div className="qw-counts">
              {SEARCH_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`qw-choice${a.searchesCount === n ? ' is-picked' : ''}`}
                  onClick={() => {
                    patch({ searchesCount: n })
                    void next()
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </Question>
        )}

        {key === 'summary' && a.isMcps && (
          <div className="qw-question is-wide">
            <h2 className="qw-title">Summary</h2>
            {estimate ? (
              <>
                {/* The terms the ENGINE settled, not the answers given — they
                    are not the same thing, and this is the last chance to spot
                    a Territory or a Media list that reads wrong. */}
                <div className="qw-summary-row">
                  <span>Territory</span>
                  <span className="qw-summary-amount">{estimate.territory || '—'}</span>
                </div>
                <div className="qw-summary-row">
                  <span>Media</span>
                  <span className="qw-summary-amount">
                    {estimate.mediaBought.length > 0 ? estimate.mediaBought.join(', ') : '—'}
                  </span>
                </div>
                {/* Which column of the rate card it was priced on (Andy, 26 Sep
                    2026). Not on a searches-only estimate: nothing is licensed. */}
                {estimate.licenceFeeLocal > 0 && (
                  <div className="qw-summary-row">
                    <span>Rate</span>
                    <span className="qw-summary-amount">
                      {estimate.rateType === 'campaign_rate'
                        ? 'Campaign Rate'
                        : estimate.rateType === 'track_rate'
                          ? 'Track Rate'
                          : 'Per 30s'}
                    </span>
                  </div>
                )}
                {/* Only when the media was actually widened — not when All
                    Media is what was asked for (Andy, 26 Sep 2026). */}
                {estimate.capped &&
                  !(a.mcpsMedia.length === 1 && a.mcpsMedia[0] === 'All Media') && (
                  <p className="qw-note">
                    All Media works out cheaper than the media chosen, so that is what is being
                    bought. The territory is unchanged.
                  </p>
                )}
                {estimate.licenceFeeLocal > 0 && (
                  <div className="qw-summary-row">
                    <span>MCPS licence fee{estimate.tracks > 1 ? ` (${estimate.tracks} tracks)` : ''}</span>
                    <span className="qw-summary-amount">
                      {amount.format(estimate.licenceFeeLocal / 100)}
                    </span>
                  </div>
                )}
                {estimate.sequelLicensingFee > 0 && (
                  <div className="qw-summary-row">
                    <span>Sequel licensing fee</span>
                    <span className="qw-summary-amount">
                      {amount.format(estimate.sequelLicensingFee / 100)}
                    </span>
                  </div>
                )}
                {estimate.searchFee > 0 && (
                  <div className="qw-summary-row">
                    <span>Library search fee</span>
                    <span className="qw-summary-amount">{amount.format(estimate.searchFee / 100)}</span>
                  </div>
                )}
                <div className="qw-summary-row is-total">
                  <span>QUOTE TOTAL</span>
                  <span className="qw-summary-amount">{totalText}</span>
                </div>
              </>
            ) : (
              <p className="qw-note">
                {region.data === null && !region.isPending
                  ? 'That client has no region set, so the minimum fee and the search fee cannot be worked out. Set it on the client first.'
                  : 'Working out the price…'}
              </p>
            )}
            {error && <p className="form-error">{error}</p>}
          </div>
        )}

        {key === 'summary' && !a.isMcps && (
          <div className="qw-question is-wide">
            <h2 className="qw-title">Summary</h2>
            {FEE_SCREENS.map((s) => {
              const cat = a.fees[s.key]
              const sum =
                cat.lines.reduce((t, l) => t + toAmount(l.cost), 0) + toAmount(cat.sequel)
              const shown = s.multiply && tracks && tracks > 0 ? sum * tracks : sum
              return (
                <div key={s.key} className="qw-summary-row">
                  <span>{s.heading}</span>
                  <span className="qw-summary-amount">{amount.format(shown)}</span>
                </div>
              )
            })}
            <div className="qw-summary-row is-total">
              <span>QUOTE TOTAL</span>
              <span className="qw-summary-amount">{totalText}</span>
            </div>
            {error && <p className="form-error">{error}</p>}
          </div>
        )}
      </div>

      <div className="qw-foot">
        {step > 0 ? (
          <button type="button" className="qw-step-button" onClick={back}>
            BACK
          </button>
        ) : (
          <span />
        )}

        {/* The middle cell is always rendered, empty or not: the footer is a
            three-column grid, and leaving it out slides NEXT into the middle. */}
        {feeKey || (key === 'summary' && !a.isMcps) ? (
          <span className="qw-total">
            TOTAL <strong>{totalText}</strong>
          </span>
        ) : (
          <span />
        )}

        {key === 'summary' ? (
          <button
            type="button"
            className="qw-step-button"
            disabled={!canCreate || create.isPending || createMcps.isPending}
            onClick={() => void submit()}
          >
            {create.isPending || createMcps.isPending
              ? 'CREATING…'
              : a.isMcps
                ? 'CREATE ESTIMATE'
                : 'CREATE QUOTE'}
          </button>
        ) : showNext ? (
          <button
            type="button"
            className="qw-step-button"
            disabled={classifying}
            onClick={() => void next()}
          >
            {classifying ? 'READING…' : 'NEXT'}
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
