import { NavLink } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import SequelLogo from "../SequelLogo";

/**
 * Sequel Track's App Nav, copied from the component of that name in Webflow
 * rather than designed here.
 *
 *   nav_sidebar    16rem, flex 0 0 16rem so page content can never squash it,
 *                  padding 2rem with 3rem at the left, one rule down its right
 *   app_logo_wrap  4rem square, 6rem of air beneath it
 *   nav_links_app  1rem between links
 *   nav_text_app   0.8rem, weight 400, 0.5rem above and below
 *
 * Track marks no current page — the "selected" class it used to carry was
 * visually identical to the normal one. This does mark it, with weight, since
 * a nav that cannot say where you are is a bug rather than a style.
 */

// The twelve, in Track's order. `to` is null for the ones whose page has not
// been rebuilt yet: they are shown and not clickable, because a nav that
// quietly omits nine of its items would misrepresent how far along this is.
const LINKS: { label: string; to: string | null }[] = [
  { label: "Dashboard", to: null },
  { label: "Management", to: null },
  { label: "Notifications", to: null },
  { label: "Projects", to: "/projects" },
  { label: "Roster", to: null },
  { label: "Songs", to: null },
  { label: "Partners", to: null },
  { label: "Clients", to: null },
  { label: "Users", to: null },
  { label: "Finance", to: null },
  { label: "Settings", to: null },
];

export default function Rail() {
  return (
    <aside className="nav-sidebar">
      <NavLink to="/projects" className="app-logo-wrap" aria-label="Sequel">
        <SequelLogo className="h-16! w-16!" />
      </NavLink>

      {LINKS.map(({ label, to }) =>
        to ? (
          <NavLink key={label} to={to} className="nav-link-app">
            {label}
          </NavLink>
        ) : (
          <span
            key={label}
            className="nav-link-app is-unbuilt"
            aria-disabled="true"
          >
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

      {/* Not part of Track's nav. Studio's two music pages still exist and are
          still used, and the agreed shape puts them on the project as a Music
          tab — until that tab exists they would otherwise be unreachable. */}
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
  );
}
