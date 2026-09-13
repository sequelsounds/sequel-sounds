import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './lib/auth'
import { useIsStaff } from './lib/staff'
import { supabase } from './lib/supabase'
import Inbox from './routes/Inbox'
import Library from './routes/Library'
import Login from './routes/Login'
import Playlists, { PlaylistRoute } from './routes/Playlists'
import Project from './routes/Project'
import Projects from './routes/Projects'
import SharedPlaylist from './routes/SharedPlaylist'
import SharedTrack from './routes/SharedTrack'
import StaffLayout from './routes/StaffLayout'
import TrackProjects from './routes/TrackProjects'
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
        <Route index path="/" element={<Projects />} />
        <Route path="/projects/:id" element={<Project />} />
        <Route path="/playlists" element={<Playlists />} />
        <Route path="/playlists/:id" element={<PlaylistRoute />} />
        <Route path="/library" element={<Library />} />
        {/* Sequel Track, read-only against the Xano mirror while it migrates */}
        <Route path="/track" element={<TrackProjects />} />
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
