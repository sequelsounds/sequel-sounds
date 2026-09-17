import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mirror } from './xanoMirror'
import { supabase } from './supabase'

/**
 * The new app's QuickBooks connection — finance only.
 *
 * Everything goes through the `quickbooks` edge function, which holds the
 * connection for the Intuit app "Sequel App New". That is a separate
 * connection from the old app's, on purpose: Intuit rotates the refresh token,
 * and two systems refreshing one connection knock each other out. See
 * migration 0025.
 */

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export async function callQuickBooks<T>(body: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const res = await fetch(`${FUNCTIONS_URL}/quickbooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(payload?.error ?? `QuickBooks failed (${res.status}).`)
  return payload as T
}

export type QboAddress = Partial<
  Record<
    'Line1' | 'Line2' | 'Line3' | 'Line4' | 'Line5' | 'City' | 'CountrySubDivisionCode' | 'PostalCode' | 'Country',
    string
  >
>

export type QboVendor = {
  id: string
  name: string
  currency: string | null
  address: QboAddress | null
}

export type QboVendors = { connected: boolean; vendors?: QboVendor[]; error?: string }

/**
 * The live vendor list. Only ever asked for by finance — the function refuses
 * everyone else, so asking would only produce an error.
 */
export function useQboVendors(enabled: boolean) {
  return useQuery({
    queryKey: ['qbo', 'vendors'],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => callQuickBooks<QboVendors>({ action: 'vendors' }),
  })
}

/**
 * Starts the Intuit consent flow and comes back to this page afterwards.
 * `sandbox` connects Intuit's test company instead of Sequel's books — the
 * company raises go to until the switch-over.
 */
export async function connectQuickBooks(environment: 'production' | 'sandbox' = 'production') {
  const { url } = await callQuickBooks<{ url: string }>({
    action: 'connect',
    environment,
    return_to: window.location.href,
  })
  window.location.assign(url)
}

/**
 * Removes the connection: revoked at Intuit, then deleted here. Only the new
 * app's Intuit app ("Sequel App New") is affected — the old app's connection
 * is a different grant.
 */
export function useDisconnectQuickBooks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callQuickBooks<{ ok: boolean; revoked: boolean }>({ action: 'disconnect' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['qbo', 'vendors'] })
    },
  })
}

/**
 * "Name — CURRENCY", the old app's label. The currency is not decoration:
 * QuickBooks ties a vendor to one currency, so the same supplier can exist
 * twice — "Audio Network GBP" and "Audio Network Milan" — and a bill sent to
 * the wrong one goes to the wrong entity.
 */
export function vendorLabel(v: QboVendor) {
  return v.currency ? `${v.name} — ${v.currency}` : v.name
}

/**
 * Both address shapes, as the old app reads them. Intuit fills City,
 * CountrySubDivisionCode and PostalCode only when the address was typed into
 * its structured fields; a free-text address puts the town and postcode in
 * Line4 or Line5 instead. Reading only one shape drops half an address and
 * still looks complete.
 */
export function addressLines(a: QboAddress | null): string[] {
  if (!a) return []
  return [a.Line1, a.Line2, a.Line3, a.Line4, a.Line5, a.City, a.CountrySubDivisionCode, a.PostalCode, a.Country].filter(
    (x): x is string => !!x,
  )
}

/**
 * Links a supplier to a vendor — the vendor id AND its currency, as the old
 * app's `Supplier_qbo_vendor_update` does. A Bill must be in the vendor's
 * currency, so the supplier has to carry the same one.
 *
 * The currency table stores the euro as "EURO" while Intuit sends "EUR", so
 * the first three letters are compared, as in the old app. No match clears the
 * currency rather than leaving a stale one beside a new vendor (the old app
 * writes 0 for that; the mirror's unset is null).
 *
 * ⚠️ Only finance can do this and the database says so, not this code:
 * `supplier_list_write_guard` refuses both columns to anyone else.
 */
export function useLinkQboVendor(uuid: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ supplierId, vendor }: { supplierId: number; vendor: QboVendor }) => {
      const code = (vendor.currency ?? '').toUpperCase().trim().slice(0, 3)
      let currencyId: number | null = null
      if (code) {
        const { data: currencies, error: cErr } = await mirror.from('currencies_bank_accounts').select('id, currency')
        if (cErr) throw cErr
        const match = ((currencies ?? []) as { id: number; currency: string | null }[]).find(
          (c) => (c.currency ?? '').toUpperCase().slice(0, 3) === code,
        )
        currencyId = match?.id ?? null
      }

      const { data, error } = await mirror
        .from('supplier_list')
        .update({ qbo_vendor_id: vendor.id, default_currency_id: currencyId })
        .eq('id', supplierId)
        .select('id')
      if (error) {
        throw new Error(
          error.code === '42501' ? 'Only finance can link a QuickBooks vendor.' : error.message,
        )
      }
      if (!data || data.length === 0) throw new Error('Not saved — this account cannot edit suppliers.')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'partner', uuid] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'roster-member', uuid] })
    },
  })
}

// ── Raising an invoice ─────────────────────────────────────────────────────
// The old app's check_invoice_ready / raise_invoice / retry_invoice_bills,
// through the `quickbooks` function (see its raise.ts). Finance only.

export type RaiseCheck = {
  connected: boolean
  error?: string
  environment?: 'production' | 'sandbox'
  ok?: boolean
  problems?: string[]
  summary?: {
    client_name: string
    currency_code: string
    total_to_invoice: number
    line_count: number
    bills_to_create: number
    converted_bills: number
  }
}

export type BillResult = {
  supplier: string
  currency: string
  total: number
  ok: boolean
  qbo_bill_id: string
  detail: string
  qbo_error: string | null
}

export type RaiseResult = {
  connected: boolean
  error?: string
  raised?: boolean
  message?: string
  problems?: string[]
  created_not_recorded?: boolean
  recovered?: boolean
  environment?: 'production' | 'sandbox'
  app_url?: string
  qbo_invoice_id?: string
  invoice_number?: string
  po_attached?: boolean
  attach_detail?: string
  bills_created?: number
  bills_failed?: number
  bills_skipped?: { line_id: number; supplier: string; reason: string }[]
  bill_results?: BillResult[]
}

export type RetryBillsResult = {
  connected: boolean
  error?: string
  ok?: boolean
  message?: string
  app_url?: string
  bills_created?: number
  bills_failed?: number
  bills_skipped?: { line_id: number; supplier: string; reason: string }[]
  bill_results?: BillResult[]
}

export const raiseCheck = (uuid: string) => callQuickBooks<RaiseCheck>({ action: 'raise_check', uuid })

export function useRaiseInvoice(uuid: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callQuickBooks<RaiseResult>({ action: 'raise', uuid }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'invoice', uuid] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'invoice-lines', uuid] })
    },
  })
}

export function useRetryBills(uuid: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callQuickBooks<RetryBillsResult>({ action: 'retry_bills', uuid }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'invoice-lines', uuid] })
    },
  })
}
