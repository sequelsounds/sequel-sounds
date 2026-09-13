import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useProjects } from '../lib/xanoMirror'

/**
 * Every project, read from the Xano mirror. This replaced Studio's own list,
 * which was built on projects_mirror — a partial backfill holding 105 of the
 * 241 projects Xano actually has. One list, and it is the complete one.
 */

// There are three supervisors, so a first name identifies one unambiguously
// and buys the project title the width it needs.
function firstName(name: string | null) {
  if (!name) return '—'
  return name.trim().split(/\s+/)[0]
}

export default function Projects() {
  const projects = useProjects()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const all = projects.data ?? []
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((p) =>
      [p.title, p.sequel_no, p.brand, p.agency, p.supervisor, p.client_group]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(term)),
    )
  }, [projects.data, q])

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Sequel</div>
        <div className="title-row">
          <h1 className="page-title">Projects</h1>
        </div>
        <div className="page-subtitle">
          {projects.data
            ? q
              ? `#${rows.length} of ${projects.data.length}`
              : `#${projects.data.length}`
            : ' '}
        </div>
      </div>

      <div className="tab-band">
        <div className="tab-band-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            className="w-full bg-transparent outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {projects.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {projects.error && (
          <p className="form-error px-7 py-4">{projects.error.message}</p>
        )}
        {projects.data && (
          <table className="track-table">
            <colgroup>
              <col />
              <col style={{ width: 115 }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: 85 }} />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="pl-7">Project</th>
                <th>Sequel no</th>
                <th>Brand</th>
                <th>Agency</th>
                <th>Stage</th>
                <th>Supe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className="track-row cursor-pointer"
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  <td className="pl-7">
                    {/* 14 of the 241 rows carry no title at all — blank shells
                        created in Track. Showing the id keeps them
                        identifiable rather than rendering an empty line. */}
                    <span
                      className="sentence-case block truncate font-sans"
                      title={p.title ?? undefined}
                    >
                      {p.title ?? `Untitled (#${p.id})`}
                    </span>
                  </td>
                  <td className="secondary">{p.sequel_no ?? '—'}</td>
                  <td className="secondary">
                    <span className="block truncate" title={p.brand ?? undefined}>
                      {p.brand ?? '—'}
                    </span>
                  </td>
                  <td className="secondary">
                    <span className="block truncate" title={p.agency ?? undefined}>
                      {p.agency ?? '—'}
                    </span>
                  </td>
                  <td className="secondary">{p.stage ?? '—'}</td>
                  <td className="secondary">{firstName(p.supervisor)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-7 py-6 text-sequel-mid">
                    {q ? 'Nothing matches that search.' : 'No projects visible to this account.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
