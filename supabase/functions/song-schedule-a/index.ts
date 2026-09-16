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
//   { action: "status", uuid }  -> { state }
//   { action: "submit", uuid, track_title, writers }
//        -> { state: "sign", signing_url } | { state, error }
//   { action: "sign", uuid }    -> { state, signing_url? }   re-opening the link
//   { action: "check", uuid }   -> { state }                 after Firma says done
//
// state is one of: invalid · open · sign · done · preparing
//
// What changed from the old app (Andy, 16 Sep 2026): the email goes to the
// supplier's contract email; the confirmation saves in one transaction; and
// the page then shows the Schedule A, filled in, to be signed in place through
// Firma — replacing the SharePoint + BoldSign second half.
//
// Secrets this needs: RESEND_API_KEY (the email — the same Resend account and
// template the old app's Xano trigger uses) and FIRMA_API_KEY (signing). If
// either is missing, the function says so; it never fails silently.
//
// ⚠️ Nothing here returns or logs a key.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { ANCHORS, buildScheduleA, loadFonts } from './pdf.ts'

// deno-lint-ignore no-explicit-any
type Client = SupabaseClient<any, any, any>

const FIRMA_API = 'https://api.firma.dev/functions/v1/signing-request-api'
const FIRMA_SIGNING_ORIGIN = 'https://app.firma.dev'
const RESEND_API = 'https://api.resend.com/emails'
// The old app's own: Xano table trigger 11, read 16 Sep.
const EMAIL_FROM = 'Sequel <registrations@sequelsounds.com>'
const EMAIL_SUBJECT = 'Action needed | Confirm song registration details'
const EMAIL_TEMPLATE_ID = '9a24f397-9f6f-4e27-a7dc-0a7a13749b0f'
const BUCKET = 'schedule-a'
// Two minutes to create a signing request before another attempt may start.
const CLAIM_MS = 2 * 60 * 1000

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
]

const PUBLIC_ERROR =
  "We couldn't prepare your Schedule A just now. Please try again in a minute, or contact Sequel if the problem continues."

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
  firma_request_id: string | null
  firma_signer_id: string | null
  firma_signing_url: string | null
  schedule_a_sent_at: string | null
  schedule_a_pdf_path: string | null
}

const SONG_COLS =
  'id, uuid, track_title, composer, brand, project, ownership, commencement_date, commencement_date_dup2, composer_reg_form_status, schedule_a_status, schedule_a_via, contract_email, project_master_list_id, supplier_list_id, firma_request_id, firma_signer_id, firma_signing_url, schedule_a_sent_at, schedule_a_pdf_path'

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
 *  - Confirmed, a new-app song, not yet signed: the signing step.
 *  - Anything else confirmed (older songs went through BoldSign): all set.
 */
