// quickbooks — the new app's QuickBooks calls, finance only.
//
//   { action: "connect", return_to }  -> { url }   Intuit's consent page
//   { action: "vendors" }             -> { connected, vendors?, error? }
//   { action: "disconnect" }          -> { ok, revoked }
//   { action: "payment_times" }       -> { connected, clients?, overall? }
//   { action: "bills" }               -> { connected, bills? }
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

const AUTHORISE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const API_BASE = 'https://quickbooks.api.intuit.com'
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

type Conn = {
  realm_id: string
  access_token: string | null
  access_expires_at: string | null
  refresh_token: string | null
  status: string
}

class NotConnected extends Error {}

async function readConn(admin: SupabaseClient): Promise<Conn | null> {
  const { data } = await admin
    .from('qbo_connection')
    .select('realm_id, access_token, access_expires_at, refresh_token, status')
    .eq('environment', 'production')
    .maybeSingle()
  return (data as Conn | null) ?? null
}

async function markBroken(admin: SupabaseClient, reason: string) {
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
    .eq('environment', 'production')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isFresh = (c: Conn | null) =>
  !!c?.access_token && !!c.access_expires_at && Date.parse(c.access_expires_at) > Date.now() + 120_000

/** A usable access token and realm, refreshing through the lock if needed. */
async function accessToken(admin: SupabaseClient): Promise<{ token: string; realm: string }> {
  const lock = crypto.randomUUID()

  for (let attempt = 0; attempt < 12; attempt++) {
    const { data: claim, error } = await admin.rpc('qbo_claim_refresh', { p_lock: lock, p_seconds: 30 })
    if (error) throw new Error('Could not read the QuickBooks connection.')

    if (claim === 'none') throw new NotConnected('QuickBooks is not connected.')

    if (claim === 'fresh') {
      const c = await readConn(admin)
      if (isFresh(c)) return { token: c!.access_token!, realm: c!.realm_id }
      continue
    }

    if (claim === 'busy') {
      await sleep(1000)
      continue
    }

    // claimed: this call alone refreshes.
    const c = await readConn(admin)
    if (!c?.refresh_token) throw new NotConnected('QuickBooks is not connected.')

    const clientId = Deno.env.get('QBO_CLIENT_ID') ?? ''
    const clientSecret = Deno.env.get('QBO_CLIENT_SECRET') ?? ''
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
        await markBroken(admin, 'QuickBooks refused the saved connection (invalid_grant). Reconnect.')
        throw new NotConnected('The QuickBooks connection has expired. Connect it again.')
      }
      await admin
        .from('qbo_connection')
        .update({ last_error: `refresh failed: ${reason}`, refresh_lock_id: null, refresh_lock_until: null })
        .eq('environment', 'production')
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
      .eq('environment', 'production')
      .eq('refresh_lock_id', lock)
    if (saveError) throw new Error('QuickBooks refreshed but the new token could not be saved.')

    return { token: body.access_token, realm: c.realm_id }
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
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  const PAGE = 1000
  for (let start = 1; ; start += PAGE) {
    const query = `${select} startposition ${start} maxresults ${PAGE}`
    const url = `${API_BASE}/v3/company/${realm}/query?minorversion=75&query=${encodeURIComponent(query)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (res.status === 401) {
      await markBroken(admin, 'QuickBooks rejected the access token (401). Reconnect.')
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

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const userId = await financeUser(req)
  if (!userId) return json({ error: 'Only finance can use QuickBooks from here.' }, 403, origin)

  let body: { action?: string; return_to?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  if (body.action === 'connect') {
    const clientId = Deno.env.get('QBO_CLIENT_ID') ?? ''
    if (!clientId || !Deno.env.get('QBO_CLIENT_SECRET')) {
      return json({ error: 'QuickBooks keys are not set on the server.' }, 500, origin)
    }
    const returnTo = safeReturnTo(body.return_to)
    if (!returnTo) return json({ error: 'return_to is not one of this app’s pages.' }, 400, origin)

    const state = randomState()
    const { error } = await admin.from('qbo_oauth_state').insert({ state, user_id: userId, return_to: returnTo })
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

  if (body.action === 'disconnect') {
    // Revoke at Intuit first, so the grant is gone there and not just
    // forgotten here; then drop the row whatever Intuit said, because a
    // connection finance has asked to remove must not keep working. Revoking
    // is per Intuit app, so this cannot touch the old app's connection.
    const { data } = await admin
      .from('qbo_connection')
      .select('refresh_token, access_token')
      .eq('environment', 'production')
      .maybeSingle()
    const token = (data?.refresh_token ?? data?.access_token) as string | null | undefined
    let revoked = false
    if (token) {
      const clientId = Deno.env.get('QBO_CLIENT_ID') ?? ''
      const clientSecret = Deno.env.get('QBO_CLIENT_SECRET') ?? ''
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
    const { error } = await admin.from('qbo_connection').delete().eq('environment', 'production')
    if (error) return json({ error: 'Could not remove the QuickBooks connection.' }, 500, origin)
    return json({ ok: true, revoked }, 200, origin)
  }

  return json({ error: 'unknown action' }, 400, origin)
})
