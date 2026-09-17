// song-schedule-a — a new song, the composer's confirmation, and the Schedule A.
//
// Staff (a signed-in staff session):
//   { action: "create", project_id, supplier_id, ownership }
//        -> { song_id, uuid, emailed, email_error? }
//   { action: "resend_link", song_id }        -> { emailed, email_error? }
//   { action: "document", song_id }           -> { url }  signed copy, 10 minutes
//
// Public (the composer; the song's uuid is the only credential, as in the old
// app's /song-confirmation):
//   { action: "status", uuid }  -> { state, schedule? }
//   { action: "submit", uuid, track_title, writers }  -> { state, schedule?, error? }
//   { action: "sign", uuid, name, consent, details_hash }  -> { state, error?, schedule? }
//
// state is one of: invalid · open · sign · done. `schedule` (with state
// "sign") is what the page shows: the Schedule A's details, their hash, the
// consent wording and where the signed copy will go.
//
// What changed from the old app (Andy, 16 Sep 2026): the email goes to the
// supplier's contract email; the confirmation saves in one transaction; and
// the page then shows the Schedule A, filled in, to be signed right there —
// replacing the SharePoint + BoldSign second half. Signing is Sequel's own:
// Firma's embedded signing was tried the same evening and dropped (slow, its
// own terms to accept, its styling in a frame, a long wait after signing).
//
// A signature here is a typed name plus a ticked consent. What makes it
// stand up is the record: the signed PDF carries a second page saying who
// signed, when, from which IP and browser, and a hash of the details they
// were shown; the same is kept on the song, with a hash of the stored file.
//
// Secrets: RESEND_API_KEY (the link email and the signed copy). Optional:
// SCHEDULE_A_COPY_TO, comma-separated addresses that get a copy of every
// signed Schedule A. If a secret is missing the function says so; it never
// fails silently.
//
// ⚠️ Nothing here returns or logs a key.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { buildScheduleA, loadFonts, londonTime } from './pdf.ts'

// deno-lint-ignore no-explicit-any
type Client = SupabaseClient<any, any, any>

/**
 * Work that may finish after the response: Supabase's runtime keeps the
 * worker alive for it. Where that is missing (local runs), it is awaited.
 */
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
async function inBackground(p: Promise<unknown>): Promise<void> {
  const settled = p.catch((e) => console.error('background task failed', (e as Error).message))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(settled)
  else await settled
}

const RESEND_API = 'https://api.resend.com/emails'
// The old app's own: Xano table trigger 11, read 16 Sep.
const EMAIL_FROM = 'Sequel <registrations@sequelsounds.com>'
const EMAIL_SUBJECT = 'Action needed | Confirm song registration details'
const EMAIL_TEMPLATE_ID = '9a24f397-9f6f-4e27-a7dc-0a7a13749b0f'
const BUCKET = 'schedule-a'
const SIGNED_SUBJECT = 'Your signed Schedule A'

/** The wording the signer ticks. Stored with the signature, word for word. */
const CONSENT =
  'I agree to sign this Schedule A electronically, and that typing my name here is my signature.'

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
]

const PUBLIC_ERROR =
  "We couldn't sign your Schedule A just now. Please try again in a minute, or contact Sequel if the problem continues."

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

const admin = (): Client =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
    db: { schema: 'xano_mirror' },
  })

/** The caller as themselves, so the database's own staff check applies. */
function asCaller(req: Request): Client | null {
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(auth)) return null
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
}

async function isStaff(client: Client): Promise<boolean> {
  const { data, error } = await client.rpc('track_is_staff')
  return !error && data === true
}

type Song = {
  id: number
  uuid: string
  track_title: string | null
  composer: string | null
  brand: string | null
  project: string | null
  ownership: string | null
  commencement_date: string | null
  commencement_date_dup2: string | null
  composer_reg_form_status: string | null
  schedule_a_status: string | null
  schedule_a_via: string | null
  contract_email: string | null
  project_master_list_id: number | null
  supplier_list_id: number | null
  schedule_a_pdf_path: string | null
}

