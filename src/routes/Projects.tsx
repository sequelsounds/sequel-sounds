import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Projects() {
  const { data, isPending, error } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects_mirror')
        .select('id, name, client_name, status')
        .order('name')
      if (error) throw error
      return data
    },
  })

  if (isPending) return <p className="text-sm text-sequel-brown/70">Loading…</p>
  if (error) return <p className="text-sm text-red-600">{error.message}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Projects</h1>
      <ul className="divide-y divide-sequel-brown/30 border border-sequel-brown">
        {data.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`} className="block px-4 py-3 hover:bg-sequel-brown/5">
              <span className="font-medium">{p.name}</span>
              {p.client_name && <span className="ml-2 text-sm text-sequel-brown/70">{p.client_name}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
