import { NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useNotifications } from '../../lib/notifications'
import { useIsFinance, useIsManagement } from '../../lib/xanoMirror'
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
// omitted four of its items would misrepresent how far along this is.
// `also` lists other routes that belong to the item, so it is bold there too.
// An invoice page is Finance — Andy, 15 Sep. It takes effect once Finance has
// a `to`; an unbuilt item is never marked.
const LINKS: { label: string; to: string | null; also?: string[] }[] = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Management', to: '/management' },
  { label: 'Notifications', to: '/notifications' },
  { label: 'Projects', to: '/projects' },
  { label: 'Roster', to: '/roster' },
  { label: 'Songs', to: '/songs' },
  { label: 'Partners', to: '/partners' },
  { label: 'Clients', to: '/clients' },
  { label: 'Users', to: '/users' },
  { label: 'Finance', to: '/invoices', also: ['/invoices'] },
  // Not in Track's nav — its /reporting page was reached by URL only. Shown
  // to finance only, because the page is finance only.
  { label: 'Reporting', to: '/reporting' },
  { label: 'Settings', to: '/settings' },
]

export default function Rail() {
  // Track hides this link from anyone who is not management, so this does
  // too. The database is what actually refuses — see useIsManagement.
  const management = useIsManagement()
  const finance = useIsFinance()
  /* ⚠️ THE COUNT IS THE POINT OF THE LINK. A notifications page nobody is told
   * to visit is a page nobody visits, and the whole reason this exists is that
   * a release form being opened was buried in a row's share menu. */
  const notifications = useNotifications()
  const unread = notifications.data?.unread ?? 0
  const links = LINKS.filter(
    (l) =>
      (l.label !== 'Management' || management.data === true) &&
      (l.label !== 'Reporting' || finance.data === true),
  )
  const { pathname } = useLocation()
  const inAlso = (also?: string[]) =>
    (also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`))

  return (
    // Placed explicitly rather than by source order: the rail spans two rows,
    // which auto flow would otherwise drop into the 2rem strip at the top.
    <aside className="nav-sidebar col-start-1 row-start-1 row-span-2">
      <NavLink to="/projects" className="app-logo-wrap" aria-label="Sequel">
        <SequelLogo className="h-16! w-16!" />
      </NavLink>

      {links.map(({ label, to, also }) =>
        to ? (
          <NavLink
            key={label}
            to={to}
            className={`nav-link-app${inAlso(also) ? ' is-current' : ''}`}
          >
            {label}
            {label === 'Notifications' && unread > 0 && (
              <span className="nav-count" aria-label={`${unread} unread`}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
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
        onClick={() => void supabase.auth.signOut({ scope: 'local' })}
        className="nav-link-app cursor-pointer text-left"
      >
        Logout
      </button>

      {/* Studio's own pages (/playlists, /library) are deliberately not here.
          Track's nav does not have them, and this is Track's nav. They are
          reachable by URL until the project page's Music tab absorbs them. */}
    </aside>
  )
}