const SONG_COLS =
  'id, uuid, track_title, composer, brand, project, ownership, commencement_date, commencement_date_dup2, composer_reg_form_status, schedule_a_status, schedule_a_via, contract_email, project_master_list_id, supplier_list_id, schedule_a_pdf_path'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function songByUuid(db: Client, uuid: unknown): Promise<Song | null> {
  if (typeof uuid !== 'string' || !UUID_RE.test(uuid.trim())) return null
  const { data } = await db.from('sequel_songs').select(SONG_COLS).eq('uuid', uuid.trim()).maybeSingle()
  return (data as Song | null) ?? null
}

async function songById(db: Client, id: unknown): Promise<Song | null> {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) return null
  const { data } = await db.from('sequel_songs').select(SONG_COLS).eq('id', n).maybeSingle()
  return (data as Song | null) ?? null
}

/**
 * Which screen the composer sees.
 *  - Pending: the form.
 *  - Confirmed, a new-app song ('sequel', or one of the two Firma test
 *    songs), not yet signed: the signing step.
 *  - Anything else confirmed (older songs went through BoldSign): all set.
 */
function stateOf(s: Song | null): 'invalid' | 'open' | 'sign' | 'done' {
  if (!s) return 'invalid'
  if (s.composer_reg_form_status === 'Pending') return 'open'
  if (s.composer_reg_form_status === 'Confirmed') {
    if ((s.schedule_a_via === 'sequel' || s.schedule_a_via === 'firma') && s.schedule_a_status !== 'Complete') {
      return 'sign'
    }
    return 'done'
  }
  return 'invalid'
}

// ------------------------------------------------------------------ email

function appOrigin(req: Request): string {
  const origin = req.headers.get('origin')
  if (origin && ALLOWED_ORIGINS.some((re) => re.test(origin))) return origin
  return (Deno.env.get('APP_BASE_URL') ?? 'https://app.sequelsounds.com').replace(/\/+$/, '')
}

/** The old trigger's project_name: "Brand - Title", or its fallback. */
function projectName(brand: string | null, title: string | null): string {
  const b = (brand ?? '').trim()
  const t = (title ?? '').trim()
  return (b ? `${b} - ` : '') + (t || 'your latest project')
}

async function sendLinkEmail(db: Client, song: Song, origin: string): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY')
  let error: string | null = null
  if (!key) {
    error = 'The email could not be sent: RESEND_API_KEY is not set on the server.'
  } else if (!song.contract_email) {
    error = 'The email could not be sent: this song has no contract email.'
  } else {
    try {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [song.contract_email],
          subject: EMAIL_SUBJECT,
          template: {
            id: EMAIL_TEMPLATE_ID,
            variables: {
              composition_team_name: song.composer ?? '',
              project_name: projectName(song.brand, song.project),
              submit_url: `${origin}/song-confirmation?uuid=${song.uuid}`,
            },
          },
        }),
      })
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300)
        console.error('resend failed', res.status, detail)
        error = `The email could not be sent (Resend ${res.status}): ${detail}`
      }
    } catch (e) {
      error = `The email could not be sent: ${(e as Error).message}`
    }
  }
  await db
    .from('sequel_songs')
    .update(error ? { link_email_error: error } : { link_emailed_at: new Date().toISOString(), link_email_error: null })
    .eq('id', song.id)
  return error
}

