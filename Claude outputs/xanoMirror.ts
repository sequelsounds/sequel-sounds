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

export type Quote = {
  id: number
  status: string | null
  music_type: string | null
  currency: string | null
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
  invoice_number: string | null
  status: string | null
  invoice_date: string | null
  due_date: string | null
  currency: string | null
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

export function useProjects() {
  return useQuery({
    queryKey: ['mirror', 'projects'],
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
