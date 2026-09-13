import type {
  Identity,
  Theme,
  ViewerComment,
  ViewerPlaylist,
} from '../../lib/viewer'
import { useViewerPlayer } from '../../lib/viewerPlayer'
import { Shell, Stage } from './Shell'
import TrackRows from './TrackRows'

type Props = {
  playlist: ViewerPlaylist
  theme: Theme | null
  comments: ViewerComment[]
  identity: Identity | null
  onIdentity: (identity: Identity) => void
}

/**
 * The plain playlist: listen through, download what the switches allow,
 * leave a note. A film in the list plays in a picture above the rows;
 * otherwise the picture stays parked and the page is a list and a bar.
 */
export default function StandardPlaylist({
  playlist,
  theme,
  comments,
  identity,
  onIdentity,
}: Props) {
  const player = useViewerPlayer()
  return (
    <Shell theme={theme} playlist={playlist}>
      <div className="mt-8">
        <Stage away={player.current?.kind !== 'video'} />
        {playlist.playlist_tracks.length === 0 ? (
          <p className="viewer-meta">Nothing here yet.</p>
        ) : (
          <TrackRows
            playlist={playlist}
            comments={comments}
            identity={identity}
            onIdentity={onIdentity}
          />
        )}
      </div>
    </Shell>
  )
}
