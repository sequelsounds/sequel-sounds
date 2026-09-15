import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Sequel Track's data, read from the `xano_mirror` schema in Supabase: a
 * replica of Xano kept in step by the sync_xano_mirror task, hourly since
 * 13 September 2026.
 *
 * Nothing in THIS file writes — the hooks here are reads, and the writes live
 * beside them in `supplierWrites.ts` and whatever follows it.
 *
 * ⚠️ "Replica" is no longer true of every table. A table is taken OUT of
 * sync_xano_mirror when the rebuild starts writing it, and Supabase becomes
 * the original for it from that moment; the sync would otherwise put every
 * edit back on the hour, and delete anything created. `supplier_list` went
 * first, on 13 September 2026. Everything else here is still a replica, and
 * still has no insert, update or delete policy at all, so a stray mutation
 * fails at the database rather than quietly diverging from Xano.
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
  // The ids behind the labels above. The page reads the label and writes the
  // id, so editing a foreign key needs both — added to `project_list` when the
  // project page stopped being read-only.
  client_group_id: number | null
  agency_id: number | null
  brand_category_id: number | null
  service_id: number | null
  adpro_user_id: number | null
  sequel_ownership: string | null
  concept: string | null
  updated_at: string | null
  /** ⚠️ The PROPOSED track, never the confirmed one — a draft quote prefills
      from these and must not touch what was signed off. */
  proposed_song: string | null
  proposed_artist: string | null
}

/**
 * The signed-in person, as Xano knows them.
 *
 * `birthday` is here for one thing: /dashboard's greeting, which beats every
 * other line on the day. It is the caller's own row and nobody else's —
 * track_me is keyed on the caller — and a date of birth should not travel
 * any further than that.
 */
export type Me = {
  id: number
  name: string | null
  email: string | null
  birthday: string | null
}

export function useMe() {
  return useQuery({
    queryKey: ['mirror', 'me'],
    queryFn: async (): Promise<Me | null> => {
      // database.types.ts only knows the public schema's own functions (see
      // the note on `mirror` below — `npm run types` needs the Supabase CLI),
      // so the call is cast rather than typed. The row is typed on the way out.
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc('track_me')
      if (error) throw error
      return (data as Me[] | null)?.[0] ?? null
    },
  })
}

/**
 * Whether the signed-in person is management — Andy and Phil, not every
 * Sequel account.
 *
 * ⚠️ This is for HIDING THE NAV LINK, nothing more. The gate that matters is
 * in the database: the three `management_*` views ask the same function, so
 * typing the URL gets an empty page rather than the company's figures. Track
 * makes the same split, and its own note is worth repeating — hiding a link
 * is not access control.
 */
/** Whether the signed-in person is finance — archiving a raised invoice needs it. */
export function useIsFinance() {
  return useQuery({
    queryKey: ['mirror', 'is-finance'],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_is_finance',
      )
      if (error) throw error
      return data === true
    },
  })
}

export function useIsManagement() {
  return useQuery({
    queryKey: ['mirror', 'is-management'],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_is_management',
      )
      if (error) throw error
      return data === true
    },
  })
}

/**
 * Whether the signed-in person is Sequel staff.
 *
 * ⚠️ For SHOWING THE EDIT CONTROLS, nothing more. The project page is one of
 * the few a client user can legitimately open — track_can_see_project lets in
 * the client contact, the ad producer and the supervisor — so it has to decide
 * whether to render boxes or read-only fields. The gate that matters is the
 * insert and update policies, which ask this same function inside the
 * database: a client user who forces the controls open gets zero rows back.
 */
