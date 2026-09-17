// quickbooks — the new app's QuickBooks calls, finance only.
//
//   { action: "connect", return_to }  -> { url }   Intuit's consent page
//   { action: "vendors" }             -> { connected, vendors?, error? }
//   { action: "disconnect" }          -> { ok, revoked }
//   { action: "payment_times" }       -> { connected, clients?, overall? }
//   { action: "bills" }               -> { connected, bills? }
//   { action: "invoice", doc_number } -> { connected, invoices? }  read only
//   { action: "orphans" }             -> { connected, orphans? }   read only
//   { action: "raise_check", uuid }   -> { connected, environment, ok, problems, summary }
//   { action: "raise", uuid }         -> { connected, raised, ... }  see raise.ts
//   { action: "retry_bills", uuid }   -> { connected, ok, bill_results, ... }
//   { action: "sandbox_lists" }       -> the test company's items, taxes, terms, accounts
//   { action: "sandbox_link", kind, sequel_id, currency? } -> copies a client or supplier into the test company
//
// ⚠️ TWO COMPANIES (17 Sep). Raises go to Intuit's SANDBOX until the
// switch-over (Andy): QBO_RAISE_ENV must be set to "production" to change
// that. Every read (vendors, bills, payment times, orphans) stays on the
// real company. A "connect" with environment "sandbox" connects the test
// company with the Development keys, QBO_SANDBOX_CLIENT_ID / _SECRET.
//
// Talks to QuickBooks through the Intuit app "Sequel App New", a separate
// connection from the old app's (Xano table 65), so nothing here can rotate or
// revoke the token Xano raises invoices with. See migration 0025.
//
// ⚠️ ALL TOKEN REFRESHING HAPPENS IN accessToken() BELOW, and it takes the
// lock in qbo_claim_refresh first. Intuit rotates the refresh token; two
// refreshes at once kill the connection. Anything else that ever calls
// QuickBooks must come through here, not grow its own refresh.
//
// ⚠️ The connection row is a credential. Nothing here returns or logs it.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { raiseCheck, raiseInvoice, retryBills, type Conn, type Env } from './raise.ts'

const AUTHORISE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const API_BASE = 'https://quickbooks.api.intuit.com'
const API_BASES: Record<Env, string> = {
  production: API_BASE,
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
}

/** Where raises go. The test company until the switch-over (Andy, 17 Sep). */
const RAISE_ENV: Env = Deno.env.get('QBO_RAISE_ENV') === 'production' ? 'production' : 'sandbox'

/** Development keys only reach sandbox companies; production keys only the real one. */
function intuitKeys(env: Env) {
  return env === 'sandbox'
    ? { id: Deno.env.get('QBO_SANDBOX_CLIENT_ID') ?? '', secret: Deno.env.get('QBO_SANDBOX_CLIENT_SECRET') ?? '' }
    : { id: Deno.env.get('QBO_CLIENT_ID') ?? '', secret: Deno.env.get('QBO_CLIENT_SECRET') ?? '' }
}
const REDIRECT_URI = 'https://sveirphsppyfhulymjiu.supabase.co/functions/v1/qbo-callback'
const SCOPE = 'com.intuit.quickbooks.accounting'
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
]

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.some((re) => re.test(origin)) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

/** Finance, asked the same way the database asks it: track_is_finance(). */
async function financeUser(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(auth)) return null
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data: userData } = await asUser.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
  const userId = userData?.user?.id
  if (!userId) return null
  const { data: isFinance, error } = await asUser.rpc('track_is_finance')
  if (error || isFinance !== true) return null
  return userId
}

/** Only our own pages, so the callback can never be used as an open redirect. */
function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const u = new URL(value)
    if (!ALLOWED_ORIGINS.some((re) => re.test(u.origin))) return null
    u.searchParams.delete('qbo')
    u.searchParams.delete('qbo_error')
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

