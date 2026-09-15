import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mirror } from './xanoMirror'
import { supabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Option } from './quoteWrites'

/**
 * Raising an invoice REQUEST — the old app's fifteen-step form on `/project`.
 *
 * ⚠️ This is not `/invoice`. That page is where finance checks and amends an
 * invoice before it goes to QuickBooks, and it is still read-only here. This
 * is the form that CREATES one, and it is the only invoice write in the new
 * app.
 *
 * ⚠️ `invoices` and `invoice_line_items` are on the BLOCKED side of the hourly
 * sync — QuickBooks, BoldSign and Coda read them out of Xano — so an invoice
 * raised here is DELETED on the hour. Expected, not a bug: built and tested
 * against the mirror with throwaway data, cut over once at the end.
 *
 * ⚠️ NOTHING HERE COMPUTES A STORED TOTAL. `track_create_invoice_request`
 * derives all three. The figures below are for the screen only, and they are
 * deliberately the same arithmetic — four separate bugs on the old form came
 * from a screen and a stored value each implementing the same sum slightly
 * differently. If one changes, change both.
 */

/** The ten values `usage_region` accepts. Read off the live form, 14 Sep. */
export const USAGE_REGIONS = [
  'Africa',
  'Asia',
  'Europe',
  'Global',
  'Latin America',
  'NAMET & RUB',
  'North America',
  'North Asia',
  'SEAA',
  'South Asia',
] as const

