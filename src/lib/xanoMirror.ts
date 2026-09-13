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

/**
 * A client company, as `/clients` and `/client` show it.
 *
 * ⚠️ `Clients.UUID` is uppercase in Xano while `Supplier List.uuid` is
 * lowercase — a real inconsistency between two tables that are otherwise
 * handled identically, and the cause of a day lost to a misleading Xano error
 * in August. The mirror lower-cases every column on the way in, so it is
 * `uuid` here and the trap does not survive the crossing.
 */
export type Client = {
  id: number
  uuid: string | null
  company: string | null
  city: string | null
  street_address: string | null
  postal_code: string | null
  invoice_email: string | null
  accounts_payable_email: string | null
  qbo_customer_id: string | null
  invoice_instructions: string | null
  status: string | null
  country_id: number | null
  country_text: string | null
  // The five regions the tabs filter on: 1 Asia Pacific, 2 Europe, 3 Latin
  // America, 4 North America, 5 Middle East & Turkey. The tabs key on the id
  // rather than the label, as everything else in Track does.
  region_id: number | null
  region_text: string | null
  client_type_id: number | null
  client_type_text: string | null
}

/**
 * Every live client, in Track's order.
 *
 * The sort is Track's, not Postgres': Xano orders `Company` by byte, so the
 * list runs digits, then capitals, then lowercase — "11:11 …", "360FX Milan",
 * … "Weber Shandwick New York", "adam&eve\TBWA London". A plain JavaScript
 * `<` compares UTF-16 code units and reproduces exactly that, which is why the
 * ordering is done here rather than asked of PostgREST, whose default
 * collation would put adam&eve third.
 *
 * The view already drops archived clients (`status != 'Archived'`, so a blank
 * status still shows) and resolves country, region and type.
 */
export function useClients() {
  return useQuery({
    queryKey: ['mirror', 'clients'],
    queryFn: async (): Promise<Client[]> => {
      const { data, error } = await mirror.from('client_list').select('*')
      if (error) throw error
      return ((data ?? []) as Client[]).sort((a, b) =>
        (a.company ?? '') < (b.company ?? '') ? -1 : (a.company ?? '') > (b.company ?? '') ? 1 : 0,
      )
    },
  })
}

/** One client, for `/clients/:uuid`. */
export function useClient(uuid: string | undefined) {
  return useQuery({
    enabled: !!uuid,
    queryKey: ['mirror', 'client', uuid],
    queryFn: async (): Promise<Client | null> => {
      // client_detail, not client_list: get_client_detail has no archive
      // filter, so an archived client is off the list and still opens by URL.
      const { data, error } = await mirror
        .from('client_detail')
        .select('*')
        .eq('uuid', uuid!)
        .maybeSingle()
      if (error) throw error
      return (data as Client) ?? null
    },
  })
}

/** A project as the client page lists it — five columns, not the list's eight. */
export type ClientProject = {
  id: number
  uuid: string | null
  title: string | null
  sequel_no: string | null
  brand: string | null
  campaign_name: string | null
  projects_status: number | null
  stage_text: string | null
  // The counters key on this, not on service_name: 1 Composition,
  // 2 Commercial, 3 Library, 4 Sonic Branding, 5 Sound Design, 6 Talent.
  services_id: number | null
  service_name: string | null
  pipeline_gbp: number | null
}

/**
 * The client's projects, newest first.
 *
 * ⚠️ Joined on `client_agency`. Project Master List has two client-ish
 * columns and `client` is the other one — an FK to Client Groups, not to
 * Clients.
 */
export function useClientProjects(clientId: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(clientId),
    queryKey: ['mirror', 'client-projects', clientId],
    queryFn: async (): Promise<ClientProject[]> => {
      const { data, error } = await mirror
        .from('client_projects')
        .select('*')
        .eq('client_agency', clientId!)
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as ClientProject[]
    },
  })
}

export type ClientProfit = {
  client_id: number
  year: number
  total_profit_gbp: number
  ytd_profit_gbp: number
  invoices_counted: number
  /**
   * Invoices whose QuickBooks rate was never pulled. They are left out of both
   * totals rather than counted at zero, which would understate the profit
   * quietly. Nothing on the page shows this yet; Track does not show it
   * either, and the number is here so it can be.
   */
  invoices_unrated: number
}

/**
 * The two profit tiles, in GBP.
 *
 * Each invoice is converted at `exchange_rate_lock` — the rate QuickBooks
 * applied on the day, stamped on the invoice — so a historic total never moves
 * when rates change. Profit means `total_sequel_profit`: every Sequel fee
 * including studio fees and contingency, and no supplier lines.
 *
 * The year is passed in rather than derived on the server, as Track does it,
 * which is also what lets a past year be asked for.
 */
export function useClientProfit(clientId: number | undefined, year: number) {
  return useQuery({
    enabled: Number.isFinite(clientId),
    queryKey: ['mirror', 'client-profit', clientId, year],
    queryFn: async (): Promise<ClientProfit | null> => {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_client_profit',
        { p_client: clientId!, p_year: year },
      )
      if (error) throw error
      const row = (data as ClientProfit[] | null)?.[0]
      if (!row) return null
      // Postgres hands numerics back as strings over PostgREST.
      return {
        ...row,
        total_profit_gbp: Number(row.total_profit_gbp),
        ytd_profit_gbp: Number(row.ytd_profit_gbp),
      }
    },
  })
}

