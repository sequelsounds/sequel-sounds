// raise.ts — raising an invoice into QuickBooks, and its supplier bills.
//
// A port of Xano's raise_invoice (api 575), retry_invoice_bills (598),
// create_qbo_bill (fn 79), get_qbo_exchange_rates (fn 80) and
// attach_file_to_qbo (fn 61), read line by line on 17 Sep 2026. The wording
// the modal shows is Xano's and Wized's. Read those before changing anything
// here: most of the rules below were learned from a real invoice going wrong.
//
// ⚠️ CREATES BUT DOES NOT SEND. Nothing reaches the client. Finance opens the
// invoice in QuickBooks, checks it, and sends it from there.
//
// ── The rules for not failing silently (Andy, 15 Sep) ─────────────────────
//  1. The attempt is written down BEFORE the create (qbo_raise_attempts), with
//     the DocNumber it will use, so a crash afterwards still points at
//     QuickBooks.
//  2. Intuit's requestid is sent on every create, so a retried request returns
//     what was already made instead of making a second one.
//  3. Before raising, an attempt left 'started' is looked up in QuickBooks by
//     its DocNumber and customer. If it is there it is RECORDED, not created
//     again. (Xano's plan said to tag PrivateNote; on an invoice that field is
//     the statement memo, which the client sees on statements, so the attempt
//     log does the job instead.)
//  4. Nothing fallible between the create and the write-back. Every read of
//     the created invoice is defensive.
//  5. The write-back is retried; if it still fails the attempt is marked
//     'created_not_recorded' with the QuickBooks id, and the pre-flight
//     refuses to raise that invoice again until someone has looked.
//  6. Bills stay resumable: qbo_bill_id is written on each line the moment its
//     bill lands, and a line that already has one is skipped.
//
// ⚠️ TWO RATES, RECIPROCALS, BOTH NEEDED (fn 80, 598):
//   rate_used  invoice currency → supplier currency, to work out the amount
//   qbo_rate   supplier currency → GBP, sent as ExchangeRate on a foreign bill
// Putting one where the other belongs is accepted silently and misstates the
// cost by the square of the rate. A missing rate REFUSES; it is never 1.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'

export type Env = 'production' | 'sandbox'
export type Conn = { token: string; realm: string; base: string }

type Config = {
  app_url: string
  invoice_item: string
  invoice_term: string
  tax_uk: string
  tax_other: string
  uk_country_id: number
  bill_term: string
  bill_account: string
  bill_tax_vat: string
  bill_tax_no_vat: string
  cf_sequel_no?: string
  cf_staff_member?: string
  staff_members?: Record<string, string>
  unilever_client_id?: number
}

type Line = {
  id: number
  category: string | null
  amount: number
  bill_id: string | null
  supplier_id: number
  supplier: string | null
  vat_registered: boolean
  currency: string | null
  vendor_id: string | null
}

type Context = {
  config: Config
  invoice: {
    id: number
    uuid: string
    status: string | null
    description: string | null
    total_to_invoice: number
    po_number: string | null
    po_attachment_url: string | null
    qbo_invoice_id: string | null
    invoice_number: string | null
    invoice_date: string | null
    music_supervisor_id: number | null
  }
  currency_code: string | null
  client: { id: number; company: string | null; country: number | null; qbo_id: string | null } | null
  project: { sequel_no: string; client: number | null; music_supervisor: number | null } | null
  owner_email: string | null
  lines: Line[]
}

// Xano's text, word for word (raise_invoice, 575).
const UNILEVER_NOTE =
  'Please note Unilever Payment Process:\n\nhttps://unlv-p-001-delivery.sitecorecontenthub.cloud/api/public/content/orig%2FCDGRrFM3Sh2DPz_JlmsKGw?v=91cb4533'

/** Table 48 says EURO; Intuit says EUR. The rate map carries both keys. */
const qboCurrency = (code: string) => (code === 'EURO' ? 'EUR' : code)

const todayUtc = () => new Date().toISOString().slice(0, 10)
const round2 = (n: number) => Math.round(n * 100) / 100
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)

type QboResult = { status: number; body: Record<string, unknown>; fault: string | null }

