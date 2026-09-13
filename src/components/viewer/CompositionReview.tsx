import { useMemo } from 'react'
import { useMediaUrl } from '../../lib/media'
import {
  useViewer,
  type Identity,
  type Theme,
  type ViewerComment,
  type ViewerPlaylist,
} from '../../lib/viewer'
import { useViewerPlayer } from '../../lib/viewerPlayer'
import Notes from './Notes'
import { Shell, Stage } from './Shell'
import TrackRows, { groupRows, playable } from './TrackRows'

type Props = {
  playlist: ViewerPlaylist
  theme: Theme | null
  comments: ViewerComment[]
  identity: Identity | null
  onIdentity: (identity: Identity) => void
}

/**
 * A composer's cuts, marked up. The films in the list are the work: one
 * plays large at the top, and a note is left at a moment in it — the
 * timestamp is the whole point, so it is offered on every note and every
 * note's stamp takes the picture back there.
 */
export default function CompositionReview({
  playlist,
  theme,
  comments,
  identity,
  onIdentity,
}: Props) {
  const { token } = useViewer()
  const player = useViewerPlayer()
  const groups = useMemo(() => groupRows(playlist), [playlist])
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const queue = useMemo(() => flat.map((r) => playable(r.tracks!)), [flat])
  const cuts = flat.filter((r) => r.tracks!.kind === 'video')
  const first = cuts[0] ?? null

  // The cut the picture and the notes are about: whichever is playing,
  // or the first before anything is.
  const currentRow =
    flat.find((r) => r.tracks!.id === player.current?.id) ?? null
  const shown = currentRow?.tracks?.kind === 'video' ? currentRow : first
  const shownTrack = shown?.tracks ?? null
  const poster = useMediaUrl(first?.tracks?.artwork_s3_key ?? null, token)
  const notes = shownTrack
    ? comments.filter((c) => c.target_id === shownTrack.id)
    : []

  const start = () => {
    if (first) player.play(queue, flat.indexOf(first))
  }

  return (
    <Shell theme={theme} playlist={playlist}>
      <div className="mt-8">
        {cuts.length === 0 ? (
          <p className="viewer-meta">No cuts on this review yet.</p>
        ) : (
          <>
            <Stage away={false} poster={poster.data ?? null} onStart={start} />
            {shownTrack && (
              <div className="mb-8">
                <div className="viewer-section">
                  <span>{shownTrack.title}</span>
                  <span>
                    {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                  </span>
                </div>
                <Notes
                  flush
                  playlistId={playlist.id}
                  targetType="video"
                  targetId={shownTrack.id}
                  comments={notes}
                  identity={identity}
                  onIdentity={onIdentity}
                  stampAt={
                    player.isCurrent(shownTrack.id) ? player.position : null
                  }
                  onStamp={(seconds) => {
                    const index = flat.indexOf(shown!)
                    if (player.isCurrent(shownTrack.id)) {
                      player.seek(seconds)
                      return
                    }
                    player.play(queue, index)
                    setTimeout(() => player.seek(seconds), 600)
                  }}
                />
              </div>
            )}
          </>
        )}
        <TrackRows
          playlist={playlist}
          comments={comments}
          identity={identity}
          onIdentity={onIdentity}
          notes={false}
        />
      </div>
    </Shell>
  )
}
