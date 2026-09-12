import { useDraggable } from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import { formatDuration, plural } from '../../lib/format'
import { toPlayerTrack, usePlayer, type PlayerTrack } from '../../lib/player'
import { playlistCount, type TrackWithUse } from '../../lib/queries'
import Artwork from './Artwork'
import ShareIcon from './ShareIcon'
import TrackMeta from './TrackMeta'

type Props = {
  tracks: TrackWithUse[]
  showProject?: boolean
}

/**
 * The list a supe scans all day. Every row is draggable into the Creator and
 * plays from the first cell; those are the only two things an inbox track
 * does. The queue handed to the player is this table's order, so next and
 * previous walk the list on screen.
 */
export default function TrackTable({ tracks, showProject = false }: Props) {
  const queue = useMemo(() => tracks.map(toPlayerTrack), [tracks])
  return (
    <table className="track-table">
      <colgroup>
        <col style={{ width: 34 }} />
        <col style={{ width: 56 }} />
        <col />
        {showProject && <col style={{ width: 180 }} />}
        <col style={{ width: 72 }} />
        <col style={{ width: 80 }} />
      </colgroup>
      <tbody>
        {tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            index={index}
            queue={queue}
            showProject={showProject}
          />
        ))}
      </tbody>
    </table>
  )
}

function TrackRow({
  track,
  index,
  queue,
  showProject,
}: {
  track: TrackWithUse
  index: number
  queue: PlayerTrack[]
  showProject: boolean
}) {
  const player = usePlayer()
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `track:${track.id}`,
    data: { type: 'track', track },
  })
  const current = player.isCurrent(track.id)
  const inPlaylists = playlistCount(track)
  const secondary = [track.artist, track.album].filter(Boolean).join(': ')

  return (
    <tr
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`track-row ${current ? 'is-playing' : ''} ${isDragging ? 'opacity-40' : ''}`}
    >
      <td className="grip">
        <span className="grip-glyph">⋮⋮</span>
        <button
          type="button"
          className="play-btn"
          aria-label={current && player.playing ? 'Pause' : 'Play'}
          onClick={(e) => {
            e.stopPropagation()
            player.play(queue, index)
          }}
        >
          {current && player.playing ? '❚❚' : '▶'}
        </button>
      </td>
      <td className="pr-0!">
        <Artwork artworkKey={track.artwork_s3_key} kind={track.kind} />
      </td>
      <td>
        <div className="truncate">
          {track.title}
          {inPlaylists > 0 && <span className="pill">in {plural(inPlaylists, 'playlist')}</span>}
        </div>
        <div className="secondary mt-0.5 truncate text-xs">
          {secondary || (track.processing_status !== 'ready' ? 'Processing…' : '')}
        </div>
      </td>
      {showProject && <td className="secondary">{track.projects_mirror?.name ?? ''}</td>}
      <td>
        {/* Row actions. Not draggable: pointerdown here must not start a drag,
            or the click never lands. */}
        <div
          className="row-actions"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Track details"
            title="Track details"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
          >
            i
          </button>
          <button
            type="button"
            aria-label="Copy share link"
            title={copied ? 'Link copied' : 'Copy a link to this track alone'}
            onClick={async (e) => {
              e.stopPropagation()
              await navigator.clipboard.writeText(`${location.origin}/t/${track.share_token}`)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <ShareIcon />
          </button>
        </div>
      </td>
      <td className="secondary pr-5 text-right">{formatDuration(track.duration_seconds)}</td>
      {editing && <TrackMeta track={track} onClose={() => setEditing(false)} />}
    </tr>
  )
}