function faultOf(body: Record<string, unknown>): string | null {
  const fault = body.Fault as { Error?: { Message?: string; Detail?: string; code?: string }[] } | undefined
  if (!fault) return null
  const e = fault.Error?.[0]
  return [e?.code, e?.Message, e?.Detail].filter(Boolean).join(' — ') || 'QuickBooks returned a fault.'
}

async function qbo(
  conn: Conn,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>,
  payload?: unknown,
): Promise<QboResult> {
  const url = new URL(`${conn.base}/v3/company/${conn.realm}/${path}`)
  url.searchParams.set('minorversion', '75')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${conn.token}`,
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  const body = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  // ⚠️ A 200 is not success on its own: Intuit answers 200 with a Fault when it
  // takes the request and rejects the content.
  return { status: res.status, body, fault: res.ok ? faultOf(body) : faultOf(body) ?? `HTTP ${res.status}` }
}

const query = (conn: Conn, select: string) => qbo(conn, 'GET', 'query', { query: select })

// ── exchange rates (fn 80) ───────────────────────────────────────────────────

/**
 * QuickBooks' own rates for ONE date, keyed by Sequel currency code.
 * ⚠️ Pinned to a date and maxresults 1000, or the history pages at 100 rows
 * of one currency and hands back a plausible wrong number (9 Sep).
 * ⚠️ HOME-CURRENCY-PER-UNIT: rate(USD) ≈ 0.7375 is pounds per dollar.
 */
async function exchangeRates(conn: Conn, asOf: string): Promise<Record<string, number>> {
  const rates: Record<string, number> = { GBP: 1 }
  const r = await query(conn, `select * from exchangerate where asofdate = '${asOf}' maxresults 1000`)
  if (r.fault) return rates
  const rows = ((r.body.QueryResponse as Record<string, unknown> | undefined)?.ExchangeRate ?? []) as Record<
    string,
    unknown
  >[]
  for (const row of rows) {
    const code = str(row.SourceCurrencyCode)
    const rate = num(row.Rate)
    if (code && rate > 0) {
      rates[code] = rate
      if (code === 'EUR') rates.EURO = rate
    }
  }
  return rates
}

// ── bills (fn 79, and the grouping in 575 / 598) ─────────────────────────────

type BillGroup = {
  vendor_id: string
  supplier: string
  currency: string
  source_currency: string
  rate_used: number
  qbo_rate: number
  line_ids: number[]
  qbo_lines: unknown[]
  total: number
  source_total: number
}

export type BillResult = {
  supplier: string
  vendor_id: string
  currency: string
  source_currency: string
  rate_used: number
  qbo_rate: number
  total: number
  source_total: number
  line_ids: number[]
  ok: boolean
  qbo_bill_id: string
  due_date: string
  txn_date: string
  detail: string
  qbo_error: string | null
}

/** Unbilled lines whose conversion has no rate. Refused before anything is made. */
function missingRates(ctx: Context, rates: Record<string, number>): number {
  const inv = ctx.currency_code ?? ''
  let missing = 0
  for (const l of ctx.lines) {
    if (l.bill_id || !l.vendor_id || !l.currency) continue
    if (l.currency !== inv && (!(rates[inv] > 0) || !(rates[l.currency] > 0))) missing++
  }
  return missing
}

function groupBills(ctx: Context, rates: Record<string, number>) {
  const cfg = ctx.config
  const inv = ctx.currency_code ?? ''
  const groups = new Map<string, BillGroup>()
  const skipped: { line_id: number; supplier: string; reason: string }[] = []

  for (const l of ctx.lines) {
    if (l.bill_id || !l.vendor_id) continue
    const code = l.currency ?? ''
    const supRate = rates[code] ?? 0
    const invRate = rates[inv] ?? 0
    if (!code || (code !== inv && (!(supRate > 0) || !(invRate > 0)))) {
      skipped.push({ line_id: l.id, supplier: l.supplier ?? '', reason: 'No exchange rate to convert this line into the supplier’s currency.' })
      continue
    }
    const rate = code !== inv ? invRate / supRate : 1
    const amount = round2(num(l.amount) * rate)
    const lineObj = {
      Amount: amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      Description: l.category ?? '',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: cfg.bill_account },
        BillableStatus: 'NotBillable',
        // Per LINE, from the supplier's own flag — never hoisted to the bill.
        TaxCodeRef: { value: l.vat_registered ? cfg.bill_tax_vat : cfg.bill_tax_no_vat },
      },
    }
    const g = groups.get(l.vendor_id)
    if (g && g.currency !== code) {
      skipped.push({
        line_id: l.id,
        supplier: l.supplier ?? '',
        reason: 'Two suppliers share this QuickBooks vendor but disagree about its currency.',
      })
      continue
    }
    if (!g) {
      groups.set(l.vendor_id, {
        vendor_id: l.vendor_id,
        supplier: l.supplier ?? '',
        currency: code,
        source_currency: inv,
        rate_used: rate,
        qbo_rate: supRate,
        line_ids: [l.id],
        qbo_lines: [lineObj],
        total: amount,
        source_total: num(l.amount),
      })
    } else {
      g.line_ids.push(l.id)
      g.qbo_lines.push(lineObj)
      g.total = round2(g.total + amount)
      g.source_total += num(l.amount)
    }
  }
  return { groups: [...groups.values()], skipped }
}

async function createBills(
  admin: SupabaseClient,
  conn: Conn,
  ctx: Context,
  rates: Record<string, number>,
  invoiceNumber: string,
  txnDate: string,
  staff: string,
) {
  const cfg = ctx.config
  const { groups, skipped } = groupBills(ctx, rates)

  // Both numbers, so the bill can be reconciled from either system (575).
  let note = `QuickBooks invoice ${invoiceNumber} - Sequel Track invoice ${ctx.invoice.id}`
  if (ctx.project?.sequel_no) note += ` - job ${ctx.project.sequel_no}`

  const results: BillResult[] = []
  for (const g of groups) {
    const payload: Record<string, unknown> = {
      VendorRef: { value: g.vendor_id },
      CurrencyRef: { value: qboCurrency(g.currency) },
      GlobalTaxCalculation: 'TaxExcluded',
      PrivateNote: note,
      Line: g.qbo_lines,
      // ⚠️ On the BILL, not the line: an account-based line has no ServiceDate
      // and QuickBooks refuses the whole bill with 2010, naming nothing.
      TxnDate: txnDate,
      // ⚠️ Without a term QuickBooks makes the bill due the day it is created.
      SalesTermRef: { value: cfg.bill_term },
    }
    if (staff && cfg.cf_staff_member) {
      payload.CustomField = [{ DefinitionId: cfg.cf_staff_member, Name: 'Staff Member', Type: 'StringType', StringValue: staff }]
    }
    // ⚠️ Required on any non-GBP bill (error 2410), and it is supplier → GBP.
    if (g.currency !== 'GBP' && g.qbo_rate > 0) payload.ExchangeRate = g.qbo_rate

    const { qbo_lines: _sent, ...summary } = g
    const result: BillResult = {
      ...summary,
      ok: false,
      qbo_bill_id: '',
      due_date: '',
      txn_date: '',
      detail: '',
      qbo_error: null,
    }
    try {
      const r = await qbo(
        conn,
        'POST',
        'bill',
        // ⚠️ enhancedAllCustomFields on the CREATE, or custom fields are dropped.
        // A fresh requestid per attempt: resending one Intuit has seen replays
        // its first answer, which would repeat a refusal after the cause was
        // fixed. Double billing is prevented by qbo_bill_id instead (rule 6).
        { include: 'enhancedAllCustomFields', requestid: crypto.randomUUID() },
        payload,
      )
      const bill = r.body.Bill as Record<string, unknown> | undefined
      const id = str(bill?.Id)
      if (r.fault || !id) {
        result.detail = 'QuickBooks refused the bill.'
        result.qbo_error = r.fault ?? 'QuickBooks answered but returned no bill.'
      } else {
        result.ok = true
        result.qbo_bill_id = id
        result.due_date = str(bill?.DueDate)
        result.txn_date = str(bill?.TxnDate)
        result.detail = 'Bill created.'
        // Written the moment it lands, so a retry skips it.
        await admin.rpc('qbo_mark_bill', { p_line_ids: g.line_ids, p_bill_id: id })
      }
    } catch (e) {
      result.detail = 'QuickBooks could not be reached for this bill.'
      result.qbo_error = (e as Error).message
    }
    results.push(result)
  }
  return {
    bills_created: results.filter((b) => b.ok).length,
    bills_failed: results.filter((b) => !b.ok).length,
    bills_skipped: skipped,
    bill_results: results,
  }
}

// ── the PO attachment (fn 61) ────────────────────────────────────────────────

const PO_KEY_RE = /^invoices\/po\/[0-9a-f-]{36}\.([a-z0-9]+)$/
const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

async function readPo(stored: string): Promise<{ bytes: ArrayBuffer; ext: string } | { error: string }> {
  const m = PO_KEY_RE.exec(stored)
  let res: Response
  let ext: string
  if (m) {
    ext = m[1]
    const bucket = Deno.env.get('S3_BUCKET') ?? ''
    const region = Deno.env.get('S3_REGION') ?? ''
    const aws = new AwsClient({
      accessKeyId: Deno.env.get('S3_ACCESS_KEY_ID') ?? '',
      secretAccessKey: Deno.env.get('S3_SECRET_ACCESS_KEY') ?? '',
      region,
      service: 's3',
    })
    res = await aws.fetch(`https://${bucket}.s3.${region}.amazonaws.com/${stored}`)
  } else if (/^https:\/\//.test(stored)) {
    ext = (stored.split('?')[0].split('.').pop() ?? '').toLowerCase()
    res = await fetch(stored)
  } else {
    // A relative Xano vault path, from an imported invoice.
    return { error: 'The PO is stored in the old app. Attach it by hand in QuickBooks.' }
  }
  if (!res.ok) return { error: 'Could not read the PO to attach. It is still on the invoice here.' }
  return { bytes: await res.arrayBuffer(), ext }
}