function randomState(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

type ConnRow = {
  realm_id: string
  access_token: string | null
  access_expires_at: string | null
  refresh_token: string | null
  status: string
}

class NotConnected extends Error {}

async function readConn(admin: SupabaseClient, env: Env = 'production'): Promise<ConnRow | null> {
  const { data } = await admin
    .from('qbo_connection')
    .select('realm_id, access_token, access_expires_at, refresh_token, status')
    .eq('environment', env)
    .maybeSingle()
  return (data as ConnRow | null) ?? null
}

async function markBroken(admin: SupabaseClient, reason: string, env: Env = 'production') {
  await admin
    .from('qbo_connection')
    .update({
      status: 'Error',
      last_error: reason,
      access_token: null,
      refresh_token: null,
      refresh_lock_id: null,
      refresh_lock_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('environment', env)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isFresh = (c: ConnRow | null) =>
  !!c?.access_token && !!c.access_expires_at && Date.parse(c.access_expires_at) > Date.now() + 120_000

/** A usable access token and realm, refreshing through the lock if needed. */
async function accessToken(admin: SupabaseClient, env: Env = 'production'): Promise<Conn> {
  const lock = crypto.randomUUID()
  const base = API_BASES[env]

  for (let attempt = 0; attempt < 12; attempt++) {
    const { data: claim, error } = await admin.rpc('qbo_claim_refresh', {
      p_lock: lock,
      p_seconds: 30,
      p_environment: env,
    })
    if (error) throw new Error('Could not read the QuickBooks connection.')

    if (claim === 'none') throw new NotConnected('QuickBooks is not connected.')

    if (claim === 'fresh') {
      const c = await readConn(admin, env)
      if (isFresh(c)) return { token: c!.access_token!, realm: c!.realm_id, base }
      continue
    }

    if (claim === 'busy') {
      await sleep(1000)
      continue
    }

    // claimed: this call alone refreshes.
    const c = await readConn(admin, env)
    if (!c?.refresh_token) throw new NotConnected('QuickBooks is not connected.')

    const { id: clientId, secret: clientSecret } = intuitKeys(env)
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh_token }),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

    if (!res.ok || typeof body.access_token !== 'string') {
      const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`
      if (reason === 'invalid_grant') {
        // The refresh token is dead — revoked, expired or rotated away. Only a
        // person can fix that, by connecting again.
        await markBroken(admin, 'QuickBooks refused the saved connection (invalid_grant). Reconnect.', env)
        throw new NotConnected('The QuickBooks connection has expired. Connect it again.')
      }
      await admin
        .from('qbo_connection')
        .update({ last_error: `refresh failed: ${reason}`, refresh_lock_id: null, refresh_lock_until: null })
        .eq('environment', env)
        .eq('refresh_lock_id', lock)
      throw new Error(`QuickBooks did not refresh the connection (${reason}).`)
    }

    const now = Date.now()
    const update: Record<string, unknown> = {
      access_token: body.access_token,
      access_expires_at: new Date(now + Number(body.expires_in ?? 3600) * 1000).toISOString(),
      status: 'Connected',
      last_error: null,
      updated_at: new Date(now).toISOString(),
      refresh_lock_id: null,
      refresh_lock_until: null,
    }
    // ⚠️ Save the NEW refresh token. Keeping the old one is how a connection
    // dies a day later for no visible reason.
    if (typeof body.refresh_token === 'string') {
      update.refresh_token = body.refresh_token
      update.refresh_expires_at = new Date(
        now + Number(body.x_refresh_token_expires_in ?? 8726400) * 1000,
      ).toISOString()
    }
    const { error: saveError } = await admin
      .from('qbo_connection')
      .update(update)
      .eq('environment', env)
      .eq('refresh_lock_id', lock)
    if (saveError) throw new Error('QuickBooks refreshed but the new token could not be saved.')

    return { token: body.access_token, realm: c.realm_id, base }
  }

  throw new Error('QuickBooks is busy. Try again in a moment.')
}

type Vendor = {
  id: string
  name: string
  currency: string | null
  address: Record<string, string> | null
}

const ADDRESS_KEYS = ['Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'City', 'CountrySubDivisionCode', 'PostalCode', 'Country']

async function listVendors(admin: SupabaseClient): Promise<Vendor[]> {
  const { token, realm } = await accessToken(admin)
  const out: Vendor[] = []
  const PAGE = 1000

  for (let start = 1; ; start += PAGE) {
    const query = `select * from Vendor startposition ${start} maxresults ${PAGE}`
    const url = `${API_BASE}/v3/company/${realm}/query?minorversion=75&query=${encodeURIComponent(query)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })

    if (res.status === 401) {
      await markBroken(admin, 'QuickBooks rejected the access token (401). Reconnect.')
      throw new NotConnected('The QuickBooks connection was rejected. Connect it again.')
    }
    const body = (await res.json().catch(() => ({}))) as {
      QueryResponse?: { Vendor?: Record<string, unknown>[] }
      Fault?: unknown
    }
    // ⚠️ Intuit can answer 200 with a Fault. A 200 is not success on its own.
    if (!res.ok || body.Fault) throw new Error(`QuickBooks would not list vendors (HTTP ${res.status}).`)

    const rows = body.QueryResponse?.Vendor ?? []
    for (const v of rows) {
      const addr = v.BillAddr as Record<string, unknown> | undefined
      const picked: Record<string, string> = {}
      if (addr) for (const k of ADDRESS_KEYS) if (typeof addr[k] === 'string' && addr[k]) picked[k] = addr[k] as string
      out.push({
        id: String(v.Id),
        name: String(v.DisplayName ?? ''),
        currency: ((v.CurrencyRef as { value?: string } | undefined)?.value) ?? null,
        address: addr ? picked : null,
      })
    }
    if (rows.length < PAGE) break
  }
  return out
}

/** Every row of one entity, a page at a time. */
async function queryAll(
  token: string,
  realm: string,
  admin: SupabaseClient,
  select: string,
  entity: string,
  env: Env = 'production',
): Promise<Record<string, unknown>[]> {
  const base = API_BASES[env]
  const out: Record<string, unknown>[] = []
  const PAGE = 1000
  for (let start = 1; ; start += PAGE) {
    const query = `${select} startposition ${start} maxresults ${PAGE}`
    const url = `${base}/v3/company/${realm}/query?minorversion=75&query=${encodeURIComponent(query)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (res.status === 401) {
      await markBroken(admin, 'QuickBooks rejected the access token (401). Reconnect.', env)
      throw new NotConnected('The QuickBooks connection was rejected. Connect it again.')
    }
    const body = (await res.json().catch(() => ({}))) as {
      QueryResponse?: Record<string, Record<string, unknown>[] | undefined>
      Fault?: unknown
    }
    if (!res.ok || body.Fault) throw new Error(`QuickBooks would not list ${entity} (HTTP ${res.status}).`)
    const rows = body.QueryResponse?.[entity] ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

const DAY = 86_400_000
const dayDiff = (later: string, earlier: string) =>
  Math.round((Date.parse(later) - Date.parse(earlier)) / DAY)

/**
 * How long each client takes to pay, from QuickBooks itself, so it covers
 * every invoice ever raised and not only the ones this app knows about.
 *
 * An invoice counts once it is fully paid (Balance 0) and at least one
 * Payment links to it; the paid date is the LAST such payment, so a part
 * payment does not make a client look quicker than they were. Days late is
 * against the invoice's own DueDate, where it has one. Fully paid invoices
 * with no linked payment — credited or written off — are left out rather
 * than guessed at.
 */
async function paymentTimes(admin: SupabaseClient) {
  const { token, realm } = await accessToken(admin)
  const [invoices, payments] = await Promise.all([
    queryAll(token, realm, admin, 'select Id, TxnDate, DueDate, Balance, CustomerRef from Invoice', 'Invoice'),
    queryAll(token, realm, admin, 'select * from Payment', 'Payment'),
  ])

  const paidOn = new Map<string, string>()
  for (const p of payments) {
    const date = p.TxnDate as string | undefined
    if (!date) continue
    for (const line of (p.Line as { LinkedTxn?: { TxnId: string; TxnType: string }[] }[] | undefined) ?? []) {
      for (const t of line.LinkedTxn ?? []) {
        if (t.TxnType !== 'Invoice') continue
        const prev = paidOn.get(t.TxnId)
        if (!prev || date > prev) paidOn.set(t.TxnId, date)
      }
    }
  }

  type Acc = { id: string; name: string; paid: number; days: number; lateCount: number; late: number; open: number }
  const byClient = new Map<string, Acc>()
  const all = { paid: 0, days: 0, lateCount: 0, late: 0, open: 0 }

  for (const inv of invoices) {
    const ref = inv.CustomerRef as { value?: string; name?: string } | undefined
    if (!ref?.value) continue
    const acc =
      byClient.get(ref.value) ??
      { id: ref.value, name: ref.name ?? '', paid: 0, days: 0, lateCount: 0, late: 0, open: 0 }
    byClient.set(ref.value, acc)

    const balance = Number(inv.Balance ?? 0)
    if (balance > 0) {
      acc.open++
      all.open++
      continue
    }
    const paid = paidOn.get(String(inv.Id))
    const issued = inv.TxnDate as string | undefined
    if (!paid || !issued) continue
    const d = Math.max(0, dayDiff(paid, issued))
    acc.paid++
    acc.days += d
    all.paid++
    all.days += d
    const due = inv.DueDate as string | undefined
    if (due) {
      const l = dayDiff(paid, due)
      acc.lateCount++
      acc.late += l
      all.lateCount++
      all.late += l
    }
  }

  const avg = (sum: number, n: number) => (n ? Math.round((sum / n) * 10) / 10 : null)
  const clients = [...byClient.values()]
    .filter((c) => c.paid > 0 || c.open > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      paid_invoices: c.paid,
      open_invoices: c.open,
      avg_days_to_pay: avg(c.days, c.paid),
      avg_days_late: avg(c.late, c.lateCount),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    clients,
    overall: {
      paid_invoices: all.paid,
      open_invoices: all.open,
      avg_days_to_pay: avg(all.days, all.paid),
      avg_days_late: avg(all.late, all.lateCount),
    },
  }
}

/**
 * Every supplier bill in QuickBooks, with whether the supplier's own invoice
 * is attached to it yet.
 *
 * Read from QuickBooks rather than the mirror: only bills raised since 8 Sep
 * carry a qbo_bill_id on their invoice lines, and QuickBooks holds every bill
 * back to the start. The page joins the linked ones to their invoice itself.
 *
 * "Has supplier invoice" means an Attachable points at the bill. A bill the
 * old app raised carries no attachment of its own, so any file on it is the
 * supplier's paperwork.
 */
async function listBills(admin: SupabaseClient) {
  const { token, realm } = await accessToken(admin)
  const [bills, attachables] = await Promise.all([
    queryAll(token, realm, admin, 'select * from Bill', 'Bill'),
    queryAll(token, realm, admin, 'select * from Attachable', 'Attachable'),
  ])

  const withFile = new Set<string>()
  for (const a of attachables) {
    for (const ref of (a.AttachableRef as { EntityRef?: { type?: string; value?: string } }[] | undefined) ?? []) {
      if (ref.EntityRef?.type === 'Bill' && ref.EntityRef.value) withFile.add(ref.EntityRef.value)
    }
  }

  return bills
    .map((b) => {
      const vendor = b.VendorRef as { value?: string; name?: string } | undefined
      const currency = b.CurrencyRef as { value?: string } | undefined
      return {
        id: String(b.Id),
        doc_number: (b.DocNumber as string | undefined) ?? null,
        txn_date: (b.TxnDate as string | undefined) ?? null,
        due_date: (b.DueDate as string | undefined) ?? null,
        vendor_id: vendor?.value ?? null,
        vendor_name: vendor?.name ?? '',
        currency: currency?.value ?? null,
        total: Number(b.TotalAmt ?? 0),
        balance: Number(b.Balance ?? 0),
        has_supplier_invoice: withFile.has(String(b.Id)),
      }
    })
    .sort((a, b) => (b.txn_date ?? '').localeCompare(a.txn_date ?? '') || Number(b.id) - Number(a.id))
}

/**
 * QuickBooks invoices the app has no record of.
 *
 * ⚠️ WHY. A raise creates the invoice in QuickBooks and THEN records it. If
 * anything fails in between, QuickBooks has an invoice the app still shows as
 * unraised — and raising it again bills the client twice. That happened on
 * 9 Sep (invoice 292) and 10 Sep (293 → 1166, found by Andy on 15 Sep). This
 * is the check that makes such a failure loud: the Finance page shows every
 * orphan it returns.
 *
 * Matched on the QuickBooks id stored on the app's invoice. Only invoices
 * dated on or after the app's first (13 Nov 2025) count — anything older
 * predates the app and was never meant to be in it.
 */
const ORPHANS_FROM = '2025-11-01'

type Linked = { TxnId?: string; TxnType?: string }

/**
 * Invoices that were cancelled rather than lost, so they are not flagged
 * (Andy, 15 Sep — 1122, a duplicate cancelled by a credit note):
 * - voided: total 0;
 * - fully credited: nothing owed, and every payment linked to it is a
 *   credit-note application (a Payment of 0 that links a CreditMemo), so no
 *   money was ever received against it.
 * An invoice paid even partly in cash still counts, and is still flagged.
 */
async function cancelledIds(
  token: string,
  realm: string,
  admin: SupabaseClient,
  invoices: Record<string, unknown>[],
): Promise<Set<string>> {
  const out = new Set<string>()
  const linkedOf = (i: Record<string, unknown>) => ((i.LinkedTxn as Linked[] | undefined) ?? [])
  const payIds = new Set<string>()
  for (const i of invoices) {
    if (Number(i.TotalAmt ?? 0) === 0) out.add(String(i.Id))
    else if (Number(i.Balance ?? 1) === 0)
      for (const l of linkedOf(i)) if (l.TxnType === 'Payment' && l.TxnId) payIds.add(l.TxnId)
  }
  if (!payIds.size) return out

  const list = [...payIds].map((id) => `'${id.replace(/[^0-9]/g, '')}'`).join(',')
  const payments = await queryAll(token, realm, admin, `select * from Payment where Id in (${list})`, 'Payment')
  const creditOnly = new Set(
    payments
      .filter(
        (p) =>
          Number(p.TotalAmt ?? 0) === 0 &&
          ((p.Line as { LinkedTxn?: Linked[] }[] | undefined) ?? []).some((l) =>
            (l.LinkedTxn ?? []).some((t) => t.TxnType === 'CreditMemo'),
          ),
      )
      .map((p) => String(p.Id)),
  )
  for (const i of invoices) {
    if (Number(i.TotalAmt ?? 0) === 0 || Number(i.Balance ?? 1) !== 0) continue
    const links = linkedOf(i)
    const direct = links.filter((l) => l.TxnType === 'CreditMemo')
    const pays = links.filter((l) => l.TxnType === 'Payment')
    if ((direct.length || pays.length) && pays.every((l) => creditOnly.has(String(l.TxnId)))) out.add(String(i.Id))
  }
  return out
}

async function listOrphans(admin: SupabaseClient) {
  const { token, realm } = await accessToken(admin)
  const [invoices, known] = await Promise.all([
    queryAll(token, realm, admin, `select * from Invoice where TxnDate >= '${ORPHANS_FROM}'`, 'Invoice'),
    admin.schema('xano_mirror').from('invoices').select('qbo_invoice_id'),
  ])
  if (known.error) throw new Error('Could not read the app\u2019s invoices.')
  const ids = new Set(
    ((known.data ?? []) as { qbo_invoice_id: string | null }[])
      .map((r) => (r.qbo_invoice_id ?? '').trim())
      .filter(Boolean),
  )
  const missing = invoices.filter((i) => !ids.has(String(i.Id)))
  const cancelled = await cancelledIds(token, realm, admin, missing)
  return missing
    .filter((i) => !cancelled.has(String(i.Id)))
    .map((i) => ({
      id: String(i.Id),
      doc_number: (i.DocNumber as string | undefined) ?? null,
      txn_date: (i.TxnDate as string | undefined) ?? null,
      customer: (i.CustomerRef as { name?: string } | undefined)?.name ?? '',
      currency: (i.CurrencyRef as { value?: string } | undefined)?.value ?? null,
      total: Number(i.TotalAmt ?? 0),
    }))
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const userId = await financeUser(req)
  if (!userId) return json({ error: 'Only finance can use QuickBooks from here.' }, 403, origin)

  let body: {
    action?: string
    return_to?: unknown
    doc_number?: unknown
    environment?: unknown
    uuid?: unknown
    kind?: unknown
    sequel_id?: unknown
    currency?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const bodyEnv: Env = body.environment === 'sandbox' ? 'sandbox' : 'production'

  if (body.action === 'connect') {
    const { id: clientId, secret } = intuitKeys(bodyEnv)
    if (!clientId || !secret) {
      return json({ error: `QuickBooks ${bodyEnv} keys are not set on the server.` }, 500, origin)
    }
    const returnTo = safeReturnTo(body.return_to)
    if (!returnTo) return json({ error: 'return_to is not one of this app’s pages.' }, 400, origin)

    const state = randomState()
    const { error } = await admin
      .from('qbo_oauth_state')
      .insert({ state, user_id: userId, return_to: returnTo, environment: bodyEnv })
    if (error) return json({ error: 'Could not start the QuickBooks connection.' }, 500, origin)

    const url = new URL(AUTHORISE_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPE)
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    url.searchParams.set('state', state)
    return json({ url: url.toString() }, 200, origin)
  }

  if (body.action === 'vendors') {
    try {
      const vendors = await listVendors(admin)
      return json({ connected: true, vendors }, 200, origin)
    } catch (e) {
      if (e instanceof NotConnected) return json({ connected: false, error: e.message }, 200, origin)
      return json({ error: e instanceof Error ? e.message : 'QuickBooks failed.' }, 502, origin)
    }
  }

  if (body.action === 'payment_times') {
    try {
      return json({ connected: true, ...(await paymentTimes(admin)) }, 200, origin)
    } catch (e) {
      if (e instanceof NotConnected) return json({ connected: false, error: e.message }, 200, origin)
      return json({ error: e instanceof Error ? e.message : 'QuickBooks failed.' }, 502, origin)
    }
  }

  if (body.action === 'bills') {
    try {
      return json({ connected: true, bills: await listBills(admin) }, 200, origin)
    } catch (e) {
      if (e instanceof NotConnected) return json({ connected: false, error: e.message }, 200, origin)
      return json({ error: e instanceof Error ? e.message : 'QuickBooks failed.' }, 502, origin)
    }
  }

  if (body.action === 'invoice') {
    // Read only. For reconciling an invoice QuickBooks has and the app does
    // not (an orphaned raise). The number is checked before it goes near the
    // query string.
    const doc = typeof body.doc_number === 'string' ? body.doc_number.trim() : ''
    if (!/^[A-Za-z0-9-]{1,21}$/.test(doc)) return json({ error: 'doc_number is not valid' }, 400, origin)
    try {
      const { token, realm } = await accessToken(admin)
      const rows = await queryAll(
        token,
        realm,
        admin,
        `select * from Invoice where DocNumber = '${doc}'`,
        'Invoice',
      )
      return json({ connected: true, invoices: rows }, 200, origin)
    } catch (e) {
      if (e instanceof NotConnected) return json({ connected: false, error: e.message }, 200, origin)
      return json({ error: e instanceof Error ? e.message : 'QuickBooks failed.' }, 502, origin)
    }
  }

  if (body.action === 'orphans') {
    try {
      return json({ connected: true, orphans: await listOrphans(admin) }, 200, origin)
    } catch (e) {
      if (e instanceof NotConnected) return json({ connected: false, error: e.message }, 200, origin)
      return json({ error: e instanceof Error ? e.message : 'QuickBooks failed.' }, 502, origin)
    }
  }

  if (body.action === 'disconnect') {
    // Revoke at Intuit first, so the grant is gone there and not just
    // forgotten here; then drop the row whatever Intuit said, because a
    // connection finance has asked to remove must not keep working. Revoking
    // is per Intuit app, so this cannot touch the old app's connection.
    const { data } = await admin
      .from('qbo_connection')
      .select('refresh_token, access_token')
      .eq('environment', bodyEnv)
      .maybeSingle()
    const token = (data?.refresh_token ?? data?.access_token) as string | null | undefined
    let revoked = false
    if (token) {
      const { id: clientId, secret: clientSecret } = intuitKeys(bodyEnv)
      const res = await fetch(REVOKE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ token }),
      })
      revoked = res.ok
    }
    const { error } = await admin.from('qbo_connection').delete().eq('environment', bodyEnv)
    if (error) return json({ error: 'Could not remove the QuickBooks connection.' }, 500, origin)
    return json({ ok: true, revoked }, 200, origin)
  }

  // ── the raise ──────────────────────────────────────────────────────────
  if (body.action === 'raise_check' || body.action === 'raise' || body.action === 'retry_bills') {
    const uuid = typeof body.uuid === 'string' ? body.uuid : ''
    if (!/^[0-9a-f-]{36}$/i.test(uuid)) return json({ error: 'uuid is not valid' }, 400, origin)
    const { data: inv } = await admin.schema('xano_mirror').from('invoices').select('id').eq('uuid', uuid).maybeSingle()
    if (!inv) return json({ error: 'Invoice not found.' }, 404, origin)
    const invoiceId = (inv as { id: number }).id

    try {
      if (body.action === 'raise_check') {
        return json({ connected: true, environment: RAISE_ENV, ...(await raiseCheck(admin, invoiceId, RAISE_ENV)) }, 200, origin)
      }
      const conn = await accessToken(admin, RAISE_ENV)
      if (body.action === 'raise') {
        return json({ connected: true, ...(await raiseInvoice(admin, conn, RAISE_ENV, invoiceId, userId)) }, 200, origin)
      }
      return json({ connected: true, ...(await retryBills(admin, conn, RAISE_ENV, invoiceId)) }, 200, origin)
    } catch (e) {
      if (e instanceof NotConnected) {
        const which = RAISE_ENV === 'sandbox' ? 'The QuickBooks test company' : 'QuickBooks'
        return json({ connected: false, error: `${which} is not connected.` }, 200, origin)
      }
      console.error(body.action, invoiceId, (e as Error).message)
      return json({ error: e instanceof Error ? e.message : 'QuickBooks failed.' }, 502, origin)
    }
  }

  // ── setting up the test company ─────────────────────────────────────────
  // Sandbox only, by construction: these never touch the real books.
  if (body.action === 'sandbox_lists') {
    try {
      const conn = await accessToken(admin, 'sandbox')
      const lists: Record<string, unknown> = {}
      for (const entity of ['Item', 'TaxCode', 'Term', 'Account', 'Customer', 'Vendor']) {
        lists[entity] = await queryAll(conn.token, conn.realm, admin, `select * from ${entity}`, entity, 'sandbox')
      }
      // Preferences is a single object and does not page; read it on its own.
      const pref = await fetch(`${conn.base}/v3/company/${conn.realm}/preferences?minorversion=75`, {
        headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' },
      })
      lists.Preferences = await pref.json().catch(() => null)
      return json({ connected: true, realm: conn.realm, lists }, 200, origin)
    } catch (e) {
      if (e instanceof NotConnected) return json({ connected: false, error: e.message }, 200, origin)
      return json({ error: e instanceof Error ? e.message : 'QuickBooks failed.' }, 502, origin)
    }
  }

  if (body.action === 'sandbox_link') {
    const kind = body.kind === 'vendor' ? 'vendor' : body.kind === 'customer' ? 'customer' : null
    const sequelId = Number(body.sequel_id)
    if (!kind || !Number.isInteger(sequelId) || sequelId <= 0) return json({ error: 'kind and sequel_id are required' }, 400, origin)
    try {
      const conn = await accessToken(admin, 'sandbox')
      const mirror = admin.schema('xano_mirror')
      let name = ''
      let currency = ''
      if (kind === 'customer') {
        // A customer's currency is fixed in QuickBooks and must match the
        // invoices raised to it, and a client has no currency of its own here,
        // so the caller names it.
        const { data: c } = await mirror.from('clients').select('company').eq('id', sequelId).maybeSingle()
        name = (c as { company?: string } | null)?.company ?? ''
        currency = typeof body.currency === 'string' ? body.currency : ''
      } else {
        const { data: v } = await mirror.from('supplier_list').select('title, default_currency_id').eq('id', sequelId).maybeSingle()
        name = (v as { title?: string } | null)?.title ?? ''
        const cid = (v as { default_currency_id?: number } | null)?.default_currency_id
        if (cid) {
          const { data: cur } = await mirror.from('currencies_bank_accounts').select('currency').eq('id', cid).maybeSingle()
          currency = (cur as { currency?: string } | null)?.currency ?? ''
        }
      }
      if (!name) return json({ error: `No ${kind} ${sequelId}.` }, 404, origin)
      const entity = kind === 'customer' ? 'customer' : 'vendor'
      const payload: Record<string, unknown> = { DisplayName: `${name} (${sequelId})` }
      if (currency) payload.CurrencyRef = { value: currency === 'EURO' ? 'EUR' : currency }
      const res = await fetch(`${conn.base}/v3/company/${conn.realm}/${entity}?minorversion=75`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const out = (await res.json().catch(() => ({}))) as Record<string, { Id?: string } | unknown>
      const created = (out[kind === 'customer' ? 'Customer' : 'Vendor'] as { Id?: string } | undefined)?.Id
      if (!res.ok || !created) return json({ error: 'QuickBooks would not create it.', detail: out }, 502, origin)
      const { error } = await admin
        .from('qbo_id_map')
        .upsert({ environment: 'sandbox', kind, sequel_id: sequelId, qbo_id: created })
      if (error) return json({ error: 'Created in the test company but not saved here.' }, 500, origin)
      return json({ connected: true, kind, sequel_id: sequelId, qbo_id: created, name: payload.DisplayName }, 200, origin)
    } catch (e) {
      if (e instanceof NotConnected) return json({ connected: false, error: e.message }, 200, origin)
      return json({ error: e instanceof Error ? e.message : 'QuickBooks failed.' }, 502, origin)
    }
  }

  return json({ error: 'unknown action' }, 400, origin)
})
