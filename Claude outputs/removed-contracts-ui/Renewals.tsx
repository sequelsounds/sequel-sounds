import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useMarkRenewalSeen, useRenewals, type Renewal, type Unresolved } from '../lib/contracts'
import { useIsStaff } from '../lib/staff'

/**
 * Renewals — `/renewals`. New: the old app has no such page.
 *
 * Named for what it is FOR, not for what it lists (Andy, 18 Sep): contracts
 * themselves live on a project's Contracting tab, and this page exists to say
 * what is about to lapse. The renewal engine's whole commercial point is
 * pre-empting expiry, and the old app computed the dates and then had nothing
 * to show them on. A page rather than an email, so nothing can go out to an
 * agency about a licence that is not really expiring.
 *
 * ⚠️ ONE LINE PER PROJECT, not per contract (Andy, 18 Sep). A job can carry a
 * master and a publishing licence with different expiries; the project is
 * chased on the earliest, and the rest are underneath it. MARK DONE ticks the
 * whole project, so it cannot come back half-ticked.
 *
 * ⚠️ NOTHING PERPETUAL APPEARS ON THIS PAGE AT ALL. A perpetual grant has no
 * expiry to chase, and emailing an agency about renewing something they own
 * outright is the mistake that costs a relationship. The count in the band is
 * only there so the absence is explained rather than looking like a gap.
 *
 * Three lists:
 *   EXPIRING       within 42 days, soonest first
 *   EXPIRED        already lapsed — the ones someone may still be using
 *   MISSING DATES  confirmed, not perpetual, no expiry at all. Usually the
 *                  reader found no dates and nobody filled them in. Nothing
 *                  chases these, so without the list they are invisible until
 *                  a client asks — the direction that loses money quietly.
 */

const shortDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
function fmtDate(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : shortDate.format(d)
}

const TABS = ['Expiring', 'Expired', 'Missing dates'] as const
type Tab = (typeof TABS)[number]

