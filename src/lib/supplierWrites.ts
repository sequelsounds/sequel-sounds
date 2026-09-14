import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mirror } from './xanoMirror'

/**
 * Editing a supplier — the first thing in the rebuild that writes.
 *
 * `supplier_list` came out of Xano's `sync_xano_mirror` task on 13 September
 * 2026 (it was block 18 of 47), so this one table is no longer a replica of
 * anything: Supabase is the original for it, and what is written here stays
 * written. That is the whole reason writing to it is safe. While a table is
 * still in that task, an hourly full push puts every edit back and DELETES
 * anything created, so the order is always: take the table out of the sync
 * first, then build its writes.
 *
 * ⚠️ THE TWO COPIES DIVERGE FROM THAT DATE, in both directions and silently.
 * An edit made on Track's `/partner-edit` or `/roster-edit` lands in Xano and
 * never arrives here; an edit made here never reaches Xano. Track's two
 * supplier edit pages are retired in practice. Nothing downstream reads
 * Supplier List out of Xano — no QuickBooks, BoldSign or Coda path touches it,
 * which is exactly why suppliers went first — with one thing to keep an eye
 * on: `qbo_vendor_id` lives on this table and the invoice flow reads the
 * QuickBooks mapping from Xano. See `qbo_vendor_id` below.
 *
 * Reads come off the `partner_detail` and `roster_list` VIEWS; writes go to
 * the base table by `id`, because a view over a join is not updatable. So
 * every call here needs both: the id addresses the row, the uuid names the
 * cache entry to refresh.
 *
 * Nothing in this file decides who may write. Three things in the database do,
 * and they are layered because each catches what the others cannot:
 *
 *   - **column grants.** `authenticated` has UPDATE on the editable columns
 *     only, so `id` and `uuid` cannot be moved however the request is built.
 *   - **`supplier_list_staff_update`.** Sequel staff, the same question the
 *     read policy asks. A client user gets no rows rather than an error.
 *   - **`supplier_list_write_guard`.** `qbo_vendor_id`, `default_currency_id`
 *     and `revolut_counterparty_id` need finance. RLS cannot express that: a
 *     policy decides whether a ROW may be updated, not which of its columns
 *     changed.
 *
 * A refusal therefore comes back as an error or as zero rows, never as a
 * silent success, and `useSaveSupplier` turns both into something the person
 * can read.
 */

/**
 * The columns a form may send.
 *
 * Deliberately narrower than the table and narrower than the column grants:
 * the grants are the security boundary, this is the list the UI actually has
 * controls for. The three finance-gated columns are absent because nothing
 * edits them yet — see the note in `Partner.tsx` about the QuickBooks picker.
 */
export type SupplierPatch = {
  title?: string | null
  bio?: string | null
  strengths?: string | null
  brief_email?: string | null
  phone_number?: string | null
  website?: string | null
  city?: string | null
  countries_list_id?: number | null
  creative_team_member_1_name?: string | null
  creative_team_member_1_email?: string | null
  creative_team_member_2_name?: string | null
  creative_team_member_2_email?: string | null
  creative_team_member_3_name?: string | null
  creative_team_member_3_email?: string | null
  clearance_contact_name_1?: string | null
  clearance_contact_email_1?: string | null
  clearance_contact_name_2?: string | null
  clearance_contact_email_2?: string | null
  finance_email?: string | null
  composition_showreel?: string | null
  sounddesign_showreel?: string | null
  final_mix_showreel?: string | null
  library_link?: string | null
  studio_setup?: string | null
  stand_out_work?: string | null
}

/**
 * What went wrong, in words the person can act on.
 *
 * PostgREST hands back Postgres' own code and message. `42501` is the one that
 * matters here and arrives from two different places — the write guard's own
 * `raise`, which is already a sentence worth showing, and a plain column-grant
 * refusal, which is not. Telling them apart by whether the message reads like
 * English would be guesswork; the guard's text is matched on instead.
 */
function writeError(error: { code?: string; message: string }): Error {
  if (error.code === '42501') {
    return error.message.includes('finance access')
      ? new Error(error.message)
      : new Error('That column cannot be edited from here.')
  }
  return new Error(error.message)
}

export function useSaveSupplier(uuid: string | undefined) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: SupplierPatch }) => {
      const { data, error } = await mirror
        .from('supplier_list')
        .update(patch)
        .eq('id', id)
        .select('id')

      if (error) throw writeError(error)

      // RLS refuses an UPDATE by matching no rows, not by erroring — so an
      // empty result is a refusal, and treating it as "saved, nothing to do"
      // is how a page ends up reporting a write that never happened.
      if (!data || data.length === 0) {
        throw new Error('Not saved — this account cannot edit suppliers.')
      }

      return data[0] as { id: number }
    },

    // Both detail views and both lists: the same row is a partner or a roster
    // member depending on which page is open, and its title shows on the list
    // behind it.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'partner', uuid] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'roster-member', uuid] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'partners'] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'roster'] })
    },
  })
}

export type Country = { id: number; country: string | null }

/**
 * The country picker's options — 195 rows that effectively never change, so
 * they are fetched once and kept.
 *
 * Sorted with a plain `<` rather than PostgREST's `.order()`, for the reason
 * the lists elsewhere are: Postgres orders by the column's collation and Xano
 * orders by byte, and the two disagree on anything capitalised.
 */
export function useCountries() {
  return useQuery({
    queryKey: ['mirror', 'countries'],
    staleTime: Infinity,
    queryFn: async (): Promise<Country[]> => {
      const { data, error } = await mirror.from('countries_list').select('id, country')
      if (error) throw error
      return ((data ?? []) as Country[]).sort((a, b) =>
        (a.country ?? '') < (b.country ?? '') ? -1 : (a.country ?? '') > (b.country ?? '') ? 1 : 0,
      )
    },
  })
}
