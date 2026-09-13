import { Loader } from '../components/Loader'
import { useTrackProjects } from '../lib/trackMirror'

/**
 * Sequel Track's project list, read from the Xano mirror. Read-only on
 * purpose: Track still runs on Xano, and this page exists to prove the data
 * and the access rules before any writing moves across.
 */

// There are three supervisors, so a first name identifies one unambiguously
// and buys the project title the width it actually needs. Measured: with the
// Creator open the table has 650px, and six full-width columns left the
// title column 22px.
function firstName(name: string | null) {
  if (!name) return '—'
  return name.trim().split(/\s+/)[0]
}

export default function TrackProjects() {
  const projects = useTrackProjects()
  const rows = projects.data ?? []

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Track</div>
        <div className="title-row">
          <h1 className="page-title">Projects</h1>
        </div>
        <div className="page-subtitle">
          {projects.data ? `#${projects.data.length}` : ' '}
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
                <tr key={p.id} className="track-row">
                  <td className="pl-7">
                    {/* 14 of the 241 rows carry no title at all — blank
                        shells created in Track. Showing the id keeps them
                        identifiable rather than rendering an empty line.
                        Titles run long and the Creator panel takes a third of
                        the width, so the full name lives in the tooltip. */}
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
                    No projects visible to this account.
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
