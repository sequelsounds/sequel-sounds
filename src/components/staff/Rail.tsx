import { NavLink } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import SequelLogo from '../SequelLogo'

/**
 * Sequel Track's App Nav, copied from the component of that name in Webflow
 * and measured against the running page:
 *
 *   nav_sidebar    16rem, flex 0 0 16rem so page content can never squash it,
 *                  padding 2rem with 3rem at the left, one rule down its right
 *   app_logo_wrap  4rem square, 6rem of air beneath it
 *   nav_links_app  17px tall on a 33px step — see .nav-link-app for how
 *   nav_text_app   0.8rem, weight 400
 *
 * Track marks no current page at all: the "selected" class it used to carry
 * was, on inspection, visually identical to the normal one. This marks it,
 * with weight, because a nav that cannot say where you are is a bug and not
 * a style.
 */

// The twelve, in Track's order. `to` is null where the page has not been
// rebuilt yet: those are shown and not clickable, because a nav that quietly
// omitted nine of its items would misrepresent how far along this is.
const LINKS: { label: string; to: string | null }[] = [
  { label: 'Dashboard', to: null },
  { label: 'Management', to: null },
  { label: 'Notifications', to: null },
  { label: 'Projects', to: '/projects' },
  { label: 'Roster', to: null },
  { label: 'Songs', to: null },
  { label: 'Partners', to: null },
  { label: 'Clients', to: null },
  { label: 'Users', to: null },
  { label: 'Finance', to: null },
  { label: 'Settings', to: null },
]

export default function Rail() {
  return (
    // Placed explicitly rather than by source order: the rail spans two rows,
    // which auto flow would otherwise drop into the 2rem strip at the top.
    <aside className="nav-sidebar col-start-1 row-start-1 row-span-2">
      <NavLink to="/projects" className="app-logo-wrap" aria-label="Sequel">
        <SequelLogo className="h-16! w-16!" />
      </NavLink>

      {LINKS.map(({ label, to }) =>
        to ? (
          <NavLink key={label} to={to} className="nav-link-app">
            {label}
          </NavLink>
        ) : (
          <span key={label} className="nav-link-app is-unbuilt" aria-disabled="true">
            {label}
          </span>
        ),
      )}

      {/* Track's logout clears the four auth cookies and returns to /login.
          Here the session is Supabase's, so signing out is the whole job. */}
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="nav-link-app cursor-pointer text-left"
      >
        Logout
      </button>

      {/* Not part of Track's nav, and not really part of this one. Studio's
          two music pages are still used, and the agreed shape puts them on
          the project as a Music tab — until that exists, leaving them out
          would strand them. */}
      <div className="nav-aside">
        <div className="nav-aside-title">Studio</div>
        <NavLink to="/playlists" className="nav-link-app">
          Playlists
        </NavLink>
        <NavLink to="/library" className="nav-link-app">
          Library
        </NavLink>
      </div>
    </aside>
  )
}