async function attachPo(conn: Conn, ctx: Context, qboId: string): Promise<{ ok: boolean; detail: string; name: string }> {
  const stored = (ctx.invoice.po_attachment_url ?? '').trim()
  if (!stored) return { ok: false, detail: 'No PO attachment on this invoice.', name: '' }
  try {
    const file = await readPo(stored)
    if ('error' in file) return { ok: false, detail: file.error, name: '' }
    // ⚠️ The new app does not keep the client's own filename (the key is a
    // uuid), so the file is named for the PO. The old app kept theirs.
    const po = (ctx.invoice.po_number ?? '').trim().replace(/[^\w .-]+/g, '')
    const name = `${po ? `PO ${po}` : `PO invoice ${ctx.invoice.id}`}.${file.ext}`
    const meta = {
      FileName: name,
      ContentType: CONTENT_TYPES[file.ext] ?? 'application/octet-stream',
      // IncludeOnSend is what makes it go out with the invoice email.
      AttachableRef: [{ EntityRef: { type: 'Invoice', value: qboId }, IncludeOnSend: true }],
    }
    // ⚠️ Intuit is strict (fn 61): parts named file_metadata_01 and
    // file_content_01, both as files, the metadata one ending .json.
    const form = new FormData()
    form.append('file_metadata_01', new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'attachment.json')
    form.append('file_content_01', new Blob([file.bytes], { type: meta.ContentType }), name)
    const res = await fetch(`${conn.base}/v3/company/${conn.realm}/upload?minorversion=75`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' },
      body: form,
    })
    const body = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const list = body.AttachableResponse as { Attachable?: { Id?: string } }[] | undefined
    if (!res.ok || !list?.[0]?.Attachable) {
      return { ok: false, detail: 'QuickBooks would not take the attachment. Add it by hand in QuickBooks.', name }
    }
    return { ok: true, detail: 'Attached, and set to go out with the invoice.', name }
  } catch {
    return { ok: false, detail: 'QuickBooks would not take the attachment. Add it by hand in QuickBooks.', name: '' }
  }
}

