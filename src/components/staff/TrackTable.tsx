import { useDraggable } from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import { formatDuration } from '../../lib/format'
import { toPlayerTrack, usePlayer, type PlayerTrack } from '../../lib/player'
import { useDeleteTrack, type TrackWithUse } from '../../lib/queries'
import Artwork from './Artwork'
import {
  GripIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  ShareIcon,
  TrashIcon,
} from './icons'
import TrackMeta from './TrackMeta'

type Props = {
  tracks: TrackWithUse[]
  /**
   * Drops the per-row actions and the duration, for the project page's
   * right-hand pane: at half the width there is no room for columns that
   * the Library, on a full page, has all the space in the world for.
   */
  lean?: boolean
}

/**
 * The list a supe scans all day. Every row is draggable into the Creator and
 * plays from the first cell; those are the only two things an inbox track
 * does. The queue handed to the player is this table's order, so next and
 * previous walk the list on screen.
 */
export default function TrackTable({ tracks, lean = false }: Props) {
  const queue = useMemo(() => tracks.map(toPlayerTrack), [tracks])
  // Held here rather than per row: the arrows in the dialog step through this
  // table's order, which a row does not know.
  const [editing, setEditing] = useState<number | null>(null)
  const editingTrack = editing == null ? null : (tracks[editing] ?? null)
  // Deleting does not ask. The bin is deliberate enough on its own, and
  // the objects it removes are recoverable — the bucket keeps versions.
  // Only a failure is worth interrupting for, which the mutation handles.
  const remove = useDeleteTrack()

  return (
    <>
      <table className="track-table">
        <colgroup>
          <col style={{ width: 34 }} />
          <col style={{ width: 56 }} />
          <col />
          {/* Three 24px marks and two 14px gaps is 100, and the cell's own
              12px padding either side puts the column at 124. At 86 the
              first mark was clipped by the td's overflow. */}
          {!lean && <col style={{ width: 124 }} />}
          {!lean && <col style={{ width: 80 }} />}
        </colgroup>
        <tbody>
          {tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              queue={queue}
              lean={lean}
              onEdit={() => setEditing(index)}
              onDelete={() => remove.mutate(track.id)}
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
          onNext={
            editing! < tracks.length - 1
              ? () => setEditing(editing! + 1)
              : undefined
          }
        />
      )}
    </>
  )
}

function TrackRow({
  track,
  index,
  queue,
  lean,
  onEdit,
  onDelete,
}: {
  track: TrackWithUse
  index: number
  queue: PlayerTrack[]
  lean: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const player = usePlayer()
  const [copied, setCopied] = useState(false)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `track:${track.id}`,
    data: { type: 'track', track },
  })
  const current = player.isCurrent(track.id)
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
      </td>
      <td className="pr-0!">
        {/* Pointerdown must not start a drag here, or the click never lands. */}
        <div className="art-wrap" onPointerDown={(e) => e.stopPropagation()}>
          <Artwork artworkKey={track.artwork_s3_key} kind={track.kind} />
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
        </div>
      </td>
      <td>
        <div className="truncate">{track.title}</div>
        <div className="secondary mt-0.5 truncate text-xs">
          {secondary ||
            (track.processing_status !== 'ready' ? 'Processing…' : '')}
        </div>
      </td>
      {!lean && (
        <>
          <td className="actions-cell">
            {/* Row actions. Not draggable: pointerdown here must not start a drag,
              or the click never lands. */}
            <div
              className="row-actions"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="icon-btn"
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
                className="icon-btn"
                aria-label="Copy share link"
                title={
                  copied ? 'Link copied' : 'Copy a link to this track alone'
                }
                onClick={async (e) => {
                  e.stopPropagation()
                  await navigator.clipboard.writeText(
                    `${location.origin}/t/${track.share_token}`,
                  )
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                <ShareIcon />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Delete track"
                title="Delete track"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <TrashIcon />
              </button>
            </div>
          </td>
          <td className="secondary pr-5 text-right">
            {formatDuration(track.duration_seconds)}
          </td>
        </>
      )}
    </tr>
  )
}
