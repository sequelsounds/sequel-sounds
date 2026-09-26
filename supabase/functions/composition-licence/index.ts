// composition-licence — draws a composition licence and puts it in S3.
//
//   staff (their session as bearer):
//     { action: "create", project_id, invoice_id, fields: {...} }
//         -> the row is written FIRST (track_create_composition_licence), which
//            is what decides the key, the Sequel No., the issue date and — the
//            point of the whole design — the INVOICE NUMBER. Then the PDF is
//            drawn here and PUT to that key; a read url comes back with it.
//     { action: "update", uuid, fields: {...} }
//         -> the row is updated and the PDF REDRAWN OVER THE SAME KEY
//     { action: "read", uuid, download?: true }
//         -> a GET url for the file
//     { action: "send", uuid, to }
//         -> emails a LINK to the licence, copying the sender
//
// ⚠️ INVOICE FIRST — Andy, 25 Sep 2026: "a client doesn't get a licence without
// the invoice being raised first." The number printed on the certificate comes
// from the invoice row via the database. The browser picks WHICH raised invoice;
// it never supplies the number, and the database refuses an unraised one.
//
// ⚠️ THE DATABASE DECIDES, NOT THIS FILE — the same rule as release-form. Every
// action calls a SECURITY DEFINER function AS THE CALLER, which checks
// track_is_staff() and hands back the only key this function will write.
//
// ⚠️ THE KEY LIVES UNDER contracts/licences/ — sequel-sounds-signer already
// holds Put/Get on contracts/*, so no IAM change was needed.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { buildLicence, londonLongDate, type LicenceInput } from './pdf.ts'

const READ_TTL_SECONDS = 3600
/** Same sender as the release form: a person's name on the shared
 *  notifications@ mailbox, with Reply-To and Cc set to that person. */
const EMAIL_SENDER_ADDRESS = Deno.env.get('RELEASE_FORM_FROM') ?? 'notifications@sequelsounds.com'
/** ⚠️ THE WORDS LIVE IN RESEND, NOT HERE (Andy, 20 Sep). Template
 *  "Composition licence" (alias composition-licence), made 26 Sep from the
 *  release form's. It must be PUBLISHED in Resend before a send will work. */
const LICENCE_TEMPLATE_ID =
  Deno.env.get('LICENCE_TEMPLATE_ID') ?? 'ded30423-9959-4e86-a93c-ad3ece1690f0'
/** Belt and braces: only this prefix is ever written or signed, whatever the row says. */
const KEY_RE = /^contracts\/licences\/[0-9a-f-]{36}\.pdf$/

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
  /^https:\/\/[^.]+\.sequelsounds\.app$/,
  /^https:\/\/sequel-sounds\.andy-4c2\.workers\.dev$/,
]

/** ⚠️ CORS IS LOAD-BEARING. The browser preflights a POST carrying an
 *  Authorization header, and curl does not. */
function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.some((re) => re.test(origin)) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

function readConfig() {
  const missing: string[] = []
  const get = (name: string) => {
    const v = Deno.env.get(name)
    if (!v) missing.push(name)
    return v ?? ''
  }
  const cfg = {
    bucket: get('S3_BUCKET'),
    region: get('S3_REGION'),
    accessKeyId: get('S3_ACCESS_KEY_ID'),
    secretAccessKey: get('S3_SECRET_ACCESS_KEY'),
  }
  return { cfg, problems: missing.map((m) => `${m} is not set`) }
}

function objectUrl(bucket: string, region: string, key: string) {
  const path = key.split('/').map(encodeURIComponent).join('/')
  return new URL(`https://${bucket}.s3.${region}.amazonaws.com/${path}`)
}

function disposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function dbError(error: { code?: string; message?: string }) {
  const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 400
  return { status, message: error.message ?? 'That did not work.' }
}

/** Only these keys are passed to the database, trimmed, as strings. */
const FIELDS = [
  'licensee_name', 'licensee_address', 'rights_granted', 'licensor_share', 'composition_title',
  'writer_names', 'production_name', 'client_name', 'brand', 'campaign', 'scripts', 'cutdowns',
  'media', 'territory', 'term', 'first_transmission', 'licence_fee',
] as const