export const SECTION_KEYS = ['demos', 'searches', 'master', 'publishing', 'other'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

/** One typed supplier cost: who, how much, and whether the client is billed for it. */
export type InvoiceLine = {
  supplierId: number | null
  amount: string
  /**
   * ⚠️ Paythrough YES means Sequel takes the client's money and pays the label
   * or publisher. NO means the client settles direct — Sequel still RECORDS the
   * spend, because Sequel records all client music expenditure regardless of
   * who settles it, but it does not go on the invoice. That second half is the
   * part people miss: a cost can be tracked without being billed.
   */
  paythrough: boolean
}

export type InvoiceSection = {
  lines: InvoiceLine[]
  /** Keyed by the stored column name, so what is typed and what is stored agree. */
  fees: Record<string, string>
  costAvoidance: string
}

export type InvoiceForm = {
  description: string
  clientId: number | null
  poNumber: string
  /** The S3 key `sign-document` minted, or null. Never a filename. */
  poKey: string | null
  poFilename: string | null
  currencyId: number | null
  songName: string
  artistName: string
  usageTerritories: string
  usageRegion: string
  sections: Record<SectionKey, InvoiceSection>
}

/**
 * The five fee sections, in the order the old app asks them, with the labels it
 * uses. Read off the live page on 14 September rather than taken from a doc.
 *
 * ⚠️ "Sequel Licensing Fee" appears on BOTH Library/Master and Publishing, and
 * that is the old app's wording, kept. Unlike the quote wizard's four identical
 * boxes this one is not ambiguous — the section heading says which pool it is,
 * and the two are genuinely separate fees that can differ.
 *
 * ⚠️ THE TWO LICENCE FEES DO NOT MERGE. That has been written down as settled
 * twice and reversed twice. One commission, two recorded fields.
 */
export const INVOICE_SECTIONS: {
  key: SectionKey
  heading: string
  /** The flat Sequel fee boxes, label → stored column. */
  fees: { label: string; column: string }[]
  /** The stored column for this section's cost avoidance. */
  avoidanceColumn: string
  /** What a supplier line on this section is filed under. An enum on table 46. */
  category: string
}[] = [
  {
    key: 'demos',
    heading: 'Demos',
    fees: [
      { label: 'Contingency Fee', column: 'demo_contingency_fee' },
      { label: 'Sequel Demo Fee', column: 'sequel_demo_fee' },
    ],
    avoidanceColumn: 'demo_cost_avoidance',
    category: 'Demos',
  },
  {
    key: 'searches',
    heading: 'Searches',
    fees: [
      { label: 'Contingency Fee', column: 'search_contingency_fee' },
      { label: 'Sequel Search Fee', column: 'sequel_search_fee' },
    ],
    avoidanceColumn: 'search_cost_avoidance',
    category: 'Searches',
  },
  {
    key: 'master',
    heading: 'Library/Master',
    fees: [
      { label: 'Sequel Studio Fee', column: 'master_sequel_studios_fee' },
      { label: 'Sequel Licensing Fee', column: 'master_sequel_licence_fee' },
    ],
    avoidanceColumn: 'master_cost_avoidance',
    category: 'Library Master',
  },
  {
    key: 'publishing',
    heading: 'Publishing',
    fees: [
      { label: 'Sequel Studio Fee', column: 'publishing_sequel_studios_fee' },
      { label: 'Sequel Licensing Fee', column: 'publishing_sequel_licence_fee' },
    ],
    avoidanceColumn: 'publishing_cost_avoidance',
    category: 'Publishing',
  },
  {
    key: 'other',
    heading: 'Other Fees',
    fees: [{ label: 'Sequel Consultancy', column: 'sequel_consultancy_fee' }],
    avoidanceColumn: 'other_cost_avoidance',
    category: 'Other Fees',
  },
]

export function emptyInvoice(): InvoiceForm {
  const sections = {} as Record<SectionKey, InvoiceSection>
  for (const s of INVOICE_SECTIONS) {
    const fees: Record<string, string> = {}
    for (const f of s.fees) fees[f.column] = ''
    sections[s.key] = { lines: [{ supplierId: null, amount: '', paythrough: true }], fees, costAvoidance: '' }
  }
  return {
    description: '',
    clientId: null,
    poNumber: '',
    poKey: null,
    poFilename: null,
    currencyId: null,
    songName: '',
    artistName: '',
    usageTerritories: '',
    usageRegion: '',
    sections,
  }
}

/** A typed amount → a number. Blank is zero. */
export function toAmount(raw: string): number {
  const cleaned = (raw ?? '').replace(/[\s,£$€¥]/g, '')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

export type InvoiceTotals = {
  /** All Sequel fees. */
  fees: number
  /** Third-party rows the client settles through Sequel. */
  paythrough: number
  /** Every third-party row. */
  thirdParty: number
  /** fees + paythrough rows only. */
  totalToInvoice: number
  /** fees + every third-party row. */
  totalSpend: number
  /** fees, and nothing else. */
  profit: number
  /** Stored, reported, and in NONE of the three above. */
  costAvoidance: number
}

/**
 * The three totals (§2.2 of the invoicing doc).
 *
 * ⚠️ Every Sequel fee is in all three. There are no exceptions left — studio
 * fees were the last one and stopped being special on 29 August 2026, when
 * "total spend" was defined as what the CLIENT spent on music rather than what
 * left Sequel's bank. Invoice 1054 billed a client 11,000 and reported their
 * spend as 6,000 before that.
 *
 * ⚠️ Spend equalling the invoice total is CORRECT whenever every row is a
 * paythrough. It means the client paid for everything through Sequel.
 *
 * ⚠️ COST AVOIDANCE IS RETURNED BUT IS IN NONE OF THEM. It is what the client
 * was saved against the original quote — money that did not move. Putting it in
 * spend would inflate 2026 by roughly 1.57m across currencies.
 */
export function invoiceTotals(form: InvoiceForm): InvoiceTotals {
  let fees = 0
  let paythrough = 0
  let thirdParty = 0
  let costAvoidance = 0

  for (const section of INVOICE_SECTIONS) {
    const s = form.sections[section.key]
    if (!s) continue
    for (const f of section.fees) fees += toAmount(s.fees[f.column] ?? '')
    costAvoidance += toAmount(s.costAvoidance)
    for (const line of s.lines) {
      const amount = toAmount(line.amount)
      if (line.supplierId === null && amount === 0) continue
      thirdParty += amount
      if (line.paythrough) paythrough += amount
    }
  }

  return {
    fees,
    paythrough,
    thirdParty,
    totalToInvoice: fees + paythrough,
    totalSpend: fees + thirdParty,
    profit: fees,
    costAvoidance,
  }
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function callSignDocument(body: Record<string, unknown>) {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const res = await fetch(`${FUNCTIONS_URL}/sign-document`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ purpose: 'invoice_po', ...body }),
  })
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) throw new Error((payload?.error as string) ?? 'That file could not be accepted.')
  return payload ?? {}
}

