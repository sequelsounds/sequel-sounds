import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * The pieces /management and /dashboard share: the money and date formats, the
 * hover card that names the invoice behind a bar segment, the year toggle, and
 * the fee mix itself.
 *
 * They live here rather than in either route because Track builds both pages
 * from the same custom code — /dashboard was duplicated from /management and
 * the fee mix is the same markup on both, down to the class names.
 *
 * ⚠️ The two pages are NOT the same underneath. /management is company-wide and
 * management-only; /dashboard is the caller's own billing and staff-only. They
 * read separate views for that reason, and nothing here should ever decide
 * which rows a page gets.
 */

/** What the fee mix needs of an invoice. Both pages' rows satisfy it. */
export type ReportRow = {
  id: number
  uuid: string | null
  invoice_number: string | null
  project_title: string
  client_name: string
  invoice_date: string | null
  status: string | null
  profit: number
  studios: number
  licence: number
  search: number
  demo: number
  other: number
}

/** Under this share of the bar a fee has no room for a stem. */
const LABEL_MIN_PCT = 2

export const money = (value: number) => '£' + Math.round(value).toLocaleString('en-GB')
/** The Projects axis counts things, so a half-project tick prints nothing. */
export const whole = (value: number) => (value % 1 === 0 ? String(value) : '')

export const longDate = (raw: string | null) => {
  if (!raw) return ''
  const parts = String(raw).slice(0, 10).split('-')
  if (parts.length !== 3) return ''
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).toLocaleDateString(
    'en-GB',
    {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    },
  )
}

export const yearOf = (row: { invoice_date: string | null }) => String(row.invoice_date).slice(0, 4)

/* ------------------------------------------------------------------- tips */

export type Tip = { project: string; client: string; value: string; meta: string }

