import { useQuery } from '@tanstack/react-query'
import { mirror } from './xanoMirror'
import { callQuickBooks } from './quickbooks'

/** One row of the Finance page's client invoices list. */
export type FinanceInvoice = {
  id: number
  uuid: string | null
  invoice_number: string | null
  status: string | null
  description: string | null
  invoice_date: string | null
  due_date: string | null
  created_at: string | null
  qbo_invoice_id: string | null
  locked: boolean | null
  project_title: string | null
  project_sequel_no: string | null
  client_name: string | null
  currency: string | null
  total_to_invoice: number | null
}

/**
 * Every invoice but the archived ones, newest first — the same rule the
 * project page's list follows. Written as an OR so a row with no status still
 * shows (mirror trap 4).
 */
export function useAllInvoices() {
  return useQuery({
    queryKey: ['mirror', 'all-invoices'],
    queryFn: async (): Promise<FinanceInvoice[]> => {
      const { data, error } = await mirror
        .from('invoice_detail')
        .select(
          'id, uuid, invoice_number, status, description, invoice_date, due_date, created_at, qbo_invoice_id, locked, project_title, project_sequel_no, client_name, currency, total_to_invoice',
        )
        .or('status.is.null,status.neq.Archived')
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as FinanceInvoice[]
    },
  })
}

export type PaymentTime = {
  id: string
  name: string
  paid_invoices: number
  open_invoices: number
  avg_days_to_pay: number | null
  avg_days_late: number | null
}

export type PaymentTimes = {
  connected: boolean
  error?: string
  clients?: PaymentTime[]
  overall?: Omit<PaymentTime, 'id' | 'name'>
}

/**
 * How long each client takes to pay, worked out from QuickBooks' own payments
 * (see `paymentTimes` in the `quickbooks` edge function). Finance only.
 */
export function usePaymentTimes(enabled: boolean) {
  return useQuery({
    queryKey: ['qbo', 'payment-times'],
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => callQuickBooks<PaymentTimes>({ action: 'payment_times' }),
  })
}

/** The four places an invoice can sit on this page. */
export type Stage = 'To raise' | 'Awaiting payment' | 'Overdue' | 'Paid'

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Where an invoice sits.
 *
 *  - not in QuickBooks yet → To raise (Submitted, Returned, Failed, blank)
 *  - Paid → Paid
 *  - in QuickBooks, unpaid, and past its due date, or marked Overdue → Overdue
 *  - anything else in QuickBooks → Awaiting payment
 *
 * Overdue is worked out from the due date rather than trusted from the
 * status, as the lifecycle doc says: nothing sets Overdue in the old app until
 * someone runs the payment sync by hand.
 */
export function stageOf(i: FinanceInvoice): Stage {
  if (!i.qbo_invoice_id) return 'To raise'
  if (i.status === 'Paid') return 'Paid'
  if (i.status === 'Overdue' || (i.due_date && i.due_date < today())) return 'Overdue'
  return 'Awaiting payment'
}

export type QboBill = {
  id: string
  doc_number: string | null
  txn_date: string | null
  due_date: string | null
  vendor_id: string | null
  vendor_name: string
  currency: string | null
  total: number
  balance: number
  has_supplier_invoice: boolean
}

/** Every supplier bill in QuickBooks. Finance only. */
export function useQboBills(enabled: boolean) {
  return useQuery({
    queryKey: ['qbo', 'bills'],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => callQuickBooks<{ connected: boolean; error?: string; bills?: QboBill[] }>({ action: 'bills' }),
  })
}

/**
 * Which of our invoices each bill belongs to, where the app raised it: the
 * old app's raise writes the bill id onto the invoice's lines. Bills from
 * before 8 Sep carry no link and show without one.
 */
export function useBillLinks() {
  return useQuery({
    queryKey: ['mirror', 'bill-links'],
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await mirror
        .from('invoice_line_items')
        .select('invoice_id, qbo_bill_id')
        .not('qbo_bill_id', 'is', null)
        .neq('qbo_bill_id', '')
      if (error) throw error
      const map = new Map<string, number>()
      for (const r of (data ?? []) as { invoice_id: number | null; qbo_bill_id: string }[]) {
        if (r.invoice_id != null) map.set(String(r.qbo_bill_id), r.invoice_id)
      }
      return map
    },
  })
}

export type BillStage = 'Paid' | 'Overdue' | 'Unpaid'

export function billStageOf(b: QboBill): BillStage {
  if (b.balance <= 0) return 'Paid'
  if (b.due_date && b.due_date < today()) return 'Overdue'
  return 'Unpaid'
}

export type QboOrphan = {
  id: string
  doc_number: string | null
  txn_date: string | null
  customer: string
  currency: string | null
  total: number
}

/**
 * QuickBooks invoices the app has no record of — the failed-raise check.
 * A raise that created the invoice and then failed to record it leaves one of
 * these, and raising it again would bill the client twice. Finance only.
 */
export function useQboOrphans(enabled: boolean) {
  return useQuery({
    queryKey: ['qbo', 'orphans'],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => callQuickBooks<{ connected: boolean; error?: string; orphans?: QboOrphan[] }>({ action: 'orphans' }),
  })
}
