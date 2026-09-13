import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Sequel Track's data, read from the `xano_mirror` schema in Supabase: a
 * replica of Xano kept in step by the sync_xano_mirror task, every 15 minutes.
 *
 * Nothing here writes. Xano is still the system of record and the mirror has
 * no insert, update or delete policies at all, so a stray mutation fails at
 * the database rather than quietly diverging from Xano.
 *
 * Visibility is RLS, not query filters. Staff see everything; a client user
 * sees only the projects they are named on. Every view below is
 * `security_invoker`, so it inherits those policies rather than bypassing
 * them — a plain view would run as its owner and hand everyone everything.
 *
 * MONEY: every `*_amount` field is in major units. Xano stores quote amounts
 * in minor units and invoice amounts in major; the views divide where needed
 * so nothing on this side has to remember which is which.
 */

export type Project = {
  id: number
  title: string | null
  sequel_no: string | null
  brand: string | null
  campaign_name: string | null
  product: string | null
  brand_no: string | null
  project_type: string | null
  stage: string | null
  record_status: string | null
  client_group: string | null
  agency: string | null
  country: string | null
  region: string | null
  brand_category: string | null
  service: string | null
  supervisor: string | null
  adpro_lead: string | null
  client_user: string | null
  // Track's third header line is a mailto link, so the address is wanted
  // alongside the name.
  client_user_email: string | null
  term: string | null
  territory: string | null
  media: string | null
  scripts: string | null
  durations: string | null
  cutdowns: boolean | null
  extension_yn: boolean | null
  proposed_start_date: string | null
  proposed_air_date: string | null
  confirmed_first_air_date: string | null
  // Empty string, not null, when the project is still open — Xano's own
  // convention for an unset date, left as it is rather than cleaned up here.
  closed_cancelled_date: string | null
  created_at: string | null
  pipeline_gbp: number | null
  studio_inbox_link: string | null
  studio_link: string | null
  disco_inbox_link: string | null
  final_disco_link: string | null
  notes: string | null
  notes_or_request: string | null
  // The pipeline-stage FK. The four counters on the list are keyed on the id
  // rather than the label so renaming an option cannot zero a counter.
  status_id: number | null
  supervisor_id: number | null
  client_user_id: number | null
  // The list's Agency column, which is NOT `agency`: Track joins it through
  // the client user's own company. Both are here because Track shows both,
  // under the same word, on two different pages.
  client_user_company: string | null
}

/** The signed-in person, as Xano knows them. */
export type Me = { id: number; name: string | null; email: string | null }

export function useMe() {
  return useQuery({
    queryKey: ['mirror', 'me'],
    queryFn: async (): Promise<Me | null> => {
      // database.types.ts only knows the public schema's own functions (see
      // the note on `mirror` below — `npm run types` needs the Supabase CLI),
      // so the call is cast rather than typed. The row is typed on the way out.
      const { data, error } = await (
        supabase as unknown as SupabaseClient
      ).rpc('track_me')
      if (error) throw error
      return (data as Me[] | null)?.[0] ?? null
    },
  })
}

export type Song = {
  id: number
  track_title: string | null
  composer: string | null
  registration_status: string | null
  schedule_a_status: string | null
  ownership: string | null
  duration: string | null
  tunecode: string | null
  status: string | null
}

export type CreativeLink = {
  id: number
  name: string | null
  url: string | null
  created_at: string | null
}

export type Quote = {
  id: number
  description: string | null
  status: string | null
  music_type: string | null
  // The quote's own free text ("SGD $", or "SGD" on the next row) and the one
  // character resolved through its currency FK, which is what the row shows.
  currency: string | null
  currency_symbol: string | null
  service: string | null
  client: string | null
  artist_name: string | null
  song_name: string | null
  territory: string | null
  term: string | null
  grand_total_amount: number | null
  mcps_fee_gbp_amount: number | null
  sequel_licence_amount: number | null
  created_at: string | null
}

export type Invoice = {
  id: number
  description: string | null
  invoice_number: string | null
  status: string | null
  invoice_date: string | null
  due_date: string | null
  currency: string | null
  currency_symbol: string | null
  client: string | null
  music_supervisor: string | null
  song_name: string | null
  total_amount: number | null
  total_gbp_amount: number | null
  gross_spend_amount: number | null
  po_number: string | null
  aws_link: string | null
}

