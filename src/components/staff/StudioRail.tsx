import { Link, NavLink } from 'react-router-dom'
import { useRecentProjects } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

/**
 * Studio's own left rail. Same shape as the app's nav so the two feel like
 * one product, but with the colours flipped (Brown ground, Silver type) so
 * you always know you are in Studio.
 */
export default function StudioRail() {
  const recent = useRecentProjects()

  return (
    <aside className="nav-sidebar is-studio col-start-1 row-start-1 row-span-2">
      <NavLink to="/studio" className="app-logo-wrap" aria-label="Sequel Studio">
        <img src="/sequel-mark-light.svg" alt="" width={64} height={64} className="h-16 w-16" />
      </NavLink>

      <NavLink to="/studio" className="nav-link-app">
        Projects
      </NavLink>
      <NavLink to="/playlists" className="nav-link-app">
        Playlists
      </NavLink>
      <NavLink to="/library" className="nav-link-app">
        Library
      </NavLink>

      {recent.data && recent.data.length > 0 && (
        <div className="studio-recent">
          <h3 className="studio-recent-head">Recent</h3>
          {recent.data.map((p) => (
            <Link key={p.id} to={`/studio/${p.id}`} className="studio-recent-link">
              <span className="truncate">{p.name}</span>
              {p.hasNew && (
                <span className="studio-recent-new" title="New submissions since you last looked" />
              )}
            </Link>
          ))}
        </div>
      )}

      <Link to="/projects" className="nav-link-app mt-auto">
        Back to the app
      </Link>
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="nav-link-app cursor-pointer text-left"
      >
        Logout
      </button>
    </aside>
  )
}