// deno-lint-ignore no-explicit-any
function pickFields(raw: any) {
  const out: Record<string, string> = {}
  for (const k of FIELDS) out[k] = String(raw?.[k] ?? '').trim()
  return out
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const { cfg, problems } = readConfig()
  if (problems.length) return json({ error: 'storage is misconfigured', problems }, 500, origin)

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }

  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: 's3',
  })

  const signRead = async (key: string, download?: string) => {
    const target = objectUrl(cfg.bucket, cfg.region, key)
    target.searchParams.set('X-Amz-Expires', String(READ_TTL_SECONDS))
    if (download) target.searchParams.set('response-content-disposition', disposition(download))
    const signed = await aws.sign(target.toString(), { method: 'GET', aws: { signQuery: true } })
    return signed.url
  }

  const authorization = req.headers.get('authorization') ?? ''
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  })

  /**
   * Draw the licence FROM THE ROW the database returned, not from the request —
   * so the invoice number, Sequel No. and issue date on the page are always the
   * database's, and create and update cannot draw different documents.
   */
  // deno-lint-ignore no-explicit-any
  const drawAndStore = async (row: any) => {
    const input: LicenceInput = {
      sequel_no: String(row.sequel_no),
      issued_on: londonLongDate(new Date(`${row.issued_on}T12:00:00Z`)),
      licensee_name: String(row.licensee_name),
      licensee_address: String(row.licensee_address ?? '') || null,
      invoice_number: String(row.invoice_number),
      rights_granted: String(row.rights_granted),
      licensor_share: String(row.licensor_share),
      composition_title: String(row.composition_title),
      writer_names: String(row.writer_names),
      production_name: String(row.production_name),
      client_name: String(row.client_name),
      brand: String(row.brand),
      campaign: String(row.campaign),
      scripts: String(row.scripts),
      cutdowns: String(row.cutdowns),
      media: String(row.media),
      territory: String(row.territory),
      term: String(row.term),
      first_transmission: String(row.first_transmission),
      licence_fee: String(row.licence_fee),
    }
    const pdf = await buildLicence(input)
    return await aws.fetch(objectUrl(cfg.bucket, cfg.region, row.key).toString(), {
      method: 'PUT',
      body: pdf,
      headers: { 'Content-Type': 'application/pdf' },
    })
  }

  // ----------------------------------------------------------------- create
  if (body.action === 'create') {
    const { data, error } = await asCaller.rpc('track_create_composition_licence', {
      p_project_id: Number(body.project_id),
      p_invoice_id: Number(body.invoice_id),
      p_fields: pickFields(body.fields),
    })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    if (!KEY_RE.test(data.key)) return json({ error: 'bad key' }, 500, origin)

    let put: Response
    try {
      put = await drawAndStore(data)
    } catch (e) {
      await asCaller.rpc('track_discard_composition_licence', { p_uuid: data.uuid })
      console.error('composition-licence: drawing failed', e)
      return json({ error: 'The licence could not be drawn.' }, 500, origin)
    }
    if (!put.ok) {
      const detail = await put.text().catch(() => '')
      await asCaller.rpc('track_discard_composition_licence', { p_uuid: data.uuid })
      console.error('composition-licence: S3 refused the PUT', put.status, detail.slice(0, 500))
      return json({ error: 'That licence could not be saved. Please try again.' }, 502, origin)
    }
    return json({ uuid: data.uuid, ref: data.ref, url: await signRead(data.key) }, 200, origin)
  }

  // ------------------------------------------------------------------- read
  if (body.action === 'read') {
    const { data, error } = await asCaller.rpc('track_composition_licence_key', {
      p_uuid: String(body.uuid ?? ''),
    })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    if (!KEY_RE.test(data.key)) return json({ error: 'bad key' }, 500, origin)
    return json(
      { url: await signRead(data.key, body.download ? String(data.file_name) : undefined) },
      200,
      origin,
    )
  }

  // ----------------------------------------------------------------- update
  // ⚠️ THE KEY DOES NOT CHANGE: the corrected licence is written over the old
  // one, so a link already shared shows the correction rather than a stale file.
  if (body.action === 'update') {
    const { data, error } = await asCaller.rpc('track_update_composition_licence', {
      p_uuid: String(body.uuid ?? ''),
      p_fields: pickFields(body.fields),
    })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    if (!KEY_RE.test(data.key)) return json({ error: 'bad key' }, 500, origin)
    let put: Response
    try {
      put = await drawAndStore(data)
    } catch (e) {
      console.error('composition-licence: redrawing failed', e)
      return json({ error: 'The changes were saved but the document could not be redrawn.' }, 500, origin)
    }
    if (!put.ok) {
      console.error('composition-licence: S3 refused the PUT on update', put.status)
      return json({ error: 'The changes were saved but the document could not be stored.' }, 502, origin)
    }
    return json({ uuid: data.uuid, ref: data.ref, url: await signRead(data.key) }, 200, origin)
  }

  // ------------------------------------------------------------------- send
  // Same shape as the release form's send: a LINK to the share page, never an
  // attachment; the words live in the Resend template; the address is typed by
  // the sender every time and there is NO fallback to anything stored.
  if (body.action === 'send') {
    const { data: detail, error } = await asCaller.rpc('track_composition_licence_detail', {
      p_uuid: String(body.uuid ?? ''),
    })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    /* ⚠️⚠️ NEVER FALL BACK TO A STORED ADDRESS — the release form lesson of
     * 21 Sep, when a test letter reached a real Ogilvy contact that way. */
    const to = String(body.to ?? '').trim()
    if (!to) return json({ error: 'No recipient was given, so nothing was sent.' }, 400, origin)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ error: `“${to}” is not an email address.` }, 400, origin)
    }
    const key = Deno.env.get('RESEND_API_KEY')
    if (!key) return json({ error: 'Email is not configured on the server (RESEND_API_KEY).' }, 500, origin)

    const { data: linkRow, error: linkErr } = await asCaller.rpc('track_licence_send_link', {
      p_uuid: String(body.uuid ?? ''),
      p_to: to,
    })
    if (linkErr) {
      const e = dbError(linkErr)
      return json({ error: e.message }, e.status, origin)
    }
    const base = (Deno.env.get('APP_BASE_URL') ?? 'https://app.sequelsounds.com').replace(/\/+$/, '')
    // ⚠️ The licence page, not /link (the asset page) — Andy, 26 Sep.
    const link = `${base}/licence?id=${linkRow.code}`

    const { data: greeting } = await asCaller.rpc('track_greeting_for_email', { p_email: to })
    const { data: meRows } = await asCaller.rpc('track_me')
    const meRow = (Array.isArray(meRows) ? meRows[0] : null) as { name?: string; email?: string } | null
    const mine = typeof meRow?.email === 'string' && meRow.email.includes('@') ? meRow.email : ''
    const cc = mine ? [mine] : []
    const name = String(meRow?.name ?? '').replace(/[\r\n"<>,;:]/g, '').trim()
    const from = name ? `${name} — Sequel <${EMAIL_SENDER_ADDRESS}>` : `Sequel <${EMAIL_SENDER_ADDRESS}>`
    const subject = (String(body.subject ?? '').trim() ||
      `Licence | ${detail.brand} — ${detail.campaign}`).slice(0, 200)

    /* Every variable on every send, even when empty: the template has no
     * fallbacks, so Resend refuses a send that omits one. */
    const variables = {
      greeting: typeof greeting === 'string' && greeting ? greeting : 'Hi there,',
      track_name: String(detail.composition_title ?? ''),
      brand: String(detail.brand ?? ''),
      campaign: String(detail.campaign ?? ''),
      invoice_number: String(detail.invoice_number ?? ''),
      view_url: link,
    }

    let sendError: string | null = null
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from,
          to: [to],
          ...(cc.length ? { cc } : {}),
          ...(mine ? { reply_to: mine } : {}),
          subject,
          template: { id: LICENCE_TEMPLATE_ID, variables },
        }),
      })
      if (!res.ok) sendError = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`
    } catch (e) {
      sendError = (e as Error).message
    }
    await asCaller.rpc('track_mark_licence_sent', {
      p_uuid: String(body.uuid ?? ''),
      p_to: to,
      p_error: sendError,
    })
    if (sendError) {
      console.error('composition-licence: send failed', sendError)
      return json({ error: `That did not send. ${sendError}` }, 502, origin)
    }
    return json({ sent_to: to, cc, link }, 200, origin)
  }

  return json({ error: 'unknown action' }, 400, origin)
})
