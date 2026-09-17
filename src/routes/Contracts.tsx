import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useMarkRenewalSeen, useRenewals, type Renewal, type Unresolved } from '../lib/contracts'
import { useIsStaff } from '../lib/staff'

/**
 * Contracts — `/contracts`. New: the old app has no such page.
 *
 * The renewal engine's whole commercial point is pre-empting expiry, and the
 * old app computed the dates and then had nothing to show them on. Andy asked
 * on 17 Sep for a page rather than an email: nothing here sends anything, so
 * nothing can go out to an agency about a licence that is not really expiring.
 *
 * Two lists:
 *   DUE          expiring within 42 days, soonest first
 *   NO EXPIRY    confirmed, not perpetual, no end date — the failure bucket.
 *                An extraction miss looks exactly like this, and without a
 *                list it is invisible, which is the direction that loses money.
 */

const shortDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
function fmtDate(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : shortDate.format(d)
}

const TABS = ['Due', 'No expiry'] as const
type Tab = (typeof TABS)[number]

function Counter({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function Contracts() {
  const staff = useIsStaff()
  const renewals = useRenewals()
  const seen = useMarkRenewalSeen()
  const [tab, setTab] = useState<Tab>('Due')
  const [q, setQ] = useState('')

  const due = useMemo(() => renewals.data?.due ?? [], [renewals.data])
  const unresolved = useMemo(() => renewals.data?.unresolved ?? [], [renewals.data])

  const match = (r: Renewal | Unresolved) => {
    const term = q.trim().toLowerCase()
    if (!term) return true
    return [r.supplier, r.contract_type, r.project_title, r.sequel_no, r.brand, r.file_name].some((v) =>
      (v ?? '').toLowerCase().includes(term),
    )
  }

  if (staff.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader />
      </div>
    )
  }

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Our</div>
        <div className="title-row">
          <h1 className="page-title">Contracts</h1>
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
            aria-label="Search contracts"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        <Counter label="Due within 42 days" value={due.length} />
        <div className="tab-band-divider" />
        <Counter label="No expiry" value={unresolved.length} />
        <div className="tab-band-divider" />
        {/* Already lapsed is a count, not a list: nothing can be chased. */}
        <Counter label="Already expired" value={renewals.data?.expired ?? 0} />
      </div>

      <div className="filter-tabs" role="tablist" aria-label="Contracts">
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
        <span className="project-list-head-cell">Supplier</span>
        <span className="project-list-head-cell">Type</span>
        <span className="project-list-head-cell">Song</span>
        <span className="project-list-head-cell">Project</span>
        <span className="project-list-head-cell">Job no.</span>
        <span className="project-list-head-cell">{tab === 'Due' ? 'Expires' : 'Uploaded'}</span>
        <span className="project-list-head-cell">{tab === 'Due' ? '' : ''}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {renewals.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {renewals.error && <p className="form-error px-8 py-4">{renewals.error.message}</p>}

        {tab === 'Due' &&
          due.filter(match).map((r) => (
            <div key={r.id} className={`renewal-grid finance-row${r.seen ? ' is-seen' : ''}`}>
              <span className="project-list-title">{r.supplier || r.file_name}</span>
              <span className="project-list-cell">{r.contract_type}</span>
              <span className="project-list-cell">{r.song_name || r.artist}</span>
              <span className="project-list-cell">
                {r.project_id ? (
                  <Link to={`/projects/${r.project_id}?tab=Contracting`}>{r.project_title}</Link>
                ) : (
                  r.project_title
                )}
              </span>
              <span className="project-list-cell">{r.sequel_no}</span>
              <span className="project-list-cell">
                {fmtDate(r.end_date)}
                {/* The number people act on: how long is left. */}
                <span className="renewal-days">{r.days_left === 0 ? ' · today' : ` · ${r.days_left}d`}</span>
              </span>
              <span className="project-list-cell">
                <button
                  type="button"
                  className="renewal-tick"
                  onClick={() => seen.mutate({ uuid: r.uuid, seen: !r.seen })}
                >
                  {r.seen ? 'DEALT WITH' : 'MARK DONE'}
                </button>
              </span>
            </div>
          ))}

        {tab === 'No expiry' &&
          unresolved.filter(match).map((r) => (
            <div key={r.id} className="renewal-grid finance-row">
              <span className="project-list-title">{r.supplier || r.file_name}</span>
              <span className="project-list-cell">{r.contract_type}</span>
              <span className="project-list-cell" />
              <span className="project-list-cell">
                {r.project_id ? (
                  <Link to={`/projects/${r.project_id}?tab=Contracting`}>{r.project_title}</Link>
                ) : (
                  r.project_title
                )}
              </span>
              <span className="project-list-cell">{r.sequel_no}</span>
              <span className="project-list-cell">{fmtDate(r.created_at)}</span>
              <span className="project-list-cell" />
            </div>
          ))}

        {renewals.data && tab === 'Due' && due.filter(match).length === 0 && (
          <div className="no-result-row">Nothing is due for renewal.</div>
        )}
        {renewals.data && tab === 'No expiry' && unresolved.filter(match).length === 0 && (
          <div className="no-result-row">Every contract has an expiry or is perpetual.</div>
        )}
      </div>
    </>
  )
}
