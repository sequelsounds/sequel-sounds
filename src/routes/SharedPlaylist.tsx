import { useParams } from 'react-router-dom'

export default function SharedPlaylist() {
  const { token } = useParams()
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold">Playlist</h1>
      <p className="mt-2 text-sm text-sequel-brown/70">
        Themed client view: name/email gate, player, timestamped comments. Token: {token}
      </p>
    </div>
  )
}
