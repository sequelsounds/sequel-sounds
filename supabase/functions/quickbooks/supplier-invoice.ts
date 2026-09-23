// Supplier invoices against QuickBooks bills (Andy, 23 Sep).
//
// A bill gets a link (/bill-upload/<token>). The supplier — or a member of
// staff — uploads their invoice there. Gemini reads it; the comparison with
// the bill is done HERE, in code, not by the model:
//
//   it is an invoice · same currency · same total (to the penny) · same supplier
//
// Either way it waits for finance (Andy, 23 Sep): finance is told whether it
// matched, and approves it into QuickBooks on the same page — or rejects it so
// the supplier can send a corrected one. Nothing is attached automatically.
//
// ⚠️ THE BILL IS NEVER EDITED. The only QuickBooks write is an Attachable
// pointing at the bill. Amounts, lines, dates and the bill number are left
// exactly as they are.
//
// Storage: the private Supabase bucket `supplier-invoices` (migration 0077),
// not S3 — the signer's IAM policy is scoped per prefix.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import type { Conn } from './raise.ts'

const BUCKET = 'supplier-invoices'
const MODEL = 'gemini-3.8-flash'
const MAX_BYTES = 15 * 1024 * 1024
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

export type SupplierInvoiceRow = {
  bill_id: string
  token: string
  vendor_id: string | null
  vendor_name: string | null
  currency: string | null
  total: number | null
  project_id: number | null
  project_sequel_no: string | null
  invoice_number: string | null
  status: 'waiting' | 'review' | 'attached' | 'rejected' | 'failed'
  file_key: string | null
  file_name: string | null
  file_type: string | null
  file_size: number | null
  uploaded_at: string | null
  uploaded_by: number | null
  uploader_note: string | null
  ai_check: Check | null
  qbo_attachable_id: string | null
  error: string | null
}

type Read = {
  is_invoice?: boolean | null
  supplier_name?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  currency?: string | null
  total?: number | string | null
  subtotal?: number | string | null
  tax?: number | string | null
  billed_to?: string | null
  references?: string[] | null
}

type Item = { key: string; label: string; expected: string; found: string; ok: boolean; required: boolean }
export type Check = { pass: boolean; items: Item[]; read: Read; model: string; checked_at: string }

export type BillForLink = {
  id: string
  vendor_id: string | null
  vendor_name: string
  currency: string | null
  total: number
  project_id?: number | null
  project_label?: string | null
  invoice_number?: string | null
}

// ── the link ────────────────────────────────────────────────────────────────

/** Makes the bill's row if it has none, and refreshes what the bill says. The
 *  token and anything uploaded are kept: a link, once sent, keeps working. */
export async function linkFor(admin: SupabaseClient, bill: BillForLink, staffId: number | null) {
  const sequelNo = bill.project_label ? bill.project_label.split(' ')[0] : null
  const snapshot = {
    vendor_id: bill.vendor_id,
    vendor_name: bill.vendor_name,
    currency: bill.currency,
    total: bill.total,
    project_id: bill.project_id ?? null,
    project_sequel_no: sequelNo,
    invoice_number: bill.invoice_number ?? null,
  }
  const { data: existing } = await admin.from('track_supplier_invoices').select('bill_id').eq('bill_id', bill.id).maybeSingle()
  const q = existing
    ? admin.from('track_supplier_invoices').update(snapshot).eq('bill_id', bill.id)
    : admin.from('track_supplier_invoices').insert({ bill_id: bill.id, created_by: staffId, ...snapshot })
  const { error } = await q
  if (error) throw new Error('Could not make the upload link.')
  const { data, error: readErr } = await admin.from('track_supplier_invoices').select('*').eq('bill_id', bill.id).single()
  if (readErr || !data) throw new Error('Could not make the upload link.')
  return data as SupplierInvoiceRow
}

