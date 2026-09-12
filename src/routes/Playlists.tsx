import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Search from '../components/staff/Search'
import { useCreator } from '../lib/creator'
import { formatDate, plural } from '../lib/format'
import { splitProjectName } from '../lib/projectName'
import {
  usePlaylistActions,
  usePlaylists,
  type PlaylistSummary,
} from '../lib/queries'

/** Every playlist: the unattached ones first, then grouped by project. */
export default function Playlists() {
  const playlists = usePlaylists()
  const creator = useCreator()
  const navigate = useNavigate()
  const actions = usePlaylistActions()

  const openPlaylist = (p: PlaylistSummary) => {
    creator.open(p.id)
    if (p.project_id) navigate(`/projects/${p.project_id}?tab=playlists`)
  }

  const groups = new Map<string, { title: string; rows: PlaylistSummary[] }>()
  for (const p of playlists.data ?? []) {
    const key = p.project_id ?? ''
    if (!groups.has(key)) {
      groups.set(key, {
        title: p.projects_mirror
          ? splitProjectName(p.projects_mirror.name).title
          : 'Not attached to a project',
        rows: [],
      })
    }
    groups.get(key)!.rows.push(p)
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === '' ? -1 : b === '' ? 1 : 0,
  )

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Everything you have put together…</div>
        <div className="title-row">
          <h1 className="page-title">Playlists</h1>
          <button
            type="button"
            className="btn btn-tool btn-outline"
            onClick={async () => {
              const id = await actions.createPlaylist.mutateAsync({
                projectId: null,
              })
              creator.open(id)
            }}
          >
            New playlist
          </button>
        </div>
        <div className="page-subtitle">
          {playlists.data
            ? plural(playlists.data.length, 'playlist')
            : '\u00a0'}
        </div>
      </div>
      {/* tab_bar_app: the search takes 40% of the band, as Form Block 3 does. */}
      <div className="tab-band">
        <div className="tab-band-search">
          <Search />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {playlists.isPending && (
          <p className="px-7 py-4 text-sequel-mid">Loading…</p>
        )}
        {playlists.error && (
          <p className="form-error px-7 py-4">{playlists.error.message}</p>
        )}
        {playlists.data && playlists.data.length === 0 && (
          <p className="px-7 py-6 text-sequel-mid">No playlists yet.</p>
        )}
        {ordered.map(([key, group]) => (
          <section key={key}>
            <h2 className="submission-title sentence-case font-sans px-7 pb-2 pt-4">
              {group.title}
            </h2>
            <PlaylistRows
              rows={group.rows}
              onOpen={openPlaylist}
              current={creator.playlistId}
            />
          </section>
        ))}
      </div>
    </>
  )
}

export function PlaylistRows({
  rows,
  onOpen,
  current,
}: {
  rows: PlaylistSummary[]
  onOpen: (p: PlaylistSummary) => void
  current: string | null
}) {
  return (
    <table className="track-table">
      <colgroup>
        <col />
        <col style={{ width: 110 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 200 }} />
      </colgroup>
      <tbody>
        {rows.map((p) => {
          const n = p.playlist_tracks[0]?.count ?? 0
          return (
            <tr
              key={p.id}
              className={`track-row cursor-pointer ${p.id === current ? 'is-playing' : ''}`}
              onClick={() => onOpen(p)}
            >
              <td className="pl-7">{p.name}</td>
              <td className="secondary">
                {n > 0 ? plural(n, 'track') : 'empty'}
              </td>
              <td className="secondary">{formatDate(p.updated_at)}</td>
              <td className="secondary text-xs">
                {[
                  p.video_track_id ? 'picture' : null,
                  p.require_sign_in ? 'sign-in' : 'open link',
                  p.visible_to_client ? 'visible to client' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** /playlists/:id — open it in the Creator and land where it lives. */
export function PlaylistRoute() {
  const { id } = useParams()
  const creator = useCreator()
  const navigate = useNavigate()
  const playlists = usePlaylists()
  useEffect(() => {
    if (!id || !playlists.data) return
    const p = playlists.data.find((x) => x.id === id)
    creator.open(id)
    navigate(
      p?.project_id ? `/projects/${p.project_id}?tab=playlists` : '/playlists',
      { replace: true },
    )
  }, [id, playlists.data, creator, navigate])
  return <p className="px-7 py-4 text-sequel-mid">Opening…</p>
}
