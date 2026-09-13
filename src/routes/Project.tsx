import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import Search from '../components/staff/Search'
import Confirm from '../components/staff/Confirm'
import TrackTable from '../components/staff/TrackTable'
import { PencilIcon, ShareIcon, TrashIcon } from '../components/staff/icons'
import { useCreator } from '../lib/creator'
import { formatDate, plural } from '../lib/format'
import {
  type PlaylistSummary,
  type TrackWithUse,
  usePlaylist,
  usePlaylistActions,
  usePlaylists,
  useProject,
  useProjectTracks,
  useRecordVisit,
  useDeleteSubmission,
} from '../lib/queries'
import { trackProjectUrl } from '../lib/track'

/**
 * The tracks in a drop that a delete may touch: the ones nothing is using
 * yet. Once a track is in a playlist it has been chosen, and a link may
 * already be out with a client — binning the drop it arrived in is no
 * reason to pull it out from under them. Those stay, and the drop's row
 * goes on listing them.
 */
function unusedIn(drop: Submission): TrackWithUse[] {
  return drop.tracks.filter((t) => t.playlist_tracks.length === 0)
}

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
    // The inbox is what partners sent, and nothing else. A staff upload gets
    // a submission_id of its own so a drop of forty files stays one drop, and
    // that made it look exactly like a submission here — three of our own
    // uploads were being listed as though a partner had sent them. The inbox
    // link is the thing that makes a submission, so inbox_id is the test.
    if (!t.inbox_id) continue
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
  const project = useProject(id)
  const tracks = useProjectTracks(id)
  const playlists = usePlaylists(id)
  const creator = useCreator()
  const actions = usePlaylistActions()
  useRecordVisit(id)

  const [copied, setCopied] = useState(false)
  const [picked, setPicked] = useState<Open | null>(null)
  const [deleting, setDeleting] = useState<PlaylistSummary | null>(null)
  const [dropping, setDropping] = useState<Submission | null>(null)
  const deleteSubmission = useDeleteSubmission()

  const submissions = useMemo(
    () => groupSubmissions(tracks.data ?? []),
    [tracks.data],
  )
  // The left column: staff playlists first, then the inbox's own drops.
  // Whichever comes first is what opens when you land on the project.
  // A pick only counts while the thing it names still exists. Deleting the
  // open playlist — from the row here, or from the Creator's own menu —
  // refreshes the column on the left but left this side reading a playlist
  // that had gone, from the query cache.
  const stillThere =
    picked?.kind === 'playlist'
      ? !!playlists.data?.some((p) => p.id === picked.key)
      : picked?.kind === 'submission'
        ? submissions.some((s) => s.key === picked.key)
        : false

  const open: Open | null =
    (stillThere ? picked : null) ??
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

  /**
   * A drop has no playlist of its own to edit, so the pencil makes one —
   * these tracks, in the order they arrived, open in the Playlister ready to
   * be cut down. The originals stay in the inbox; a playlist row only points
   * at a track.
   */
  const openDrop = async (drop: Submission) => {
    const newId = await actions.createPlaylist.mutateAsync({
      projectId: id ?? null,
      name: drop.company || 'New playlist',
    })
    await actions.persistOrder.mutateAsync({
      playlistId: newId,
      rows: drop.tracks.map((t, i) => ({
        id: crypto.randomUUID(),
        track_id: t.id,
        section_id: null,
        position: i,
      })),
    })
    creator.open(newId)
    setPicked({ kind: 'playlist', key: newId })
  }

  const copyInbox = async () => {
    const token = project.data?.inboxes?.token
    if (!token) return
    await navigator.clipboard.writeText(`${location.origin}/inbox/${token}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
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

      {/* tab_bar_app: the search and nothing else. The split below labels
          its own two halves, so a tab strip was naming them twice. */}
      <div className="tab-band">
        <div className="tab-band-search">
          <Search />
        </div>
      </div>

      <div className="split">
        <div className="split-list">
          <div className="pane-head">
            <div className="min-w-0">
              <h2 className="submission-title truncate">{title}</h2>
              <div className="detail-meta">
                {plural(playlists.data?.length ?? 0, 'playlist')} ·{' '}
                {plural(submissions.length, 'submission')}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 font-mono text-[0.7rem] uppercase underline"
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
          <div className="split-group">
            <span>Playlists</span>
          </div>
          {playlists.data?.length === 0 && (
            <p className="px-5 pb-2 text-[0.8rem] text-sequel-mid">None yet.</p>
          )}
          {playlists.data?.map((p) => (
            <div
              key={p.id}
              className="split-row"
              aria-current={open?.kind === 'playlist' && open.key === p.id}
            >
              <button
                type="button"
                className="split-row-main"
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
              <div className="split-row-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Edit in creator"
                  title="Edit in creator"
                  onClick={() => creator.open(p.id)}
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy share link"
                  title="Copy share link"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      `${location.origin}/p/${p.token}`,
                    )
                  }
                >
                  <ShareIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Delete playlist"
                  title="Delete playlist"
                  onClick={() => setDeleting(p)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}

          <div className="split-group">
            <span>Inbox</span>
          </div>
          {tracks.data && submissions.length === 0 && (
            <p className="px-5 pb-4 text-[0.8rem] text-sequel-mid">
              Nothing sent yet. Copy the link above and pass it to partners.
            </p>
          )}
          {submissions.map((s) => (
            <div
              key={s.key}
              className="split-row"
              aria-current={open?.kind === 'submission' && open.key === s.key}
            >
              <button
                type="button"
                className="split-row-main"
                onClick={() => setPicked({ kind: 'submission', key: s.key })}
              >
                <span className="split-row-title">{s.company}</span>
                <span className="split-row-meta">
                  <span className="pill">
                    {plural(s.tracks.length, 'track')}
                  </span>
                  {s.email && (
                    <span className="min-w-0 truncate">{s.email}</span>
                  )}
                  <span className="shrink-0">{formatDate(s.latest)}</span>
                </span>
              </button>
              <div className="split-row-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Open this drop in the Playlister"
                  title="Open this drop in the Playlister"
                  onClick={() => void openDrop(s)}
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy the inbox link"
                  title="Copy the inbox link"
                  disabled={!project.data?.inboxes?.token}
                  onClick={() => void copyInbox()}
                >
                  <ShareIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Delete this drop"
                  disabled={unusedIn(s).length === 0}
                  title={
                    unusedIn(s).length === 0
                      ? 'Every track in this drop is in a playlist'
                      : 'Delete this drop'
                  }
                  onClick={() => setDropping(s)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* No second pane until there is something to read in it — an empty
            box explaining its own emptiness is worse than no box. The left
            one takes the width on its own. */}
        {(open || tracks.error) && (
          <div className="split-detail">
            {tracks.error && (
              <p className="form-error px-5 py-4">{tracks.error.message}</p>
            )}
            {openSubmission && (
              <>
                <div className="pane-head">
                  <div className="min-w-0">
                    <h2 className="submission-title truncate">
                      {openSubmission.company}
                    </h2>
                    <div className="detail-meta">
                      {plural(openSubmission.tracks.length, 'track')} ·{' '}
                      {formatDate(openSubmission.latest)}
                    </div>
                  </div>
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
                <TrackTable tracks={openSubmission.tracks} lean />
              </>
            )}

            {open?.kind === 'playlist' && openPlaylist.data && (
              <>
                <div className="pane-head">
                  <div className="min-w-0">
                    <h2 className="submission-title truncate">
                      {openPlaylist.data.name}
                    </h2>
                    <div className="detail-meta">
                      {plural(playlistTracks.length, 'track')} ·{' '}
                      {formatDate(openPlaylist.data.updated_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn shrink-0 text-sequel-brown"
                    title="Edit in creator"
                    aria-label="Edit in creator"
                    onClick={() => creator.open(openPlaylist.data!.id)}
                  >
                    <PencilIcon size="1.25rem" />
                  </button>
                </div>
                {playlistTracks.length === 0 ? (
                  <p className="px-7 py-6 text-sequel-mid">
                    Nothing in this playlist yet. Drag tracks in from a
                    submission, or drop files on the creator.
                  </p>
                ) : (
                  <TrackTable tracks={playlistTracks} lean />
                )}
              </>
            )}
          </div>
        )}
      </div>
      {deleting && (
        <Confirm
          title={`Delete “${deleting.name}”?`}
          body="The tracks stay in the project — only the playlist goes, along with any link already shared for it."
          confirmLabel="Delete playlist"
          onConfirm={() => {
            const id = deleting.id
            setDeleting(null)
            void actions.deletePlaylist.mutateAsync(id)
            if (open?.key === id) setPicked(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
      {dropping && (
        <Confirm
          title={`Delete what ${dropping.company} sent?`}
          body={[
            `${plural(unusedIn(dropping).length, 'track')} will go from the library and from storage. This cannot be undone.`,
            dropping.tracks.length - unusedIn(dropping).length > 0 &&
              `The other ${dropping.tracks.length - unusedIn(dropping).length} are in a playlist and stay where they are.`,
          ]
            .filter(Boolean)
            .join(' ')}
          confirmLabel={`Delete ${plural(unusedIn(dropping).length, 'track')}`}
          onConfirm={() => {
            const key = dropping.key
            const going = unusedIn(dropping)
            setDropping(null)
            deleteSubmission.mutate(going.map((t) => t.id))
            if (open?.key === key) setPicked(null)
          }}
          onCancel={() => setDropping(null)}
        />
      )}
    </>
  )
}
