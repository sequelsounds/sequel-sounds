import { useMemo, useState } from 'react'
import { Loader } from '../components/Loader'
import LineChart, { type ChartSeries } from '../components/staff/LineChart'
import {
  FeeMix,
  TipCard,
  useGrown,
  useTip,
  YearToggle,
  money,
  tipFor,
  whole,
  yearOf,
} from '../components/staff/reporting'
import { useManagement, type ManagementInvoice } from '../lib/xanoMirror'

/**
 * Sequel Track's `/management`: the company's own figures, rebuilt from the
 * page and from the endpoint behind it (api 591) rather than from the data.
 *
 * ⚠️ MANAGEMENT ONLY. Track guards this with assert_management, not
 * assert_sequel_staff — it shows every supervisor's billing, profit and
 * margin, and Camila is staff. Here the gate is in the database: the three
 * views ask `track_is_management()`, so a staff member who is not management
 * gets nothing back however they reach this URL. Hiding a nav link is not
 * access control, on either stack.
 *
 * Three things about the shape of the page, each checked on the running one:
 *
 *  1. THE EIGHT STATS ARE THE CURRENT CALENDAR YEAR, and the year toggle does
 *     not move them. On Track they are Wized bindings and the toggle is
 *     custom code that Wized cannot see, so they cannot follow it even in
 *     principle. Verified against the page: 144 invoices and £1,008,510
 *     invoiced are 2026, where the endpoint's all-time totals are 155 and
 *     £1,084,624.
 *  2. REVENUE AND PROJECTS ARE NOT YEAR-SCOPED EITHER. They always draw this
 *     year against last, which is the comparison they exist to make. Only the
 *     six panes that group rather than plot follow the toggle.
 *  3. THE RECENT TAB IS EMPTY on Track — an outer tab with no content in it
 *     at all. Left as it is rather than invented; it is in the known-issues
 *     note instead.
 *
 * Read-only, like the rest of this pass. Track's bar segments open the
 * invoice they stand for; `/invoice` has not been rebuilt, so here a segment
 * says what it is and does not navigate.
 */

const BROWN = 'var(--color-sequel-brown)'
/** Library pink. Last year's lines, and anything under the pointer. */
const ROSE = 'var(--color-sequel-library)'

/** Brands and agencies are long tails. Everything else is short enough whole. */
const TOP_N = 20

type Pane =
  'revenue' | 'projects' | 'feemix' | 'brands' | 'agencies' | 'categories' | 'clientmix' | 'region'

const PANES: { key: Pane; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'projects', label: 'Projects' },
  { key: 'feemix', label: 'Fee Mix' },
  { key: 'brands', label: 'Brands' },
  { key: 'agencies', label: 'Agencies' },
  { key: 'categories', label: 'Categories' },
  { key: 'clientmix', label: 'Client Mix' },
  { key: 'region', label: 'Region' },
]

/* ----------------------------------------------------------------- leagues */

function League({
  rows,
  year,
  years,
  onPick,
  keyOf,
  nameFor,
  heading,
  limit,
  withSpend,
  isTeam,
}: {
  rows: ManagementInvoice[]
  year: string
  years: string[]
  onPick: (y: string) => void
  keyOf: (row: ManagementInvoice) => string | number | null
  nameFor: (key: string | number) => string
  heading: string
  /** 0 for the whole list. */
  limit: number
  /** Spend and margin, which only the Team table carries. */
  withSpend: boolean
  isTeam?: boolean
}) {
  const tip = useTip()
  const grown = useGrown(year)

  const list = useMemo(() => {
    const groups = new Map<
      string | number,
      {
        invoiced: number
        profit: number
        spend: number
        count: number
        units: { row: ManagementInvoice; value: number }[]
      }
    >()
    rows.forEach((row) => {
      const key = keyOf(row)
      if (key === null || key === undefined || key === '') return
      const g = groups.get(key) ?? {
        invoiced: 0,
        profit: 0,
        spend: 0,
        count: 0,
        units: [],
      }
      g.invoiced += Number(row.invoiced) || 0
      g.profit += Number(row.profit) || 0
      g.spend += Number(row.spend) || 0
      g.count += 1
      if ((Number(row.profit) || 0) > 0) g.units.push({ row, value: Number(row.profit) })
      groups.set(key, g)
    })
    // By PROFIT, never by invoiced — invoiced flatters the pass-through-heavy.
    const all = Array.from(groups.entries())
      .map(([key, value]) => ({ key, name: nameFor(key), ...value }))
      .sort((a, b) => b.profit - a.profit)
    return limit ? all.slice(0, limit) : all
  }, [rows, keyOf, nameFor, limit])

  const spendClass = withSpend ? ' has-spend' : ''

  if (!list.length) {
    return (
      <div className={`league${isTeam ? ' is-team' : ''}`}>
        <YearToggle years={years} year={year} onPick={onPick} />
        <div className="league-cell">Nothing invoiced in {year}.</div>
      </div>
    )
  }

  const biggest = list[0].profit || 1

  return (
    <div
      className={`league${isTeam ? ' is-team' : ''}`}
      ref={tip.root}
      onMouseLeave={() => tip.setTip(null)}
    >
      <YearToggle years={years} year={year} onPick={onPick} />

      <div className="league-scroll" onMouseMove={tip.place}>
        <div className={`league-head${spendClass}`}>
          <div>{heading}</div>
          <div>Profit</div>
          <div>Invoiced</div>
          {withSpend && <div>Spend</div>}
          {withSpend && <div>Margin</div>}
          <div>Invoices</div>
        </div>

        {list.map((item, i) => (
          <div key={String(item.key)} className={`league-row${spendClass}`}>
            {/* Down the table rather than all at once, so the eye reads the
                order the rows are already in. */}
            <div
              className="league-bar"
              style={{
                width: grown ? `${(item.profit / biggest) * 100}%` : '0%',
                transitionDelay: `${i * 60}ms`,
              }}
            >
              {item.units
                .sort((a, b) => b.value - a.value)
                .map((unit) => (
                  <div
                    key={unit.row.id}
                    className="league-unit"
                    style={{ width: `${(unit.value / item.profit) * 100}%` }}
                    onMouseEnter={() => tip.setTip(tipFor(unit.row, unit.value, item.name))}
                  />
                ))}
            </div>
            <div className="league-cell">{item.name}</div>
            <div className="league-cell is-num">{money(item.profit)}</div>
            <div className="league-cell is-num">{money(item.invoiced)}</div>
            {withSpend && <div className="league-cell is-num">{money(item.spend)}</div>}
            {withSpend && (
              <div className="league-cell is-num">
                {item.spend > 0 ? ((item.profit / item.spend) * 100).toFixed(1) + '%' : '—'}
              </div>
            )}
            <div className="league-cell is-num">{item.count}</div>
          </div>
        ))}
      </div>

      <TipCard tip={tip.tip} at={tip.at} className="league-tip" cardRef={tip.card} />
    </div>
  )
}