export function useIsStaff() {
  return useQuery({
    queryKey: ['mirror', 'is-staff'],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc('track_is_staff')
      if (error) throw error
      return data === true
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
  uuid: string | null
  /** ⚠️ The CODE, not the symbol: "$" is both USD and SGD. */
  currency_code: string | null
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
  // The row links to /invoices/:uuid, so the list has to carry one.
  uuid: string | null
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
  // Raised in QuickBooks when set. Archiving one is finance-only.
  qbo_invoice_id: string | null
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
export const mirror = (supabase as unknown as SupabaseClient).schema('xano_mirror')

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
 * ⚠️ EXCEPT the inner join, which is fixed here. Xano reaches the client user
 * with a join that drops the row when there is no match, so a project whose
 * Client_user_id is unset never reaches the page at all. Three of Andy's live
 * projects are invisible on Track because of it — **224-SUN-26-II** (Sassy -
 * The Film), **216-CLE-26-II** (PRODUCT) and **112-CAL-26-II** (Original Taste
 * Speaks Louder), all Active, all at New, all his.
 *
 * They were reproduced on purpose while this pass was read-only, on the rule
 * that the rebuild copies Track rather than improving on it. A list that
 * silently omits live work is not a rendering difference though — it is the
 * page failing at the one thing it is for, and the omission is invisible
 * precisely because there is nothing on screen to count against. So the filter
 * is gone, and the two lists now differ by those three rows.
 *
 * ⚠️ THE VERIFIED COUNT MOVES WITH IT. `/projects` was signed off against
 * Track at 86 rows; on Andy's account it now reads 89. That is the fix, not a
 * regression — but it means the 86 in the migration note is Track's number and
 * no longer this page's.
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
      // Archived only. The client_user_id test that used to sit here is what
      // hid the three projects named above; see the note on this function.
      return ((data ?? []) as Project[]).filter((p) => p.record_status !== 'Archived')
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
    // ⚠️ Archived invoices are left out, as the old app's get_project_invoices
    // does. Written as an OR so a row with no status is still shown — a bare
    // `<>` drops NULL rows (mirror trap 4).
    queryFn: async () => {
      const { data, error } = await mirror
        .from('project_invoices')
        .select('*')
        .eq('project_master_list_id', id!)
        .or('status.is.null,status.neq.Archived')
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as Invoice[]
    },
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
  /**
   * ⚠️ A SECOND, OLDER status vocabulary on the same project, and the one the
   * user page's Projects tab shows: Project Submitted, Quote(s) Supplied,
   * Creative Development, Contracting, Invoicing, Complete, Closed — against
   * `stage_text`'s New / Quoting / Creative / Approvals / Contracting /
   * Complete / Cancelled / Archived. The same project can read Complete on the
   * client page and Invoicing on the user page, and "Sapa 2026 Extension"
   * does.
   */
  legacy_status_text: string | null
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

/**
 * A Sequel song — one Sequel composed for a client, and registered with the
 * PROs once the paperwork is back.
 */
export type SequelSong = {
  id: number
  uuid: string | null
  track_title: string | null
  composer: string | null
  brand: string | null
  project: string | null
  project_master_list_id: number | null
  /** "Awaiting Registration" on the band counts Unregistered. */
  registration_status: string | null
  schedule_a_status: string | null
  ownership: string | null
  duration: string | null
  tunecode: string | null
  status: string | null
  supplier_list_id: number | null
  supplier_title: string | null
  supplier_uuid: string | null
  // The song page's other five tabs.
  alternative_titles: string | null
  agreement_number: string | null
  prs_registration_date: string | null
  commencement_date: string | null
  clock_numbers: string | null
  campaign_description: string | null
  script_title: string | null
  /**
   * ⚠️ The song's own Advertising_Agency column, which is NOT what the page's
   * "Ad Agency" shows. Track reads the song's project, that project's
   * client_agency, and that client's Company — `ad_agency` below. The two
   * disagree: "Go Go Noodles" carries "UStudios" here while its project's
   * client is Oliver London, and Oliver London is what Track renders. Both are
   * kept so the disagreement stays visible rather than being quietly resolved.
   */
  advertising_agency: string | null
  /** What the page's Ad Agency field shows: the project's client company. */
  ad_agency: string | null
  notes: string | null
}

/**
 * Every active song.
 *
 * ⚠️ The view filters `status = 'Active'`, not `is distinct from 'Archived'`.
 * That is Get_songs' own rule and it differs from every other list in Track: a
 * song with a blank status is absent here where a client or supplier with one
 * would still show. All 14 rows carry a status today, so nothing is hidden by
 * it yet.
 */
export function useSongs() {
  return useQuery({
    queryKey: ['mirror', 'songs'],
    queryFn: async (): Promise<SequelSong[]> => {
      const { data, error } = await mirror.from('song_list').select('*')
      if (error) throw error
      return ((data ?? []) as SequelSong[]).sort((a, b) =>
        (a.track_title ?? '') < (b.track_title ?? '')
          ? -1
          : (a.track_title ?? '') > (b.track_title ?? '')
            ? 1
            : 0,
      )
    },
  })
}

/** One song, for `/songs/:uuid`. The same view the list reads. */
export function useSong(uuid: string | undefined) {
  return useQuery({
    enabled: !!uuid,
    queryKey: ['mirror', 'song', uuid],
    queryFn: async (): Promise<SequelSong | null> => {
      const { data, error } = await mirror
        .from('song_list')
        .select('*')
        .eq('uuid', uuid!)
        .maybeSingle()
      if (error) throw error
      return (data as SequelSong) ?? null
    },
  })
}

/** A person in Track's directory — an agency, brand, freelance, AdPro or supplier contact. */
export type TrackUser = {
  id: number
  uuid: string | null
  name: string | null
  email: string | null
  job_title: string | null
  phone_number: string | null
  created_at: string | null
  notes: string | null
  user_type: number | null
  user_type_title: string | null
  status: number | null
  status_title: string | null
  company: number | null
  company_name: string | null
  company_uuid: string | null
  /** The CLIENT's country, reached through the company. Users have no country. */
  country_title: string | null
}

/** Staff. get_users excludes both, so /users is only external people. */
const INTERNAL_USER_TYPES = [1, 2]

/**
 * The directory behind `/users`.
 *
 * ⚠️ Staff are excluded — user_type 1 (Admin) and 2 (Sequel) — which is why
 * this returns 146 of the 149 rows on the table. Xano's own note is worth
 * repeating: a new internal user type has to be added to that filter or it
 * starts appearing in a client-facing list.
 *
 * Newest first, which is Track's `sort = {created_at: "desc"}` and the one
 * list in the app not ordered by name.
 *
 * ⚠️ With `id` descending as a tiebreak, which Track does not have. Users were
 * created in batches, so ties are common — three share 2026-09-06 19:51:39.734
 * — and Track's order inside a tie is whatever the store returns, which moves
 * when a row is edited. The two lists therefore agree everywhere the order is
 * defined and differ inside ties, where Track has no answer to match.
 */
export function useTrackUsers() {
  return useQuery({
    queryKey: ['mirror', 'users'],
    queryFn: async (): Promise<TrackUser[]> => {
      const { data, error } = await mirror
        .from('user_directory')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (error) throw error
      return ((data ?? []) as TrackUser[]).filter(
        (u) => u.user_type == null || !INTERNAL_USER_TYPES.includes(u.user_type),
      )
    },
  })
}

/**
 * One person, for `/users/:uuid`.
 *
 * No type filter: get_user_by_uuid has none either, so a Sequel account is off
 * the list and still opens by URL.
 */
export function useTrackUser(uuid: string | undefined) {
  return useQuery({
    enabled: !!uuid,
    queryKey: ['mirror', 'user', uuid],
    queryFn: async (): Promise<TrackUser | null> => {
      const { data, error } = await mirror
        .from('user_directory')
        .select('*')
        .eq('uuid', uuid!)
        .maybeSingle()
      if (error) throw error
      return (data as TrackUser) ?? null
    },
  })
}

/** The person's projects — the ones they are the client contact on. */
export function useUserProjects(userId: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(userId),
    queryKey: ['mirror', 'user-projects', userId],
    queryFn: async (): Promise<ClientProject[]> => {
      const { data, error } = await mirror
        .from('client_projects')
        .select('*')
        .eq('client_user_id', userId!)
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as ClientProject[]
    },
  })
}

/* -------------------------------------------------------------- management
 * The company-wide figures behind `/management`.
 *
 * ⚠️ MANAGEMENT ONLY, NOT STAFF. Track guards its endpoint with
 * assert_management rather than assert_sequel_staff, because this page shows
 * every supervisor's billing, profit and margin. Camila is Sequel staff and
 * must not see it. The mirror's own RLS grants staff everything, so the gate
 * lives inside the three views (`public.track_is_management()`): a staff
 * member who is not management gets empty lists, not a partial page.
 *
 * ⚠️ Hiding the nav link is not access control, and neither is this hook.
 * The database is what refuses.
 *
 * Every money field is already GBP — the view converts with
 * `exchange_rate_lock`, never `gbp_total_amount` (zero on almost every row)
 * and never `eur_rate` (Unilever's fixed rate).
 */

/** One live invoice, as `/management` counts it. */
export type ManagementInvoice = {
  id: number
  uuid: string | null
  invoice_number: string | null
  project_title: string
  brand: string
  category_id: number
  /** "Unclassified" where the project has no category — a reported value, not a blank. */
  category: string
  /** The PROJECT's agency, not the invoiced party. Both are Clients rows. */
  agency: string
  /** The INVOICED client's region. "Unassigned" where there is none. */
  region: string
  /** project.client === 1. Not Brand_Group, which is free text and wrong. */
  is_unilever: boolean
  invoice_date: string | null
  status: string | null
  supervisor_id: number | null
  client_id: number | null
  client_name: string
  invoiced: number
  profit: number
  spend: number
  third_party: number
  studios: number
  demo: number
  search: number
  licence: number
  other: number
  /** In no total. It records money that did not move. */
  cost_avoidance: number
}

/** A live project, for the Projects series only. */
export type ManagementProject = {
  id: number
  created_at: string
  supervisor_id: number | null
  brand: string | null
  client: number | null
  category_id: number
}

/** A supervisor's name, for the Team table. */
export type ManagementStaff = { id: number; name: string | null }

export type ManagementOverview = {
  invoices: ManagementInvoice[]
  projects: ManagementProject[]
  staff: ManagementStaff[]
}

/**
 * Everything `/management` draws, in three reads.
 *
 * Track fetches the equivalent in one endpoint that takes four seconds and
 * change; these are plain selects against views, and the grouping happens
 * here in the browser exactly as it does on Track — which is what lets the
 * year toggle re-render eight panes without going back to the server.
 */
export function useManagement() {
  return useQuery({
    queryKey: ['mirror', 'management'],
    queryFn: async (): Promise<ManagementOverview> => {
      const [invoices, projects, staff] = await Promise.all([
        mirror.from('management_invoices').select('*'),
        mirror.from('management_projects').select('*'),
        mirror.from('management_staff').select('*'),
      ])
      if (invoices.error) throw invoices.error
      if (projects.error) throw projects.error
      if (staff.error) throw staff.error
      return {
        invoices: (invoices.data ?? []) as ManagementInvoice[],
        projects: (projects.data ?? []) as ManagementProject[],
        staff: (staff.data ?? []) as ManagementStaff[],
      }
    },
  })
}

/* --------------------------------------------------------------- dashboard
 * `/dashboard`: the caller's own billing, the personal counterpart to
 * `/management`.
 *
 * ⚠️ STAFF ONLY, AND ONLY YOUR OWN. Track guards its endpoint with
 * assert_sequel_staff and filters on `music_supervisor_id == $auth.id` in
 * Xano rather than the browser — company totals would otherwise have reached
 * that machine even if nothing drew them. The two views below do the same in
 * the database, so the rows for anyone else never leave it.
 *
 * ⚠️ music_supervisor_id IS WHOEVER RAISED THE INVOICE, not whoever owns the
 * project today. Jobs change hands. This reports billing, not ownership.
 */

/** One of the caller's live invoices, in GBP. Every year — the charts need last year. */
export type DashboardInvoice = {
  id: number
  uuid: string | null
  invoice_number: string | null
  project_title: string
  invoice_date: string | null
  status: string | null
  supervisor_id: number | null
  client_id: number | null
  client_name: string
  invoiced: number
  profit: number
  spend: number
  third_party: number
  studios: number
  demo: number
  search: number
  licence: number
  other: number
  /** In no total. The Avoidance stat is the only thing that reads it. */
  cost_avoidance: number
}

/** One of the caller's live projects, for the Projects series only. */
export type DashboardProject = { id: number; created_at: string }

export type DashboardOverview = {
  invoices: DashboardInvoice[]
  projects: DashboardProject[]
}

/**
 * Everything `/dashboard` draws, in two reads.
 *
 * Track's endpoint scopes its totals to the current year in Xano and returns
 * the rows unscoped, because the charts plot this year against last. Here the
 * rows arrive unscoped either way and the page does the year filtering, which
 * is what `/management` already does with the same figures.
 */
export function useDashboard() {
  return useQuery({
    queryKey: ['mirror', 'dashboard'],
    queryFn: async (): Promise<DashboardOverview> => {
      const [invoices, projects] = await Promise.all([
        mirror.from('dashboard_invoices').select('*'),
        mirror.from('dashboard_projects').select('*'),
      ])
      if (invoices.error) throw invoices.error
      if (projects.error) throw projects.error
      return {
        invoices: (invoices.data ?? []) as DashboardInvoice[],
        projects: (projects.data ?? []) as DashboardProject[],
      }
    },
  })
}

/**
 * One invoice, as Sequel Track's `/invoice` shows it — the screen finance uses
 * to check an invoice before it is raised in QuickBooks.
 *
 * ⚠️ STAFF ONLY, and the gate is in the database. `invoice_detail` and
 * `invoice_lines` both ask `track_is_staff()`, the same restriction Track
 * applies with `assert_sequel_staff`. A client user who can reach the project
 * gets no rows rather than an error.
 *
 * ⚠️ EVERY FIGURE IS IN THE INVOICE'S OWN CURRENCY. `total_to_invoice`,
 * `gross_spend` and `total_sequel_profit` are local and unmarked in Xano;
 * `/management` and `/dashboard` convert them with `exchange_rate_lock`
 * because they sum across invoices. This page shows one, with its symbol, and
 * does not convert — which is also what Track does.
 */
export type InvoiceDetail = {
  id: number
  uuid: string | null
  invoice_number: string | null
  status: string | null
  description: string | null
  invoice_date: string | null
  due_date: string | null
  created_at: string | null
  po_number: string | null
  po_attachment_url: string | null
  aws_link: string | null
  adpro_number: string | null
  usage_territories: string | null
  usage_region: string | null
  song_name: string | null
  artist_name: string | null

  /**
   * Raised in QuickBooks, so nothing may change it any more. One flag from one
   * column, as Xano returns it: Track keys every read-only state on the page
   * off this single boolean so the screen and the endpoints cannot disagree.
   */
  locked: boolean
  qbo_invoice_id: string | null

  project_master_list_id: number | null
  project_uuid: string | null
  project_title: string | null
  project_sequel_no: string | null

  client_id: number | null
  client_name: string | null
  /** ⚠️ Whoever RAISED the invoice, not whoever owns the project now. */
  music_supervisor_id: number | null
  music_supervisor: string | null

  currency_id: number | null
  currency: string | null
  currency_symbol: string | null
  exchange_rate: number | null
  gbp_total_amount: number | null

  // The nine fee boxes. Each is the header column PLUS any `sequel_fee` rows
  // that project into it — ten historic invoices carry their demo contingency
  // as a row with the column at zero, so without that fold the money is
  // missing from the box while still counting in the totals below.
  demo_contingency_fee: number
  sequel_demo_fee: number
  search_contingency_fee: number
  sequel_search_fee: number
  master_sequel_studios_fee: number
  master_sequel_licence_fee: number
  publishing_sequel_studios_fee: number
  publishing_sequel_licence_fee: number
  sequel_consultancy_fee: number

  // How much of each box came from rows rather than from its own column, so a
  // box can be marked as folded only when it actually was. The first cut of
  // this page had one page-level count and marked all four Demos/Searches
  // boxes from it — a true fact about the invoice, rendered as a false one
  // about three of the boxes.
  demo_contingency_from_rows: number
  sequel_demo_from_rows: number
  search_contingency_from_rows: number
  sequel_search_from_rows: number
  master_studios_from_rows: number
  master_licence_from_rows: number
  publishing_studios_from_rows: number
  publishing_licence_from_rows: number
  consultancy_from_rows: number
  /** How many fee rows exist at all. Zero means every box is its column. */
  fee_row_count: number

  // ⚠️ Money that did NOT move. A reporting figure, and in none of the totals.
  demo_cost_avoidance: number
  search_cost_avoidance: number
  master_cost_avoidance: number
  publishing_cost_avoidance: number
  other_cost_avoidance: number
  total_cost_avoidance: number

  total_to_invoice: number
  gross_spend: number
  total_sequel_profit: number
}

/**
 * A supplier cost row.
 *
 * ⚠️ `sequel_fee` rows are NOT here — the view filters them out, as Xano's read
 * shim does. They are Sequel's own margin; showing them as supplier costs
 * would double them on screen and invite someone to give one a supplier, which
 * is the exact condition that lets Sequel's margin be billed as a third party.
 */
export type InvoiceLine = {
  id: number
  invoice_id: number
  invoice_uuid: string | null
  category: string | null
  supplier_id: number | null
  supplier: string | null
  fee_amount: number | null
  /**
   * Paythrough: Sequel takes the client's money and pays the label or
   * publisher. False means the client settles that one direct — Sequel still
   * records the spend, but it is not billed. That is the single difference
   * between "total to invoice" and "total spend".
   */
  is_paythrough: boolean | null
  confirmed: boolean | null
  qbo_bill_id: string | null
  share_percent: number | null
  fee_type: string | null
  line_type: string | null
}

export function useInvoice(uuid: string | undefined) {
  return useQuery({
    enabled: !!uuid,
    queryKey: ['mirror', 'invoice', uuid],
    queryFn: async (): Promise<InvoiceDetail | null> => {
      const { data, error } = await mirror
        .from('invoice_detail')
        .select('*')
        .eq('uuid', uuid!)
        .maybeSingle()
      if (error) throw error
      return (data as InvoiceDetail) ?? null
    },
  })
}

export function useInvoiceLines(uuid: string | undefined) {
  return useQuery({
    enabled: !!uuid,
    queryKey: ['mirror', 'invoice-lines', uuid],
    queryFn: async (): Promise<InvoiceLine[]> => {
      const { data, error } = await mirror
        .from('invoice_lines')
        .select('*')
        .eq('invoice_uuid', uuid!)
        .order('id')
      if (error) throw error
      return (data ?? []) as InvoiceLine[]
    },
  })
}

/**
 * What a supplier has actually done, counted off the invoice lines.
 *
 * The three tiles on the two supplier pages — Demos, Wins and Fees — have been
 * empty on Track since the day those pages were made: they were duplicated
 * from `/project` and the tiles came with them, still bound to
 * `project_service_type`, `project_sequel_no` and `project_status`, none of
 * which exist on a supplier page. Andy's definitions, 14 September 2026, and
 * the arithmetic lives in the `supplier_stats` view rather than here.
 *
 * ⚠️ `fees_gbp` IS IN STERLING and every other money figure on these two pages
 * is not. A line's `fee_amount` is in its invoice's currency, so a supplier's
 * lines cannot be summed without converting — the view does it at each
 * invoice's own `exchange_rate_lock`. Label the tile accordingly.
 */
export type SupplierStats = {
  supplier_id: number
  /** Every line in the Demos category counts as one. */
  demos: number
  /** Distinct invoices carrying a Library Master or Publishing line — both on
   *  the same invoice is one win, not two. */
  wins: number
  /** Every line they are named on, in GBP. */
  fees_gbp: number
  /**
   * What Sequel itself paid out, rather than what the supplier was paid in
   * total. A non-paythrough line is settled by the client direct, so this is
   * far lower and zero for most labels and publishers. Not shown; kept so the
   * distinction is visible and switching the tile is one word.
   */
  fees_paythrough_gbp: number
  invoice_count: number
}

export function useSupplierStats(supplierId: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(supplierId),
    queryKey: ['mirror', 'supplier-stats', supplierId],
    queryFn: async (): Promise<SupplierStats | null> => {
      const { data, error } = await mirror
        .from('supplier_stats')
        .select('*')
        .eq('supplier_id', supplierId!)
        .maybeSingle()
      if (error) throw error
      return (data as SupplierStats) ?? null
    },
  })
}