/**
 * Xano's ordering, not Postgres'. Both supplier endpoints now sort by Title,
 * and Xano compares by byte: digits, then capitals, then lowercase, so
 * "BMG Australia" comes before "Believe". A JavaScript `<` compares UTF-16
 * code units and reproduces exactly that, where PostgREST's `.order()` would
 * use the column's collation and swap the pair. Same comparison as useClients.
 */
const byTitle = (a: { title: string | null }, b: { title: string | null }) =>
  (a.title ?? '') < (b.title ?? '') ? -1 : (a.title ?? '') > (b.title ?? '') ? 1 : 0

/**
 * A supplier, as `/partners` lists them.
 *
 * One table, `Supplier List`, split by type: `/partners` is everything that is
 * NOT a Composition Team, `/roster` is only the Composition Teams. Xano's
 * endpoint for the first is called `get_all_suppliers`, which it is not.
 */
export type Partner = {
  id: number
  uuid: string | null
  title: string | null
  supplier_type: string | null
  briefing_list: string | null
  approved: boolean | null
  strengths: string | null
  brief_email: string | null
  website: string | null
  city: string | null
  ca_status: string | null
  country_id: number | null
  country_text: string | null
  region_id: number | null
  region_text: string | null
}

/**
 * Every supplier that is not a composition team.
 *
 * ⚠️ Ordered by title, where Track has no order at all. `get_all_suppliers` is
 * a bare query with no `sort`, so Track shows heap order — today it opens id 8,
 * 149, 113, 22, 111 — and that order changes whenever a supplier is edited.
 * There is nothing to reproduce, so this picks a stable one.
 */
export function usePartners() {
  return useQuery({
    queryKey: ['mirror', 'partners'],
    queryFn: async (): Promise<Partner[]> => {
      const { data, error } = await mirror.from('partner_list').select('*')
      if (error) throw error
      return ((data ?? []) as Partner[]).sort(byTitle)
    },
  })
}

/** One supplier, for `/partners/:uuid`. */
export type PartnerDetail = Partner & {
  bio: string | null
  phone_number: string | null
  creative_team_member_1_name: string | null
  creative_team_member_1_email: string | null
  creative_team_member_2_name: string | null
  creative_team_member_2_email: string | null
  creative_team_member_3_name: string | null
  creative_team_member_3_email: string | null
  clearance_contact_name_1: string | null
  clearance_contact_email_1: string | null
  clearance_contact_name_2: string | null
  clearance_contact_email_2: string | null
  finance_email: string | null
  qbo_vendor_id: string | null
  default_currency_id: number | null
  vat_registered: boolean | null
}

export function usePartner(uuid: string | undefined) {
  return useQuery({
    enabled: !!uuid,
    queryKey: ['mirror', 'partner', uuid],
    queryFn: async (): Promise<PartnerDetail | null> => {
      const { data, error } = await mirror
        .from('partner_detail')
        .select('*')
        .eq('uuid', uuid!)
        .maybeSingle()
      if (error) throw error
      return (data as PartnerDetail) ?? null
    },
  })
}

/**
 * A composition team, as `/roster` lists them.
 *
 * The other half of `Supplier List`: `get_roster` is `Supplier_Type ==
 * "Composition Team"` where `get_all_suppliers` is everything else.
 */
export type RosterMember = {
  id: number
  uuid: string | null
  title: string | null
  supplier_type: string | null
  briefing_list: string | null
  approved: boolean | null
  strengths: string | null
  brief_email: string | null
  finance_email: string | null
  website: string | null
  phone_number: string | null
  city: string | null
  bio: string | null
  studio_setup: string | null
  stand_out_work: string | null
  composition_showreel: string | null
  sounddesign_showreel: string | null
  final_mix_showreel: string | null
  library_link: string | null
  access_to_vocalist: boolean | null
  sound_design: boolean | null
  final_mix: boolean | null
  composer_library: boolean | null
  /** Not Sent / Pending / Complete / NA. "Signed" on the list counts Complete. */
  ca_status: string | null
  qbo_vendor_id: string | null
  country_id: number | null
  country_text: string | null
  region_id: number | null
  region_text: string | null
}

/**
 * Every composition team, by name.
 *
 * Ordered here for the same reason as the partners list: `get_roster` is a bare
 * query with no `sort`, so Track shows heap order and there is nothing to copy.
 */
export function useRoster() {
  return useQuery({
    queryKey: ['mirror', 'roster'],
    queryFn: async (): Promise<RosterMember[]> => {
      const { data, error } = await mirror.from('roster_list').select('*')
      if (error) throw error
      return ((data ?? []) as RosterMember[]).sort(byTitle)
    },
  })
}

/**
 * One composition team.
 *
 * Off `roster_list` rather than `partner_detail`: the roster page shows four
 * fields the partner page deleted — the two showreels, the library url and the
 * studio — and this view already carries them.
 */
export function useRosterMember(uuid: string | undefined) {
  return useQuery({
    enabled: !!uuid,
    queryKey: ['mirror', 'roster-member', uuid],
    queryFn: async (): Promise<RosterMember | null> => {
      const { data, error } = await mirror
        .from('roster_list')
        .select('*')
        .eq('uuid', uuid!)
        .maybeSingle()
      if (error) throw error
      return (data as RosterMember) ?? null
    },
  })
}
