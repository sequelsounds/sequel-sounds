import { useMemo, useState } from 'react'
import { Loader } from '../components/Loader'
import LineChart, { ASPHALT_INK, type ChartSeries } from '../components/staff/LineChart'
import { FeeMix, money, whole, yearOf } from '../components/staff/reporting'
import { useDashboard, useMe, type DashboardInvoice } from '../lib/xanoMirror'

/**
 * Sequel Track's `/dashboard`: the caller's own billing, rebuilt from the page
 * and from the endpoint behind it (api 590).
 *
 * The personal counterpart to `/management` and, since Track duplicated one
 * from the other, the same shape: a greeting, eight stats, three outer tabs,
 * and Revenue / Projects / Fee mix inside the first. Two things make it its
 * own page rather than a flag on that one:
 *
 *  1. IT IS DRAWN IN ASPHALT, not Sequel Brown — the lines, the axis figures,
 *     the grid and the tooltip. Only the fee mix stays brown, on both pages.
 *  2. THERE IS NO YEAR TOGGLE. Track scopes this page's figures to the current
 *     year in Xano and offers no way to look back, so the fee mix reads
 *     "TOTAL PROFIT" with no year after it.
 *
 * ⚠️ The rows are the caller's own and the database is what decides that —
 * `dashboard_invoices` filters on the supervisor, exactly as Xano does, so no
 * one else's billing reaches this machine.
 *
 * ⚠️ music_supervisor_id is whoever RAISED the invoice, not whoever owns the
 * project now. This is a billing page, not an ownership one.
 *
 * Read-only. Its fee-mix segments each stand for one invoice and open it at
 * `/invoices/:uuid`, the same as `/management`'s — the shared `Unit` in
 * `reporting.tsx` is what does it, so the two pages cannot drift apart.
 */

/** Track's own three, in Track's order and wording. */
const PANES = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'projects', label: 'projects' },
  { key: 'feemix', label: 'Fee mix' },
] as const

type Pane = (typeof PANES)[number]['key']

/**
 * The greeting, reproduced from the Wized binding rather than re-imagined.
 *
 * One line a day from a date seed, so it does not change on every navigation
 * but does change tomorrow. Bands at 05:00, 12:00, 18:00 and 22:00; Monday
 * mornings and Friday afternoons get their own; a birthday beats all of it.
 */
const MORNING = [
  'Morning, NAME',
  'Rise and shine, NAME',
  'Fresh start, NAME',
  'Needle down, NAME',
  'Coffee first, NAME',
]
const AFTERNOON = [
  'Afternoon, NAME',
  'Back at it, NAME',
  'I feel good, NAME',
  'Second half, NAME',
  'Still spinning, NAME',
]
const EVENING = ['Evening, NAME', 'Winding down, NAME', 'Night train, NAME', 'Fade out, NAME']
const LATE = [
  'Still up, NAME?',
  'No sleep til Brooklyn, NAME',
  'Go to bed, NAME',
  'Nothing good happens after midnight, NAME',
]
const MONDAY = [
  'Happy Monday, NAME',
  "Papa's got a brand new bag, NAME",
  'Get up offa that thing, NAME',
  'Track one, side one, NAME',
]
const FRIDAY = [
  'Happy Friday, NAME',
  'Nearly there, NAME',
  'Friday at last, NAME',
  'Final track, NAME',
]

function greeting(name: string | null, birthday: string | null, now = new Date()) {
  if (!name) return ''
  const first = String(name).trim().split(' ')[0]

  // ⚠️ Matched on the date STRING rather than parsed to a Date, so a birthday
  // cannot land a day early or late from timezone drift. Day and month only.
  if (birthday) {
    const m = String(birthday).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m && Number(m[2]) === now.getMonth() + 1 && Number(m[3]) === now.getDate()) {
      return 'Happy birthday, ' + first
    }
  }

  const hour = now.getHours()
  const day = now.getDay()
  let lines: string[]
  if (hour >= 22 || hour < 5) lines = LATE
  else if (day === 1 && hour < 12) lines = MONDAY
  else if (day === 5 && hour < 18) lines = FRIDAY
  else if (hour < 12) lines = MORNING
  else if (hour < 18) lines = AFTERNOON
  else lines = EVENING

  const seed = Math.floor(now.getTime() / 86400000)
  return lines[seed % lines.length].replace('NAME', first)
}

