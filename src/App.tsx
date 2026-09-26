import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './lib/auth'
import { useIsStaff } from './lib/staff'
import { supabase } from './lib/supabase'
import Inbox from './routes/Inbox'
import Brief from './routes/Brief'
import SharedFile from './routes/SharedFile'
import Licence from './routes/Licence'
import BillUpload from './routes/BillUpload'
import SongConfirmation from './routes/SongConfirmation'
import JoinRoster from './routes/JoinRoster'
import Agreement from './routes/Agreement'
import Client from './routes/Client'
import Clients from './routes/Clients'
import Library from './routes/Library'
import Login from './routes/Login'
import Partner from './routes/Partner'
import Partners from './routes/Partners'
import Connect from './routes/Connect'
import Playlists, { PlaylistRoute } from './routes/Playlists'
import StudioProject from './routes/StudioProject'
import StudioProjects from './routes/StudioProjects'
import Roster from './routes/Roster'
import RosterMember from './routes/RosterMember'
import Song from './routes/Song'
import Songs from './routes/Songs'
import User from './routes/User'
import Dashboard from './routes/Dashboard'
import Management from './routes/Management'
import Users from './routes/Users'
import Notifications from './routes/Notifications'
import Settings from './routes/Settings'
import Contract from './routes/Contract'
import Invoice from './routes/Invoice'
import Finance from './routes/Finance'
import Project from './routes/Project'
import Projects from './routes/Projects'
import Quote from './routes/Quote'
import Reporting from './routes/Reporting'
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
  if (session === null) {
    // Keep where they were headed. Claude sends people straight to /connect
    // with the OAuth parameters in the query, and losing those to a login
    // bounce means starting the whole connection again.
    const here = window.location.pathname + window.location.search
    const next = here === '/' ? '' : `?next=${encodeURIComponent(here)}`
    return <Navigate to={`/login${next}`} replace />
  }
  if (staff.isPending) return <LoadingModal />
  if (!staff.data) {
    // Signed in, but not on the allowlist — a viewer who found the staff URL.
    return (
      <div className="p-8 text-sm">
        <p>This account is not a staff account.</p>
        <button
          type="button"
          className="mt-3 underline"
          onClick={() => supabase.auth.signOut({ scope: 'local' })}
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
      {/* ⚠️ STAFF, BUT OUTSIDE THE STAFF SHELL — the same call as /quotation.
          The old app's /contract is a document: wordmark, one rule, the
          summary beside the PDF, and no nav rail. Putting it inside
          StaffLayout would give it a sidebar the original has never had.
          A supplier gets the 7-day share link to the PDF alone and never
          reaches this page or the AI summary. */}
      <Route
        path="/contracts/:uuid"
        element={
          <RequireStaff>
            <Contract />
          </RequireStaff>
        }
      />
      {/* The client's briefing form. Token in the query string, as the old
          app's /brief?token= has it, so links already sent keep their shape. */}
      <Route path="/brief" element={<Brief />} />
      {/* A shared project file. /link?id= is the old app's shape. */}
      <Route path="/link" element={<SharedFile />} />
      {/* A sent composition licence: its own page, not the asset page (Andy, 26 Sep). */}
      <Route path="/licence" element={<Licence />} />
      {/* A supplier sends their invoice for a QuickBooks bill. The token is the credential. */}
      <Route path="/bill-upload/:token" element={<BillUpload />} />
      {/* The composer's song form and Schedule A. /song-confirmation?uuid= is
          the old app's shape, so the emails' links keep working. */}
      <Route path="/song-confirmation" element={<SongConfirmation />} />
      {/* A composition team adds its details, then signs the composer
          agreement (24 Sep). The token in each email is the credential. */}
      <Route path="/join-roster/:token" element={<JoinRoster />} />
      <Route path="/join-partner/:token" element={<JoinRoster />} />
      <Route path="/agreement/:token" element={<Agreement />} />
      <Route path="/p/:token" element={<SharedPlaylist />} />
      <Route path="/t/:token" element={<SharedTrack />} />

      {/* Staff */}
      <Route path="/login" element={<Login />} />
      {/* Connecting an assistant: staff only, but standalone rather than
          inside the app chrome — it is a decision, not a page. */}
      <Route
        path="/connect"
        element={
          <RequireStaff>
            <Connect />
          </RequireStaff>
        }
      />
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
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/management" element={<Management />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:uuid" element={<User />} />
        <Route path="/settings" element={<Settings />} />
        {/* Read-only. `invoices` is on the blocked side of the migration —
            QuickBooks reads it out of Xano — so the table stays in the sync and
            nothing here writes. It exists because the chart segments and the
            project invoice rows all want somewhere to go. */}
        <Route path="/invoices" element={<Finance />} />
        <Route path="/invoices/:uuid" element={<Invoice />} />
        <Route path="/reporting" element={<Reporting />} />
        {/* A project's Studio page: its inbox submissions and playlists. It
            lived at /projects/:id until the project page took that address. */}
        <Route path="/studio" element={<StudioProjects />} />
        <Route path="/studio/:id" element={<StudioProject />} />
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
