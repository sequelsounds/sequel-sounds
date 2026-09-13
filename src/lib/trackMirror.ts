import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Sequel Track's data lives in the `xano_mirror` schema: a replica of Xano
 * kept in step while Track is migrated across. Nothing here writes. Xano is
 * still the source of truth and the mirror carries no insert, update or
 * delete policies at all, so a stray mutation fails at the database rather
 * than quietly diverging from Xano.
 *
 * Visibility is decided by RLS, not by these queries. Staff see everything;
 * a client user sees only projects they are named on. `project_list` is a
 * `security_invoker` view, so it inherits those policies rather than
 * bypassing them.
 */
export type TrackProject = {
  id: number
  title: string | null
  sequel_no: string | null
  brand: string | null
  stage: string | null
  client_group: string | null
  agency: string | null
  service: string | null
  supervisor: string | null
  proposed_air_date: string | null
  confirmed_first_air_date: string | null
  pipeline_gbp: number | null
  record_status: string | null
  studio_link: string | null
  studio_inbox_link: string | null
}

/**
 * The same client, and so the same session — a second `createClient` would
 * mean a second copy of the auth state. `.schema()` is typed against the
 * client's own generic, which `database.types.ts` fills with the public
 * schema only (`npm run types` needs the Supabase CLI, absent here — see
 * CLAUDE.md), so the cast is what lets the authenticated client reach the
 * mirror. Rows are typed on the way out instead.
 */
const mirror = (supabase as unknown as SupabaseClient).schema('xano_mirror')

export function useTrackProjects() {
  return useQuery({
    queryKey: ['track', 'projects'],
    queryFn: async (): Promise<TrackProject[]> => {
      const { data, error } = await mirror
        .from('project_list')
        .select('*')
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as TrackProject[]
    },
  })
}