function Stat({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <div className="stat" style={first ? { marginLeft: 0 } : undefined}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function Dashboard() {
  const query = useDashboard()
  const me = useMe()
  const [outer, setOuter] = useState<'stats' | 'recent' | 'team'>('stats')
  const [pane, setPane] = useState<Pane>('revenue')

  const thisYear = new Date().getFullYear()
  const lastYear = thisYear - 1

  const invoices = useMemo(() => query.data?.invoices ?? [], [query.data])
  const projects = useMemo(() => query.data?.projects ?? [], [query.data])

  // The stat bar and the fee mix are the current year. Track scopes them in
  // Xano; the rows arrive unscoped here because the charts need last year too.
  const current = useMemo(
    () => invoices.filter((row) => yearOf(row) === String(thisYear)),
    [invoices, thisYear],
  )
  const sum = (key: keyof DashboardInvoice) =>
    current.reduce((acc, row) => acc + (Number(row[key]) || 0), 0)

  const bucket = <T,>(
    rows: T[],
    dateOf: (row: T) => string | null,
    add: (cur: number, row: T) => number,
  ) => {
    const out: Record<number, (number | null)[]> = {
      [thisYear]: new Array(12).fill(null),
      [lastYear]: new Array(12).fill(null),
    }
    rows.forEach((row) => {
      const raw = dateOf(row)
      if (!raw) return
      const y = Number(String(raw).slice(0, 4))
      if (!out[y]) return
      const month = Number(String(raw).slice(5, 7)) - 1
      if (month < 0 || month > 11) return
      out[y][month] = add(out[y][month] ?? 0, row)
    })
    return out
  }

  const series = (
    set: Record<number, (number | null)[]>,
    y: number,
    colour: string,
    solid: boolean,
    label: string,
  ): ChartSeries => ({
    label,
    data: set[y].map((v) => (v == null ? null : Math.round(v))),
    colour,
    solid,
  })

  const ASPHALT = 'var(--color-sequel-asphalt)'
  /** Library pink. Last year, on both pages. */
  const ROSE = 'var(--color-sequel-library)'

  const invoicedSet = bucket(
    invoices,
    (r) => r.invoice_date,
    (cur, r) => cur + (Number(r.invoiced) || 0),
  )
  const profitSet = bucket(
    invoices,
    (r) => r.invoice_date,
    (cur, r) => cur + (Number(r.profit) || 0),
  )
  const projectSet = bucket(
    projects,
    (r) => r.created_at,
    (cur) => cur + 1,
  )
  const invoiceSet = bucket(
    invoices,
    (r) => r.invoice_date,
    (cur) => cur + 1,
  )

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">{today}</div>
        <h1 className="page-title">{greeting(me.data?.name ?? null, me.data?.birthday ?? null)}</h1>
        <div className="page-subtitle">Here&rsquo;s your YTD overview&hellip;</div>
      </div>

      <div className="tab-band">
        <Stat label="Spend" value={money(sum('spend'))} first />
        <div className="tab-band-divider" />
        <Stat label="Invoiced" value={money(sum('invoiced'))} />
        <div className="tab-band-divider" />
        <Stat label="Profit" value={money(sum('profit'))} />
        <div className="tab-band-divider" />
        <Stat label="Invoices" value={String(current.length)} />
        <div className="tab-band-divider" />
        <Stat label="Average" value={money(current.length ? sum('profit') / current.length : 0)} />
        <div className="tab-band-divider" />
        <Stat
          label="Outstanding"
          value={money(
            current
              .filter((row) => row.status === 'Awaiting Payment')
              .reduce((acc, row) => acc + (Number(row.invoiced) || 0), 0),
          )}
        />
        <div className="tab-band-divider" />
        <Stat label="Studios" value={money(sum('studios'))} />
        <div className="tab-band-divider" />
        <Stat label="Avoidance" value={money(sum('cost_avoidance'))} />
      </div>

      <div className="project-tabs is-plain" role="tablist" aria-label="Overview">
        {(
          [
            ['stats', 'Your stats'],
            ['recent', 'Recent'],
            ['team', 'Team'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={outer === key}
            className="project-tab"
            onClick={() => setOuter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {query.isPending && (
        <div className="flex justify-center py-16">
          <Loader />
        </div>
      )}
      {query.error && <p className="form-error px-8 py-4">{query.error.message}</p>}

      {query.data && invoices.length === 0 && <div className="no-result-row">No results found</div>}

      {query.data && invoices.length > 0 && outer === 'stats' && (
        <div className="flex min-h-0 flex-1 flex-col pt-4 pr-8 pb-8">
          {/* ⚠️ THE CHART TABS SIT UNDER THE CHART HERE, not over it.
              /management puts them above; /dashboard's own tabs component has
              the menu after the content, so the strip is the last thing in the
              pane. Checked in the DOM, not assumed from the other page. */}
          <div className="mr-8 ml-8 min-h-0 flex-1">
            {pane === 'revenue' && (
              <LineChart
                format={money}
                ink={ASPHALT_INK}
                series={[
                  series(invoicedSet, thisYear, ASPHALT, true, `${thisYear} invoiced`),
                  series(profitSet, thisYear, ASPHALT, false, `${thisYear} profit`),
                  series(invoicedSet, lastYear, ROSE, true, `${lastYear} invoiced`),
                  series(profitSet, lastYear, ROSE, false, `${lastYear} profit`),
                ]}
              />
            )}
            {pane === 'projects' && (
              <LineChart
                format={whole}
                ink={ASPHALT_INK}
                series={[
                  series(projectSet, thisYear, ASPHALT, true, `${thisYear} projects`),
                  series(invoiceSet, thisYear, ASPHALT, false, `${thisYear} invoices`),
                  series(projectSet, lastYear, ROSE, true, `${lastYear} projects`),
                  series(invoiceSet, lastYear, ROSE, false, `${lastYear} invoices`),
                ]}
              />
            )}
            {pane === 'feemix' && <FeeMix rows={current} year={String(thisYear)} />}
          </div>

          <div className="chart-tabs" role="tablist" aria-label="Chart">
            {PANES.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={pane === p.key}
                className="chart-tab"
                onClick={() => setPane(p.key)}
              >
                <span className="chart-tab-label">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Both are empty panes on Track, as they are on /management. */}
      {query.data && outer !== 'stats' && <div className="min-h-0 flex-1" />}
    </>
  )
}
