import { Link, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function StaffLayout() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <Link to="/" className="font-semibold tracking-tight">
          Sequel Sounds
        </Link>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-neutral-500 hover:text-neutral-900"
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