// ── the raise (575) ──────────────────────────────────────────────────────────

async function loadContext(admin: SupabaseClient, invoiceId: number, env: Env): Promise<Context> {
  const { data, error } = await admin.rpc('qbo_raise_context', { p_invoice_id: invoiceId, p_environment: env })
  if (error || !data) throw new Error('Could not read the invoice.')
  return data as Context
}

export async function raiseCheck(admin: SupabaseClient, invoiceId: number, env: Env) {
  const { data, error } = await admin.rpc('qbo_raise_check', { p_invoice_id: invoiceId, p_environment: env })
  if (error || !data) throw new Error('Could not check the invoice.')
  return data as { ok: boolean; problems: string[]; summary: Record<string, unknown> }
}

function staffNumber(ctx: Context): string {
  const owner = ctx.project?.music_supervisor && ctx.project.music_supervisor > 0
    ? ctx.project.music_supervisor
    : ctx.invoice.music_supervisor_id ?? 0
  return ctx.config.staff_members?.[String(owner)] ?? ''
}

async function nextDocNumber(conn: Conn): Promise<string> {
  // ⚠️ QuickBooks does not number an invoice made through the API (887 was
  // created blank). Xano sorted on DocNumber, which is TEXT; the highest
  // number among the most recent invoices is safer against a stray one.
  const r = await query(conn, 'select DocNumber from Invoice orderby MetaData.CreateTime desc maxresults 200')
  if (r.fault) throw new Error('Could not read the last invoice number from QuickBooks. Nothing has been changed.')
  const rows = ((r.body.QueryResponse as Record<string, unknown> | undefined)?.Invoice ?? []) as Record<string, unknown>[]
  const numbers = rows.map((x) => str(x.DocNumber)).filter((d) => /^\d+$/.test(d)).map(Number)
  if (!numbers.length) throw new Error('QuickBooks returned no numbered invoices, so the next number cannot be worked out.')
  return String(Math.max(...numbers) + 1)
}