/**
 * One invoice a supplier appears on — the rows behind the Demos / Wins / Fees
 * tiles, listed out.
 *
 * The tab these fill said "Projects" and had no markup at all on Track — not
 * an empty state, nothing. Andy's call, 14 September 2026: invoices rather
 * than projects, because an invoice line is the only place a supplier is
 * actually named.
 *
 * ⚠️ `supplier_amount` IS IN THE INVOICE'S OWN CURRENCY and is shown with its
 * symbol, the way every other invoice row in the app shows money. The Fees
 * tile above the tab is sterling, because that one sums across invoices and
 * cannot be anything else. Both are right, and the tile says "(GBP)" so the
 * difference is on screen rather than assumed.
 */
export type SupplierInvoice = {
  supplier_id: number
  invoice_id: number
  invoice_uuid: string | null
  invoice_number: string | null
  status: string | null
  invoice_date: string | null
  created_at: string | null
  description: string | null
  currency_symbol: string | null
  currency: string | null
  project_master_list_id: number | null
  project_title: string | null
  project_sequel_no: string | null
  /** What THIS supplier is owed on THIS invoice, not the invoice total. */
  supplier_amount: number | null
  supplier_amount_gbp: number | null
  line_count: number
  demo_lines: number
  /** Counted as a win by the same test the tile uses: a master or publishing line. */
  is_win: boolean | null
  any_paythrough: boolean | null
}