/** Status and token for each bill that has a row, for the Bills lists. */
export async function statusesFor(admin: SupabaseClient, billIds: string[]) {
  type S = { upload_status: SupplierInvoiceRow['status']; upload_token: string; upload_requested_at: string | null }
  const out = new Map<string, S>()
  if (!billIds.length) return out
  const { data } = await admin
    .from('track_supplier_invoices')
    .select('bill_id, status, token, requested_at')
    .in('bill_id', billIds)
  for (const r of (data ?? []) as { bill_id: string; status: S['upload_status']; token: string; requested_at: string | null }[]) {
    out.set(r.bill_id, { upload_status: r.status, upload_token: r.token, upload_requested_at: r.requested_at })
  }
  return out
}

async function byToken(admin: SupabaseClient, token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) return null
  const { data } = await admin.from('track_supplier_invoices').select('*').eq('token', token).maybeSingle()
  return (data as SupplierInvoiceRow | null) ?? null
}

// ── requesting the invoice ──────────────────────────────────────────────────

const RESEND_API = 'https://api.resend.com/emails'
const SENDER = Deno.env.get('RELEASE_FORM_FROM') ?? 'notifications@sequelsounds.com'

/**
 * Who a request goes to: the supplier in the app linked to the bill's
 * QuickBooks vendor — the one whose name matches it if several are (MCPS's
 * vendor is shared by a dozen libraries) — and its finance email, else its
 * contract email, else its brief email. The modal shows it and it can be
 * changed there; this is only the first guess.
 */
