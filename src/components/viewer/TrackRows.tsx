import { Fragment, useMemo, useState } from 'react'
import type { Tables } from '../../lib/database.types'
import { formatDuration } from '../../lib/format'
import { downloadUrl } from '../../lib/media'
import {
  useViewer,
  type Identity,
  type ViewerComment,
  type ViewerPlaylist,
  type ViewerRow,
  type ViewerTrack,
} from '../../lib/viewer'
import { useViewerPlayer, type ViewerPlayable } from '../../lib/viewerPlayer'
import Artwork from '../staff/Artwork'
import { DownloadIcon, NoteIcon, PauseIcon, PlayIcon } from '../staff/icons'
import Menu from '../staff/Menu'
import Notes from './Notes'

export type Group = {
  section: Tables<'playlist_sections'> | null
  rows: ViewerRow[]
}

/**
 * Sections by position, each with its rows by position, then anything
 * unsectioned — the same order the Creator shows and the same rule it
 * writes positions by.
 */
export function groupRows(playlist: ViewerPlaylist): Group[] {
  const sections = [...playlist.playlist_sections].sort(
    (a, b) => a.position - b.position,
  )
  const rows = [...playlist.playlist_tracks]
    .filter((r) => r.tracks)
    .sort((a, b) => a.position - b.position)
  const groups: Group[] = sections.map((section) => ({
    section,
    rows: rows.filter((r) => r.section_id === section.id),
  }))
  const known = new Set(sections.map((s) => s.id))
  const loose = rows.filter((r) => !r.section_id || !known.has(r.section_id))
  if (loose.length) groups.push({ section: null, rows: loose })
  return groups.filter((g) => g.rows.length > 0)
}

export function playable(t: ViewerTrack): ViewerPlayable {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    kind: t.kind,
    preview_key: t.preview_key,
    duration_seconds: t.duration_seconds,
  }
}

/** The extension a key or filename ends in, for naming a download. */
function extOf(name: string | null | undefined): string {
  const m = (name ?? '').match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : 'bin'
}

type Props = {
  playlist: ViewerPlaylist
  comments: ViewerComment[]
  identity: Identity | null
  onIdentity: (identity: Identity) => void
  /** Rows to show; defaults to every row, grouped. */
  groups?: Group[]
  /** Replaces the row's own play with something else — a sync session's cue. */
  onPick?: (row: ViewerRow) => void
  /** Which row reads as current when `onPick` is in charge. */
  activeId?: string | null
  /** Whether that row is playing, and what its square does when pressed again. */
  activePlaying?: boolean
  onToggle?: () => void
  /** Whether a row can open its notes. */
  notes?: boolean
}

/**
 * The list: sections, then a row per track that plays on click, with a
 * download and the notes on the right.
 */
