import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useClients, type Client } from '../lib/xanoMirror'

/**
 * Sequel Track's `/clients`, rebuilt from the page rather than from the data.
 *
 * The staff directory of every client company — agencies, brands and
 * production companies — alongside `/partners` and `/roster`, and built by
 * duplicating `/partners` in Webflow, which is why its row is still the
 * `partner_row` grid.
 *
 * Three behaviours here differ from `/projects` and each was checked on the
 * running page rather than assumed:
 *
 *  1. The six counts never move. They are the whole dataset, always, whatever
 *     is typed or selected — where the counters on `/projects` follow the
 *     search. Typing "London" leaves them at 96/37/17/9/30/3.
 *  2. The search matches the company name only. "Brazil" returns the two
 *     companies with Brazil in the name, not the five clients in Brazil;
 *     "Agency" returns four, not every client whose type is Agency. Track
 *     searches the serialised row on `/projects` and only this one field here.
 *  3. Region and search compose. APAC with "London" typed is empty, and says
 *     so.
 *
 * Read-only, like the rest of this pass: the share and archive marks are the
 * ones Track draws, and neither does anything. Archiving is the one write on
 * Track's own page (`archive_client`, api 555) and it stays in Xano.
 */

/**
 * The tabs, in Track's order, keyed on the Regions table's ids rather than on
 * the labels — renaming a region should not silently empty a tab.
 *
 * The labels are Track's own, verbatim: "Na", "Apac" and "Met" are what the
 * Webflow page says, and this pass recreates them rather than tidying them to
 * NA / APAC / MET.
 */
const TABS: { region: number | null; label: string }[] = [
  { region: null, label: 'Global' },
  { region: 2, label: 'Europe' },
  { region: 3, label: 'Latam' },
  { region: 4, label: 'Na' },
  { region: 1, label: 'Apac' },
  { region: 5, label: 'Met' },
]

/** share-2, 1rem, stroke 1.5 — the icon Webflow embeds in the row. */
function ShareIcon() {
  return (
    <svg
      width="1rem"
      height="1rem"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

/** The archive mark. Track's is a cross, not a bin — on a 40-unit box. */
function ArchiveIcon() {
  return (
    <svg width="1rem" height="1rem" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true">
      <path d="M21.499 19.994L32.755 8.727a1.064 1.064 0 0 0-.001-1.502c-.398-.396-1.099-.398-1.501.002L20 18.494L8.743 7.224c-.4-.395-1.101-.393-1.499.002a1.05 1.05 0 0 0-.309.751c0 .284.11.55.309.747L18.5 19.993L7.245 31.263a1.064 1.064 0 0 0 .003 1.503c.193.191.466.301.748.301h.006c.283-.001.556-.112.745-.305L20 21.495l11.257 11.27c.199.198.465.308.747.308a1.06 1.06 0 0 0 1.061-1.061c0-.283-.11-.55-.31-.747z" />
    </svg>
  )
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function Clients() {
  const clients = useClients()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [region, setRegion] = useState<number | null>(null)

  const all = useMemo(() => clients.data ?? [], [clients.data])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all.filter(
      (c: Client) =>
        (region == null || c.region_id === region) &&
        (!term || (c.company ?? '').toLowerCase().includes(term)),
    )
  }, [all, q, region])

  // Deliberately off `all`, never off `rows`. See the note at the top: these
  // six do not move.
  const count = (r: number) => all.filter((c) => c.region_id === r).length

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Our</div>
        <h1 className="page-title">Clients</h1>
        <div className="page-subtitle">The folks we&rsquo;re here to help.</div>
      </div>

      <div className="tab-band">
        {/* app-search-form is 30% of the band here, not the 40% the projects
            list gives it. */}
        <div className="tab-band-search is-narrow">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search clients"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        <Counter label="Global" value={all.length} />
        <div className="tab-band-divider" />
        <Counter label="Europe" value={count(2)} />
        <div className="tab-band-divider" />
        <Counter label="Latam" value={count(3)} />
        <div className="tab-band-divider" />
        <Counter label="Na" value={count(4)} />
        <div className="tab-band-divider" />
        <Counter label="Apac" value={count(1)} />
        <div className="tab-band-divider" />
        <Counter label="Met" value={count(5)} />
      </div>

      <div className="filter-tabs" role="tablist" aria-label="Region">
        {TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={region === t.region}
            className="filter-tab"
            onClick={() => setRegion(t.region)}
          >
            <span className="filter-tab-text">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* app-list-spacer-row. It is 2rem tall and shrinkable, so the moment
            the list is long enough to scroll the flex box takes all 2rem back
            and the first row sits flush against the tabs — which is what
            Track does with 96 clients in it. Left as it is. */}
        <div className="h-8" />

        {clients.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {clients.error && <p className="form-error px-8 py-4">{clients.error.message}</p>}

        {clients.data &&
          rows.map((c) => (
            <div
              key={c.id}
              className="project-row project-row-client"
              onClick={() => navigate(`/clients/${c.uuid}`)}
            >
              <span className="row-title" title={c.company ?? undefined}>
                {c.company}
              </span>
              <span className="row-field">{c.country_text}</span>
              <span className="row-type">{c.client_type_text}</span>
              {/* Both marks are Track's own and both are inert in this pass:
                  the share link and the archive are writes, and Xano is still
                  the only writer. */}
              <span className="row-action is-inert" title="Share — not rebuilt yet">
                <ShareIcon />
              </span>
              <span className="row-action is-inert" title="Archive — not rebuilt yet">
                <ArchiveIcon />
              </span>
            </div>
          ))}

        {clients.data && rows.length === 0 && (
          <p className="empty-note py-6">
            {q || region != null
              ? 'No clients match that.'
              : 'No clients on this account.'}
          </p>
        )}
      </div>
    </>
  )
}
