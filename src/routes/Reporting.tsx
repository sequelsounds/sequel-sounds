import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { YearToggle } from '../components/staff/reporting'
import { downloadUnileverCsv, useUnileverReport, type UnileverRow } from '../lib/unileverReport'
import { useIsFinance } from '../lib/xanoMirror'

/**
 * Sequel Track's `/reporting` — the Unilever annual report — rebuilt from the
 * page, then finished. Track's page was left half done (notes 9 Sep: "renders
 * only brand and invoice number"); Andy asked on 17 Sep for four things on top
 * of the copy, and those are the departures:
 *
 *  1. **A year picker.** Track's year was fixed in the request.
 *  2. **Fuller rows that open the invoice.** Track's row link had no config.
 *  3. **Missing data is flagged**, with a Needs attention tab — what Unilever
 *     expect that a row does not have (AdPro, usage region and territories,
 *     the song on a licence invoice, and the things that would once have
 *     dropped a row from Xano's report silently). The rules are in 0038.
 *  4. **EUR totals per region**, beside the counts.
 *
 * What is Track's: the band, the six region tabs in Track's order, counts off
 * the whole year (they never follow the search or the tab), the search
 * fields, and EXPORT writing the whole year in Unilever's own columns.
 *
 * ⚠️ The region is the INVOICED CLIENT's region, not the invoice's usage
 * region. Unilever's report is booked where the invoice went.
 *
 * Finance only, as in Xano; the database function refuses anyone else.
 */

const TABS: { region: number | null; label: string }[] = [
  { region: null, label: 'Global' },
  { region: 2, label: 'Europe' },
  { region: 3, label: 'Latam' },
  { region: 4, label: 'Na' },
  { region: 1, label: 'Apac' },
  { region: 5, label: 'Met' },
]

const eur = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

/** "04 Sep 26", the date format the other lists use. */
const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
})
function fmtDate(value: unknown) {
  if (typeof value !== 'string' || !value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : shortDate.format(d)
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
const totalEur = (rows: UnileverRow[]) => rows.reduce((sum, r) => sum + num(r.total_cost_eur), 0)

function Counter({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="stat report-stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {count} · {eur.format(total)}
      </span>
    </div>
  )
}

export default function Reporting() {
  const finance = useIsFinance()
  const isFinance = finance.data === true
  const [year, setYear] = useState(new Date().getFullYear())
  const report = useUnileverReport(year, isFinance)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [region, setRegion] = useState<number | null>(null)
  const [attention, setAttention] = useState(false)

  const all = useMemo(() => report.data?.rows ?? [], [report.data])

  // The picker always offers this year, so January is not an empty toggle.
  const years = useMemo(() => {
    const set = new Set(report.data?.years ?? [])
    set.add(new Date().getFullYear())
    set.add(year)
    return [...set].sort((a, b) => b - a).map(String)
  }, [report.data, year])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all.filter(
      (r) =>
        (region == null || r._region_id === region) &&
        (!attention || r.issues.length > 0) &&
        (!term ||
          [r.brand, r.invoice_number, r.invoicee, r.service_job_no, r.adpro_number, r.memo]
            .map(text)
            .join(' ')
            .toLowerCase()
            .includes(term)),
    )
  }, [all, q, region, attention])

  // Off `all`, never off `rows`: the counts do not move, as in Track.
  const inRegion = (id: number) => all.filter((r) => r._region_id === id)
  const flagged = all.filter((r) => r.issues.length > 0).length

  if (finance.isPending) {
    return (
      <Loader />
    )
  }

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Our</div>
        <div className="title-row">
          <h1 className="page-title">Unilever</h1>
          <div className="report-actions flex items-center gap-4">
            <YearToggle years={years} year={String(year)} onPick={(y) => setYear(Number(y))} />
            <button
              type="button"
              className="btn btn-mono btn-outline"
              disabled={!report.data || all.length === 0}
              onClick={() => downloadUnileverCsv(all, year)}
            >
              Export
            </button>
          </div>
        </div>
        <div className="page-subtitle">Projects</div>
      </div>

      {!isFinance ? (
        <div className="no-result-row">Only finance can see the Unilever report.</div>
      ) : (
        <>
          <div className="tab-band">
            <div className="tab-band-search is-narrow">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                aria-label="Search the report"
                className="project-search"
              />
            </div>
            <div className="tab-band-divider" />
            <Counter label="Global" count={all.length} total={totalEur(all)} />
            {TABS.slice(1).map((t) => {
              const list = inRegion(t.region!)
              return (
                <div key={t.label} className="contents">
                  <div className="tab-band-divider" />
                  <Counter label={t.label} count={list.length} total={totalEur(list)} />
                </div>
              )
            })}
          </div>

          <div className="project-tabs is-plain" role="tablist" aria-label="Region">
            {TABS.map((t) => (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={region === t.region}
                className="project-tab"
                onClick={() => setRegion(t.region)}
              >
                {t.label}
              </button>
            ))}
            {/* Not a region: it narrows whichever region is showing. */}
            <button
              type="button"
              aria-pressed={attention}
              aria-selected={attention}
              className="project-tab report-attention-tab"
              onClick={() => setAttention((v) => !v)}
            >
              Needs attention ({flagged})
            </button>
          </div>

          <div className="report-grid project-list-head finance-head">
            <span className="project-list-head-cell">Date</span>
            <span className="project-list-head-cell">Invoice</span>
            <span className="project-list-head-cell">Job no.</span>
            <span className="project-list-head-cell">Brand</span>
            <span className="project-list-head-cell">Invoicee</span>
            <span className="project-list-head-cell">AdPro</span>
            <span className="project-list-head-cell">Total (EUR)</span>
            <span className="project-list-head-cell">Missing</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {report.isPending && (
              <Loader />
            )}
            {report.error && <p className="form-error px-8 py-4">{report.error.message}</p>}

            {rows.map((r) => (
              <div
                key={r.id}
                className="report-grid finance-row"
                onClick={() => r.uuid && navigate(`/invoices/${r.uuid}`)}
              >
                <span className="project-list-cell">{fmtDate(r.date)}</span>
                <span className="project-list-title">{text(r.invoice_number) || '—'}</span>
                <span className="project-list-cell">{text(r.service_job_no)}</span>
                <span className="project-list-cell" title={text(r.brand)}>
                  {text(r.brand)}
                </span>
                <span className="project-list-cell" title={text(r.invoicee)}>
                  {text(r.invoicee)}
                </span>
                <span className="project-list-cell">{text(r.adpro_number)}</span>
                <span className="project-list-cell">{eur.format(num(r.total_cost_eur))}</span>
                <span
                  className={`project-list-cell ${r.issues.length ? 'report-issues' : ''}`}
                  title={r.issues.join('\n') || undefined}
                >
                  {r.issues.join(' · ')}
                </span>
              </div>
            ))}

            {report.data && rows.length === 0 && (
              <div className="no-result-row">No results found</div>
            )}
          </div>
        </>
      )}
    </>
  )
}