export async function suggestedRecipient(admin: SupabaseClient, row: SupplierInvoiceRow) {
  if (!row.vendor_id) return null
  const { data } = await admin
    .schema('xano_mirror')
    .from('supplier_list')
    .select('title, finance_email, contract_email, brief_email')
    .eq('qbo_vendor_id', row.vendor_id)
  type Sup = { title: string | null; finance_email: string | null; contract_email: string | null; brief_email: string | null }
  const list = (data ?? []) as Sup[]
  const vendorWords = words(row.vendor_name ?? '')
  const best = list.find((s) => words(s.title ?? '').some((w) => vendorWords.includes(w))) ?? (list.length === 1 ? list[0] : null)
  if (!best) return null
  const email = [best.finance_email, best.contract_email, best.brief_email]
    .map((e) => (e ?? '').trim())
    .find((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  return email ? { email, supplier: best.title } : null
}

/**
 * Emails the supplier the bill's upload link. The words live in Resend, like
 * every other Sequel email (template id in SUPPLIER_INVOICE_TEMPLATE_ID); the
 * sender is the signed-in person on notifications@, with Reply-To and CC set to
 * them so replies reach the person who asked.
 */
export async function requestInvoice(
  admin: SupabaseClient,
  row: SupplierInvoiceRow,
  to: string,
  caller: { id: number | null; name: string; email: string },
  appBase: string,
) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: `\u201c${to}\u201d is not an email address.`, status: 400 }
  if (row.status === 'attached') return { error: 'This bill already has its invoice.', status: 409 }
  const key = Deno.env.get('RESEND_API_KEY')
  const template = Deno.env.get('SUPPLIER_INVOICE_TEMPLATE_ID')
  if (!key) return { error: 'Email is not configured on the server (RESEND_API_KEY).', status: 500 }
  if (!template) return { error: 'The invoice request email template is not set up yet (SUPPLIER_INVOICE_TEMPLATE_ID).', status: 500 }

  const { data: greeting } = await admin.rpc('track_greeting_for_email', { p_email: to })
  const cleanName = caller.name.replace(/[\r\n"<>,;:]/g, '').trim()
  const from = cleanName ? `${cleanName} \u2014 Sequel <${SENDER}>` : `Sequel <${SENDER}>`
  const mine = caller.email.includes('@') ? caller.email : ''
  const po = row.invoice_number ?? ''
  const subject = `Invoice request | PO ${po}${row.project_sequel_no ? ` \u2014 ${row.project_sequel_no}` : ''}`

  let sendError: string | null = null
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [to],
        ...(mine ? { cc: [mine], reply_to: mine } : {}),
        subject,
        // Every variable on every send: Resend refuses a send that omits one,
        // which is what we want rather than a request with a blank PO.
        template: {
          id: template,
          variables: {
            greeting: typeof greeting === 'string' && greeting ? greeting : 'Hi there,',
            po_number: po,
            sequel_no: row.project_sequel_no ?? '',
            amount: money(num(row.total), row.currency),
            upload_url: `${appBase}/bill-upload/${row.token}`,
          },
        },
      }),
    })
    if (!res.ok) sendError = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`
  } catch (e) {
    sendError = (e as Error).message
  }

  await admin
    .from('track_supplier_invoices')
    .update(
      sendError
        ? { request_error: sendError }
        : { requested_to: to, requested_at: new Date().toISOString(), requested_by: caller.id, request_error: null },
    )
    .eq('bill_id', row.bill_id)
  if (sendError) return { error: `That did not send. ${sendError}`, status: 502 }
  return { ok: true, sent_to: to, cc: mine ? [mine] : [], status: 200 }
}

// ── the page ────────────────────────────────────────────────────────────────

/**
 * What the upload page shows. A supplier sees what we expect and where their
 * upload stands — never the check's detail, the note, or the file. Staff see
 * all of it, with a short-lived link to the file.
 */
export async function view(admin: SupabaseClient, token: string, staff: boolean, finance: boolean) {
  const row = await byToken(admin, token)
  if (!row) return null
  const base = {
    vendor_name: stripCurrency(row.vendor_name ?? ''),
    currency: row.currency,
    total: row.total,
    invoice_number: row.invoice_number,
    project_sequel_no: row.project_sequel_no,
    // A supplier is told "received" for both review and attached: whether it
    // needs a second look is Sequel's business, not theirs.
    status: staff ? row.status : row.status === 'review' || row.status === 'failed' ? 'received' : row.status,
    file_name: row.file_name,
    uploaded_at: row.uploaded_at,
  }
  if (!staff) return base
  let file_url: string | null = null
  if (row.file_key) {
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(row.file_key, 600)
    file_url = data?.signedUrl ?? null
  }
  return {
    ...base,
    staff: true,
    finance,
    bill_id: row.bill_id,
    vendor_name_full: row.vendor_name,
    project_id: row.project_id,
    ai_check: row.ai_check,
    uploader_note: row.uploader_note,
    error: row.error,
    file_url,
  }
}

// ── the upload ──────────────────────────────────────────────────────────────

export async function submit(
  admin: SupabaseClient,
  getConn: () => Promise<Conn>,
  token: string,
  file: { name?: unknown; data?: unknown },
  note: unknown,
  staffId: number | null,
) {
  const row = await byToken(admin, token)
  if (!row) return { error: 'This link is not valid.', status: 404 }
  if (row.status === 'attached') return { error: 'This invoice has already been received.', status: 409 }

  // ⚠️ ONE UPLOAD PER LINK (Andy, 23 Sep). Once something is in, the link only
  // opens again if finance rejects it — otherwise anyone holding the link could
  // quietly replace a genuine invoice before it is looked at. Staff can always
  // replace one, signed in.
  if (staffId === null && row.status !== 'waiting' && row.status !== 'rejected') {
    return { error: 'An invoice has already been sent for this bill. If it needs changing, please contact Sequel.', status: 409 }
  }

  // ⚠️ A FEW TRIES AN HOUR PER BILL. Each upload is an AI read and a stored
  // file; a link in the wrong hands should not be able to run either up.
  if (staffId === null) {
    const { data: allowed } = await admin.rpc('check_rate_limit', {
      p_limit: `bill_upload_${row.bill_id}`,
      p_max: 5,
      p_window_secs: 3600,
    })
    if (allowed === false) return { error: 'Too many uploads. Please wait an hour and try again.', status: 429 }
  }

  const name = typeof file.name === 'string' ? file.name.trim().slice(0, 200) : ''
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const type = TYPES[ext]
  if (!type) return { error: 'Please upload a PDF, PNG or JPG.', status: 415 }
  if (typeof file.data !== 'string' || !file.data) return { error: 'No file was received.', status: 400 }
  let bytes: Uint8Array
  try {
    bytes = fromBase64(file.data)
  } catch {
    return { error: 'The file could not be read.', status: 400 }
  }
  if (bytes.byteLength > MAX_BYTES) return { error: 'That file is over 15 MB.', status: 413 }
  // ⚠️ THE CONTENTS, NOT THE NAME: a file renamed to .pdf is refused.
  if (!looksLike(bytes, type)) return { error: 'That file is not a real PDF, PNG or JPG.', status: 415 }

  const key = `${row.bill_id}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await admin.storage.from(BUCKET).upload(key, bytes, { contentType: type, upsert: false })
  if (upErr) return { error: 'The file could not be saved. Please try again.', status: 500 }

  const uploadedAt = new Date().toISOString()
  await admin
    .from('track_supplier_invoices')
    .update({
      file_key: key,
      file_name: name,
      file_type: type,
      file_size: bytes.byteLength,
      uploaded_at: uploadedAt,
      uploaded_by: staffId,
      uploader_note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : null,
      status: 'review',
      ai_check: null,
      error: null,
      decided_by: null,
      decided_at: null,
    })
    .eq('bill_id', row.bill_id)

  // Read and compare. A failure here leaves it with finance, never lost.
  let check: Check
  let mixed = false
  try {
    const read = await readInvoice(bytes, type)
    mixed = await isMixed(admin, row)
    check = compare(read, row, await supplierNames(admin, row), mixed)
  } catch (e) {
    await admin
      .from('track_supplier_invoices')
      .update({ status: 'review', error: `Could not read the invoice automatically: ${(e as Error).message}` })
      .eq('bill_id', row.bill_id)
    await tellFinance(admin, row, 'could not be read automatically')
    return { ok: true, status: 200 }
  }

  // ⚠️ NOTHING GOES TO QUICKBOOKS WITHOUT FINANCE (Andy, 23 Sep). Every upload
  // waits for a finance click, match or not; the check is there to make that
  // click quick, not to replace it.
  await admin.from('track_supplier_invoices').update({ status: 'review', ai_check: check }).eq('bill_id', row.bill_id)
  const t = num(check.read.total)
  const e = num(row.total)
  if (check.pass) {
    const under = mixed && t !== null && e !== null && e - t > 0.01
    await tellFinance(
      admin,
      row,
      under
        ? `matches the bill and is ready to approve. It is ${money(t, row.currency)} against the bill's ${money(e, row.currency)}, so bring the bill down before paying it`
        : 'matches the bill and is ready to approve',
    )
  } else {
    const off = check.items.filter((i) => i.required && !i.ok).map((i) => i.label.toLowerCase())
    await tellFinance(admin, row, `needs a look (${off.join(', ')} did not match)`)
  }
  return { ok: true, status: 200 }
}

