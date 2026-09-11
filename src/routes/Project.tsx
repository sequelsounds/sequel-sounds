import { useParams } from 'react-router-dom'

export default function Project() {
  const { id } = useParams()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Project</h1>
      <p className="text-sm text-sequel-brown/70">
        Track list, player, shortlist/reject and playlist drag-and-drop go here. ({id})
      </p>
    </div>
  )
}