export default function TrackRows({
  playlist,
  comments,
  identity,
  onIdentity,
  groups: given,
  onPick,
  activeId,
  activePlaying = false,
  onToggle,
  notes = true,
}: Props) {
  const { token } = useViewer()
  const player = useViewerPlayer()
  const groups = useMemo(() => given ?? groupRows(playlist), [given, playlist])
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const queue = useMemo(() => flat.map((r) => playable(r.tracks!)), [flat])
  const [open, setOpen] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const save = async (track: ViewerTrack, key: string, ext: string) => {
    setFailed(null)
    try {
      const url = await downloadUrl(key, `${track.title}.${ext}`, token)
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      setFailed(
        err instanceof Error ? err.message : 'The download did not start.',
      )
    }
  }

  return (
    <div className="viewer-list">
      {failed && <p className="form-error px-2 py-1">{failed}</p>}
      {groups.map((g, gi) => (
        <Fragment key={g.section?.id ?? 'loose'}>
          {(g.section || groups.length > 1) && (
            <div className="viewer-section">
              <span>{g.section?.name ?? 'Tracks'}</span>
              <span>{g.rows.length}</span>
            </div>
          )}
          {gi === 0 && !g.section && groups.length === 1 && (
            <div className="viewer-section" />
          )}
          {g.rows.map((row) => {
            const track = row.tracks!
            const index = flat.indexOf(row)
            const number = index + 1
            const current =
              activeId != null
                ? activeId === track.id
                : player.isCurrent(track.id)
            const playing =
              current && (activeId == null ? player.playing : activePlaying)
            // The square: pause what it started, start what it has not.
            const press = () => {
              if (!onPick) player.play(queue, index)
              else if (current && onToggle) onToggle()
              else onPick(row)
            }
            const own = comments.filter((c) => c.target_id === track.id)
            const downloads: { label: string; key: string; ext: string }[] = []
            if (playlist.allow_download && track.preview_key) {
              const ext = extOf(track.preview_key)
              downloads.push({
                label: ext.toUpperCase(),
                key: track.preview_key,
                ext,
              })
            }
            if (
              playlist.allow_download &&
              playlist.allow_originals &&
              track.s3_key
            ) {
              const ext = extOf(track.original_filename ?? track.s3_key)
              downloads.push({
                label: `Original (${ext.toUpperCase()})`,
                key: track.s3_key,
                ext,
              })
            }
            const sub = [track.artist, track.album].filter(Boolean).join(' · ')
            return (
              <Fragment key={row.id}>
                <div
                  className={`viewer-row ${current ? 'is-playing' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onPick ? onPick(row) : player.play(queue, index)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (onPick) onPick(row)
                      else player.play(queue, index)
                    }
                  }}
                >
                  <span className="num">{number}</span>
                  <button
                    type="button"
                    className="art-wrap"
                    aria-label={playing ? 'Pause' : 'Play'}
                    onClick={(e) => {
                      e.stopPropagation()
                      press()
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Artwork
                      artworkKey={track.artwork_s3_key}
                      kind={track.kind}
                      token={token}
                    />
                    <span className="play-btn" aria-hidden="true">
                      {playing ? <PauseIcon /> : <PlayIcon />}
                    </span>
                  </button>
                  <span className="min-w-0">
                    <span className="title block">{track.title}</span>
                    {(sub || row.note) && (
                      <span className="sub block">{row.note ?? sub}</span>
                    )}
                  </span>
                  <span className="dur">
                    {formatDuration(track.duration_seconds)}
                  </span>
                  <span
                    className="viewer-row-actions"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {downloads.length === 1 && (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Download ${downloads[0].label}`}
                        title={`Download ${downloads[0].label}`}
                        onClick={() =>
                          void save(track, downloads[0].key, downloads[0].ext)
                        }
                      >
                        <DownloadIcon />
                      </button>
                    )}
                    {downloads.length > 1 && (
                      <Menu
                        label={<DownloadIcon />}
                        title="Download"
                        buttonClassName="icon-btn"
                        items={downloads.map((d) => ({
                          label: d.label,
                          onSelect: () => void save(track, d.key, d.ext),
                        }))}
                      />
                    )}
                    {notes && (
                      <button
                        type="button"
                        className={`icon-btn ${open === row.id ? 'is-on' : ''}`}
                        aria-label={
                          own.length ? `${own.length} notes` : 'Leave a note'
                        }
                        aria-expanded={open === row.id}
                        title={
                          own.length ? `${own.length} notes` : 'Leave a note'
                        }
                        onClick={() =>
                          setOpen((v) => (v === row.id ? null : row.id))
                        }
                      >
                        <NoteIcon />
                      </button>
                    )}
                    {notes && own.length > 0 && (
                      <span className="viewer-count">{own.length}</span>
                    )}
                  </span>
                </div>
                {open === row.id && (
                  <Notes
                    playlistId={playlist.id}
                    targetType="track"
                    targetId={track.id}
                    comments={own}
                    identity={identity}
                    onIdentity={onIdentity}
                    stampAt={
                      player.isCurrent(track.id) ? player.position : null
                    }
                    onStamp={(seconds) => {
                      if (!player.isCurrent(track.id)) player.play(queue, index)
                      // The seek lands once the source is up; a fresh start
                      // begins at zero and the element ignores a seek made
                      // before it has metadata.
                      const go = () => player.seek(seconds)
                      if (player.isCurrent(track.id)) go()
                      else setTimeout(go, 600)
                    }}
                  />
                )}
              </Fragment>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