// ── finance's decision ──────────────────────────────────────────────────────

export async function decide(
  admin: SupabaseClient,
  getConn: () => Promise<Conn>,
  token: string,
  decision: unknown,
  staffId: number | null,
) {
  const row = await byToken(admin, token)
  if (!row) return { error: 'This link is not valid.', status: 404 }
  if (row.status === 'attached') return { error: 'Already in QuickBooks.', status: 409 }
  if (!row.file_key) return { error: 'Nothing has been uploaded yet.', status: 400 }
  const now = new Date().toISOString()

  if (decision === 'reject') {
    await admin
      .from('track_supplier_invoices')
      .update({ status: 'rejected', decided_by: staffId, decided_at: now })
      .eq('bill_id', row.bill_id)
    await tellSupervisor(
      admin,
      row,
      'supplier_invoice_rejected',
      'was rejected. Its upload link is open again for a corrected one',
      staffId,
    )
    return { ok: true, status: 200 }
  }
  if (decision !== 'attach') return { error: 'decision must be attach or reject.', status: 400 }

  const { data: blob, error } = await admin.storage.from(BUCKET).download(row.file_key)
  if (error || !blob) return { error: 'Could not read the uploaded file.', status: 500 }
  const ext = (row.file_key.split('.').pop() ?? 'pdf').toLowerCase()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const attached = await attach(getConn, row, bytes, row.file_type ?? TYPES[ext], ext, row.ai_check?.read?.invoice_number ?? null)
  await admin
    .from('track_supplier_invoices')
    .update(
      attached.ok
        ? { status: 'attached', qbo_attachable_id: attached.id, decided_by: staffId, decided_at: now, error: null }
        : { status: 'failed', error: attached.detail, decided_by: staffId, decided_at: now },
    )
    .eq('bill_id', row.bill_id)
  if (attached.ok) {
    await tellSupervisor(admin, row, 'supplier_invoice_approved', 'was approved and is in QuickBooks', staffId)
  }
  return attached.ok ? { ok: true, status: 200 } : { error: attached.detail, status: 502 }
}