/**
 * Uploads a PO and returns the S3 key to store.
 *
 * ⚠️ The key is what goes in `po_attachment_url`, not a URL. A presigned URL
 * expires in fifteen minutes; storing one would give every historic invoice a
 * dead link. The read side signs it again on demand.
 */
export async function uploadPo(file: File): Promise<{ key: string; filename: string }> {
  const signed = await callSignDocument({ filename: file.name, size_bytes: file.size })
  const uploadUrl = signed.upload_url as string
  const put = await fetch(uploadUrl, { method: 'PUT', body: file })

  if (!put.ok) {
    // ⚠️ Keep the body. S3 explains itself in the XML and nowhere else, and a
    // signed URL that is refused looks identical to a network failure from the
    // outside — which is how "try again" became the message for a condition
    // retrying cannot fix.
    const detail = await put.text().catch(() => '')
    console.error('sign-document: S3 refused the PUT', put.status, detail.slice(0, 500))

    /**
     * ⚠️ 403 HERE IS AN IAM POLICY, NOT A BUG. The signing user
     * (`sequel-sounds-signer`) is scoped to the track prefixes, so it cannot
     * write `invoices/po/*` until one statement is added allowing
     * `s3:PutObject` and `s3:GetObject` on that prefix. Found 14 Sep 2026;
     * everything either side of it works.
     */
    if (put.status === 403) {
      throw new Error(
        'Storage will not accept POs yet — the upload key has no permission for the invoice folder. Everything else on this form still works.',
      )
    }
    throw new Error(`The PO could not be uploaded (${put.status}).`)
  }

  return { key: signed.key as string, filename: file.name }
}

/**
 * A short-lived URL for reading a PO back.
 *
 * ⚠️ ONLY for keys this app minted. The 147 imported invoices hold a RELATIVE
 * XANO VAULT PATH in the same column, which is not an S3 key and dies at
 * cutover — `isS3PoKey` is what tells them apart, and the function refuses
 * anything else anyway.
 */
export function isS3PoKey(value: string | null | undefined): boolean {
  return !!value && /^invoices\/po\/[0-9a-f-]{36}\.[a-z0-9]+$/.test(value)
}

export async function signPoRead(key: string, downloadAs?: string): Promise<string> {
  const signed = await callSignDocument({ read: key, ...(downloadAs ? { download: downloadAs } : {}) })
  return signed.url as string
}

