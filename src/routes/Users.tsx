import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useTrackUsers, type TrackUser } from '../lib/xanoMirror'

/**
 * Sequel Track's `/users`, rebuilt from the page.
 *
 * The people outside Sequel — agency, brand, freelance, AdPro and supplier
 * contacts. Staff are not here: get_users filters out user_type 1 and 2, which
 * is 146 of the 149 rows on the table.
 *
 * This is the best-behaved list in Track and the rebuild copies it as it is:
 *
 *  - **the search matches named fields**, not the serialised record — name,
 *    email, type, status, company, country, job title, phone. Xano's own
 *    comment says why: stringifying would also search ids and uuids, so typing
 *    "3" would match half the list on numbers nobody can see. `/partners` and
 *    `/songs` do stringify, and have exactly that problem.
 *  - **the count in the subtitle is the whole list**, not the filtered one.
 *  - **newest first**, the one list in the app not ordered by name.
 *
 * ⚠️ Three of the row bindings are misnamed in Wized and have been for months:
 * `user_row_type` renders the company, `user_row_status` the type, and
 * `user_row_company` the status. The columns line up correctly on screen — only
 * the names are shifted — so this is a trap for the next person reading the
 * config, not a bug on the page.
 *
 * Read-only.
 */

export default function Users() {
  const users = useTrackUsers()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  const all = useMemo(() => users.data ?? [], [users.data])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((u: TrackUser) =>
      [
        u.name,
        u.email,
        u.user_type_title,
        u.status_title,
        u.company_name,
        u.country_title,
        u.job_title,
        u.phone_number,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [all, q])

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Let&rsquo;s check in on...</div>
        <div className="title-row">
          <h1 className="page-title">Our users</h1>
          <button type="button" className="btn btn-mono btn-outline" disabled>
            + New User
          </button>
        </div>
        {/* dashboard_user_count reads the request's length, so the sentence
            does not change while you search. */}
        <div className="page-subtitle">We currently have {all.length} users</div>
      </div>

      <div className="tab-band">
        {/* The whole band is the search on this page — no counters beside it. */}
        <div className="tab-band-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search users"
            className="project-search"
          />
        </div>
      </div>

      <div className="user-list-grid user-list-head">
        <span className="project-list-head-cell">Name</span>
        <span className="project-list-head-cell">Company</span>
        <span className="project-list-head-cell">Type</span>
        <span className="project-list-head-cell">Status</span>
        <span className="project-list-head-cell">Country</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {users.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {users.error && <p className="form-error px-8 py-4">{users.error.message}</p>}

        {users.data &&
          rows.map((u) => (
            <div
              key={u.id}
              className="user-list-grid user-list-row"
              onClick={() => navigate(`/users/${u.uuid}`)}
            >
              <span className="project-list-title" title={u.name ?? undefined}>
                {u.name}
              </span>
              <span className="project-list-cell" title={u.company_name ?? undefined}>
                {u.company_name}
              </span>
              <span className="project-list-cell">{u.user_type_title}</span>
              <span className="project-list-cell">{u.status_title}</span>
              <span className="project-list-cell">{u.country_title}</span>
            </div>
          ))}

        {users.data && rows.length === 0 && (
          <div className="no-result-row">No results found</div>
        )}
      </div>
    </>
  )
}
