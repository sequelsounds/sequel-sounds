// release-form — draws a clearance letter and puts it in S3.
//
//   staff (their session as bearer):
//     { action: "create", project_id, recipient_name, recipient_address,
//       brand, campaign, track_name, term, territory, media, scripts }
//         -> the row is written FIRST (track_create_release_form), which is
//            what decides the key, the signer and the date; then the PDF is
//            drawn here and PUT to that key; a read url comes back with it
//     { action: "update", uuid, ...the same fields }
//         -> the row is updated, the PDF is REDRAWN OVER THE SAME KEY, and a
//            fresh read url comes back
//     { action: "read", uuid, download?: true }
//         -> a GET url for the file
//     { action: "send", uuid, to, subject }
//         -> emails a LINK to the stored PDF, copying the sender and setting
//            Reply-To to them, with the words the sender actually wrote
//
// ⚠️ THE DATABASE DECIDES, NOT THIS FILE — the same rule as sign-contract. Both
// actions call a SECURITY DEFINER function AS THE CALLER, which checks
// track_is_staff() and hands back the only key this function will sign. The
// caller never names a key, and never names the signer either: whose name goes
// on a letter telling a broadcaster music is cleared is not the browser's
// business.
//
// ⚠️ THE UPLOAD HAPPENS HERE, not in the browser. Contracts presign a PUT
// because the browser holds the file; here the function holds it, so it signs
// its own request and writes the object itself. If the write fails the row is
// discarded, so a listed release form always has a file behind it.
//
// ⚠️ THE KEY LIVES UNDER contracts/release-forms/. Not because these are
// contracts — they are not — but because sequel-sounds-signer already holds
// Put/Get/Delete on contracts/* and a new top-level prefix would need a new
// IAM policy before anything could be saved at all.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { buildReleaseForm, londonLongDate } from './pdf.ts'

const RESEND_API = 'https://api.resend.com/emails'

/**
 * ⚠️ THE DESIGN LIVES IN RESEND, NOT HERE — Andy, 20 Sep. A hand-written
 * HTML email was built first and binned: Sequel already had a template
 * (song-registration-request-v2) that defines what a Sequel email looks like,
 * and a second look written in TypeScript is a second look to keep in step.
 * This one is its sibling — same shell, same wordmark, same footer.
 *
 * ⚠️ THE BODY COPY IS FIXED AND LIVES IN THE TEMPLATE — Andy, 20 Sep:
 * *"the email just need to be a generic you've been sent a release form. No
 * note is needed."* A per-send message was built first and removed. Nothing
 * this function sends is written by the sender any more.
 *
 * ⚠️ ITS VARIABLES HAVE NO FALLBACKS, deliberately. Resend refuses a send
 * that omits one, which is the behaviour we want: a release form that reaches a
 * broadcaster with a blank Territory is worse than one that fails to send.
 * Every variable below is therefore passed on EVERY send, even when empty.
 *
 * ⚠️ A wording or layout change is made in Resend and needs no deploy. Keep
 * `Claude outputs/release-form-template.html` in step as the readable copy —
 * the last time a Sequel template could not be read from the repo, nobody could
 * say what the email said (see the 16 Sep note on template 9a24f397).
/**
 * ⚠️ NOT registrations@ — Andy, 19 Sep: *"why has it come from
 * registrations?"*. It did because this copied the Schedule A's sender, which
 * was the wrong thing to copy: registrations@ is named for SONG REGISTRATIONS,
 * and this is a named person telling a broadcaster that music is cleared.
 *
 * ⚠️ AND NOT A SUBDOMAIN. A send.sequelsounds.com sender was proposed on
 * deliverability grounds and rejected by Andy — *"the emails should come from
 * sequelsounds.com or it looks dodge"*. He is right for this case: subdomain
 * separation exists to stop high-volume marketing poisoning transactional mail,
 * and Sequel sends a handful of one-to-one letters a month. Amazon, PayPal and
 * GitHub all send from their root domain for the same reason.
 *
 * ⚠️ THE ADDRESS IS A SHARED MAILBOX, THE NAME IS A PERSON. notifications@
 * exists in Microsoft 365 (Andy created it, 19 Sep) so bounces, out-of-office
 * replies and auto-responders have somewhere to land rather than hard-bouncing,
 * which mailbox providers notice. What a recipient reads is the display name,
 * which is the supervisor who signed the letter.
 */