// ── the read ────────────────────────────────────────────────────────────────

const PROMPT = `You are reading a document a supplier has sent to Sequel Sounds (the company may appear as TBPB Ltd) so it can be paid.
Return JSON only, with exactly these keys:
- is_invoice: true if this document is an invoice or bill asking to be paid, otherwise false
- supplier_name: the company or person who ISSUED the document, as printed
- invoice_number: the document's own invoice number, as printed
- invoice_date: the invoice date as YYYY-MM-DD
- currency: the ISO 4217 code of the amounts (GBP, USD, EUR, SGD, JPY and so on). Read symbols in context: "$" alone is not enough to say USD if the document says otherwise.
- total: the final amount payable, including any tax, as a plain number with no symbols or thousands separators
- subtotal: the amount before tax as a plain number, or null
- tax: the tax amount as a plain number, or null
- billed_to: who the document is addressed to, as printed
- references: an array of every purchase order number, job number, project name or other reference printed on it
Use null for anything that is not on the document. Never guess or calculate a figure that is not printed.`

async function readInvoice(bytes: Uint8Array, mime: string): Promise<Read> {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: toBase64(bytes) } }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`the reader refused (${res.status})`)
  // deno-lint-ignore no-explicit-any
  const payload = (await res.json()) as any
  const text: string = payload?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  // responseMimeType is not reliably honoured, so fences are stripped.
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!parsed || typeof parsed !== 'object') throw new Error('the reader returned nothing usable')
  return parsed as Read
}

// ── the comparison (in code, not by the model) ──────────────────────────────

const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const CURRENCY_WORDS = /\b(gbp|usd|eur|euro|sgd|jpy|yen|aud|cad|nzd|chf)\b|[$£€¥]/gi
const STOP = new Set([
  'ltd', 'limited', 'llc', 'inc', 'pte', 'plc', 'co', 'company', 'the', 'and', 'uk', 'gmbh', 'srl', 'sa', 'bv',
  'music', 'musics', 'publishing', 'records', 'studio', 'studios', 'group', 'productions', 'production',
])

function stripCurrency(name: string) {
  return name.replace(CURRENCY_WORDS, ' ').replace(/\s+/g, ' ').trim()
}

function words(name: string) {
  return stripCurrency(name.toLowerCase().replace(/&/g, ' and '))
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
}

function sameSupplier(printed: string, names: string[]) {
  const p = words(printed)
  if (!p.length) return false
  return names.some((n) => {
    const w = words(n)
    return w.some((x) => p.includes(x))
  })
}

/** The QuickBooks name plus every supplier in the app linked to that vendor. */
async function supplierNames(admin: SupabaseClient, row: SupplierInvoiceRow) {
  const names = [row.vendor_name ?? '']
  if (row.vendor_id) {
    const { data } = await admin.schema('xano_mirror').from('supplier_list').select('title').eq('qbo_vendor_id', row.vendor_id)
    for (const r of (data ?? []) as { title: string | null }[]) if (r.title) names.push(r.title)
  }
  return names.filter(Boolean)
}

