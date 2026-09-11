import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/**
 * Client for the public token pages. The share token travels as a header so it
 * never lands in Postgres logs or a Referer, and RLS reads it via
 * app.request_token().
 */
export function tokenClient(token: string) {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-share-token': token } },
  })
}
