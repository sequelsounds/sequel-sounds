import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mirror } from './xanoMirror'
import { supabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Editing and creating a project.
 *
 * ⚠️ READ THIS BEFORE TRUSTING ANYTHING THIS FILE WRITES.
 *
 * `project_master_list` is STILL IN Xano's `sync_xano_mirror` task 42 at the
 * time of writing. While it is, an hourly full push puts every edit back and
 * DELETES every project created here. Suppliers went first precisely because
 * they could leave the sync; projects cannot leave it until creation works on
 * this side, which is what this file is for. The order is:
 *
 *   1. build creation and editing (here)
 *   2. take the two `project_master_list` blocks out of task 42
 *   3. from that moment Supabase is the original for projects
 *
 * Until step 2 is done this is testable, not usable. After step 2 the two
 * copies diverge silently in both directions, and anything still creating
 * projects in Xano — Coda, the Webflow form — stops reaching Track.
 *
 * Nothing here decides who may write. Four things in the database do:
 *
 *   - **column grants.** `authenticated` has INSERT/UPDATE on the editable
 *     columns only, so `id`, `uuid`, `sequel_no` and `created_at` cannot be
 *     moved however the request is built.
 *   - **`project_master_list_staff_insert` / `_staff_update`.** Sequel staff.
 *     A client user gets zero rows rather than an error.
 *   - **`project_master_list_create_guard`.** Allocates the Sequel No. under an
 *     advisory lock, and refuses a project missing any of its nine required
 *     fields.
 *   - **`project_master_list_update_guard`.** Puts identity columns back to
 *     what they were, and refuses to leave a project without those nine.
 *
 * All four are skipped when `auth.uid()` is null, so the hourly sync keeps
 * writing unchanged while the table is still in it.
 *
 * A fifth trigger, `project_master_list_studio_record`, gives a project created
 * here the `public.projects_mirror` row that music, briefs and file uploads
 * attach to. Without it a Track-made project can take no uploads at all: that
 * table is fed by the Xano webhook and knows nothing about projects that never
 * existed in Xano.
 */

/**
 * The columns a form may send.
 *
 * Narrower than the column grants on purpose: the grants are the security
 * boundary, this is the list the UI actually has controls for.
 */
export type ProjectPatch = {
  title?: string | null
  brand?: string | null
  product?: string | null
  campaignname?: string | null
  project_type?: string | null
  country?: string | null
  brand_no?: string | null
  cutdowns?: boolean | null
  extension_yn?: boolean | null
  client?: number | null
  client_agency?: number | null
  brand_category?: number | null
  music_supervisor?: number | null
  services_id?: number | null
  client_user_id?: number | null
  adpro_user?: number | null
  projects_status?: number | null
  pipeline_gbp?: number | null
  proposed_start_date?: string | null
  concept?: string | null
  notes?: string | null
  notesorrequest?: string | null
  term?: string | null
  territory?: string | null
  media?: string | null
  scripts?: string | null
  durations?: string | null
}

/**
 * What went wrong, in words the person can act on.
 *
 * `23514` is the guards' own `raise` — "missing product, campaign name" or
 * "cannot be left without its title" — and those are already sentences worth
 * showing. `42501` from a column grant is not.
 */
function writeError(error: { code?: string; message: string }): Error {
  if (error.code === '23514') return new Error(error.message)
  if (error.code === '42501') return new Error('That field cannot be edited from here.')
  return new Error(error.message)
}

export function useSaveProject(id: number | undefined) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (patch: ProjectPatch) => {
      const { data, error } = await mirror
        .from('project_master_list')
        .update(patch)
        .eq('id', id!)
        .select('id')

      if (error) throw writeError(error)

      // RLS refuses an UPDATE by matching no rows, not by erroring. Treating an
      // empty result as "saved, nothing to do" is how a page reports a write
      // that never happened.
      if (!data || data.length === 0) {
        throw new Error('Not saved — this account cannot edit projects.')
      }

      return data[0] as { id: number }
    },

    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'project', id] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'projects'] })
    },
  })
}

