import { Link, Outlet } from 'react-router-dom'
import SequelLogo from '../components/SequelLogo'
import { supabase } from '../lib/supabase'

export default function StaffLayout() {
  return (
    <div className="min-h-screen bg-sequel-silver text-sequel-brown">
      <header className="flex items-center justify-between border-b border-sequel-brown px-6 py-3">
        <Link to="/">
          <SequelLogo />
        </Link>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-sequel-brown/70 hover:text-sequel-brown"
        >
          Sign out
        </button>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