function Counter({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

/** "3 contracts", "1 contract" — said once, on the project's line. */
const countLabel = (n: number) => `${n} contract${n === 1 ? '' : 's'}`

export default function Renewals() {
  const staff = useIsStaff()
  const renewals = useRenewals()
  const seen = useMarkRenewalSeen()
  const [tab, setTab] = useState<Tab>('Expiring')
  const [q, setQ] = useState('')
  /** Which project lines are opened out. Shut by default: the point of the
   *  page is one line per job. */
  const [open, setOpen] = useState<Record<number, boolean>>({})

  const due = useMemo(() => renewals.data?.due ?? [], [renewals.data])
  const expired = useMemo(() => renewals.data?.expired ?? [], [renewals.data])
  const unresolved = useMemo(() => renewals.data?.unresolved ?? [], [renewals.data])

  const match = (r: Renewal | Unresolved) => {
    const term = q.trim().toLowerCase()
    if (!term) return true
    const own = [r.project_title, r.sequel_no, r.brand]
    const inner = r.contracts.flatMap((c) => [c.supplier, c.contract_type, c.file_name])
    return [...own, ...inner].some((v) => (v ?? '').toLowerCase().includes(term))
  }

  const toggle = (id: number | null) => {
    if (id === null) return
    setOpen((o) => ({ ...o, [id]: !o[id] }))
  }

  if (staff.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader />
      </div>
    )
  }

  const dueRows = due.filter(match)
  const expiredRows = expired.filter(match)
  const unresolvedRows = unresolved.filter(match)

  /** Expiring and Expired are the same row, read from either end of today. */
  const renewalRow = (r: Renewal, lapsed: boolean) => (
    <div key={r.project_id ?? r.sequel_no}>
      <div
        className={`renewal-grid finance-row${r.all_seen ? ' is-seen' : ''}`}
        onClick={() => toggle(r.project_id)}
      >
        <span className="project-list-title">{r.project_title || '—'}</span>
        <span className="project-list-cell">{r.brand}</span>
        <span className="project-list-cell">{r.sequel_no}</span>
        <span className="project-list-cell">{countLabel(r.contract_count)}</span>
        <span className="project-list-cell">
          {fmtDate(r.end_date)}
          <span className="renewal-days">
            {lapsed
              ? ` · ${r.days_since === 0 ? 'today' : `${r.days_since}d ago`}`
              : r.days_left === 0
                ? ' · today'
                : ` · ${r.days_left}d`}
          </span>
        </span>
        <span className="project-list-cell renewal-actions">
          {r.project_id && (
            <Link
              to={`/projects/${r.project_id}?tab=Contracting`}
              className="renewal-tick"
              onClick={(e) => e.stopPropagation()}
            >
              OPEN
            </Link>
          )}
          <button
            type="button"
            className="renewal-tick"
            onClick={(e) => {
              e.stopPropagation()
              seen.mutate({ uuids: r.contracts.map((c) => c.uuid), seen: !r.all_seen })
            }}
          >
            {r.all_seen ? 'DEALT WITH' : 'MARK DONE'}
          </button>
        </span>
      </div>

      {r.project_id !== null &&
        open[r.project_id] &&
        r.contracts.map((c) => (
          <div key={c.uuid} className="renewal-grid renewal-sub">
            {/* The columns above belong to the project, so a contract says what
                it is in its own first cell rather than borrowing headings that
                do not describe it. */}
            <span className="project-list-cell">
              {[c.supplier || c.file_name, c.contract_type].filter(Boolean).join(' · ')}
            </span>
            <span className="project-list-cell renewal-sub-wide">{c.song_name || c.artist}</span>
            <span className="project-list-cell" />
            <span className="project-list-cell">{fmtDate(c.end_date)}</span>
            <span className="project-list-cell">{c.seen ? 'dealt with' : ''}</span>
          </div>
        ))}
    </div>
  )

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Our</div>
        <div className="title-row">
          <h1 className="page-title">Renewals</h1>
        </div>
        <div className="page-subtitle">Licences coming up for renewal.</div>
      </div>

      <div className="tab-band">
        <div className="tab-band-search is-narrow">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search renewals"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        <Counter label="Expiring" value={due.length} />
        <div className="tab-band-divider" />
        <Counter label="Expired" value={expired.length} />
        <div className="tab-band-divider" />
        <Counter label="Missing dates" value={unresolved.length} />
        <div className="tab-band-divider" />
        {/* Said out loud so the absence is explained: these are not chased. */}
        <Counter label="Perpetual" value={renewals.data?.perpetual ?? 0} />
      </div>

      <div className="filter-tabs" role="tablist" aria-label="Renewals">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="filter-tab"
            onClick={() => setTab(t)}
          >
            <span className="filter-tab-text">{t}</span>
          </button>
        ))}
      </div>

      <div className="renewal-grid project-list-head finance-head">
        <span className="project-list-head-cell">Project</span>
        <span className="project-list-head-cell">Brand</span>
        <span className="project-list-head-cell">Job no.</span>
        <span className="project-list-head-cell">Contracts</span>
        <span className="project-list-head-cell">
          {tab === 'Expiring' ? 'First expiry' : tab === 'Expired' ? 'Expired' : 'Uploaded'}
        </span>
        <span className="project-list-head-cell" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {renewals.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {renewals.error && <p className="form-error px-8 py-4">{renewals.error.message}</p>}

        {tab === 'Expiring' && dueRows.map((r) => renewalRow(r, false))}
        {tab === 'Expired' && expiredRows.map((r) => renewalRow(r, true))}

        {tab === 'Missing dates' &&
          unresolvedRows.map((r) => (
            <div key={r.project_id ?? r.sequel_no}>
              <div className="renewal-grid finance-row" onClick={() => toggle(r.project_id)}>
                <span className="project-list-title">{r.project_title || '—'}</span>
                <span className="project-list-cell">{r.brand}</span>
                <span className="project-list-cell">{r.sequel_no}</span>
                <span className="project-list-cell">{countLabel(r.contract_count)}</span>
                <span className="project-list-cell">{fmtDate(r.latest)}</span>
                <span className="project-list-cell renewal-actions">
                  {r.project_id && (
                    <Link
                      to={`/projects/${r.project_id}?tab=Contracting`}
                      className="renewal-tick"
                      onClick={(e) => e.stopPropagation()}
                    >
                      OPEN
                    </Link>
                  )}
                </span>
              </div>

              {r.project_id !== null &&
                open[r.project_id] &&
                r.contracts.map((c) => (
                  <div key={c.uuid} className="renewal-grid renewal-sub">
                    <span className="project-list-cell">
                      {[c.supplier || c.file_name, c.contract_type].filter(Boolean).join(' · ')}
                    </span>
                    <span className="project-list-cell renewal-sub-wide" />
                    <span className="project-list-cell" />
                    <span className="project-list-cell">{fmtDate(c.created_at)}</span>
                    <span className="project-list-cell" />
                  </div>
                ))}
            </div>
          ))}

        {renewals.data && tab === 'Expiring' && dueRows.length === 0 && (
          <div className="no-result-row">Nothing is expiring in the next 42 days.</div>
        )}
        {renewals.data && tab === 'Expired' && expiredRows.length === 0 && (
          <div className="no-result-row">Nothing has lapsed.</div>
        )}
        {renewals.data && tab === 'Missing dates' && unresolvedRows.length === 0 && (
          <div className="no-result-row">Every contract has an expiry or is perpetual.</div>
        )}
      </div>
    </>
  )
}
