import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mirror } from './xanoMirror'
import { supabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  supplier_type?: string | null
  briefing_list?: string | null
  ca_status?: string | null
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

/**
 * The three enums on `Supplier List`, read from the Xano table schema (table
 * 45) rather than from the endpoint.
 *
 * ⚠️ THE TABLE IS AUTHORITATIVE, NOT THE ENDPOINT. `Patch_supplier`'s own input
 * definitions had drifted from the column on all three of these: it declared
 * Music Supervisor / Record Label / Music Publisher / Music Library / Other for
 * the type, Standard / High-End / Bespoke for the briefing list, and
 * Pending / Approved / Rejected for the CA status. Every real value would have
 * failed input validation before reaching the database, and it never surfaced
 * because no page exposed those three fields. They were corrected on 23 August;
 * the lists below are the columns as they stand.
 *
 * ⚠️ There are TEN supplier types, not the nine the August note counts —
 * `Partner Library` was added the same day and the count was not updated.
 */
export const SUPPLIER_TYPES = [
  'Agent',
  'Manager',
  'Publisher',
  'Label',
  'MCPS Library',
  'Non-MCPS Library',
  'Sync Rep',
  'Composition Team',
  'Partner Library',
  'Musicologist',
] as const

/**
 * ⚠️ `Composition Team` is what splits the two pages: `/roster` is exactly the
 * composition teams and `/partners` is exactly everything else. Changing a
 * supplier's type to or from it MOVES THE RECORD between the two lists, which
 * is correct and still surprising the first time it happens.
 */
export const COMPOSITION_TEAM = 'Composition Team'

export const BRIEFING_LISTS = ['UK', 'Argentina', 'Singapore', 'Global', 'North America'] as const

/** Composer agreement status. A blank reads as Not Sent on about 55 rows. */
export const CA_STATUSES = ['Not Sent', 'Pending', 'Complete', 'NA'] as const

/**
 * Creating a supplier.
 *
 * There has never been a way to do this on either stack — Xano's supplier group
 * is four reads and one patch, and Track has no create form. Row 111 was made
 * by hand in the Xano table as a result, and made without a uuid, which makes
 * it unreachable from every edit page in both apps.
 *
 * Three things in the database make this safe rather than a second row 111:
 *
 *   - `uuid` now defaults to `gen_random_uuid()`, so a supplier cannot be
 *     created without one by ANY route, including a hand-typed row
 *   - `id` now comes from a sequence starting at 1000, clear of every id Xano
 *     ever issued, so a new supplier cannot collide with a historic one
 *   - the three FK columns no longer default to `0`. Xano uses 0 for an unset
 *     integer FK; this table has real foreign keys and no lookup row is 0, so
 *     that default made every insert fail until it was dropped
 *
 * Only the name and the type are asked for. Everything else on the record is
 * editable the moment the page opens, so a create form that asked for twenty
 * fields would be a worse version of the page it hands you to.
 */
export function useCreateSupplier() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ title, supplierType }: { title: string; supplierType: string }) => {
      const { data, error } = await mirror
        .from('supplier_list')
        .insert({ title, supplier_type: supplierType })
        .select('id, uuid')
        .single()

      if (error) throw writeError(error)
      const row = data as { id: number; uuid: string | null }
      // The default should make this impossible. If it ever happens the record
      // is unreachable by URL, which is worth saying out loud rather than
      // navigating to `/partners/null`.
      if (!row?.uuid) throw new Error('The supplier was created but has no link. Tell Andy.')
      return row
    },

    onSuccess: () => {
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

/**
 * Archives a supplier: status Archived, never deleted (Andy, 15 Sep). It leaves
 * the Partners and Roster lists and the pickers; its page still opens.
 */
export function useArchiveSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (supplierId: number) => {
      const { error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_archive_supplier',
        { p_supplier_id: supplierId },
      )
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'partners'] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'roster'] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'invoice-lookups'] })
    },
  })
}