/** Clients to bill, currencies, and the supplier picker. */
export function useInvoiceLookups() {
  return useQuery({
    queryKey: ['mirror', 'invoice-lookups'],
    staleTime: Infinity,
    queryFn: async () => {
      const [clients, currencies, suppliers, countries] = await Promise.all([
        mirror.from('clients').select('id, company, status'),
        mirror.from('currencies_bank_accounts').select('id, currency'),
        mirror.from('supplier_list').select('id, title, countries_list_id, status'),
        mirror.from('countries_list').select('id, country'),
      ])
      const failed = [clients, currencies, suppliers, countries].find((r) => r.error)
      if (failed?.error) throw failed.error

      const rows = <T,>(r: { data: unknown }) => (r.data ?? []) as T[]
      const byLabel = (a: Option, b: Option) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)

      const countryName = new Map(
        rows<{ id: number; country: string | null }>(countries).map((c) => [c.id, c.country ?? '']),
      )

      return {
        clients: rows<{ id: number; company: string | null; status: string | null }>(clients)
          .filter((c) => c.status !== 'Archived')
          .map((c) => ({ id: c.id, label: c.company ?? '' }))
          .sort(byLabel),
        // ⚠️ Kept in table order and shown as the CODE. The symbol is "$" for
        // both USD and SGD, which is no use on a document about money.
        currencies: rows<{ id: number; currency: string | null }>(currencies)
          .sort((a, b) => a.id - b.id)
          .map((c) => ({ id: c.id, label: c.currency ?? '' })),
        /**
         * ⚠️ The country is part of the LABEL, not decoration. There are seven
         * Warner entities and several other repeated names, and the country is
         * the only thing telling them apart in a picker of 130-odd.
         *
         * ⚠️ No type filter, matching the old app's picker — so composition
         * teams appear here too. Flagged there, kept here for parity.
         */
        //
        // ⚠️ Archived suppliers are KEPT and flagged, not dropped: a line that
        // already points at one must still show its name (Andy, 15 Sep). Each
        // picker leaves them out unless the line already holds one.
        suppliers: rows<{
          id: number
          title: string | null
          countries_list_id: number | null
          status: string | null
        }>(suppliers)
          .map((s) => {
            const country = s.countries_list_id ? countryName.get(s.countries_list_id) : ''
            return {
              id: s.id,
              label: country ? `${s.title ?? ''} (${country})` : (s.title ?? ''),
              archived: s.status === 'Archived',
            }
          })
          .sort(byLabel),
      }
    },
  })
}

export type NewInvoiceInput = { projectId: number; form: InvoiceForm }

/**
 * ⚠️ ONE WRITE PATH. `authenticated` has no insert grant on `invoices` or
 * `invoice_line_items`; everything goes through `track_create_invoice_request`,
 * which derives all three totals itself and stamps the supervisor from the
 * session. The browser sends what was typed and nothing that was computed.
 */
export function useCreateInvoiceRequest(projectId: number | undefined) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: NewInvoiceInput): Promise<{ id: number; uuid: string }> => {
      const form = input.form

      const fees: Record<string, number> = {}
      const lines: {
        supplier_id: number
        amount: number
        category: string
        is_paythrough: boolean
      }[] = []

      for (const section of INVOICE_SECTIONS) {
        const s = form.sections[section.key]
        if (!s) continue
        for (const f of section.fees) fees[f.column] = toAmount(s.fees[f.column] ?? '')
        fees[section.avoidanceColumn] = toAmount(s.costAvoidance)
        for (const line of s.lines) {
          const amount = toAmount(line.amount)
          if (line.supplierId === null && amount === 0) continue
          lines.push({
            supplier_id: line.supplierId ?? 0,
            amount,
            category: section.category,
            is_paythrough: line.paythrough,
          })
        }
      }

      const { data, error } = await (supabase as unknown as SupabaseClient).rpc(
        'track_create_invoice_request',
        {
          p_project_id: input.projectId,
          p_client_id: form.clientId,
          p_currency_id: form.currencyId,
          p_description: form.description.trim(),
          p_po_number: form.poNumber.trim() || null,
          p_po_attachment_url: form.poKey,
          p_song_name: form.songName.trim() || null,
          p_artist_name: form.artistName.trim() || null,
          p_usage_territories: form.usageTerritories.trim() || null,
          p_usage_region: form.usageRegion || null,
          p_fees: fees,
          p_lines: lines,
        },
      )
      if (error) throw new Error(error.message)
      const row = (Array.isArray(data) ? data[0] : data) as { id: number; uuid: string } | null
      if (!row?.uuid) throw new Error('The invoice was created but has no link. Tell Andy.')
      return row
    },

    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'invoices', projectId] })
      void qc.invalidateQueries({ queryKey: ['mirror', 'project-invoices', projectId] })
    },
  })
}