export type Contract = {
  id: number
  file_name: string | null
  description: string | null
  contract_type: string | null
  supplier: string | null
  artist: string | null
  song_name: string | null
  status: string | null
  confirmed: boolean | null
  start_date: string | null
  end_date: string | null
  perpetual: boolean | null
  url: string | null
  created_at: string | null
}

export type Brief = {
  id: number
  name: string | null
  brief_type: string | null
  status: string | null
  source: string | null
  one_sentence_brief: string | null
  client_deadline: string | null
  sequel_deadline: string | null
  submitted_at: string | null
  requested_by: string | null
  // Whether the client's link still works. Xano decides this by omitting the
  // token once it lapses; the view states the rule instead.
  share_link_live: boolean | null
  created_at: string | null
}

export type ProjectFile = {
  id: number
  file_name: string | null
  description: string | null
  asset_tag: string | null
  file_size: number | null
  file_type: string | null
  url: string | null
  final_edit: boolean | null
  uploaded_by: string | null
  created_at: string | null
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

async function rows<T>(view: string, projectId: number, order: string) {
  const { data, error } = await mirror
    .from(view)
    .select('*')
    .eq('project_master_list_id', projectId)
    .order(order, { ascending: false })
  if (error) throw error
  return (data ?? []) as T[]
}

/**
 * The list behind `/projects` — which is "your projects", not all of them.
 * Track's get_staff_projects is `Music_Supervisor == $auth.id && Status !=
 * "Archived"`, sorted by id descending, and this matches it.
 *
 * RLS is a separate question and stays where it is: it decides what a person
 * is allowed to read. This decides what the page chooses to show them.
 *
 * Including the inner join. Xano reaches the client user with a join that
 * drops the row when there is no match, so a project whose Client_user_id is
 * unset never reaches the page. Three of Andy's live projects are invisible on
 * Track because of it — 224-SUN-26-II, 216-CLE-26-II and 112-CAL-26-II — and
 * they are invisible here too, on purpose: the brief for this pass is to
 * reproduce what Track does, not to improve on it while the two run side by
 * side. Deleting the client_user_id line below is the whole of the fix when
 * that is the decision.
 */
export function useMyProjects(supervisorId: number | null | undefined) {
  return useQuery({
    enabled: supervisorId !== undefined,
    queryKey: ['mirror', 'projects', supervisorId ?? null],
    queryFn: async (): Promise<Project[]> => {
      let q = mirror.from('project_list').select('*')
      if (supervisorId != null) q = q.eq('supervisor_id', supervisorId)
      const { data, error } = await q.order('id', { ascending: false })
      if (error) throw error
      return ((data ?? []) as Project[]).filter(
        (p) => p.record_status !== 'Archived' && p.client_user_id != null,
      )
    },
  })
}

/** Every project the reader may see. Used by the pages that are not the list. */
export function useProjects() {
  return useQuery({
    queryKey: ['mirror', 'projects', 'all'],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await mirror
        .from('project_list')
        .select('*')
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as Project[]
    },
  })
}

export function useProject(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'project', id],
    queryFn: async (): Promise<Project | null> => {
      const { data, error } = await mirror
        .from('project_list')
        .select('*')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as Project | null
    },
  })
}

export function useProjectQuotes(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'quotes', id],
    queryFn: () => rows<Quote>('project_quotes', id!, 'id'),
  })
}

export function useProjectInvoices(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'invoices', id],
    queryFn: () => rows<Invoice>('project_invoices', id!, 'id'),
  })
}

export function useProjectContracts(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'contracts', id],
    queryFn: () => rows<Contract>('project_contracts', id!, 'id'),
  })
}

export function useProjectBriefs(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'briefs', id],
    queryFn: () => rows<Brief>('project_briefs', id!, 'id'),
  })
}

export function useProjectFiles(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'files', id],
    queryFn: () => rows<ProjectFile>('project_files', id!, 'id'),
  })
}

export function useProjectSongs(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'songs', id],
    queryFn: async (): Promise<Song[]> => {
      const { data, error } = await mirror
        .from('sequel_songs')
        .select(
          'id, track_title, composer, registration_status, schedule_a_status, ownership, duration, tunecode, status',
        )
        .eq('project_master_list_id', id!)
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as Song[]
    },
  })
}

export function useProjectCreativeLinks(id: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(id),
    queryKey: ['mirror', 'creative', id],
    queryFn: async (): Promise<CreativeLink[]> => {
      const { data, error } = await mirror
        .from('creative_links')
        .select('id, name, url, created_at')
        .eq('project_master_list_id', id!)
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as CreativeLink[]
    },
  })
}