export function useSupplierInvoices(supplierId: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(supplierId),
    queryKey: ['mirror', 'supplier-invoices', supplierId],
    queryFn: async (): Promise<SupplierInvoice[]> => {
      const { data, error } = await mirror
        .from('supplier_invoices')
        .select('*')
        .eq('supplier_id', supplierId!)
      if (error) throw error
      // Newest first, and an invoice with no date sorts last rather than
      // first: 148 of 150 imported invoices have no due date and some have no
      // invoice date either, and a null must not lead the list.
      return ((data ?? []) as SupplierInvoice[]).sort((a, b) =>
        (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''),
      )
    },
  })
}

/* ------------------------------------------------------------ the quote doc
 * The client-facing quote document, behind `/quotes/:uuid`.
 *
 * Mirrors Xano's get_quote_by_uuid (api 419) through two views, with the
 * formatting left to the page: 419 divides by 100 and comma-separates before
 * the front end sees it, and these carry full precision so the page rounds
 * once — the rule the invoice page already follows.
 *
 * ⚠️ NOT PUBLIC, unlike the old app. There, api 419 is `auth = false` so a
 * client can open the document from a shared link, which means anyone holding
 * a uuid can read it. Here `quotes_scoped_read` already lets the project's
 * client contact, ad producer and supervisor see it once signed in, so the
 * page works for a client without the document being open to the world.
 * Whether a public share link is added on top is Andy's call, still open.
 */

