import { useNavigate } from 'react-router-dom'
import Search from '../components/staff/Search'
import { plural } from '../lib/format'
import { useProjects } from '../lib/queries'

export default function Projects() {
  const projects = useProjects()
  const navigate = useNavigate()
  const rows = projects.data ?? []

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Studio</div>
        <div className="title-row">
          <h1 className="page-title">Projects</h1>
        </div>
        <div className="page-subtitle">
          {projects.data ? `#${projects.data.length}` : '\u00a0'}
        </div>
      </div>
      {/* tab_bar_app: the search takes 40% of the band, as Form Block 3 does. */}
      <div className="tab-band">
        <div className="tab-band-search">
          <Search />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {projects.isPending && (
          <p className="px-7 py-4 text-sequel-mid">Loading…</p>
        )}
        {projects.error && (
          <p className="form-error px-7 py-4">{projects.error.message}</p>
        )}
        {projects.data && (
          <table className="track-table">
            <colgroup>
              <col />
              <col style={{ width: 150 }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="pl-7">Project</th>
                <th>Sequel no</th>
                <th>Client</th>
                <th>Inbox</th>
                <th>Playlists</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const tracks = p.tracks[0]?.count ?? 0
                const playlists = p.playlists[0]?.count ?? 0
                return (
                  <tr
                    key={p.id}
                    className="track-row cursor-pointer"
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <td className="pl-7">
                      <span className="sentence-case font-sans">{p.name}</span>
                    </td>
                    <td className="secondary">{p.sequel_no ?? '—'}</td>
                    <td className="secondary">{p.client_name ?? ''}</td>
                    <td className="secondary">
                      {tracks > 0 ? plural(tracks, 'track') : '—'}
                    </td>
                    <td className="secondary">
                      {playlists > 0 ? playlists : '—'}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-7 py-6 text-sequel-mid">
                    No projects yet — they arrive from Sequel Track.
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