const EMAIL_SENDER_ADDRESS =
  Deno.env.get('RELEASE_FORM_FROM') ?? 'notifications@sequelsounds.com'

/** The Resend template. Overridable so a redesign can be tried without a
 *  deploy, but the id below is the live one (Andy created it 20 Sep). */
const RELEASE_FORM_TEMPLATE_ID =
  Deno.env.get('RELEASE_FORM_TEMPLATE_ID') ?? 'c541ed52-2438-427b-bba4-e9553c0a39d6'

/**
 * `Name — Sequel <addr>`.
 *
 * ⚠️ The name is stripped of anything that could break or inject a header.
 * It comes from the database rather than the browser, but a display name is
 * still the one part of this a person typed.
 */
function sender(name: string) {
  const clean = name.replace(/[\r\n"<>,;:]/g, '').trim()
  return clean
    ? `${clean} — Sequel <${EMAIL_SENDER_ADDRESS}>`
    : `Sequel <${EMAIL_SENDER_ADDRESS}>`
}

const READ_TTL_SECONDS = 3600
/** Belt and braces: only this prefix is ever signed, whatever the row says. */
const KEY_RE = /^contracts\/release-forms\/[0-9a-f-]{36}\.pdf$/

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
  /^https:\/\/[^.]+\.sequelsounds\.app$/,
  /^https:\/\/sequel-sounds\.andy-4c2\.workers\.dev$/,
]

/** ⚠️ CORS IS LOAD-BEARING. The browser preflights any POST carrying an
 *  Authorization header, and curl does not — so a function with no OPTIONS
 *  handler passes every command-line test and fails in the app. */
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

  /** Draw the letter and put it at the key the database chose. Shared by
   *  create and update precisely so the two cannot draw different documents. */
  const drawAndStore = async (
    row: {
      key: string
      signer_name: string
      signer_signature: string | null
      signer_signature_kind: 'drawn' | 'typed'
      issued_on: string
    },
  ) => {
    const pdf = await buildReleaseForm({
      recipient_name: String(body.recipient_name ?? '').trim(),
      recipient_address: String(body.recipient_address ?? '').trim() || null,
      brand: String(body.brand ?? '').trim(),
      campaign: String(body.campaign ?? '').trim(),
      track_name: String(body.track_name ?? '').trim(),
      term: String(body.term ?? '').trim(),
      territory: String(body.territory ?? '').trim(),
      media: String(body.media ?? '').trim(),
      scripts: String(body.scripts ?? '').trim(),
      signer_name: String(row.signer_name),
      /** Whoever ISSUED it, not whoever is editing — the name printed under it
       *  does not change on an edit, so neither does the hand above it. */
      signer_signature: row.signer_signature ?? null,
      signer_signature_kind: row.signer_signature_kind === 'typed' ? 'typed' : 'drawn',
      issued_on: londonLongDate(new Date(`${row.issued_on}T12:00:00Z`)),
    })
    return await aws.fetch(objectUrl(cfg.bucket, cfg.region, row.key).toString(), {
      method: 'PUT',
      body: pdf,
      headers: { 'Content-Type': 'application/pdf' },
    })
  }

  // ----------------------------------------------------------------- create
  if (body.action === 'create') {
    const { data, error } = await asCaller.rpc('track_create_release_form', {
      p_project_id: Number(body.project_id),
      p_recipient_name: String(body.recipient_name ?? ''),
      p_recipient_address: String(body.recipient_address ?? ''),
      p_brand: String(body.brand ?? ''),
      p_campaign: String(body.campaign ?? ''),
      p_track_name: String(body.track_name ?? ''),
      p_term: String(body.term ?? ''),
      p_territory: String(body.territory ?? ''),
      p_media: String(body.media ?? ''),
      p_scripts: String(body.scripts ?? ''),
      p_recipient_email: String(body.recipient_email ?? ''),
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
      await asCaller.rpc('track_discard_release_form', { p_uuid: data.uuid })
      console.error('release-form: drawing failed', e)
      return json({ error: 'The release form could not be drawn.' }, 500, origin)
    }
    if (!put.ok) {
      const detail = await put.text().catch(() => '')
      await asCaller.rpc('track_discard_release_form', { p_uuid: data.uuid })
      console.error('release-form: S3 refused the PUT', put.status, detail.slice(0, 500))
      /** ⚠️ 403 HERE IS AN IAM POLICY, NOT A BUG. sequel-sounds-signer needs
       *  Put/Get on contracts/* in sequel-sounds-media — the inline policy
       *  sequel-sounds-media-contracts-rw. */
      if (put.status === 403) {
        return json(
          { error: 'Storage will not accept release forms yet — the upload key has no permission for that folder.' },
          403,
          origin,
        )
      }
      return json({ error: 'That form could not be saved. Please try again.' }, 502, origin)
    }

    return json(
      { uuid: data.uuid, ref: data.ref, url: await signRead(data.key) },
      200,
      origin,
    )
  }

  // ------------------------------------------------------------------- read
  if (body.action === 'read') {
    const { data, error } = await asCaller.rpc('track_release_form_key', {
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
  // ⚠️ THE KEY DOES NOT CHANGE. The corrected letter is written over the old
  // one, so a link already shared keeps working and shows the correction. A new
  // key each save would leave a stale file in S3 that a live url still points
  // at — a broadcaster holding superseded terms and no way to tell.
  if (body.action === 'update') {
    const { data, error } = await asCaller.rpc('track_update_release_form', {
      p_uuid: String(body.uuid ?? ''),
      p_recipient_name: String(body.recipient_name ?? ''),
      p_recipient_address: String(body.recipient_address ?? ''),
      p_recipient_email: String(body.recipient_email ?? ''),
      p_brand: String(body.brand ?? ''),
      p_campaign: String(body.campaign ?? ''),
      p_track_name: String(body.track_name ?? ''),
      p_term: String(body.term ?? ''),
      p_territory: String(body.territory ?? ''),
      p_media: String(body.media ?? ''),
      p_scripts: String(body.scripts ?? ''),
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
      console.error('release-form: redrawing failed', e)
      return json({ error: 'The changes were saved but the document could not be redrawn.' }, 500, origin)
    }
    if (!put.ok) {
      console.error('release-form: S3 refused the PUT on update', put.status)
      return json({ error: 'The changes were saved but the document could not be stored.' }, 502, origin)
    }
    return json({ uuid: data.uuid, ref: data.ref, url: await signRead(data.key) }, 200, origin)
  }

  // ------------------------------------------------------------------- send
  // The stored PDF, emailed as an attachment. Nothing is drawn here: what the
  // broadcaster receives is the same bytes the link serves.
  if (body.action === 'send') {
    const { data: detail, error } = await asCaller.rpc('track_release_form_detail', {
      p_uuid: String(body.uuid ?? ''),
    })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    /* ⚠️ THE ADDRESS AND THE WORDS COME FROM THE SENDER — Andy, 19 Sep. They
     * came from the row and a fixed template until then, which meant one click
     * on a menu put a letter in a broadcaster's inbox under a message nobody
     * at Sequel had ever read. The compose modal is what changed; this end just
     * honours what it was given. The DOCUMENT is still the database's to
     * decide — the browser never names a form, a key or a link. */
    /* ⚠️⚠️ NEVER FALL BACK TO THE ADDRESS ON THE FORM. This line used to
     * read `body.to ?? detail.recipient_email`, so a browser that failed to
     * send an address got a silent substitution of the client stored on the
     * record — turning "send to whoever I typed" into "send to the client".
     * On 21 Sep a test release form reached a real Ogilvy contact that way.
     * A send with no explicit recipient is refused, always. */
    const to = String(body.to ?? '').trim()
    if (!to) {
      return json({ error: 'No recipient was given, so nothing was sent.' }, 400, origin)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ error: `\u201c${to}\u201d is not an email address.` }, 400, origin)
    }

    const key = Deno.env.get('RESEND_API_KEY')
    if (!key) {
      return json({ error: 'Email is not configured on the server (RESEND_API_KEY).' }, 500, origin)
    }

    /* ⚠️ NO KEY IS SIGNED AND NOTHING IS DOWNLOADED HERE ANY MORE. The email
     * carries a link to the share page, which signs the url itself when it is
     * opened — and which is where the open and the download are recorded. */
    const { data: linkRow, error: linkErr } = await asCaller.rpc(
      'track_release_form_send_link',
      { p_uuid: String(body.uuid ?? '') },
    )
    if (linkErr) {
      const e = dbError(linkErr)
      return json({ error: e.message }, e.status, origin)
    }
    const base = (Deno.env.get('APP_BASE_URL') ?? 'https://app.sequelsounds.com').replace(/\/+$/, '')
    const link = `${base}/link?id=${linkRow.code}`

    /* ⚠️ REPLY-TO AND CC ARE BOTH THE SUPERVISOR, and that pair is the whole
     * trick. With Reply-To set, Gmail and Outlook SUBSTITUTE it for the From
     * address, so Reply goes to the supervisor and Reply All goes to the
     * supervisor twice — notifications@ is dropped from both and never has to
     * answer for itself.
     *
     * The address comes from the caller's own row, never from the browser. */
    /* ⚠️ THE GREETING IS RESOLVED FROM THE ADDRESS BEING SENT TO — Andy,
     * 20 Sep. Not from the form: `recipient_name` there is the COMPANY, and
     * the To box is editable here, so a name stored on the form could greet
     * somebody who is not receiving the email. Unknown address falls back to
     * "To whom it may concern," inside the function. */
    const { data: greeting } = await asCaller.rpc('track_greeting_for_email', { p_email: to })

    const { data: meRows } = await asCaller.rpc('track_me')
    const meRow = (Array.isArray(meRows) ? meRows[0] : null) as
      | { name?: string; email?: string }
      | null
    const mine = typeof meRow?.email === 'string' && meRow.email.includes('@') ? meRow.email : ''
    const cc = mine ? [mine] : []
    const from = sender(String(meRow?.name ?? ''))

    const subject =
      (String(body.subject ?? '').trim() || `Music release | ${detail.brand} \u2014 ${detail.campaign}`)
        .slice(0, 200)

    /* ⚠️ FIVE VARIABLES, NOT TEN — Andy, 21 Sep: *"all this email needs to say
     * is hey luke here's your release form."* The ref headline and the
     * Term/Territory/Media/Scripts panel were dropped: they are on the PDF the
     * button opens, and the email restating them made it a summary of a
     * document rather than a note carrying one. Do not add them back without
     * asking — this is the second time this email has been cut down. */
    const variables = {
      track_name: String(detail.track_name ?? ''),
      brand: String(detail.brand ?? ''),
      campaign: String(detail.campaign ?? ''),
      view_url: link,
      greeting: typeof greeting === 'string' && greeting ? greeting : 'Hi there,',
    }

    let sendError: string | null = null
    try {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from,
          to: [to],
          ...(cc.length ? { cc } : {}),
          ...(mine ? { reply_to: mine } : {}),
          subject,
          template: { id: RELEASE_FORM_TEMPLATE_ID, variables },
        }),
      })
      if (!res.ok) sendError = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`
    } catch (e) {
      sendError = (e as Error).message
    }

    await asCaller.rpc('track_mark_release_form_sent', {
      p_uuid: String(body.uuid ?? ''),
      p_to: to,
      p_error: sendError,
    })
    if (sendError) {
      console.error('release-form: send failed', sendError)
      /** ⚠️ Resend DNS for sequelsounds.com is on the outstanding list (18 Sep
       *  handover). A 403 here is very likely that, not this code. */
      return json({ error: `That did not send. ${sendError}` }, 502, origin)
    }
    return json({ sent_to: to, cc, link }, 200, origin)
  }

  return json({ error: 'unknown action' }, 400, origin)
})