export type QuoteDetail = {
  id: number
  uuid: string
  quote_no: number
  status: string | null
  description: string | null
  created_at: string | null
  /** ⚠️ The QUOTE's service, not the project's. The two can differ. */
  service_id: number | null
  quote_service: string | null
  project_service: string | null
  quote_currency: number | null
  currency_code: string | null
  currency_symbol: string | null
  /** Minor units. */
  local_grand_total: number | null
  term: string | null
  territory: string | null
  media: string[] | null
  mcps_territories: string | null
  scripts: string | null
  duration: string | null
  cutdowns_includedyn: boolean | null
  mcps_track_rate: string | null
  online_worldwide: boolean | null
  song_name: string | null
  artist_name: string | null
  tracks_quoted: number | null
  project_master_list_id: number | null
  brand: string | null
  project_title: string | null
  sequel_no: string | null
  brand_no: string | null
  product: string | null
  client_name: string | null
  username: string | null
  company: string | null
  region: string | null
  music_supervisor: string | null
}

export type QuoteLine = {
  id: number
  quote_id: number
  category: string | null
  section: string | null
  sort_order: number | null
  fee_type: string | null
  fee_description: string | null
  /** Minor units, full precision. */
  cost: number | null
  quantity: number | null
  service_name: string | null
}

export function useQuote(uuid: string | undefined) {
  return useQuery({
    enabled: !!uuid,
    queryKey: ['mirror', 'quote', uuid],
    queryFn: async (): Promise<QuoteDetail | null> => {
      const { data, error } = await mirror
        .from('quote_detail')
        .select('*')
        .eq('uuid', uuid!)
        .maybeSingle()
      if (error) throw error
      return (data as QuoteDetail) ?? null
    },
  })
}

/**
 * The line items, in the order the document groups them: by the fee category's
 * sort order, then supplier costs before the Sequel fee within each section —
 * which is what Xano's `fee_type: "desc"` achieves, since "supplier_cost"
 * sorts after "sequel_fee".
 */
export function useQuoteLines(quoteId: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(quoteId),
    queryKey: ['mirror', 'quote-lines', quoteId],
    queryFn: async (): Promise<QuoteLine[]> => {
      const { data, error } = await mirror
        .from('quote_lines')
        .select('*')
        .eq('quote_id', quoteId!)
      if (error) throw error
      return ((data ?? []) as QuoteLine[]).sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          (b.fee_type ?? '').localeCompare(a.fee_type ?? ''),
      )
    },
  })
}