type Created = { id: string; number: string; date: string | null; due: string | null; rate: number; home: number }

function readCreated(inv: Record<string, unknown> | undefined): Created | null {
  const id = str(inv?.Id)
  if (!id) return null
  return {
    id,
    number: str(inv?.DocNumber),
    date: str(inv?.TxnDate) || null,
    due: str(inv?.DueDate) || null,
    rate: num(inv?.ExchangeRate),
    home: num(inv?.HomeTotalAmt),
  }
}

/** Rule 3: an attempt left 'started' may already be in QuickBooks. */
async function reconcileStarted(admin: SupabaseClient, conn: Conn, ctx: Context, env: Env): Promise<Created | null> {
  const { data } = await admin
    .from('qbo_raise_attempts')
    .select('id, doc_number')
    .eq('invoice_id', ctx.invoice.id)
    .eq('environment', env)
    .eq('status', 'started')
  for (const a of (data ?? []) as { id: number; doc_number: string }[]) {
    const r = await query(conn, `select * from Invoice where DocNumber = '${a.doc_number.replace(/'/g, '')}'`)
    if (r.fault) throw new Error('Could not check QuickBooks for an earlier attempt. Nothing has been changed.')
    const rows = ((r.body.QueryResponse as Record<string, unknown> | undefined)?.Invoice ?? []) as Record<string, unknown>[]
    // The number was reserved by this attempt; the customer confirms it is ours
    // rather than one someone typed by hand in the meantime.
    const ours = rows.find(
      (x) => str((x.CustomerRef as { value?: string } | undefined)?.value) === (ctx.client?.qbo_id ?? ''),
    )
    if (ours) {
      const created = readCreated(ours)
      if (created) {
        await admin.from('qbo_raise_attempts').update({ qbo_invoice_id: created.id, updated_at: new Date().toISOString() }).eq('id', a.id)
        return created
      }
    }
    await admin
      .from('qbo_raise_attempts')
      .update({ status: 'failed', error: 'Not found in QuickBooks when checked before the next raise.', updated_at: new Date().toISOString() })
      .eq('id', a.id)
  }
  return null
}

