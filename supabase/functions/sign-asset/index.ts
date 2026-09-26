// sign-asset — presigned S3 URLs for PROJECT ASSETS, and the share page.
//
//   staff (their session as bearer):
//     { action: "upload", project_id, file_name, size_bytes, file_type }
//         -> the row is written FIRST (track_create_asset), then a PUT url for
//            the key the database chose
//     { action: "read", uuid, email?: true, download?: true }
//         -> a GET url; `email` makes it last 7 days (the longest S3 allows),
//            for EMAIL BRIEF
//     { action: "delete", uuid }
//         -> the object, then the row (Xano's order: if S3 refuses, the row
//            survives)
//
//   anyone (publishable key as bearer):
//     { action: "peaks", code, peaks }
//         -> saves a waveform for a file that has none (write-once)
//     { action: "share", code, event?: "view" | "download" }
//         -> the file behind a /link code: name, type, size, expiry, an inline
//            url for the preview and a download url that saves under the real
//            filename. The call itself is recorded in track_share_events.
//
// ⚠️ THE DATABASE DECIDES, NOT THIS FILE. Every staff action calls a
// SECURITY DEFINER function AS THE CALLER, which checks track_is_staff() and
// hands back the only key this function will sign. The caller never names a
// key. The share path calls resolve_share_link with the service role, which
// is the only role allowed to, and which is where expiry and the rate limit
// live.
//
// ⚠️ WHY NOT sign-document. That function signs one prefix for one purpose,
// and its key regex is its boundary. Assets are a second prefix with a public
// read path; keeping them apart keeps each boundary simple.
//
// ⚠️ THE DOWNLOAD URL CARRIES response-content-disposition, signed in. The old
// app could not do this (Xano rejects the parameter), so its page fetched the
// whole file into memory to save it. Here the browser downloads natively.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const READ_TTL_SECONDS = 3600
const EMAIL_TTL_SECONDS = 604800
const PUT_TTL_SECONDS = 900
/** A single PUT tops out at 5 GB. */
const MAX_BYTES = 5 * 1024 * 1024 * 1024
/** Belt and braces: only these prefixes are ever signed, whatever the row says. */
const KEY_RE = /^project-assets\/[0-9a-f-]{36}_[^/\\]+$/
/** Contracts share through /link too (17 Sep), and their staff actions live in
 *  sign-contract — this prefix is signed on the SHARE PATH ONLY. */
const CONTRACT_KEY_RE = /^contracts\/[0-9a-f-]{36}_[^/\\]+$/
/** ⚠️ A release form is NOT `contracts/<uuid>_<name>`. It lives a level down,
 *  at `contracts/release-forms/<uuid>.pdf`, so the contract pattern above
 *  rejects it and a perfectly good share link reports itself invalid. */
const RELEASE_KEY_RE = /^contracts\/release-forms\/[0-9a-f-]{36}\.pdf$/
/** Composition licences (0087), at `contracts/licences/<uuid>.pdf`. */
const LICENCE_KEY_RE = /^contracts\/licences\/[0-9a-f-]{36}\.pdf$/

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
  /^https:\/\/[^.]+\.sequelsounds\.app$/,
  /^https:\/\/sequel-sounds\.andy-4c2\.workers\.dev$/,
]

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

/** Each path segment encoded once — filenames carry spaces and worse. */
function objectUrl(bucket: string, region: string, key: string) {
  const path = key.split('/').map(encodeURIComponent).join('/')
  return new URL(`https://${bucket}.s3.${region}.amazonaws.com/${path}`)
}

/** The filename a download is saved as: the part after the uuid. */
function nameFromKey(key: string) {
  const last = key.split('/').pop() ?? key
  const cut = last.indexOf('_')
  return cut > -1 ? last.slice(cut + 1) : last
}

function disposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** Postgres raises carry the message the page should show. */
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

  const sign = async (key: string, method: 'GET' | 'PUT' | 'DELETE', ttl: number, download?: string) => {
    const target = objectUrl(cfg.bucket, cfg.region, key)
    target.searchParams.set('X-Amz-Expires', String(ttl))
    if (download) target.searchParams.set('response-content-disposition', disposition(download))
    const signed = await aws.sign(target.toString(), { method, aws: { signQuery: true } })
    return signed.url
  }

  // ------------------------------------------------------------------ share
  if (body.action === 'share') {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const ip =
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-real-ip') ??
      (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    const { data, error } = await admin.rpc('resolve_share_link', {
      p_code: String(body.code ?? ''),
      p_ip: ip || 'unknown',
    })
    if (error) return json({ error: 'server' }, 500, origin)
    if (data?.error) return json({ error: data.error }, data.error === 'busy' ? 429 : 404, origin)
    if (
      !KEY_RE.test(data.key) &&
      !CONTRACT_KEY_RE.test(data.key) &&
      !RELEASE_KEY_RE.test(data.key) &&
      !LICENCE_KEY_RE.test(data.key)
    ) {
      return json({ error: 'invalid' }, 404, origin)
    }
    /* ⚠️ RECORDED HERE, NOT WITH A PIXEL. A tracking image in the email would
     * be stripped by most corporate mail filters and would report opens that
     * never happened from the ones that prefetch. This is the link actually
     * resolving, server-side: it happened.
     *
     * `event` is 'view' unless the page says otherwise — the download button
     * re-calls with 'download'. It is logged AFTER resolve_share_link, so the
     * rate limit already applied and a bad code has already been rejected.
     * Failure is swallowed: an unrecorded open is not a reason to withhold
     * somebody's document. */
    admin
      .rpc('track_log_share_event', {
        p_code: String(body.code ?? ''),
        p_event: body.event === 'download' ? 'download' : 'view',
        p_ip: ip || null,
        p_agent: req.headers.get('user-agent'),
      })
      .then(({ error: logErr }) => {
        if (logErr) console.error('share event not logged', logErr.message)
      })

    const fileName = data.file_name || nameFromKey(data.key)
    return json(
      {
        file_name: fileName,
        file_type: data.file_type,
        file_size: data.file_size,
        expires_at: data.expires_at,
        kind: data.kind ?? 'asset',
        peaks: data.peaks ?? null,
        url: await sign(data.key, 'GET', READ_TTL_SECONDS),
        download_url: await sign(data.key, 'GET', READ_TTL_SECONDS, fileName),
      },
      200,
      origin,
    )
  }

  // ------------------------------------------------------------------ peaks
  // The share page's waveform backfill. Write-once and checked in the
  // database (live code, well-formed array); nothing here to sign.
  if (body.action === 'peaks') {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    if (!Array.isArray(body.peaks) || body.peaks.length > 8000) return json({ error: 'invalid' }, 400, origin)
    const { data, error } = await admin.rpc('share_set_peaks', {
      p_code: String(body.code ?? ''),
      p_peaks: body.peaks,
    })
    if (error) return json({ error: 'server' }, 500, origin)
    return json({ ok: data === true }, 200, origin)
  }

  // ------------------------------------------------------------------ staff
  const authorization = req.headers.get('authorization') ?? ''
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  })

  if (body.action === 'upload') {
    const size = Number(body.size_bytes)
    if (!Number.isFinite(size) || size <= 0) return json({ error: 'That file is empty.' }, 400, origin)
    if (size > MAX_BYTES) return json({ error: 'Files must be under 5 GB.' }, 413, origin)
    const { data, error } = await asCaller.rpc('track_create_asset', {
      p_project_id: Number(body.project_id),
      p_file_name: String(body.file_name ?? ''),
      p_file_size: String(Math.round(size)),
      p_file_type: String(body.file_type ?? ''),
    })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    if (!KEY_RE.test(data.key)) return json({ error: 'bad key' }, 500, origin)
    return json(
      { uuid: data.uuid, key: data.key, upload_url: await sign(data.key, 'PUT', PUT_TTL_SECONDS) },
      200,
      origin,
    )
  }

  if (body.action === 'read' || body.action === 'delete') {
    const { data: key, error } = await asCaller.rpc('track_asset_key', { p_uuid: String(body.uuid ?? '') })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    if (!KEY_RE.test(key)) return json({ error: 'not an asset key' }, 400, origin)

    if (body.action === 'read') {
      const ttl = body.email ? EMAIL_TTL_SECONDS : READ_TTL_SECONDS
      const url = await sign(key, 'GET', ttl, body.download ? nameFromKey(key) : undefined)
      return json({ url, expires_in: ttl }, 200, origin)
    }

    // A brief's file is removed with its brief, never from here. Checked before
    // S3 is touched, because the row refusal would come too late.
    const { data: briefRows } = await asCaller
      .schema('xano_mirror')
      .from('briefs')
      .select('id')
      .eq('asset_uuid', String(body.uuid))
      .limit(1)
    if (briefRows && briefRows.length) {
      return json({ error: 'This file is a brief. Remove it from the Briefs tab.' }, 403, origin)
    }

    // S3 first. DeleteObject answers 204 whether or not the key existed, so a
    // success here proves the request went through, not that a file was there.
    const del = await fetch(await sign(key, 'DELETE', PUT_TTL_SECONDS), { method: 'DELETE' })
    if (!del.ok && del.status !== 404) {
      const detail = await del.text().catch(() => '')
      console.error('sign-asset: S3 refused the DELETE', del.status, detail.slice(0, 300))
      return json({ error: `Storage refused the delete (${del.status}).` }, 502, origin)
    }
    const { error: rowError } = await asCaller.rpc('track_delete_asset', { p_uuid: String(body.uuid) })
    if (rowError) {
      const e = dbError(rowError)
      return json({ error: e.message }, e.status, origin)
    }
    return json({ ok: true }, 200, origin)
  }

  return json({ error: 'unknown action' }, 400, origin)
})