/** What a segment says about the invoice it stands for. */
export function tipFor(row: ReportRow, value: number, context: string): Tip {
  return {
    project: row.project_title || 'Untitled project',
    client: row.client_name || 'Unknown client',
    value: money(value),
    meta: [
      row.invoice_number ? 'Invoice ' + row.invoice_number : '',
      context,
      longDate(row.invoice_date),
      row.status || '',
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

export function TipCard({
  tip,
  at,
  className,
  cardRef,
}: {
  tip: Tip | null
  at: { left: number; top: number }
  className: string
  /** Measured to decide which side of the pointer the card sits on. */
  cardRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={cardRef}
      className={`${className} ${tip ? 'is-on' : ''}`}
      style={{ left: at.left, top: at.top }}
      aria-hidden="true"
    >
      <div className="fee-mix-tip-project">{tip?.project}</div>
      <div className="fee-mix-tip-client">{tip?.client}</div>
      <div className="fee-mix-tip-value">{tip?.value}</div>
      <div className="fee-mix-tip-meta">{tip?.meta}</div>
    </div>
  )
}

/**
 * Where the card goes. It follows the pointer, flipping to its left as it
 * nears the right-hand edge, and sits under a fixed anchor when it is given
 * one — the fee mix pins its card below the bar so it never covers it.
 */
export function useTip(anchorBelow?: React.RefObject<HTMLElement | null>) {
  const root = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [at, setAt] = useState({ left: 0, top: 0 })

  const place = (e: React.MouseEvent) => {
    const box = root.current?.getBoundingClientRect()
    if (!box) return
    const width = card.current?.offsetWidth ?? 0
    let left = e.clientX - box.left + 14
    if (left + width > box.width) left = e.clientX - box.left - width - 14
    const anchor = anchorBelow?.current
    setAt({
      left: Math.max(0, left),
      top: anchor ? anchor.offsetTop + anchor.offsetHeight + 10 : e.clientY - box.top + 18,
    })
  }

  return { root, card, tip, at, setTip, place }
}

/**
 * False for two frames, then true — which is what a width or opacity
 * transition needs to run at all. A value set on the same tick as the mount
 * never transitions, and a timeout is worse than a frame: the pane is still
 * fading in when it fires.
 *
 * Re-runs on `replay`, so every pane opens again when the year changes.
 */
export function useGrown(replay: unknown) {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    setGrown(false)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setGrown(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [replay])
  return grown
}

/* --------------------------------------------------------------- year tabs */

export function YearToggle({
  years,
  year,
  onPick,
}: {
  years: string[]
  year: string
  onPick: (y: string) => void
}) {
  return (
    <div className="year-toggle" role="tablist" aria-label="Year">
      {years.map((y) => (
        <button
          key={y}
          type="button"
          role="tab"
          aria-selected={y === year}
          className={`year-btn ${y === year ? 'is-on' : ''}`}
          onClick={() => onPick(y)}
        >
          {y}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- fee mix */

const FEES: { key: keyof ReportRow; label: string }[] = [
  { key: 'studios', label: 'Studios' },
  { key: 'licence', label: 'Licences' },
  { key: 'search', label: 'Searches' },
  { key: 'demo', label: 'Demos' },
  { key: 'other', label: 'Other' },
]

export function FeeMix({
  rows,
  year,
  years,
  onPick,
}: {
  rows: ReportRow[]
  /** The year the rows are, and the key the bar replays on. */
  year: string
  /**
   * Omitted on /dashboard, which has no toggle: its endpoint scopes the
   * figures to the current year and there is nothing to switch between. The
   * pane then sits 2rem down rather than 1.5, because nothing is above the
   * total row, and the overflow list gains a rule to stand on.
   */
  years?: string[]
  onPick?: (y: string) => void
}) {
  const toggle = years != null && years.length > 0 && onPick != null
  const bar = useRef<HTMLDivElement>(null)
  const tip = useTip(bar)

  const grown = useGrown(year)

  const groups = useMemo(
    () =>
      FEES.map((fee) => {
        const units = rows
          .filter((row) => (Number(row[fee.key]) || 0) > 0)
          .map((row) => ({ row, value: Number(row[fee.key]) || 0 }))
          .sort((a, b) => b.value - a.value)
        return {
          label: fee.label,
          units,
          total: units.reduce((acc, unit) => acc + unit.value, 0),
          count: units.length,
        }
      })
        .filter((g) => g.total > 0)
        .sort((a, b) => b.total - a.total),
    [rows],
  )

  const sum = groups.reduce((acc, g) => acc + g.total, 0)

  if (sum <= 0) {
    return (
      <div className={`fee-mix ${toggle ? '' : 'is-plain'}`}>
        {toggle && <YearToggle years={years} year={year} onPick={onPick} />}
        <div className="fee-mix-stat">No invoices in {year}.</div>
      </div>
    )
  }

  // Offsets are cumulative, so the labels stand over the segment they name.
  let offset = 0
  let shown = 0
  const labels: React.ReactNode[] = []
  const rest: React.ReactNode[] = []

  groups.forEach((g) => {
    const pct = (g.total / sum) * 100
    const avg = g.count > 0 ? Math.round(g.total / g.count) : 0
    if (pct < LABEL_MIN_PCT) {
      rest.push(
        <div key={g.label} className="fee-mix-rest-item">
          <span className="fee-mix-swatch" />
          <span className="fee-mix-rest-name">{g.label}</span>
          <span className="fee-mix-rest-pct">{pct.toFixed(1)}%</span>
          <span className="fee-mix-rest-stat">
            {money(g.total)} · {g.count} jobs · {money(avg)} avg
          </span>
        </div>,
      )
      offset += pct
      return
    }
    const stem = 16 + shown * 40
    shown += 1
    labels.push(
      <div
        key={g.label}
        className="fee-mix-label"
        style={{
          left: `${offset}%`,
          opacity: grown ? 1 : 0,
          transitionDelay: `${350 + shown * 90}ms`,
        }}
      >
        <div className="fee-mix-stem" style={{ height: stem }} />
        <div className="fee-mix-swatch fee-mix-swatch-pin" style={{ top: stem }} />
        <div style={{ paddingTop: stem - 4 }}>
          <div className="fee-mix-name">{g.label}</div>
          <div className="fee-mix-pct">{pct.toFixed(1)}%</div>
          <div className="fee-mix-stat">{money(g.total)}</div>
          <div className="fee-mix-stat">{g.count} jobs</div>
          <div className="fee-mix-stat">{money(avg)} average</div>
        </div>
      </div>,
    )
    offset += pct
  })

  return (
    <div
      className={`fee-mix ${toggle ? '' : 'is-plain'}`}
      ref={tip.root}
      onMouseLeave={() => tip.setTip(null)}
    >
      {toggle && <YearToggle years={years} year={year} onPick={onPick} />}

      <div className="fee-mix-total" style={{ opacity: grown ? 1 : 0 }}>
        <span className="fee-mix-total-label">TOTAL PROFIT{toggle ? ` ${year}` : ''}</span>
        <span className="fee-mix-total-value">{money(sum)}</span>
      </div>

      <div className="fee-mix-bar" ref={bar} onMouseMove={tip.place}>
        {groups.map((g, i) => (
          <div
            key={g.label}
            className="fee-mix-seg"
            style={{
              width: grown ? `${(g.total / sum) * 100}%` : '0%',
              transitionDelay: `${i * 70}ms`,
            }}
          >
            {g.units.map((unit) => (
              <div
                key={unit.row.id}
                className="fee-mix-unit"
                style={{ width: `${(unit.value / g.total) * 100}%` }}
                onMouseEnter={() => tip.setTip(tipFor(unit.row, unit.value, g.label))}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="fee-mix-labels">
        {labels}
        {rest.length > 0 && (
          <div className="fee-mix-rest" style={{ opacity: grown ? 1 : 0 }}>
            {rest}
          </div>
        )}
      </div>

      <TipCard tip={tip.tip} at={tip.at} className="fee-mix-tip" cardRef={tip.card} />
    </div>
  )
}
