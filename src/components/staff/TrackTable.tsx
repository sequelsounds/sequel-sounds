import { useDraggable } from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import { formatDuration, plural } from '../../lib/format'
import { toPlayerTrack, usePlayer, type PlayerTrack } from '../../lib/player'
import { playlistCount, type TrackWithUse } from '../../lib/queries'
import Artwork from './Artwork'
import { GripIcon, InfoIcon, PauseIcon, PlayIcon, ShareIcon } from './icons'
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
  // Held here rather than per row: the arrows in the dialog step through this
  // table's order, which a row does not know.
  const [editing, setEditing] = useState<number | null>(null)
  const editingTrack = editing == null ? null : (tracks[editing] ?? null)

  return (
    <>
    <table className="track-table">
      <colgroup>
        <col style={{ width: 34 }} />
        <col style={{ width: 56 }} />
        <col />
        {showProject && <col style={{ width: 180 }} />}
        <col style={{ width: 86 }} />
        <col style={{ width: 80 }} />
      </colgroup>
      {/* The library spans every project, so the project column needs saying.
          The inbox does not have one — its tracks are already grouped under
          the partner who sent them — and a header row there would just repeat
          itself above every submission. */}
      {showProject && (
        <thead>
          <tr>
            <th />
            <th />
            <th>Track</th>
            <th>Project</th>
            <th />
            <th className="pr-5 text-right!">Length</th>
          </tr>
        </thead>
      )}
      <tbody>
        {tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            index={index}
            queue={queue}
            showProject={showProject}
            onEdit={() => setEditing(index)}
          />
        ))}
      </tbody>
    </table>
    {editingTrack && (
      <TrackMeta
        // Keyed so stepping to another track rebuilds the form rather than
        // leaving the previous track's edits in the fields.
        key={editingTrack.id}
        track={editingTrack}
        onClose={() => setEditing(null)}
        onPrev={editing! > 0 ? () => setEditing(editing! - 1) : undefined}
        onNext={editing! < tracks.length - 1 ? () => setEditing(editing! + 1) : undefined}
      />
    )}
    </>
  )
}

function TrackRow({
  track,
  index,
  queue,
  showProject,
  onEdit,
}: {
  track: TrackWithUse
  index: number
  queue: PlayerTrack[]
  showProject: boolean
  onEdit: () => void
}) {
  const player = usePlayer()
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
        <span className="grip-glyph">
          <GripIcon />
        </span>
        <button
          type="button"
          className="play-btn"
          aria-label={current && player.playing ? 'Pause' : 'Play'}
          onClick={(e) => {
            e.stopPropagation()
            player.play(queue, index)
          }}
        >
          {current && player.playing ? <PauseIcon /> : <PlayIcon />}
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
              onEdit()
            }}
          >
            <InfoIcon />
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
    </tr>
  )
}
