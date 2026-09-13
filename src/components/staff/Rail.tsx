import { Link, NavLink } from 'react-router-dom'
import { useRecentProjects } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import SequelLogo from '../SequelLogo'

/** Left rail: brand, the three sections, recent projects. */
export default function Rail() {
  const recent = useRecentProjects()

  return (
    // Matches Sequel Track's own App Nav in Webflow, read from the live
    // styles: nav_sidebar is 16rem wide with 2rem top/right/bottom and 3rem
    // left padding, on Sequel Silver. Its links are Sequel Brown — the same
    // two colours this rail already stands on, resolved from the variables
    // rather than inferred from the component's name.
    <aside className="col-start-1 row-start-1 row-span-2 flex flex-col gap-[18px] overflow-auto border-r border-sequel-line pb-8 pl-12 pr-8 pt-8 text-[14px] font-normal leading-[20px]">
      {/* The mark alone, as in Webflow's App Nav (app_logo_wrap is 4rem
          square and holds nothing but the image). */}
      <Link to="/" className="mb-[calc(6rem-18px)] block w-16 text-sequel-ink no-underline">
        <SequelLogo className="h-16! w-16!" />
      </Link>

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
        // Well clear of the nav above it: at the shared 18px gap the heading
        // read as a fourth nav item rather than the start of a new section.
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-normal text-sequel-mid">Recent</h3>
          {recent.data.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="flex items-center justify-between gap-2 py-1.5 text-[13px] text-sequel-ink no-underline hover:text-sequel-brown"
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

      {/* Staff know who they are signed in as; the address was taking up the
          foot of every page to tell them. The only thing needed here is the
          way out, drawn as one more nav link. */}
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="nav-link mt-auto cursor-pointer text-left"
      >
        Log out
      </button>
    </aside>
  )
}