// ------------------------------------------------------------ the Schedule A

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function ukDate(s: Song): string {
  if (s.commencement_date && /^\d{2}\/\d{2}\/\d{4}$/.test(s.commencement_date)) return s.commencement_date
  const iso = s.commencement_date_dup2
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

type Details = {
  team: string
  title: string
  writers: { full_name: string; cae_number: string | null; share_split: number }[]
  brand: string
  productionTitle: string
  commencementDate: string
  ownership: string
}

/** What the Schedule A says, read fresh from the database. */
async function detailsOf(db: Client, song: Song): Promise<Details> {
  const { data: writers, error } = await db
    .from('sequel_song_writer')
    .select('full_name, cae_number, share_split')
    .eq('song_id', song.id)
    .order('id')
  if (error) throw new Error(`writers: ${error.message}`)
  return {
    team: (song.composer ?? '').trim(),
    title: song.track_title ?? '',
    writers: (writers ?? []).map((w) => ({
      full_name: String(w.full_name ?? ''),
      cae_number: w.cae_number ? String(w.cae_number) : null,
      share_split: Number(w.share_split ?? 0),
    })),
    brand: song.brand ?? '',
    productionTitle: song.project ?? '',
    commencementDate: ukDate(song),
    ownership: song.ownership ?? '',
  }
}

/**
 * The hash of exactly what the page showed. Keys in a fixed order, so the
 * same details always give the same hash.
 */
function detailsHash(d: Details): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      d.team,
      d.title,
      d.writers.map((w) => [w.full_name, w.cae_number ?? '', w.share_split]),
      d.brand,
      d.productionTitle,
      d.commencementDate,
      d.ownership,
    ]),
  )
}

