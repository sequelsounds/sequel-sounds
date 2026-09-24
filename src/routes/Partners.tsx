import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { usePartners, type Partner } from '../lib/xanoMirror'
import { NewSupplier } from '../components/staff/NewSupplier'
import { SupplierArchiveAction } from '../components/staff/RowActions'

/**
 * Sequel Track's `/partners`, rebuilt from the page rather than from the data.
 *
 * The music suppliers — labels, publishers, libraries, sync reps, agents — and
 * the page `/clients` was duplicated from, which is why it is the same band,
 * the same six region tabs and the same `partner_row` grid. The differences
 * from `/clients` are small and all of them were checked on the running page:
 *
 *  1. **The search diverges from Track, deliberately.** Track matches the
 *     serialised record, so it also searches bios, uuids and ids — type a
 *     single digit and nearly every supplier matches. `/users` matches named
 *     fields instead, and the comment on its Xano endpoint says exactly why.
 *     This follows `/users`. The fields below are the ones a person could
 *     reasonably expect to search on: everything the row shows, plus the
 *     region, the city, the briefing list and the brief address. So
 *     "Publisher" still returns its 34 (it is a supplier type) and
 *     "michelle@" still returns its one, and "3" no longer returns 90.
 *  2. The row's fourth mark is a mail link, not a share link.
 *  3. The counts still never move, as on `/clients`.
 *
 * ⚠️ **The five region tabs do not add up to Global, and that is Track being
 * honest rather than wrong.** Made By Mistry has no region set — `regions_id`
 * 0, which is Xano's way of saying unset — so it is one of the 93 and in none
 * of the five tabs. 53 + 2 + 25 + 12 + 0 = 92.
 *
 * The mail and archive marks are still drawn and inert. What is live is
 * **Add partner** — the first create on either stack; see `NewSupplier`.
 */

const TABS: { region: number | null; label: string }[] = [
  { region: null, label: 'Global' },
  { region: 2, label: 'Europe' },
  { region: 3, label: 'Latam' },
  { region: 4, label: 'Na' },
  { region: 1, label: 'Apac' },
  { region: 5, label: 'Met' },
]

/** Phosphor envelope, filled, 1rem — the icon Webflow embeds in the row. */
function MailIcon() {
  return (
    <svg width="1rem" height="1rem" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM203.43,64,128,133.15,52.57,64ZM216,192H40V74.19l82.59,75.71a8,8,0,0,0,10.82,0L216,74.19V192Z" />
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

export default function Partners() {
  const partners = usePartners()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [region, setRegion] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const all = useMemo(() => partners.data ?? [], [partners.data])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all.filter(
      (p: Partner) =>
        (region == null || p.region_id === region) &&
        (!term ||
          [
            p.title,
            p.supplier_type,
            p.country_text,
            p.region_text,
            p.city,
            p.briefing_list,
            p.brief_email,
            p.strengths,
          ]
            .join(' ')
            .toLowerCase()
            .includes(term)),
    )
  }, [all, q, region])

  // Off `all`, never off `rows`: the six counts do not move.
  const count = (r: number) => all.filter((p) => p.region_id === r).length

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Our</div>
        {/* Webflow's source text is "PartNers", capital N, which nobody sees
            because the class uppercases it. */}
        <div className="title-row">
          <h1 className="page-title">Partners</h1>
          <button
            type="button"
            className="btn btn-mono btn-outline"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? 'Close' : '+ Add partner'}
          </button>
        </div>
        <div className="page-subtitle">Manage our music suppliers...</div>
      </div>

      {adding && (
        <NewSupplier
          onCancel={() => setAdding(false)}
          onCreated={(uuid) => navigate(`/partners/${uuid}`)}
        />
      )}

      <div className="tab-band">
        <div className="tab-band-search is-narrow">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search partners"
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
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* app-list-spacer-row: 2rem, and shrinkable, so a list long enough to
            scroll takes it all back. */}
        <div className="h-8" />

        {partners.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {partners.error && <p className="form-error px-8 py-4">{partners.error.message}</p>}

        {partners.data &&
          rows.map((p) => (
            <div
              key={p.id}
              className="project-row project-row-client"
              onClick={() => navigate(`/partners/${p.uuid}`)}
            >
              <span className="row-title" title={p.title ?? undefined}>
                {p.title}
              </span>
              <span className="row-field">{p.country_text}</span>
              <span className="row-type">{p.supplier_type}</span>
              {/* Track's mail mark opens the brief address. It is drawn on
                  every row, including the ones that have no address. */}
              <span className="row-action is-inert" title="Email — not rebuilt yet">
                <MailIcon />
              </span>
              <SupplierArchiveAction id={p.id} />
            </div>
          ))}

        {partners.data && rows.length === 0 && (
          <div className="no-result-row">No results found</div>
        )}
      </div>
    </>
  )
}
