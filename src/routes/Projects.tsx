import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { plural } from '../lib/format'
import { splitProjectName } from '../lib/projectName'
import { useProjects } from '../lib/queries'

export default function Projects() {
  const projects = useProjects()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('')

  const term = filter.trim().toLowerCase()
  const rows = (projects.data ?? []).filter(
    (p) => !term || p.name.toLowerCase().includes(term) || (p.client_name ?? '').toLowerCase().includes(term),
  )

  return (
    <>
      <div className="border-b border-sequel-line px-7 pb-[18px] pt-[22px]">
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-title text-[clamp(18px,2.4vw,28px)] font-normal uppercase leading-[1.1]">
            Projects
          </h1>
          <input
            type="search"
            className="search-well max-w-[18rem]"
            placeholder="Filter"
            aria-label="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {projects.isPending && <p className="px-7 py-4 text-sequel-mid">Loading…</p>}
        {projects.error && <p className="form-error px-7 py-4">{projects.error.message}</p>}
        {projects.data && (
          <table className="track-table">
            <colgroup>
              <col />
              <col style={{ width: '22%' }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="pl-7">Project</th>
                <th>Client</th>
                <th>Inbox</th>
                <th>Playlists</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const { number, title } = splitProjectName(p.name)
                const tracks = p.tracks[0]?.count ?? 0
                const playlists = p.playlists[0]?.count ?? 0
                return (
                  <tr
                    key={p.id}
                    className="track-row cursor-pointer"
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <td className="pl-7">
                      <span className="uppercase">{title}</span>
                      {number && <span className="secondary ml-2 text-xs">{number}</span>}
                    </td>
                    <td className="secondary">{p.client_name ?? ''}</td>
                    <td className="secondary">{tracks > 0 ? plural(tracks, 'track') : '—'}</td>
                    <td className="secondary">{playlists > 0 ? playlists : '—'}</td>
                    <td className="secondary">{p.status ?? ''}</td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-7 py-6 text-sequel-mid">
                    {term ? 'No project matches.' : 'No projects yet — they arrive from Sequel Track.'}
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
