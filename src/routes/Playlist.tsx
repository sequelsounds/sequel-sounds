import { useParams } from 'react-router-dom'

export default function Playlist() {
  const { id } = useParams()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Playlist</h1>
      <p className="text-sm text-sequel-brown/70">
        Ordering, theme editor, share link and viewer stats go here. ({id})
      </p>
    </div>
  )
}