const code = (c: string | null | undefined) => {
  const v = (c ?? '').trim().toUpperCase()
  return v === 'EURO' ? 'EUR' : v === 'YEN' ? 'JPY' : v
}
const money = (n: number | null, c: string | null) =>
  n === null ? 'not found' : `${code(c)} ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * ⚠️ WHERE CURRENCIES ARE MIXED, THE BILL IS AN ESTIMATE (Andy, 23 Sep).
 *
 * When our invoice is in one currency and the supplier bills in another, the
 * bill was converted when it was raised, and the estimate carries a bump for
 * currency movement — MCPS on a non-GBP estimate is the common case. So the
 * supplier's real invoice comes in at or below the bill, not on it.
 *
 * Mixed → it matches if it is no more than the bill and not below 80% of it;
 * finance is then told the real figure so the bill is brought down before it
 * is paid. Over the bill always goes to review. Same currency → to the penny.
 * MCPS is always treated as mixed: it bills in GBP whatever the estimate was.
 */
export const MIXED_FLOOR = 0.8
export const isMcps = (vendor: string | null) => /^mcps\b/i.test((vendor ?? '').trim())

function totalMatches(total: number, expected: number, mixed: boolean) {
  if (!mixed) return Math.abs(total - expected) <= 0.01
  return total <= expected + 0.01 && total >= expected * MIXED_FLOOR
}

/** Our invoice's currency, from the invoice the bill belongs to. */
async function ourCurrency(admin: SupabaseClient, row: SupplierInvoiceRow) {
  if (!row.invoice_number) return null
  const mirror = admin.schema('xano_mirror')
  const { data: inv } = await mirror
    .from('invoices')
    .select('currency_id')
    .eq('invoice_number', row.invoice_number)
    .limit(1)
    .maybeSingle()
  const id = (inv as { currency_id: number | null } | null)?.currency_id
  if (!id) return null
  const { data: cur } = await mirror.from('currencies_bank_accounts').select('currency').eq('id', id).maybeSingle()
  return code((cur as { currency: string | null } | null)?.currency)
}

async function isMixed(admin: SupabaseClient, row: SupplierInvoiceRow) {
  if (isMcps(row.vendor_name)) return true
  const ours = await ourCurrency(admin, row)
  return !!ours && ours !== code(row.currency)
}

function compare(read: Read, row: SupplierInvoiceRow, names: string[], mixed: boolean): Check {
  const total = num(read.total)
  const expectedTotal = num(row.total)
  const refs = [...(read.references ?? []), read.billed_to ?? ''].join(' ').toUpperCase()
  const ours = [row.invoice_number, row.project_sequel_no].filter(Boolean) as string[]

  const items: Item[] = [
    {
      key: 'is_invoice',
      label: 'An invoice',
      expected: 'An invoice asking to be paid',
      found: read.is_invoice ? 'Yes' : 'No',
      ok: read.is_invoice === true,
      required: true,
    },
    {
      key: 'supplier',
      label: 'Supplier',
      expected: stripCurrency(row.vendor_name ?? ''),
      found: read.supplier_name ?? 'not found',
      ok: !!read.supplier_name && sameSupplier(read.supplier_name, names),
      required: true,
    },
    {
      key: 'currency',
      label: 'Currency',
      expected: code(row.currency),
      found: read.currency ? code(read.currency) : 'not found',
      ok: !!read.currency && code(read.currency) === code(row.currency),
      required: true,
    },
    {
      key: 'total',
      label: 'Total',
      expected: money(expectedTotal, row.currency),
      found:
        money(total, read.currency ?? row.currency) +
        (mixed && total !== null && expectedTotal !== null && expectedTotal - total > 0.01
          ? ` (within the currency allowance, ${money(expectedTotal - total, row.currency)} under the bill)`
          : ''),
      ok: total !== null && expectedTotal !== null && totalMatches(total, expectedTotal, mixed),
      required: true,
    },
    {
      key: 'addressed',
      label: 'Addressed to Sequel',
      expected: 'Sequel Sounds / TBPB Ltd',
      found: read.billed_to ?? 'not found',
      ok: /sequel|tbpb/i.test(read.billed_to ?? ''),
      required: false,
    },
    {
      key: 'reference',
      label: 'PO or job number on it',
      expected: ours.join(' or ') || '—',
      found: (read.references ?? []).join(', ') || 'none',
      ok: ours.some((o) => refs.includes(o.toUpperCase())),
      required: false,
    },
  ]
  return {
    pass: items.filter((i) => i.required).every((i) => i.ok),
    items,
    read,
    model: MODEL,
    checked_at: new Date().toISOString(),
  }
}

// ── QuickBooks ──────────────────────────────────────────────────────────────

async function attach(
  getConn: () => Promise<Conn>,
  row: SupplierInvoiceRow,
  bytes: Uint8Array,
  type: string,
  ext: string,
  theirNumber: string | null,
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  try {
    const conn = await getConn()
    const who = stripCurrency(row.vendor_name ?? 'Supplier').replace(/[^\w .-]+/g, '').trim() || 'Supplier'
    const num = (theirNumber ?? '').replace(/[^\w .-]+/g, '').trim()
    const name = `${who} invoice${num ? ` ${num}` : ''}.${ext}`
    const meta = {
      FileName: name,
      ContentType: type,
      AttachableRef: [{ EntityRef: { type: 'Bill', value: row.bill_id }, IncludeOnSend: false }],
    }
    // ⚠️ Intuit is strict: parts named file_metadata_01 and file_content_01,
    // both as files, the metadata one ending .json (same as the PO attach).
    const form = new FormData()
    form.append('file_metadata_01', new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'attachment.json')
    form.append('file_content_01', new Blob([bytes as BlobPart], { type }), name)
    const res = await fetch(`${conn.base}/v3/company/${conn.realm}/upload?minorversion=75`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' },
      body: form,
    })
    const body = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const list = body.AttachableResponse as { Attachable?: { Id?: string } }[] | undefined
    const id = list?.[0]?.Attachable?.Id
    if (!res.ok || !id) return { ok: false, detail: `QuickBooks would not take the attachment (HTTP ${res.status}).` }
    return { ok: true, id: String(id) }
  } catch (e) {
    return { ok: false, detail: `QuickBooks would not take the attachment: ${(e as Error).message}` }
  }
}

// ── telling finance ─────────────────────────────────────────────────────────

async function tellFinance(admin: SupabaseClient, row: SupplierInvoiceRow, what: string) {
  const { data } = await admin.from('track_users').select('id').eq('is_finance', true)
  const who = stripCurrency(row.vendor_name ?? 'A supplier')
  const ref = row.invoice_number ? ` for PO ${row.invoice_number}` : ''
  // A fresh subject per upload: a corrected upload after a rejection is a new
  // thing to look at, not a repeat.
  const subject = crypto.randomUUID()
  for (const f of (data ?? []) as { id: number }[]) {
    await admin.rpc('track_notify', {
      p_user: f.id,
      p_kind: 'supplier_invoice_review',
      p_message: `${who}'s invoice${ref} ${what}.`,
      p_project: row.project_id,
      p_subject_kind: 'supplier_invoice',
      p_subject: subject,
      p_link: `/bill-upload/${row.token}`,
      p_refresh: false,
    })
  }
}

