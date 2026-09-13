import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useRoster, type RosterMember } from '../lib/xanoMirror'

/**
 * Sequel Track's `/roster`, rebuilt — and this one does not reproduce what
 * Track does, because three things on Track's page do not work.
 *
 * What is wrong there, and why: `v.roster_data` is never populated. The rows
 * render straight off `r.Get_Roster`, so the name and the CA status appear, and
 * everything expressed over `roster_data` has nothing to read. That is one
 * cause with three symptoms —
 *
 *  1. the six region tabs set `roster_active_region` and mark themselves
 *     selected, and the list does not filter. Europe shows all 38, still led by
 *     Spacebar Audio Production, which is in Jakarta;
 *  2. the search box does nothing at all — the field fills, the variable behind
 *     it stays empty;
 *  3. the City column is blank on every row.
 *
 * Country is blank for a second reason on top: its binding reads `.Country`,
 * which is not a column on the table — the legacy one is `Country_to_delete`
 * and the real link is `countries_list_id` — and `get_roster` carries none of
 * the addons `get_all_suppliers` has, so no country text reaches the page
 * either way.
 *
 * The rule for this pass is to recreate Track rather than improve it. That
 * assumes the page works. Here it does not, so this filters, searches and fills
 * both columns, and the divergence is deliberate and recorded. Fixing Track is
 * two addons on `get_roster` and four bindings repointed.
 *
 * What does work on Track and is reproduced as-is: Logged and Signed — Signed
 * being CA Status "Complete" — and the click through to the team.
 */

/** Track's labels on this page are uppercase, where /clients and /partners are not. */
const TABS: { region: number | null; label: string }[] = [
  { region: null, label: 'Global' },
  { region: 2, label: 'Europe' },
  { region: 3, label: 'LATAM' },
  { region: 4, label: 'NA' },
  { region: 1, label: 'APAC' },
  { region: 5, label: 'MET' },
]

function MailIcon() {
  return (
    <svg width="1rem" height="1rem" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM203.43,64,128,133.15,52.57,64ZM216,192H40V74.19l82.59,75.71a8,8,0,0,0,10.82,0L216,74.19V192Z" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg width="1rem" height="1rem" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true">
      <path d="M21.499 19.994L32.755 8.727a1.064 1.064 0 0 0-.001-1.502c-.398-.396-1.099-.398-1.501.002L20 18.494L8.743 7.224c-.4-.395-1.101-.393-1.499.002a1.05 1.05 0 0 0-.309.751c0 .284.11.55.309.747L18.5 19.993L7.245 31.263a1.064 1.064 0 0 0 .003 1.503c.193.191.466.301.748.301h.006c.283-.001.556-.112.745-.305L20 21.495l11.257 11.27c.199.198.465.308.747.308a1.06 1.06 0 0 0 1.061-1.061c0-.283-.11-.55-.31-.747z" />
    </svg>
  )
}

export default function Roster() {
  const roster = useRoster()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [region, setRegion] = useState<number | null>(null)

  const all = useMemo(() => roster.data ?? [], [roster.data])

  // Matches the four columns the page shows, rather than the serialised row.
  // /partners stringifies everything, which is why a digit there matches almost
  // every supplier; there was no behaviour to copy here, so this is the one
  // that does not surprise anyone.
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all.filter(
      (m: RosterMember) =>
        (region == null || m.region_id === region) &&
        (!term ||
          [m.title, m.city, m.country_text, m.ca_status]
            .join(' ')
            .toLowerCase()
            .includes(term)),
    )
  }, [all, q, region])

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Composition</div>
        <div className="title-row">
          <h1 className="page-title">Roster</h1>
        </div>
        <div className="page-subtitle">Manage our partners...</div>
      </div>

      {/* Two tiles, not six. Signed is CA Status "Complete" — the composer
          agreement is back. Both are the whole roster whatever is filtered,
          which is Track's behaviour here and on /clients and /partners: the
          counts are the dataset, the list is the question you asked of it. */}
      <div className="tab-band">
        <div className="tab-band-search is-narrow">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search the roster"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        <div className="stat">
          <span className="stat-label">Logged</span>
          <span className="stat-value">{all.length}</span>
        </div>
        <div className="tab-band-divider" />
        <div className="stat">
          <span className="stat-label">Signed</span>
          <span className="stat-value">
            {all.filter((m) => m.ca_status === 'Complete').length}
          </span>
        </div>
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
        <div className="h-8" />

        {roster.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {roster.error && <p className="form-error px-8 py-4">{roster.error.message}</p>}

        {roster.data &&
          rows.map((m) => (
            <div
              key={m.id}
              className="project-row project-row-roster"
              onClick={() => navigate(`/roster/${m.uuid}`)}
            >
              <span className="row-title" title={m.title ?? undefined}>
                {m.title}
              </span>
              {/* Both blank on Track. The data was always there. */}
              <span className="row-field">{m.city}</span>
              <span className="row-field">{m.country_text}</span>
              <span className="row-type">{m.ca_status}</span>
              <span className="row-action is-inert" title="Email — not rebuilt yet">
                <MailIcon />
              </span>
              <span className="row-action is-inert" title="Archive — not rebuilt yet">
                <ArchiveIcon />
              </span>
            </div>
          ))}

        {roster.data && rows.length === 0 && (
          <div className="no-result-row">No results found</div>
        )}
      </div>
    </>
  )
}