/**
 * What creating a project needs — Track's New Project wizard, step for step.
 *
 * ⚠️ NOT what the existing projects happen to have filled in. Product, campaign
 * name and country are on 183 of the 183 projects with a 2026 Sequel No. and
 * the wizard asks for none of them; they get filled in afterwards, on the
 * project page. A required set derived from the data instead of from the form
 * would refuse a project created the way Track creates one.
 *
 * The supervisor is absent because Track does not ask: Xano writes it as the
 * caller, and the create guard now does the same.
 *
 * Client Job No is the one optional field — the one question on the wizard
 * without an asterisk, and the one key its `is_form_complete` exempts.
 */
export type NewProjectInput = {
  client_user_id: number
  brand: string
  title: string
  client_agency: number
  brand_no?: string | null
  services_id: number
  pipeline_gbp: number
  client: number
  adpro_user: number
  brand_category: number
}

/**
 * Creating a project.
 *
 * The Sequel No. is NOT sent. It is allocated by the database — the next
 * counter, the first three letters of the brand, the year, and `II` — so two
 * people creating at once cannot land on the same number, and nobody can pick
 * their own.
 *
 * ⚠️ Campaign name is deliberately left blank. Xano's POST writes the literal
 * string "CampaignName" into every project it creates, which is a bug rather
 * than a default — it puts a fake value where a blank belongs, and a blank is
 * what tells the project page there is something to fill in. Not copied.
 *
 * This inserts with ids rather than going through `public.track_create_project`,
 * which takes names: the wizard already holds the ids, and the RPC exists for
 * callers that only have words. Both land on the same policy and the same guard.
 */
export function useCreateProject() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: NewProjectInput) => {
      const { data, error } = await mirror
        .from('project_master_list')
        .insert(input)
        .select('id, sequel_no')
        .single()

      if (error) throw writeError(error)
      return data as { id: number; sequel_no: string | null }
    },

    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'projects'] })
    },
  })
}

/**
 * Delete on a /projects row. It archives, as the old app's archive_project
 * does; the project's quotes, invoices, contracts, assets and songs stay.
 * `track_archive_project` (0080) also stops the hourly sync un-archiving it.
 */
export function useArchiveProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (projectId: number) => {
      const { error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_archive_project',
        { p_project_id: projectId },
      )
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'projects'] })
    },
  })
}

/**
 * The only three values the `project_type` COLUMN has ever held.
 *
 * ⚠️ Not what Track's wizard means by "Project Type?" — step 6 of that writes
 * `services_id` (Composition, Commercial, Library…) and never touches this
 * column. The same three words name two different fields in Track; see the
 * note on the wizard's step 6.
 */
export const PROJECT_TYPES = ['Advert', 'Film', 'Social post'] as const

export type Option = { id: number; label: string }

/** Sorted the way the supplier lists are — byte order, not collation. */
function byLabel(a: Option, b: Option) {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}

/**
 * The four short lookup lists behind the pickers. Two client groups, three
 * brand categories, six services and seven selectable stages — they change
 * about once a year, so they are fetched once and kept.
 *
 * `Archived.` is not offered. It is the eighth status option, it is marked
 * unselectable in Xano, and the trailing full stop is its real name.
 */
export function useProjectLookups() {
  return useQuery({
    queryKey: ['mirror', 'project-lookups'],
    staleTime: Infinity,
    queryFn: async () => {
      const [groups, categories, services, statuses, agencies, countries] = await Promise.all([
        mirror.from('client_groups').select('id, client'),
        mirror.from('brand_category').select('id, category'),
        mirror.from('services').select('id, service'),
        mirror.from('projects_status_options').select('id, status, sort_order, selectable'),
        mirror.from('clients').select('id, company, status, country'),
        mirror.from('countries_list').select('id, country'),
      ])

      const failed = [groups, categories, services, statuses, agencies, countries].find(
        (r) => r.error,
      )
      if (failed?.error) throw failed.error

      const rows = <T,>(r: { data: unknown }) => (r.data ?? []) as T[]

      return {
        clientGroups: rows<{ id: number; client: string | null }>(groups)
          .map((r) => ({ id: r.id, label: r.client ?? '' }))
          .sort(byLabel),
        brandCategories: rows<{ id: number; category: string | null }>(categories)
          .map((r) => ({ id: r.id, label: r.category ?? '' }))
          .sort(byLabel),
        services: rows<{ id: number; service: string | null }>(services)
          .map((r) => ({ id: r.id, label: r.service ?? '' }))
          .sort(byLabel),
        // Stages keep Xano's own order — New, Quoting, Creative … — because
        // that order is the pipeline, and alphabetical would scramble it.
        stages: rows<{ id: number; status: string | null; sort_order: number | null; selectable: boolean | null }>(
          statuses,
        )
          .filter((r) => r.selectable)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((r) => ({ id: r.id, label: r.status ?? '' })),
        agencies: rows<{ id: number; company: string | null; status: string | null }>(agencies)
          .filter((r) => r.status !== 'Archived')
          .map((r) => ({ id: r.id, label: r.company ?? '' }))
          .sort(byLabel),
        // Track's agency search shows the company over its country. Kept as a
        // lookup rather than a wider Option, so the picker stays one shape.
        //
        // ⚠️ `clients.country` is an FK to `countries_list`, not a name. Showing
        // it raw put "93" under Edelman Milan.
        agencyCountries: (() => {
          const names = new Map(
            rows<{ id: number; country: string | null }>(countries).map((c) => [c.id, c.country ?? '']),
          )
          return Object.fromEntries(
            rows<{ id: number; country: number | null }>(agencies).map((r) => [
              r.id,
              r.country == null ? '' : (names.get(r.country) ?? ''),
            ]),
          ) as Record<number, string>
        })(),
      }
    },
  })
}