/** The signing screen's payload. */
async function scheduleFor(db: Client, song: Song) {
  // Fetch the fonts now, while the composer reads, so signing is quick.
  void inBackground(loadFonts())
  const details = await detailsOf(db, song)
  return {
    ...details,
    details_hash: await detailsHash(details),
    consent: CONSENT,
    email: song.contract_email,
  }
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (req.headers.get('cf-connecting-ip') ?? forwarded ?? req.headers.get('x-real-ip') ?? '').slice(0, 100)
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The signed copy to the signer, and to anyone in SCHEDULE_A_COPY_TO. */
async function emailSignedCopy(db: Client, song: Song, d: Details, signer: string, signedAt: Date, pdf: Uint8Array) {
  const key = Deno.env.get('RESEND_API_KEY')
  let error: string | null = null
  if (!key) error = 'The signed copy was not emailed: RESEND_API_KEY is not set on the server.'
  else if (!song.contract_email) error = 'The signed copy was not emailed: this song has no contract email.'
  else {
    const copies = (Deno.env.get('SCHEDULE_A_COPY_TO') ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
    const project = projectName(d.brand, d.productionTitle)
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#372b29">
<p>Hi ${escapeHtml(d.team || 'there')},</p>
<p>Thanks for signing. Your Schedule A for <strong>${escapeHtml(d.title)}</strong> (${escapeHtml(project)}) is attached.</p>
<p>Signed by ${escapeHtml(signer)} on ${escapeHtml(londonTime(signedAt))}.</p>
<p>Sequel</p>
</div>`
    const safeTitle = d.title.replace(/[^\p{L}\p{N} ()&.,'-]+/gu, '').trim().slice(0, 80) || 'Song'
    try {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [song.contract_email],
          ...(copies.length ? { bcc: copies } : {}),
          subject: `${SIGNED_SUBJECT} | ${d.title}`.slice(0, 200),
          html,
          text: `Hi ${d.team || 'there'},\n\nThanks for signing. Your Schedule A for ${d.title} (${project}) is attached.\n\nSigned by ${signer} on ${londonTime(signedAt)}.\n\nSequel`,
          attachments: [{ filename: `Schedule A - ${safeTitle}.pdf`, content: bytesToB64(pdf) }],
        }),
      })
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300)
        console.error('signed copy email failed', res.status, detail)
        error = `The signed copy was not emailed (Resend ${res.status}): ${detail}`
      }
    } catch (e) {
      error = `The signed copy was not emailed: ${(e as Error).message}`
    }
  }
  await db
    .from('sequel_songs')
    .update(
      error
        ? { signed_copy_email_error: error }
        : { signed_copy_emailed_at: new Date().toISOString(), signed_copy_email_error: null },
    )
    .eq('id', song.id)
}

type SignResult = { state: 'done' } | { state: 'sign'; error: string }

async function sign(db: Client, req: Request, song: Song, body: Record<string, unknown>): Promise<SignResult> {
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : ''
  if (name.length < 2 || name.length > 120 || !/\p{L}/u.test(name)) {
    return { state: 'sign', error: 'Please type your full name to sign.' }
  }
  if (body.consent !== true) {
    return { state: 'sign', error: 'Please tick the box to agree to sign electronically.' }
  }

  const details = await detailsOf(db, song)
  const hash = await detailsHash(details)
  if (body.details_hash !== hash) {
    return {
      state: 'sign',
      error: 'The details of this Schedule A have changed since the page loaded. Please check them again, then sign.',
    }
  }

  const signedAt = new Date()
  const ip = clientIp(req)
  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 500)
  const pdf = await buildScheduleA(details, await loadFonts(), {
    name,
    signedAt,
    email: song.contract_email ?? '',
    ip,
    userAgent,
    consent: CONSENT,
    detailsHash: hash,
    reference: song.uuid,
    team: details.team,
  })
  const pdfHash = await sha256Hex(pdf)

  // A fresh name every time, never overwritten: a double click stores two
  // files, and only the one the update below accepts is the record.
  const path = `${song.uuid}/schedule-a-signed-${signedAt.getTime()}.pdf`
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) throw new Error(`storing the signed copy failed: ${upErr.message}`)

  const { data: marked, error: markErr } = await db
    .from('sequel_songs')
    .update({
      schedule_a_status: 'Complete',
      schedule_a_signed_at: signedAt.toISOString(),
      schedule_a_signer_name: name,
      schedule_a_signer_ip: ip || null,
      schedule_a_signer_agent: userAgent || null,
      schedule_a_consent: CONSENT,
      schedule_a_details_sha256: hash,
      schedule_a_pdf_sha256: pdfHash,
      schedule_a_pdf_path: path,
      firma_error: null,
    })
    .eq('id', song.id)
    .eq('composer_reg_form_status', 'Confirmed')
    // Not .neq(): that drops NULL rows as well (mirror trap 4).
    .or('schedule_a_status.is.null,schedule_a_status.neq.Complete')
    .select('id')
  if (markErr) throw new Error(`signed, but saving it failed: ${markErr.message}`)
  if (!marked || marked.length === 0) {
    // Someone (another tab) signed first. Theirs stands; this file is spare.
    await db.storage.from(BUCKET).remove([path])
    return { state: 'done' }
  }

  // The signer sees "done" straight away; the email follows.
  await inBackground(emailSignedCopy(db, song, details, name, signedAt, pdf))
  return { state: 'done' }
}

// ------------------------------------------------------------------ handler

type Writer = { full_name?: unknown; cae_number?: unknown; share_split?: unknown }

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad request' }, 400, origin)
  }
  const db = admin()
  const action = body.action

  try {
    // ---------------------------------------------------------- staff
    if (action === 'create' || action === 'resend_link' || action === 'document') {
      const caller = asCaller(req)
      if (!caller || !(await isStaff(caller))) return json({ error: 'Staff only.' }, 403, origin)

      if (action === 'create') {
        const { data, error } = await caller.rpc('track_create_song', {
          p_project_id: Number(body.project_id),
          p_supplier_id: Number(body.supplier_id),
          p_ownership: typeof body.ownership === 'string' ? body.ownership : 'Master & Publishing',
        })
        if (error) return json({ error: error.message }, 400, origin)
        const created = data as { id: number; uuid: string }
        const song = await songById(db, created.id)
        if (!song) return json({ error: 'The song was created but could not be read back.' }, 500, origin)
        const emailError = await sendLinkEmail(db, song, appOrigin(req))
        return json(
          { song_id: song.id, uuid: song.uuid, emailed: !emailError, email_error: emailError ?? undefined },
          200,
          origin,
        )
      }

      const song = await songById(db, body.song_id)
      if (!song) return json({ error: 'Song not found.' }, 404, origin)

      if (action === 'resend_link') {
        if (stateOf(song) !== 'open' && stateOf(song) !== 'sign') {
          return json({ error: 'This Schedule A is already signed.' }, 400, origin)
        }
        const emailError = await sendLinkEmail(db, song, appOrigin(req))
        return json({ emailed: !emailError, email_error: emailError ?? undefined }, 200, origin)
      }

      // document
      if (!song.schedule_a_pdf_path) return json({ error: 'No signed Schedule A yet.' }, 404, origin)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(song.schedule_a_pdf_path, 600)
      if (error || !data) return json({ error: 'Could not open the signed copy.' }, 500, origin)
      return json({ url: data.signedUrl }, 200, origin)
    }

    // --------------------------------------------------------- public
    if (action === 'status') {
      const song = await songByUuid(db, body.uuid)
      const state = stateOf(song)
      if (song && state === 'sign') return json({ state, schedule: await scheduleFor(db, song) }, 200, origin)
      return json({ state }, 200, origin)
    }

    if (action === 'submit') {
      const song = await songByUuid(db, body.uuid)
      const state = stateOf(song)
      if (!song || state === 'invalid') return json({ state: 'invalid' }, 200, origin)
      if (state !== 'open') {
        if (state === 'sign') return json({ state, schedule: await scheduleFor(db, song) }, 200, origin)
        return json({ state }, 200, origin)
      }

      const writers = Array.isArray(body.writers) ? (body.writers as Writer[]) : []
      const { data, error } = await db.schema('public').rpc('song_confirm_details', {
        p_uuid: song.uuid,
        p_title: typeof body.track_title === 'string' ? body.track_title : '',
        p_writers: writers.slice(0, 50).map((w) => ({
          full_name: typeof w.full_name === 'string' ? w.full_name : '',
          cae_number: typeof w.cae_number === 'string' ? w.cae_number : '',
          share_split: typeof w.share_split === 'number' || typeof w.share_split === 'string' ? w.share_split : null,
        })),
      })
      if (error) {
        console.error('confirm failed', error.message)
        return json({ state: 'open', error: 'submit_failed' }, 200, origin)
      }
      const result = data as { success?: boolean; error?: string }
      if (!result?.success && result?.error !== 'already_submitted') {
        if (result?.error === 'not_found') return json({ state: 'invalid' }, 200, origin)
        return json({ state: 'open', error: result?.error ?? 'submit_failed' }, 200, origin)
      }

      const fresh = await songByUuid(db, song.uuid)
      const now = stateOf(fresh)
      if (fresh && now === 'sign') return json({ state: now, schedule: await scheduleFor(db, fresh) }, 200, origin)
      return json({ state: now }, 200, origin)
    }

    if (action === 'sign') {
      const song = await songByUuid(db, body.uuid)
      const state = stateOf(song)
      if (!song || state !== 'sign') return json({ state }, 200, origin)
      let result: SignResult
      try {
        result = await sign(db, req, song, body)
      } catch (e) {
        console.error('sign failed', song.id, (e as Error).message)
        await db.from('sequel_songs').update({ firma_error: (e as Error).message }).eq('id', song.id)
        result = { state: 'sign', error: PUBLIC_ERROR }
      }
      if (result.state === 'sign') {
        // Send the details again: if they changed, the page shows the new ones.
        return json({ ...result, schedule: await scheduleFor(db, song) }, 200, origin)
      }
      return json(result, 200, origin)
    }

    return json({ error: 'unknown action' }, 400, origin)
  } catch (e) {
    console.error('song-schedule-a', action, (e as Error).message)
    return json({ error: 'Something went wrong.' }, 500, origin)
  }
})
