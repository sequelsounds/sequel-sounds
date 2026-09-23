import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * Supplier invoice uploads against QuickBooks bills. Everything goes through
 * the quickbooks edge function (supplier-invoice.ts there).
 *
 * The page is PUBLIC: a supplier opens it with nothing but the token in the
 * link. Signed-in staff get more back from the same call (the AI check, the
 * file, finance's buttons), decided by the function from the session.
 */

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string
  const res = await fetch(`${FUNCTIONS_URL}/quickbooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${data.session?.access_token ?? key}`,
    },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(payload?.error ?? `That did not work (${res.status}).`)
  return payload as T
}

export type UploadStatus = 'waiting' | 'review' | 'attached' | 'rejected' | 'failed' | 'received'

export type CheckItem = { key: string; label: string; expected: string; found: string; ok: boolean; required: boolean }

export type BillUploadPage = {
  vendor_name: string
  currency: string | null
  total: number | null
  invoice_number: string | null
  project_sequel_no: string | null
  status: UploadStatus
  file_name: string | null
  uploaded_at: string | null
  // staff only
  staff?: boolean
  finance?: boolean
  bill_id?: string
  project_id?: number | null
  ai_check?: { pass: boolean; items: CheckItem[] } | null
  uploader_note?: string | null
  error?: string | null
  file_url?: string | null
}

/**
 * DEV ONLY: /bill-upload/demo (what a supplier sees) and /bill-upload/demo-review
 * (what finance sees when the check found a difference), with made-up data and
 * no network, so the page can be looked at before anything is deployed.
 */
const DEMO: Record<string, BillUploadPage> = {
  demo: {
    vendor_name: 'Overcoast',
    currency: 'USD',
    total: 1174.3,
    invoice_number: '1094',
    project_sequel_no: '161-VAS-26-II',
    status: 'waiting',
    file_name: null,
    uploaded_at: null,
  },
  'demo-review': {
    vendor_name: 'Overcoast',
    currency: 'USD',
    total: 1174.3,
    invoice_number: '1094',
    project_sequel_no: '161-VAS-26-II',
    status: 'review',
    file_name: 'OC-2231.pdf',
    uploaded_at: new Date().toISOString(),
    staff: true,
    finance: true,
    bill_id: '0',
    file_url: null,
    ai_check: {
      pass: false,
      items: [
        { key: 'is_invoice', label: 'An invoice', expected: 'An invoice asking to be paid', found: 'Yes', ok: true, required: true },
        { key: 'supplier', label: 'Supplier', expected: 'Overcoast', found: 'Overcoast Music Ltd', ok: true, required: true },
        { key: 'currency', label: 'Currency', expected: 'USD', found: 'USD', ok: true, required: true },
        { key: 'total', label: 'Total', expected: 'USD 1,174.30', found: 'USD 1,274.30', ok: false, required: true },
        { key: 'addressed', label: 'Addressed to Sequel', expected: 'Sequel Sounds / TBPB Ltd', found: 'TBPB Ltd', ok: true, required: false },
        { key: 'reference', label: 'PO or job number on it', expected: '1094 or 161-VAS-26-II', found: 'PO 1094', ok: true, required: false },
      ],
    },
  },
}

export function useBillUploadPage(token: string) {
  const demo = import.meta.env.DEV ? DEMO[token] : undefined
  return useQuery({
    queryKey: ['bill-upload', token],
    enabled: !!token,
    retry: false,
    queryFn: () => (demo ? Promise.resolve(demo) : call<BillUploadPage>({ action: 'bill_upload_view', token })),
  })
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('The file could not be read.'))
    r.readAsDataURL(file)
  })
}

export function useSubmitBillUpload(token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, note }: { file: File; note: string }) =>
      import.meta.env.DEV && DEMO[token]
        ? new Promise<BillUploadPage>((r) =>
            setTimeout(() => r({ ...DEMO[token], status: 'received', file_name: file.name, uploaded_at: new Date().toISOString() }), 1500),
          )
        : call<BillUploadPage>({
        action: 'bill_upload_submit',
        token,
        note,
        file: { name: file.name, data: await readAsDataUrl(file) },
      }),
    onSuccess: (page) => {
      qc.setQueryData(['bill-upload', token], page)
      void qc.invalidateQueries({ queryKey: ['qbo'] })
    },
  })
}

export function useDecideBillUpload(token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (decision: 'attach' | 'reject') =>
      import.meta.env.DEV && DEMO[token]
        ? Promise.resolve({ ...DEMO[token], status: decision === 'attach' ? 'attached' : 'rejected' } as BillUploadPage)
        : call<BillUploadPage>({ action: 'bill_upload_decide', token, decision }),
    onSuccess: (page) => {
      qc.setQueryData(['bill-upload', token], page)
      void qc.invalidateQueries({ queryKey: ['qbo'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/** Makes (or finds) the bill's upload token. Staff only. */
export async function billUploadToken(billId: string): Promise<string> {
  const r = await call<{ token: string }>({ action: 'bill_upload_link', bill_id: billId })
  return r.token
}

export const billUploadUrl = (token: string) => `${window.location.origin}/bill-upload/${token}`