/**
 * The three pools of people a project points at, which are three different
 * groups and not one list of users:
 *
 *   - **supervisor** is Sequel's own — types 1 and 2, and every one of the 228
 *     projects with a supervisor uses one of those
 *   - **ad producer** is type 6, on all 222 projects that have one
 *   - **client user** is the agency, brand or freelance contact — types 3, 4
 *     and 5
 *
 * Archived people are kept and marked rather than dropped: two archived agency
 * users are still on live projects, and a picker that cannot show the value it
 * holds looks like an empty field somebody should fill in.
 */
const SEQUEL = [1, 2]
const ADPRO = [6]
const CLIENT_SIDE = [3, 4, 5]
const ARCHIVED = 4

export function useProjectPeople() {
  return useQuery({
    queryKey: ['mirror', 'project-people'],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await mirror
        .from('user')
        .select('id, name, email, user_type, status')
      if (error) throw error

      type Row = {
        id: number
        name: string | null
        email: string | null
        user_type: number | null
        status: number | null
      }

      const pool = (types: number[]) =>
        ((data ?? []) as Row[])
          .filter((u) => u.user_type != null && types.includes(u.user_type))
          .map((u) => ({
            id: u.id,
            label:
              (u.name?.trim() || u.email?.trim() || `#${u.id}`) +
              (u.status === ARCHIVED ? ' (archived)' : ''),
          }))
          .sort(byLabel)

      return {
        supervisors: pool(SEQUEL),
        adpros: pool(ADPRO),
        clientUsers: pool(CLIENT_SIDE),
        // Track's user search shows the name over the email address.
        emails: Object.fromEntries(
          ((data ?? []) as Row[]).map((u) => [u.id, u.email ?? '']),
        ) as Record<number, string>,
      }
    },
  })
}

/** The client-side user types a project can be for (CLIENT_SIDE, by name). */
export const CLIENT_USER_TYPES = ['Agency', 'Brand', 'Freelance'] as const

export type NewClientUser = {
  name: string
  email: string
  /** The client's company name, exactly as the agencies picker shows it. */
  company: string
  user_type: (typeof CLIENT_USER_TYPES)[number]
}

/**
 * "Add new user" from the New Project wizard's first step (Andy, 25 Sep 2026).
 * Goes through `track_create_user` (0065), which checks the email is unique,
 * resolves the company by name and gives the person their `track_users` row.
 * Created Active, so they can sign in to see the project.
 *
 * Waits for the people list to reload before returning, so the wizard can pick
 * the new person straight away and the search box shows their name.
 */
export function useCreateClientUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (u: NewClientUser) => {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_create_user',
        {
          p_name: u.name.trim(),
          p_email: u.email.trim(),
          p_company: u.company,
          p_user_type: u.user_type,
          p_status: 'Active',
        },
      )
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as { id: number; uuid: string } | null
      if (!row) throw new Error('Not saved: the database returned no user.')
      await qc.invalidateQueries({ queryKey: ['mirror', 'project-people'] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'users'] })
      return row
    },
  })
}