/* -------------------------------------------------------------- client mix */

function ClientMix({
  rows,
  year,
  years,
  onPick,
}: {
  rows: ManagementInvoice[]
  year: string
  years: string[]
  onPick: (y: string) => void
}) {
  const grown = useGrown(year)

  let uniProfit = 0
  let nonProfit = 0
  let uniCount = 0
  let nonCount = 0
  rows.forEach((row) => {
    const value = Number(row.profit) || 0
    if (row.is_unilever) {
      uniProfit += value
      uniCount += 1
    } else {
      nonProfit += value
      nonCount += 1
    }
  })
  const allProfit = uniProfit + nonProfit

  if (allProfit <= 0) {
    return (
      <div className="uni">
        <YearToggle years={years} year={year} onPick={onPick} />
        <div>No invoices in {year}.</div>
      </div>
    )
  }

  // A share of PROFIT, not of invoiced: the question is how much of what
  // Sequel earns depends on one client.
  const pct = (value: number) => (value / allProfit) * 100

  return (
    <div className="uni">
      <YearToggle years={years} year={year} onPick={onPick} />

      <div className="uni-headline" style={{ opacity: grown ? 1 : 0 }}>
        <div className="uni-stat">
          <span className="uni-pct">{pct(uniProfit).toFixed(1)}%</span>
          <span className="uni-pct-label">of {year} profit from Unilever</span>
        </div>
        <div className="uni-stat is-right">
          <span className="uni-pct">{pct(nonProfit).toFixed(1)}%</span>
          <span className="uni-pct-label">Non-Unilever</span>
        </div>
      </div>

      <div className="uni-bar">
        <div className="uni-seg-uni" style={{ width: grown ? `${pct(uniProfit)}%` : '0%' }} />
        <div
          className="uni-seg-non"
          style={{ width: grown ? `${pct(nonProfit)}%` : '0%', transitionDelay: '70ms' }}
        />
      </div>

      <div className="uni-legend" style={{ opacity: grown ? 1 : 0, transitionDelay: '350ms' }}>
        <div className="uni-item">
          Unilever
          <br />
          <span className="uni-item-value">{money(uniProfit)}</span>
          <br />
          {uniCount} invoices
        </div>
        <div className="uni-item">
          Non-Unilever
          <br />
          <span className="uni-item-value">{money(nonProfit)}</span>
          <br />
          {nonCount} invoices
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- page */

function Stat({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <div className="stat" style={first ? { marginLeft: 0 } : undefined}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function Management() {
  const query = useManagement()
  const [outer, setOuter] = useState<'stats' | 'recent' | 'team'>('stats')
  const [pane, setPane] = useState<Pane>('revenue')

  const thisYear = new Date().getFullYear()
  const lastYear = thisYear - 1
  const [year, setYear] = useState(String(thisYear))

  const invoices = useMemo(() => query.data?.invoices ?? [], [query.data])
  const projects = useMemo(() => query.data?.projects ?? [], [query.data])
  const staff = useMemo(() => query.data?.staff ?? [], [query.data])

  // Straight off the invoice dates, so 2027 appears by itself the day a 2027
  // invoice exists and there is nothing to maintain.
  const years = useMemo(
    () =>
      Array.from(new Set(invoices.map(yearOf).filter((y) => y && y !== 'null')))
        .sort()
        .reverse(),
    [invoices],
  )

  const forYear = useMemo(
    () => invoices.filter((row) => yearOf(row) === String(year)),
    [invoices, year],
  )

  // The stat bar is the CURRENT year, always — see the note at the top.
  const current = useMemo(
    () => invoices.filter((row) => yearOf(row) === String(thisYear)),
    [invoices, thisYear],
  )
  const sum = (key: keyof ManagementInvoice) =>
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

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })

  const staffName = (id: string | number) => {
    const found = staff.find((person) => String(person.id) === String(id))
    return found?.name ?? 'Unknown'
  }

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

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">{today}</div>
        <h1 className="page-title">The Company</h1>
        <div className="page-subtitle">Here&rsquo;s your overview&hellip;</div>
      </div>

      {/* vertical_divider between every pair, 1px x 1.5rem — and the first
          stat sits flush with the band's own 2rem inset (stats_wrap left). */}
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
            ['stats', 'Stats'],
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

      {/* The three views ask track_is_management(), so a staff member without
          the flag gets empty lists rather than an error. Say which it is
          instead of drawing a page of zeroes. */}
      {query.data && invoices.length === 0 && (
        <div className="no-result-row">
          {staff.length === 0 ? 'This page is for management only.' : 'No results found'}
        </div>
      )}

      {/* Track's Stats pane carries the padding: 1rem above the chart tabs,
          2rem in from the right and beneath. The Team pane below has none of
          it — its own table supplies the inset instead. */}
      {query.data && invoices.length > 0 && outer === 'stats' && (
        <div className="flex min-h-0 flex-1 flex-col pt-4 pr-8 pb-8">
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

          {/* mgmt_pane_fill: every pane sits 2rem below the chart tabs. */}
          <div className="ml-8 mt-8 min-h-0 flex-1">
            {pane === 'revenue' && (
              <LineChart
                format={money}
                series={[
                  series(invoicedSet, thisYear, BROWN, true, `${thisYear} invoiced`),
                  series(profitSet, thisYear, BROWN, false, `${thisYear} profit`),
                  series(invoicedSet, lastYear, ROSE, true, `${lastYear} invoiced`),
                  series(profitSet, lastYear, ROSE, false, `${lastYear} profit`),
                ]}
              />
            )}
            {pane === 'projects' && (
              <LineChart
                format={whole}
                series={[
                  series(projectSet, thisYear, BROWN, true, `${thisYear} projects`),
                  series(invoiceSet, thisYear, BROWN, false, `${thisYear} invoices`),
                  series(projectSet, lastYear, ROSE, true, `${lastYear} projects`),
                  series(invoiceSet, lastYear, ROSE, false, `${lastYear} invoices`),
                ]}
              />
            )}
            {pane === 'feemix' && (
              <FeeMix rows={forYear} year={year} years={years} onPick={setYear} />
            )}
            {pane === 'brands' && (
              <League
                rows={forYear}
                year={year}
                years={years}
                onPick={setYear}
                keyOf={(row) => row.brand}
                nameFor={(key) => String(key)}
                heading="Brand"
                limit={TOP_N}
                withSpend={false}
              />
            )}
            {pane === 'agencies' && (
              <League
                rows={forYear}
                year={year}
                years={years}
                onPick={setYear}
                keyOf={(row) => row.agency}
                nameFor={(key) => String(key)}
                heading="Agency"
                limit={TOP_N}
                withSpend={false}
              />
            )}
            {pane === 'categories' && (
              <League
                rows={forYear}
                year={year}
                years={years}
                onPick={setYear}
                keyOf={(row) => row.category}
                nameFor={(key) => String(key)}
                heading="Category"
                limit={0}
                withSpend={false}
              />
            )}
            {pane === 'clientmix' && (
              <ClientMix rows={forYear} year={year} years={years} onPick={setYear} />
            )}
            {pane === 'region' && (
              <League
                rows={forYear}
                year={year}
                years={years}
                onPick={setYear}
                keyOf={(row) => row.region}
                nameFor={(key) => String(key)}
                heading="Region"
                limit={0}
                withSpend={false}
              />
            )}
          </div>
        </div>
      )}

      {/* Track's Recent tab is an empty pane. Left empty rather than filled
          with something Track does not show — it is in the known issues. */}
      {query.data && outer === 'recent' && <div className="min-h-0 flex-1" />}

      {query.data && invoices.length > 0 && outer === 'team' && (
        <div className="mt-8 min-h-0 flex-1">
          <League
            rows={forYear}
            year={year}
            years={years}
            onPick={setYear}
            keyOf={(row) => row.supervisor_id}
            nameFor={staffName}
            heading="Supervisor"
            limit={0}
            withSpend
            isTeam
          />
        </div>
      )}
    </>
  )
}
