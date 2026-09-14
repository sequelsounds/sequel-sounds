import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mirror } from './xanoMirror'

/**
 * Editing a person — Track's `/view-user`, which edits five fields and no more.
 *
 * The set is Xano's `user_edit` (413), not a guess from the table: that
 * endpoint is staff-only (caller user_type 1 or 2) and takes Name, Company,
 * user_type, status and Notes. Track drives it from five separate Wized
 * requests, one per field, each firing on blur or change — the same
 * save-on-blur shape the supplier pages use.
 *
 * ⚠️ `user` IS STILL IN THE HOURLY SYNC, so every edit made here is overwritten
 * on the hour. That is expected, not a bug to design around: Andy's call
 * (known-issues §1.5) is that nothing leaves the sync one table at a time — the
 * rebuild is built and tested against the mirror with throwaway data and cut
 * over once, at the end. A write feature is finished when it works, not when
 * its table leaves the sync.
 *
 * ⚠️ AND THE ONE THAT MATTERS ON THIS TABLE: changing someone's User Type or
 * Status here changes the DIRECTORY and not their ACCESS. Every gate in the
 * rebuild — `track_is_staff`, `track_is_finance`, `track_is_management`,
 * `track_user_id` — reads `public.track_users`, which is a separate table with
 * its own text `user_type` and `status` columns and nothing keeping it in step:
 * no trigger, no sync function, no shared column. Blocking a person here does
 * not sign them out of the rebuild, and promoting one to Sequel does not let
 * them in. Same shape as the management and finance flags in known-issues §1.3,
 * and unresolved for the same reason. Andy has to decide whether the two should
 * be wired together before this page is trusted to control access.
 *
 * Three things in the database decide who may write, layered because each
 * catches what the others cannot:
 *
 *   - **column grants.** `authenticated` has UPDATE on these five columns only.
 *     `email` is absent because it is the login; so are `phone_number` and
 *     `login_code`, which are the login ID and the one-time passcode, and
 *     `finance_user` and `management`, which no page on either stack offers.
 *   - **`user_staff_update`.** Sequel staff, the same question the read policy
 *     asks. Anyone else matches zero rows rather than getting an error.
 *   - **`user_write_guard`.** Pins identity and the login columns, turns Xano's
 *     zero-means-null on the three integer FKs, and stamps `updated_at` /
 *     `updated_by`. Skipped when `auth.uid()` is null, so the hourly sync
 *     passes through untouched — which it must.
 *
 * Exercised against the live database on 14 Sep and rolled back: a staff update
 * lands one row and stamps `updated_by`; `company = 0` arrives as null; a
 * non-staff caller matches zero rows; `management` is refused at the grant with
 * 42501 before the guard runs; and the sync path writes raw.
 */

/**
 * The columns a form may send — the same five, narrower than the table and
 * exactly the column grants.
 */
export type UserPatch = {
  name?: string | null
  company?: number | null
  user_type?: number | null
  status?: number | null
  notes?: string | null
}

/**
 * What went wrong, in words the person can act on. `42501` is a column-grant
 * refusal, which is not a sentence worth showing as it stands.
 */
function writeError(error: { code?: string; message: string }): Error {
  if (error.code === '42501') return new Error('That field cannot be edited from here.')
  return new Error(error.message)
}

export function useSaveUser(uuid: string | undefined) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: UserPatch }) => {
      const { data, error } = await mirror
        .from('user')
        .update(patch)
        .eq('id', id)
        .select('id')

      if (error) throw writeError(error)

      // RLS refuses an UPDATE by matching no rows, not by erroring. Treating an
      // empty result as "saved, nothing to do" is how a page reports a write
      // that never happened.
      if (!data || data.length === 0) {
        throw new Error('Not saved — this account cannot edit users.')
      }

      return data[0] as { id: number }
    },

    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'user', uuid] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'users'] })
    },
  })
}

export type Option = { id: number; label: string }

/** Sorted the way the other lists are — byte order, not collation. */
function byLabel(a: Option, b: Option) {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}

/**
 * The three pickers on the page.
 *
 * Types and statuses keep their table order rather than alphabetical: both are
 * short id-ordered lists that read as a sequence — Admin, Sequel, Agency,
 * Brand, Freelance, Adpro, Supplier, and Active, Pending, Blocked, Archived —
 * and sorting them by name scrambles that for no gain.
 *
 * ⚠️ Admin and Sequel ARE offered. Track's list page hides staff, but its edit
 * dropdown is the whole of `get_user_types` and a Sequel account can move
 * anyone to either. Kept as it is rather than narrowed, because narrowing it
 * would make the two apps disagree about who can be made staff — and see the
 * access note at the top of this file for why moving someone into Sequel here
 * does not by itself let them in.
 *
 * Companies are the client list, archived dropped, the same filter `/clients`
 * uses.
 */
export function useUserLookups() {
  return useQuery({
    queryKey: ['mirror', 'user-lookups'],
    staleTime: Infinity,
    queryFn: async () => {
      const [types, statuses, companies] = await Promise.all([
        mirror.from('user_types').select('id, user_type'),
        mirror.from('user_statuses').select('id, status'),
        mirror.from('clients').select('id, company, status'),
      ])

      const failed = [types, statuses, companies].find((r) => r.error)
      if (failed?.error) throw failed.error

      const rows = <T,>(r: { data: unknown }) => (r.data ?? []) as T[]

      return {
        userTypes: rows<{ id: number; user_type: string | null }>(types)
          .sort((a, b) => a.id - b.id)
          .map((r) => ({ id: r.id, label: r.user_type ?? '' })),
        statuses: rows<{ id: number; status: string | null }>(statuses)
          .sort((a, b) => a.id - b.id)
          .map((r) => ({ id: r.id, label: r.status ?? '' })),
        companies: rows<{ id: number; company: string | null; status: string | null }>(companies)
          .filter((r) => r.status !== 'Archived')
          .map((r) => ({ id: r.id, label: r.company ?? '' }))
          .sort(byLabel),
      }
    },
  })
}