export async function raiseInvoice(admin: SupabaseClient, conn: Conn, env: Env, invoiceId: number, userId: string) {
  const refuse = (message: string, problems?: string[]) => ({ raised: false, message, problems: problems ?? [] })

  // The same pre-flight the modal showed, run again here. Never trust the browser.
  const check = await raiseCheck(admin, invoiceId, env)
  if (!check.ok) return refuse('This invoice is not ready to raise.', check.problems)

  const ctx = await loadContext(admin, invoiceId, env)
  const cfg = ctx.config
  const invCode = ctx.currency_code ?? ''
  const today = todayUtc()

  // The rates, BEFORE anything is created: a missing one refuses the whole
  // raise rather than leaving an invoice with a hole in its costs.
  const rates = await exchangeRates(conn, today)
  // ⚠️ The invoice's own rate too (17 Sep, found on the test company): an
  // invoice created through the API with no ExchangeRate was booked at 1 —
  // SGD 2,300 recorded as £2,300. The real company happened to fill it in
  // (1166), the test company did not; sending QuickBooks' own rate is right
  // for both. The old app never sent it.
  if (invCode !== 'GBP' && !(rates[invCode] > 0)) {
    return refuse(
      `QuickBooks has no exchange rate today for ${invCode}, so the invoice cannot be booked in pounds. Nothing has been changed.`,
    )
  }
  if (missingRates(ctx, rates) > 0) {
    return refuse(
      'QuickBooks has no exchange rate today for one of the supplier currencies on this invoice, so the bill amount cannot be converted. Nothing has been changed.',
    )
  }

  let created = await reconcileStarted(admin, conn, ctx, env)
  let attemptId: number | null = null
  let recovered = false
  const staff = staffNumber(ctx)

  if (created) {
    recovered = true
    const { data } = await admin
      .from('qbo_raise_attempts')
      .select('id')
      .eq('invoice_id', invoiceId)
      .eq('qbo_invoice_id', created.id)
      .limit(1)
    attemptId = (data?.[0] as { id: number } | undefined)?.id ?? null
  } else {
    const docNumber = await nextDocNumber(conn)
    const requestId = crypto.randomUUID()

    // Rule 1. The unique index on (invoice_id) where status = 'started' also
    // stops two raises of the same invoice running at once.
    const { data: attempt, error: attemptError } = await admin
      .from('qbo_raise_attempts')
      .insert({ invoice_id: invoiceId, environment: env, doc_number: docNumber, request_id: requestId, created_by: userId })
      .select('id')
      .single()
    if (attemptError || !attempt) return refuse('This invoice is already being raised. Wait a moment and reload.')
    attemptId = (attempt as { id: number }).id

    let memo = ctx.invoice.po_number?.trim() ? `PO ${ctx.invoice.po_number.trim()}` : ''
    if (ctx.project && cfg.unilever_client_id && ctx.project.client === cfg.unilever_client_id) {
      memo = memo ? `${memo}\n\n${UNILEVER_NOTE}` : UNILEVER_NOTE
    }
    const custom: unknown[] = []
    if (ctx.project?.sequel_no && cfg.cf_sequel_no) {
      custom.push({ DefinitionId: cfg.cf_sequel_no, Name: 'Sequel No,', Type: 'StringType', StringValue: ctx.project.sequel_no })
    }
    if (staff && cfg.cf_staff_member) {
      custom.push({ DefinitionId: cfg.cf_staff_member, Name: 'Staff Member', Type: 'StringType', StringValue: staff })
    }
    const total = num(ctx.invoice.total_to_invoice)
    const payload: Record<string, unknown> = {
      CustomerRef: { value: ctx.client!.qbo_id },
      CurrencyRef: { value: qboCurrency(invCode) },
      DocNumber: docNumber,
      TxnDate: today,
      SalesTermRef: { value: cfg.invoice_term },
      Line: [
        {
          Amount: total,
          DetailType: 'SalesItemLineDetail',
          Description: ctx.invoice.description ?? '',
          SalesItemLineDetail: {
            ItemRef: { value: cfg.invoice_item },
            Qty: 1,
            UnitPrice: total,
            // From the CLIENT's country: UK standard rate, everyone else none.
            TaxCodeRef: { value: ctx.client?.country === cfg.uk_country_id ? cfg.tax_uk : cfg.tax_other },
            // ⚠️ Valid on a sales item line (and not on a bill line).
            ServiceDate: today,
          },
        },
      ],
      CustomerMemo: { value: memo },
      CustomField: custom,
      GlobalTaxCalculation: 'TaxExcluded',
    }
    if (ctx.owner_email?.trim()) payload.BillEmailCc = { Address: ctx.owner_email.trim() }
    // Home currency per unit, as on a bill. Never sent on a GBP invoice.
    if (invCode !== 'GBP') payload.ExchangeRate = rates[invCode]

    let r: QboResult
    try {
      r = await qbo(conn, 'POST', 'invoice', { include: 'enhancedAllCustomFields', requestid: requestId }, payload)
    } catch (e) {
      // The request may or may not have landed. Leave the attempt 'started'
      // so the next raise looks for it (rule 3) rather than guessing.
      return refuse(`QuickBooks could not be reached (${(e as Error).message}). Try again; the next attempt checks whether this one landed.`)
    }

    // ⚠️ FROM HERE AN INVOICE MAY EXIST IN QUICKBOOKS AND NOT HERE. Keep it dull.
    created = r.fault ? null : readCreated(r.body.Invoice as Record<string, unknown> | undefined)
    if (!created) {
      await admin
        .from('qbo_raise_attempts')
        .update({ status: 'failed', error: (r.fault ?? 'No invoice returned.').slice(0, 2000), updated_at: new Date().toISOString() })
        .eq('id', attemptId)
      return refuse(`QuickBooks refused the invoice. Nothing has been changed. (${r.fault ?? 'no invoice returned'})`)
    }
    await admin.from('qbo_raise_attempts').update({ qbo_invoice_id: created.id }).eq('id', attemptId)
  }

  // Rule 5: the write-back, retried.
  let recorded = false
  for (let i = 0; i < 3 && !recorded; i++) {
    const { data, error } = await admin.rpc('qbo_record_raise', {
      p_invoice_id: invoiceId,
      p_qbo_id: created.id,
      p_number: created.number,
      p_date: created.date,
      p_due: created.due,
      p_rate: created.rate,
      p_home_total: created.home,
    })
    recorded = !error && data === true
    if (!recorded) await new Promise((res) => setTimeout(res, 500 * (i + 1)))
  }
  if (!recorded) {
    if (attemptId) {
      await admin
        .from('qbo_raise_attempts')
        .update({ status: 'created_not_recorded', error: 'The invoice was created in QuickBooks but could not be saved here.', updated_at: new Date().toISOString() })
        .eq('id', attemptId)
    }
    return {
      raised: false,
      created_not_recorded: true,
      qbo_invoice_id: created.id,
      invoice_number: created.number,
      app_url: cfg.app_url,
      message: `Invoice ${created.number} WAS created in QuickBooks, but it could not be recorded here. Do not raise it again — open it in QuickBooks and tell Andy.`,
      problems: [],
    }
  }

  // Bills, then the PO. Neither can fail the raise now.
  const bills = await createBills(admin, conn, ctx, rates, created.number, created.date ?? today, staff)
  const att = recovered
    ? { ok: false, detail: 'Recovered from an earlier attempt: check the PO is attached in QuickBooks.', name: '' }
    : await attachPo(conn, ctx, created.id)

  const result = {
    raised: true,
    recovered,
    environment: env,
    app_url: cfg.app_url,
    qbo_invoice_id: created.id,
    invoice_number: created.number,
    invoice_date: created.date,
    due_date: created.due,
    exchange_rate: created.rate,
    gbp_total: created.home,
    po_attached: att.ok,
    attach_name: att.name,
    attach_detail: att.detail,
    ...bills,
  }
  if (attemptId) {
    await admin
      .from('qbo_raise_attempts')
      .update({ status: 'recorded', result, updated_at: new Date().toISOString() })
      .eq('id', attemptId)
  }
  return result
}

// ── retry the bills (598) ────────────────────────────────────────────────────

export async function retryBills(admin: SupabaseClient, conn: Conn, env: Env, invoiceId: number) {
  const ctx = await loadContext(admin, invoiceId, env)
  if (!ctx.invoice.qbo_invoice_id) {
    return { ok: false, message: 'This invoice has not been raised yet. Raise it first.' }
  }
  // ⚠️ The invoice's OWN date, so a retry bills what it was worth when it went out.
  const date = ctx.invoice.invoice_date ?? todayUtc()
  const rates = await exchangeRates(conn, date)
  const bills = await createBills(
    admin,
    conn,
    ctx,
    rates,
    ctx.invoice.invoice_number ?? '',
    date,
    staffNumber(ctx),
  )
  return { ok: true, app_url: ctx.config.app_url, ...bills }
}
