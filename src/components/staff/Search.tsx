import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreator } from '../../lib/creator'
import { useSearch } from '../../lib/queries'

/**
 * The one search in the app: projects, playlists and tracks at once, grouped.
 *
 * It lives in the header bar rather than the rail because it searches across
 * everything, not within the section the rail happens to be pointing at.
 */
export default function Search() {
  const navigate = useNavigate()
  const creator = useCreator()
  const [q, setQ] = useState('')
  const results = useSearch(q)

  const go = (to: string) => {
    setQ('')
    navigate(to)
  }

  const hits = results.data
  const any =
    !!hits && (hits.projects.length > 0 || hits.playlists.length > 0 || hits.tracks.length > 0)

  return (
    <div className="relative w-full">
      <input
        type="search"
        className="search-well"
        placeholder="Search projects, playlists and tracks"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search projects, playlists and tracks"
      />
      {q.trim().length >= 2 && (
        <div className="menu left-0 right-0 min-w-0 text-[13px]">
          {!any && (
            <div className="px-[14px] py-2 text-sequel-mid">
              {results.isPending ? 'Searching…' : 'Nothing found'}
            </div>
          )}
          {hits && hits.projects.length > 0 && (
            <Group title="Projects">
              {hits.projects.map((p) => (
                <button key={p.id} type="button" onClick={() => go(`/studio/${p.id}`)}>
                  {p.name}
                  {p.client_name && <span className="ml-2 text-sequel-mid">{p.client_name}</span>}
                </button>
              ))}
            </Group>
          )}
          {hits && hits.playlists.length > 0 && (
            <Group title="Playlists">
              {hits.playlists.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    creator.open(p.id)
                    go(p.project_id ? `/studio/${p.project_id}` : '/playlists')
                  }}
                >
                  {p.name}
                </button>
              ))}
            </Group>
          )}
          {hits && hits.tracks.length > 0 && (
            <Group title="Tracks">
              {hits.tracks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  // A track uploaded into an unattached playlist has no project
                  // to open; the library is where it lives.
                  onClick={() => go(t.project_id ? `/studio/${t.project_id}` : '/library')}
                >
                  {t.title}
                  {t.artist && <span className="ml-2 text-sequel-mid">{t.artist}</span>}
                </button>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-[14px] pb-1 pt-1 text-[11px] uppercase tracking-[.06em] text-sequel-mid">
        {title}
      </div>
      {children}
    </div>
  )
}
