import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useSession } from '../../lib/auth'
import { useCreator } from '../../lib/creator'
import { useRecentProjects, useSearch } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import SequelLogo from '../SequelLogo'

/** Left rail: brand, search, the three sections, recent projects. */
export default function Rail() {
  const session = useSession()
  const navigate = useNavigate()
  const creator = useCreator()
  const [q, setQ] = useState('')
  const results = useSearch(q)
  const recent = useRecentProjects()

  const go = (to: string) => {
    setQ('')
    navigate(to)
  }

  const hits = results.data
  const any =
    !!hits && (hits.projects.length > 0 || hits.playlists.length > 0 || hits.tracks.length > 0)

  return (
    // Width, font-size/line-height and padding match Sequel Track's own App
    // Nav component in Webflow (nav_sidebar: 16rem, Creato 14/20, 2rem top
    // /right/bottom, 3rem left) — read from the live styles, not guessed.
    // Colour is deliberately not copied: that component sets Sequel Silver
    // text for its own dark ground, which would be invisible on this rail's
    // light one, and the approved mockup is light with dark text.
    <aside className="flex flex-col gap-[18px] overflow-auto border-r border-sequel-line pb-8 pl-12 pr-8 pt-8 text-[14px] font-normal leading-[20px]">
      {/* The mark alone, as in Webflow's App Nav (app_logo_wrap is 4rem
          square and holds nothing but the image). */}
      <Link to="/" className="block w-16 text-sequel-ink no-underline">
        <SequelLogo className="h-16! w-16!" />
      </Link>

      <div className="relative">
        <input
          type="search"
          className="search-well"
          placeholder="Search"
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
                  <button key={p.id} type="button" onClick={() => go(`/projects/${p.id}`)}>
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
                      go(p.project_id ? `/projects/${p.project_id}?tab=playlists` : '/playlists')
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
                  <button key={t.id} type="button" onClick={() => go(`/projects/${t.project_id}`)}>
                    {t.title}
                    {t.artist && <span className="ml-2 text-sequel-mid">{t.artist}</span>}
                  </button>
                ))}
              </Group>
            )}
          </div>
        )}
      </div>

      <nav>
        <NavLink to="/" end className="nav-link">
          Projects
        </NavLink>
        <NavLink to="/playlists" className="nav-link">
          Playlists
        </NavLink>
        <NavLink to="/library" className="nav-link">
          Library
        </NavLink>
      </nav>

      {recent.data && recent.data.length > 0 && (
        <div>
          <h3 className="mb-1.5 ml-2 text-xs font-normal text-sequel-mid">Recent</h3>
          {recent.data.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="flex items-center justify-between gap-2 px-2 py-1.5 text-[13px] text-sequel-ink no-underline hover:bg-sequel-well"
            >
              <span className="truncate">{p.name}</span>
              {p.hasNew && (
                <span
                  className="h-[7px] w-[7px] shrink-0 bg-sequel-accent"
                  title="New submissions since you last looked"
                />
              )}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-auto truncate text-xs text-sequel-mid">
        <span title={session?.user.email ?? ''}>{session?.user.email}</span>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="ml-2 underline hover:text-sequel-ink"
        >
          Sign out
        </button>
      </div>
    </aside>
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