/**
 * The project's supervisor, told what finance decided — the person a supplier
 * chases, and who chases them. Not told about their own decision: the service
 * role has no signed-in person, so the decider is passed in and skipped here.
 */
async function tellSupervisor(
  admin: SupabaseClient,
  row: SupplierInvoiceRow,
  kind: string,
  what: string,
  deciderId: number | null,
) {
  if (!row.project_id) return
  const { data } = await admin
    .schema('xano_mirror')
    .from('project_master_list')
    .select('music_supervisor')
    .eq('id', row.project_id)
    .maybeSingle()
  const supervisor = (data as { music_supervisor: number | null } | null)?.music_supervisor
  if (!supervisor || supervisor === deciderId) return
  const who = stripCurrency(row.vendor_name ?? 'A supplier')
  const ref = row.invoice_number ? ` for PO ${row.invoice_number}` : ''
  await admin.rpc('track_notify', {
    p_user: supervisor,
    p_kind: kind,
    p_message: `${who}'s invoice${ref} ${what}.`,
    p_project: row.project_id,
    p_subject_kind: 'supplier_invoice',
    p_subject: crypto.randomUUID(),
    p_link: `/bill-upload/${row.token}`,
    p_refresh: false,
  })
}

// ── bytes ───────────────────────────────────────────────────────────────────

/** The first bytes of each format: %PDF, the PNG signature, the JPEG SOI marker. */
function looksLike(b: Uint8Array, type: string) {
  const starts = (sig: number[]) => sig.every((v, i) => b[i] === v)
  if (type === 'application/pdf') {
    // %PDF, allowing a little leading junk some generators write first.
    const head = new TextDecoder().decode(b.subarray(0, 1024))
    return head.includes('%PDF-')
  }
  if (type === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (type === 'image/jpeg') return starts([0xff, 0xd8, 0xff])
  return false
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(binary)
}

function fromBase64(s: string) {
  const clean = s.includes(',') && s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
