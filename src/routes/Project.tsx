import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import Search from '../components/staff/Search'
import TrackTable from '../components/staff/TrackTable'
import { useCreator } from '../lib/creator'
import { formatDate, plural } from '../lib/format'
import {
  usePlaylist,
  usePlaylistActions,
  usePlaylists,
  useProject,
  useProjectTracks,
  useRecordVisit,
  type TrackWithUse,
} from '../lib/queries'
import { trackProjectUrl } from '../lib/track'

type Tab = 'playlists' | 'activity'

/** What the right-hand pane is showing. */
type Open = { kind: 'playlist' | 'submission'; key: string }

/**
 * One partner drop. Grouped on the id the inbox page mints per send; rows
 * from before that column existed fall back to sender-and-hour.
 */
type Submission = {
  key: string
  company: string
  email: string
  note: string | null
  latest: string
  tracks: TrackWithUse[]
}

function groupSubmissions(tracks: TrackWithUse[]): Submission[] {
  const groups = new Map<string, Submission>()
  for (const t of tracks) {
    const key =
      t.submission_id ??
      `${t.submitter_email ?? ''}|${t.created_at.slice(0, 13)}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        company:
          t.submitter_company ||
          t.submitter_name ||
          t.submitter_email ||
          'Unknown partner',
        email: t.submitter_email ?? '',
        note: t.notes,
        latest: t.created_at,
        tracks: [],
      }
      groups.set(key, g)
    }
    g.tracks.push(t)
    if (t.created_at > g.latest) g.latest = t.created_at
    if (!g.note && t.notes) g.note = t.notes
  }
  return [...groups.values()].sort((a, b) => (a.latest < b.latest ? 1 : -1))
}

export default function Project() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  // ?tab=inbox predates the split; both halves live in one view now.
  const tab: Tab = params.get('tab') === 'activity' ? 'activity' : 'playlists'
  const project = useProject(id)
  const tracks = useProjectTracks(id)
  const playlists = usePlaylists(id)
  const creator = useCreator()
  const actions = usePlaylistActions()
  useRecordVisit(id)

  const [copied, setCopied] = useState(false)
  const [picked, setPicked] = useState<Open | null>(null)

  const submissions = useMemo(
    () => groupSubmissions(tracks.data ?? []),
    [tracks.data],
  )
  // The left column: staff playlists first, then the inbox's own drops.
  // Whichever comes first is what opens when you land on the project.
  const open: Open | null =
    picked ??
    (playlists.data?.[0]
      ? { kind: 'playlist', key: playlists.data[0].id }
      : submissions[0]
        ? { kind: 'submission', key: submissions[0].key }
        : null)
  const openPlaylist = usePlaylist(open?.kind === 'playlist' ? open.key : null)
  const openSubmission =
    open?.kind === 'submission'
      ? (submissions.find((s) => s.key === open.key) ?? null)
      : null

  // A playlist's rows come back as plain tracks. The project's own list
  // already knows which playlists each one is in, so reuse that where it
  // can and fall back to this playlist alone.
  const playlistTracks = useMemo<TrackWithUse[]>(() => {
    const rows = openPlaylist.data?.playlist_tracks
    if (!rows) return []
    const known = new Map(tracks.data?.map((t) => [t.id, t]) ?? [])
    return [...rows]
      .sort((a, b) => a.position - b.position)
      .flatMap((r) =>
        r.tracks
          ? [
              known.get(r.tracks.id) ?? {
                ...r.tracks,
                playlist_tracks: [{ playlist_id: r.playlist_id }],
              },
            ]
          : [],
      )
  }, [openPlaylist.data, tracks.data])

  const title = project.data?.name ?? ''
  const sequelNo = project.data?.sequel_no ?? ''
  const trackUrl = trackProjectUrl(project.data?.xano_uuid ?? null)

  const copyInbox = async () => {
    const token = project.data?.inboxes?.token
    if (!token) return
    await navigator.clipboard.writeText(`${location.origin}/inbox/${token}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'playlists') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }

  if (project.error)
    return <p className="form-error px-7 py-4">{project.error.message}</p>

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">{project.data?.client_name ?? ' '}</div>
        <div className="title-row gap-4">
          {/* The title is the way through to the project in Track, so the
              separate button for it is gone. A project with no uuid has
              nowhere to point, and stays plain text rather than a dead link. */}
          <h1 className="page-title min-w-0 flex-1 truncate">
            {trackUrl ? (
              <a
                href={trackUrl}
                target="_blank"
                rel="noreferrer"
                title="Open this project in Sequel Track"
              >
                {title}
              </a>
            ) : (
              title
            )}
          </h1>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="btn btn-mono btn-outline"
              disabled={!project.data?.inboxes?.token}
              onClick={() => void copyInbox()}
            >
              {copied ? 'Copied' : 'Copy inbox link'}
            </button>
          </div>
        </div>
        <div className="page-subtitle">{sequelNo || ' '}</div>
      </div>

      {/* tab_bar_app: the search first at 40%, then the divider, then what
          the band is for on this page — as the Projects page puts its stats
          after the same two. */}
      <div className="tab-band">
        <div className="tab-band-search">
          <Search />
        </div>
        <div className="tab-band-divider mx-6" />
        <div role="tablist" className="flex items-end gap-[26px] self-stretch">
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'playlists'}
            onClick={() => setTab('playlists')}
          >
            Playlists
            {tracks.data && (
              <span className="count">
                {plural(playlists.data?.length ?? 0, 'playlist')} ·{' '}
                {plural(submissions.length, 'submission')}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === 'activity'}
            onClick={() => setTab('activity')}
          >
            Activity
          </button>
        </div>
      </div>

      {tab === 'playlists' && (
        <div className="split">
          <div className="split-list">
            <div className="split-group">
              <span>Playlists</span>
              <button
                type="button"
                className="underline"
                onClick={async () => {
                  const newId = await actions.createPlaylist.mutateAsync({
                    projectId: id ?? null,
                  })
                  creator.open(newId)
                  setPicked({ kind: 'playlist', key: newId })
                }}
              >
                New
              </button>
            </div>
            {playlists.data?.length === 0 && (
              <p className="px-8 pb-2 text-[0.8rem] text-sequel-mid">
                None yet.
              </p>
            )}
            {playlists.data?.map((p) => (
              <button
                key={p.id}
                type="button"
                className="split-row"
                aria-current={open?.kind === 'playlist' && open.key === p.id}
                onClick={() => setPicked({ kind: 'playlist', key: p.id })}
              >
                <span className="split-row-title">{p.name}</span>
                <span className="split-row-meta">
                  <span className="pill">
                    {plural(p.playlist_tracks[0]?.count ?? 0, 'track')}
                  </span>
                  {formatDate(p.updated_at)}
                </span>
              </button>
            ))}

            <div className="split-group">
              <span>Inbox</span>
            </div>
            {tracks.data && submissions.length === 0 && (
              <p className="px-8 pb-4 text-[0.8rem] text-sequel-mid">
                Nothing sent yet. Copy the link above and pass it to partners.
              </p>
            )}
            {submissions.map((s) => (
              <button
                key={s.key}
                type="button"
                className="split-row"
                aria-current={open?.kind === 'submission' && open.key === s.key}
                onClick={() => setPicked({ kind: 'submission', key: s.key })}
              >
                <span className="split-row-title">{s.company}</span>
                <span className="split-row-meta">
                  <span className="pill">
                    {plural(s.tracks.length, 'track')}
                  </span>
                  {formatDate(s.latest)}
                </span>
              </button>
            ))}
          </div>

          <div className="split-detail">
            {tracks.isPending && (
              <p className="px-7 py-4 text-sequel-mid">Loading…</p>
            )}
            {tracks.error && (
              <p className="form-error px-7 py-4">{tracks.error.message}</p>
            )}
            {!open && tracks.data && (
              <p className="px-7 py-6 text-sequel-mid">
                Nothing here yet. A partner's first drop, or a playlist you
                start, opens on this side.
              </p>
            )}

            {openSubmission && (
              <>
                <div className="detail-head">
                  <h2 className="submission-title">{openSubmission.company}</h2>
                  <div className="detail-meta">
                    {plural(openSubmission.tracks.length, 'track')} ·{' '}
                    {formatDate(openSubmission.latest)}
                  </div>
                  {(openSubmission.email || openSubmission.note) && (
                    <div className="detail-from">
                      {openSubmission.email && (
                        <div>
                          From <strong>{openSubmission.company}</strong>
                          <span className="ml-2 text-sequel-mid">
                            {openSubmission.email}
                          </span>
                        </div>
                      )}
                      {openSubmission.note && (
                        <p className="mt-2">“{openSubmission.note}”</p>
                      )}
                    </div>
                  )}
                </div>
                <TrackTable tracks={openSubmission.tracks} />
              </>
            )}

            {open?.kind === 'playlist' && openPlaylist.data && (
              <>
                <div className="detail-head">
                  <h2 className="submission-title">{openPlaylist.data.name}</h2>
                  <div className="detail-meta">
                    {plural(playlistTracks.length, 'track')} ·{' '}
                    {formatDate(openPlaylist.data.updated_at)}
                  </div>
                  <button
                    type="button"
                    className="btn btn-tool btn-outline mt-3"
                    onClick={() => creator.open(openPlaylist.data!.id)}
                  >
                    Edit in creator
                  </button>
                </div>
                {playlistTracks.length === 0 ? (
                  <p className="px-7 py-6 text-sequel-mid">
                    Nothing in this playlist yet. Drag tracks in from a
                    submission, or drop files on the creator.
                  </p>
                ) : (
                  <TrackTable tracks={playlistTracks} />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="px-7 py-6 text-sequel-mid">
            <p>
              Activity is recorded from the viewer page — who opened each
              playlist, what they played and for how long.
            </p>
            <p className="mt-2">
              Nothing to show until the first playlist is shared.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
