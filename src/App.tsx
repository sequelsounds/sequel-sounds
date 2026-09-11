import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './lib/auth'
import Inbox from './routes/Inbox'
import Login from './routes/Login'
import Playlist from './routes/Playlist'
import Project from './routes/Project'
import Projects from './routes/Projects'
import SharedPlaylist from './routes/SharedPlaylist'
import StaffLayout from './routes/StaffLayout'

function RequireStaff({ children }: { children: React.ReactNode }) {
  const session = useSession()
  if (session === undefined) return <div className="p-8 text-sm text-sequel-brown/70">Loading…</div>
  if (session === null) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      {/* Public, token-based */}
      <Route path="/inbox/:token" element={<Inbox />} />
      <Route path="/p/:token" element={<SharedPlaylist />} />

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
        <Route path="/playlists/:id" element={<Playlist />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