function stateOf(s: Song | null): 'invalid' | 'open' | 'sign' | 'done' {
  if (!s) return 'invalid'
  if (s.composer_reg_form_status === 'Pending') return 'open'
  if (s.composer_reg_form_status === 'Confirmed') {
    if (s.schedule_a_via === 'firma' && s.schedule_a_status !== 'Complete') return 'sign'
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

// ------------------------------------------------------------------ Firma

async function firma(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = Deno.env.get('FIRMA_API_KEY')
  if (!key) throw new Error('FIRMA_API_KEY is not set on the server.')
  const res = await fetch(`${FIRMA_API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: key, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Firma ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

function signingUrl(signerId: string | null, link: string | null): string | null {
  if (link && link.startsWith(FIRMA_SIGNING_ORIGIN + '/')) return link
  return signerId ? `${FIRMA_SIGNING_ORIGIN}/signing/${signerId}` : null
}

function ukDate(s: Song): string {
  if (s.commencement_date && /^\d{2}\/\d{2}\/\d{4}$/.test(s.commencement_date)) return s.commencement_date
  const iso = s.commencement_date_dup2
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * Makes the Schedule A and the signing request, once. The claim on
 * schedule_a_sent_at stops two tabs (or a double click) from paying for two
 * envelopes; a claim older than two minutes is taken to have died.
 */
async function startSigning(db: Client, song: Song): Promise<{ url: string | null; preparing?: boolean }> {
  if (song.firma_request_id) return { url: signingUrl(song.firma_signer_id, song.firma_signing_url) }

  const stale = new Date(Date.now() - CLAIM_MS).toISOString()
  const { data: claimed } = await db
    .from('sequel_songs')
    .update({ schedule_a_sent_at: new Date().toISOString(), firma_error: null })
    .eq('id', song.id)
    .is('firma_request_id', null)
    .or(`schedule_a_sent_at.is.null,schedule_a_sent_at.lt.${stale}`)
    .select('id')
  if (!claimed || claimed.length === 0) return { url: null, preparing: true }

  try {
    const { data: writers, error } = await db
      .from('sequel_song_writer')
      .select('full_name, cae_number, share_split')
      .eq('song_id', song.id)
      .order('id')
    if (error) throw new Error(`writers: ${error.message}`)

    const pdf = await buildScheduleA(
      {
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
      },
      await loadFonts(),
    )

    const team = (song.composer ?? '').trim() || 'Composer'
    const created = (await firma('/signing-requests/create-and-send', {
      method: 'POST',
      body: JSON.stringify({
        name: `Schedule A – ${song.track_title ?? ''}`.slice(0, 255),
        description: projectName(song.brand, song.project),
        document: bytesToB64(pdf),
        expiration_hours: 24 * 30,
        recipients: [
          {
            id: 'temp_1',
            first_name: team.slice(0, 100),
            email: song.contract_email,
            designation: 'Signer',
            order: 1,
            company: team.slice(0, 100),
          },
        ],
        anchor_tags: [
          {
            anchor_string: ANCHORS.signature,
            type: 'signature',
            recipient_id: 'temp_1',
            required: true,
            width: 26,
            height: 4,
            remove_anchor_text: true,
          },
          {
            anchor_string: ANCHORS.name,
            type: 'text',
            recipient_id: 'temp_1',
            required: true,
            width: 32,
            height: 2.2,
            remove_anchor_text: true,
          },
        ],
        settings: {
          // The page embeds the signing, so Firma does not email a link; it
          // does email the signed copy when it is done.
          send_signing_email: false,
          send_finish_email: true,
          attach_pdf_on_finish: true,
          allow_download: true,
          send_expiration_email: false,
        },
        completion_title: "You're all set",
        completion_message: "Thanks — your Schedule A is signed. We'll email you a copy.",
      }),
    })) as {
      id: string
      first_signer?: { id?: string; signing_link?: string }
      recipients?: { id: string; designation?: string }[]
    }

    const signerId =
      created.first_signer?.id ?? created.recipients?.find((r) => r.designation === 'Signer')?.id ?? null
    const link = created.first_signer?.signing_link ?? null
    await db
      .from('sequel_songs')
      .update({
        firma_request_id: created.id,
        firma_signer_id: signerId,
        firma_signing_url: link,
        firma_error: null,
      })
      .eq('id', song.id)
    return { url: signingUrl(signerId, link) }
  } catch (e) {
    const message = (e as Error).message
    console.error('signing request failed', song.id, message)
    // Release the claim so the next attempt can start straight away.
    await db.from('sequel_songs').update({ schedule_a_sent_at: null, firma_error: message }).eq('id', song.id)
    throw e
  }
}

/**
 * Asks Firma whether it is signed; if so, keeps our own copy of the signed PDF
 * (Firma is young — Andy, 16 Sep) and marks the Schedule A Complete.
 */
async function finaliseIfSigned(db: Client, song: Song): Promise<'done' | 'sign' | 'declined'> {
  if (song.schedule_a_status === 'Complete') return 'done'
  if (!song.firma_request_id) return 'sign'
  const id = encodeURIComponent(song.firma_request_id)
  const req = (await firma(`/signing-requests/${id}`)) as {
    status?: { finished?: boolean; declined_on?: string | null; cancelled_on?: string | null; finished_on?: string | null }
    final_document_download_url?: string | null
  }
  if (req.status?.declined_on || req.status?.cancelled_on) return 'declined'
  if (!req.status?.finished || !req.final_document_download_url) return 'sign'

  const file = await fetch(req.final_document_download_url)
  if (!file.ok) throw new Error(`signed copy download failed (${file.status})`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const path = `${song.uuid}/schedule-a-${song.firma_request_id}.pdf`
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) throw new Error(`storing the signed copy failed: ${upErr.message}`)

  // The name typed next to "For and on behalf of".
  let signerName: string | null = null
  try {
    const fields = (await firma(`/signing-requests/${id}/fields`)) as {
      results?: { type?: string; field_type?: string; value?: unknown; final_value?: unknown }[]
    }
    const text = fields.results?.find((f) => (f.type ?? f.field_type) === 'text')
    const v = text?.final_value ?? text?.value
    signerName = typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null
  } catch (e) {
    console.error('reading the signer name failed', (e as Error).message)
  }

  await db
    .from('sequel_songs')
    .update({
      schedule_a_status: 'Complete',
      schedule_a_signed_at: req.status?.finished_on ?? new Date().toISOString(),
      schedule_a_signer_name: signerName,
      schedule_a_pdf_path: path,
      firma_error: null,
    })
    .eq('id', song.id)
  return 'done'
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
        if (song.composer_reg_form_status !== 'Pending') {
          return json({ error: 'The composer has already confirmed this song.' }, 400, origin)
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
      return json({ state: stateOf(song) }, 200, origin)
    }

    if (action === 'submit') {
      const song = await songByUuid(db, body.uuid)
      const state = stateOf(song)
      if (!song || state === 'invalid') return json({ state: 'invalid' }, 200, origin)
      if (state !== 'open') return json({ state }, 200, origin)

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
      if (!result?.success) {
        if (result?.error === 'already_submitted') {
          const again = await songByUuid(db, song.uuid)
          return json({ state: stateOf(again) }, 200, origin)
        }
        if (result?.error === 'not_found') return json({ state: 'invalid' }, 200, origin)
        return json({ state: 'open', error: result?.error ?? 'submit_failed' }, 200, origin)
      }

      const fresh = await songByUuid(db, song.uuid)
      if (!fresh || stateOf(fresh) !== 'sign') return json({ state: stateOf(fresh) }, 200, origin)
      try {
        const started = await startSigning(db, fresh)
        if (started.preparing) return json({ state: 'preparing' }, 200, origin)
        return json({ state: 'sign', signing_url: started.url }, 200, origin)
      } catch {
        return json({ state: 'sign', error: PUBLIC_ERROR }, 200, origin)
      }
    }

    if (action === 'sign' || action === 'check') {
      const song = await songByUuid(db, body.uuid)
      const state = stateOf(song)
      if (!song || state !== 'sign') return json({ state }, 200, origin)
      try {
        if (song.firma_request_id) {
          const now = await finaliseIfSigned(db, song)
          if (now === 'done') return json({ state: 'done' }, 200, origin)
          if (now === 'declined') return json({ state: 'sign', declined: true }, 200, origin)
          if (action === 'check') return json({ state: 'sign' }, 200, origin)
        }
        const started = await startSigning(db, song)
        if (started.preparing) return json({ state: 'preparing' }, 200, origin)
        return json({ state: 'sign', signing_url: started.url }, 200, origin)
      } catch (e) {
        console.error(`${action} failed`, song.id, (e as Error).message)
        return json({ state: 'sign', error: PUBLIC_ERROR }, 200, origin)
      }
    }

    return json({ error: 'unknown action' }, 400, origin)
  } catch (e) {
    console.error('song-schedule-a', action, (e as Error).message)
    return json({ error: 'Something went wrong.' }, 500, origin)
  }
})
