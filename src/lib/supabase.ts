import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY')
}

export const supabase = createClient<Database>(url, key, {
  auth: {
    // Staff stay signed in across visits; the refresh token is what carries
    // that, and the client renews the access token in the background.
    persistSession: true,
    autoRefreshToken: true,
    // Sign-in is a typed code, never a link, so there is never a token in the
    // URL to pick up. Leaving this on would have the client inspect every
    // address it lands on for credentials it will never find there.
    detectSessionInUrl: false,
  },
})
