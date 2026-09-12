import { Link, NavLink } from 'react-router-dom'
import { useSession } from '../../lib/auth'
import { useRecentProjects } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import SequelLogo from '../SequelLogo'

/** Left rail: brand, the three sections, recent projects. */
export default function Rail() {
  const session = useSession()
  const recent = useRecentProjects()

  return (
    // Width, font-size/line-height and padding match Sequel Track's own App
    // Nav component in Webflow (nav_sidebar: 16rem, Creato 14/20, 2rem top
    // /right/bottom, 3rem left) — read from the live styles, not guessed.
    // Colour is deliberately not copied: that component sets Sequel Silver
    // text for its own dark ground, which would be invisible on this rail's
    // light one, and the approved mockup is light with dark text.
    <aside className="col-start-1 row-start-2 flex flex-col gap-[18px] overflow-auto border-r border-sequel-line pb-8 pl-12 pr-8 pt-8 text-[14px] font-normal leading-[20px]">
      {/* The mark alone, as in Webflow's App Nav (app_logo_wrap is 4rem
          square and holds nothing but the image). */}
      <Link to="/" className="block w-16 text-sequel-ink no-underline">
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
          <h3 className="mb-2 ml-2 text-xs font-normal text-sequel-mid">Recent</h3>
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
