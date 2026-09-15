import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Editing an invoice on `/invoice` — the header, the nine fee boxes, the five
 * cost avoidance boxes and the supplier lines.
 *
 * ⚠️ THE RAISE FLOW IS NOT HERE AND IS NOT AN OVERSIGHT. Raising creates a
 * financial record in QuickBooks, and bills cannot be raised automatically at
 * all until the supplier-currency gap is settled: QuickBooks fixes a vendor to
 * one currency permanently, a Bill must be in the vendor's currency, and a line
 * stores the INVOICE's currency. There is no rate and no supplier-side amount
 * to work from.
 *
 * ⚠️ NOTHING HERE COMPUTES A TOTAL. Every write ends in the database's own
 * recompute, and the page shows what comes back. Four separate bugs on the old
 * form came from a screen and a stored value each implementing the same sum
 * slightly differently.
 *
 * ⚠️ NULL MEANS "NOT SUPPLIED". Each of these sends only what changed, and the
 * function falls back to the stored value for everything else. A genuine 0
 * still saves, because 0 is not null — clearing a fee back to zero stays
 * possible.
 *
 * ⚠️ `invoices` and `invoice_line_items` are on the BLOCKED side of the sync,
 * so every edit made here is overwritten on the hour. Expected until cutover.
 */

const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as unknown as SupabaseClient).rpc(name, args)

/** Refetches the invoice and its lines after any write. */
function useInvoiceRefresh(uuid: string | undefined) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['mirror', 'invoice', uuid] })
    void qc.invalidateQueries({ queryKey: ['mirror', 'invoice-lines', uuid] })
  }
}

export type InvoiceHeaderPatch = {
  description?: string | null
  poNumber?: string | null
  songName?: string | null
  artistName?: string | null
  usageTerritories?: string | null
  usageRegion?: string | null
  clientId?: number | null
  currencyId?: number | null
  /** Keyed by stored column name: the nine fee boxes and the five avoidance boxes. */
  fees?: Record<string, number>
}

export function useUpdateInvoice(invoiceId: number | undefined, uuid: string | undefined) {
  const refresh = useInvoiceRefresh(uuid)

  return useMutation({
    mutationFn: async (patch: InvoiceHeaderPatch) => {
      if (invoiceId === undefined) throw new Error('No invoice loaded.')
      const { error } = await rpc('track_update_invoice', {
        p_invoice_id: invoiceId,
        p_description: patch.description ?? null,
        p_po_number: patch.poNumber ?? null,
        p_po_attachment_url: null,
        p_song_name: patch.songName ?? null,
        p_artist_name: patch.artistName ?? null,
        p_usage_territories: patch.usageTerritories ?? null,
        p_usage_region: patch.usageRegion ?? null,
        p_client_id: patch.clientId ?? null,
        p_currency_id: patch.currencyId ?? null,
        p_fees: patch.fees ?? null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: refresh,
  })
}

export function useAddInvoiceLine(invoiceId: number | undefined, uuid: string | undefined) {
  const refresh = useInvoiceRefresh(uuid)

  return useMutation({
    mutationFn: async (category: string) => {
      if (invoiceId === undefined) throw new Error('No invoice loaded.')
      const { error } = await rpc('track_add_invoice_line', {
        p_invoice_id: invoiceId,
        p_category: category,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: refresh,
  })
}

export type LinePatch = {
  lineId: number
  supplierId?: number | null
  amount?: number | null
  category?: string | null
  paythrough?: boolean | null
}

export function useUpdateInvoiceLine(uuid: string | undefined) {
  const refresh = useInvoiceRefresh(uuid)

  return useMutation({
    mutationFn: async (patch: LinePatch) => {
      const { error } = await rpc('track_update_invoice_line', {
        p_line_id: patch.lineId,
        p_supplier_id: patch.supplierId ?? null,
        p_amount: patch.amount ?? null,
        p_category: patch.category ?? null,
        p_is_paythrough: patch.paythrough ?? null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: refresh,
  })
}

export function useDeleteInvoiceLine(uuid: string | undefined) {
  const refresh = useInvoiceRefresh(uuid)

  return useMutation({
    mutationFn: async (lineId: number) => {
      const { error } = await rpc('track_delete_invoice_line', { p_line_id: lineId })
      if (error) throw new Error(error.message)
    },
    onSuccess: refresh,
  })
}

/**
 * The six categories a supplier line can be filed under.
 *
 * ⚠️ An ENUM on table 46, not free text, so an unknown value is refused by the
 * database rather than stored. `Licence` is a leftover from a retracted
 * doctrine and nothing writes it — it is absent here on purpose.
 */
export const LINE_CATEGORIES = [
  'Demos',
  'Searches',
  'Library Master',
  'Publishing',
  'Other Fees',
] as const

/**
 * Archives an invoice: status Archived, never a hard delete (Andy, 4 Sep).
 * Once it is in QuickBooks only finance can — the database refuses anyone
 * else, whatever the page shows (Andy, 15 Sep).
 */
export function useArchiveInvoice(projectId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (invoiceId: number) => {
      const { error } = await rpc('track_archive_invoice', { p_invoice_id: invoiceId })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'invoices', projectId] })
    },
  })
}
