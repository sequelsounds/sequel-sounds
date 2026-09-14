import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './lib/auth'
import { useIsStaff } from './lib/staff'
import { supabase } from './lib/supabase'
import Inbox from './routes/Inbox'
import Client from './routes/Client'
import Clients from './routes/Clients'
import Library from './routes/Library'
import Login from './routes/Login'
import Partner from './routes/Partner'
import Partners from './routes/Partners'
import Playlists, { PlaylistRoute } from './routes/Playlists'
import Roster from './routes/Roster'
import RosterMember from './routes/RosterMember'
import Song from './routes/Song'
import Songs from './routes/Songs'
import User from './routes/User'
import Dashboard from './routes/Dashboard'
import Management from './routes/Management'
import Users from './routes/Users'
import Invoice from './routes/Invoice'
import Project from './routes/Project'
import Projects from './routes/Projects'
import Quote from './routes/Quote'
import SharedPlaylist from './routes/SharedPlaylist'
import SharedTrack from './routes/SharedTrack'
import StaffLayout from './routes/StaffLayout'
import LoadingModal from './components/Loader'

// Dev only: the shell over fixture data, for checking layout without a
// sign-in code. `import.meta.env.DEV` is a build-time constant, so the branch
// and the chunk behind it are dropped from production bundles.
const Preview = import.meta.env.DEV ? lazy(() => import('./dev/Preview')) : null

function RequireStaff({ children }: { children: React.ReactNode }) {
  const session = useSession()
  const staff = useIsStaff()
  if (session === undefined) return <LoadingModal />
  if (session === null) return <Navigate to="/login" replace />
  if (staff.isPending) return <LoadingModal />
  if (!staff.data) {
    // Signed in, but not on the allowlist — a viewer who found the staff URL.
    return (
      <div className="p-8 text-sm">
        <p>This account is not a staff account.</p>
        <button
          type="button"
          className="mt-3 underline"
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </button>
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      {/* Public, token-based */}
      <Route path="/inbox/:token" element={<Inbox />} />
      {/* ⚠️ OUTSIDE the staff shell on purpose. The old app's `/quotation` is
          a standalone document reached by uuid — silver page, DOWNLOAD button,
          card, no nav rail — and it is what a client opens. Putting it inside
          StaffLayout gave it a sidebar the original has never had. */}
      <Route path="/quotes/:uuid" element={<Quote />} />
      <Route path="/p/:token" element={<SharedPlaylist />} />
      <Route path="/t/:token" element={<SharedTrack />} />

      {/* Staff */}
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireStaff>
            <StaffLayout />
          </RequireStaff>
        }
      >
        {/* Projects and the project page read the Xano mirror: all 241
            projects, not the 105 Studio's own backfill held. Studio's music
            features become a tab on the project rather than a second list. */}
        <Route index path="/" element={<Projects />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<Project />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:uuid" element={<Client />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="/partners/:uuid" element={<Partner />} />
        <Route path="/roster" element={<Roster />} />
        <Route path="/roster/:uuid" element={<RosterMember />} />
        <Route path="/songs" element={<Songs />} />
        <Route path="/songs/:uuid" element={<Song />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/management" element={<Management />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:uuid" element={<User />} />
        {/* Read-only. `invoices` is on the blocked side of the migration —
            QuickBooks reads it out of Xano — so the table stays in the sync and
            nothing here writes. It exists because the chart segments and the
            project invoice rows all want somewhere to go. */}
        <Route path="/invoices/:uuid" element={<Invoice />} />
        <Route path="/playlists" element={<Playlists />} />
        <Route path="/playlists/:id" element={<PlaylistRoute />} />
        <Route path="/library" element={<Library />} />
      </Route>

      {Preview && (
        <Route
          path="/__preview/*"
          element={
            <Suspense fallback={null}>
              <Preview />
            </Suspense>
          }
        />
      )}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
