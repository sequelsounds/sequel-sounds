// sign-document — presigned S3 URLs for DOCUMENTS, both directions. Today that
// means one thing: the PO attached to an invoice request.
//
//   { purpose: "invoice_po", filename, size_bytes }  -> a PUT url to upload to
//   { purpose: "invoice_po", read: "<key>" }         -> a GET url to open it
//
// ⚠️ WHY THE READ IS NOT IN sign-media. That function signs reads for TRACK
// keys, checked against the tracks table and against a playlist token, and its
// key regex is the security boundary. Widening it to cover invoice documents
// would mean a second authorisation path inside the function that decides who
// may read what — the kind of change that quietly weakens the first one. A PO
// is staff-only and has nothing to do with playlists, so it is gated here.
//
// ⚠️ WHY THIS IS NOT A BRANCH INSIDE sign-upload. It very nearly is one —
// `purpose: "artwork"` is exactly that shape, and the config, CORS and presign
// helpers below are duplicated from it. sign-upload is what every partner
// upload goes through, and redeploying it requires resending the whole file;
// the risk of breaking inbox uploads to save forty lines was not worth taking.
// If the two ever need to change together, merge them then.
//
// The caller never chooses the object key. It is minted here, so nobody can
// aim an upload at an existing object's prefix.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

/** Deliberately narrow. A PO is a document or a scan of one. */
const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'])
const MAX_BYTES = 25 * 1024 * 1024
const URL_TTL_SECONDS = 900

/**
 * ⚠️ Only keys this function itself minted are ever signed for reading.
 *
 * The 147 imported invoices carry a RELATIVE XANO VAULT PATH in the same
 * column, which is not an S3 key and resolves against an instance that goes
 * away at cutover. Those must fall through untouched rather than being signed
 * into a URL that 404s — the caller checks the prefix before asking.
 */
const READ_KEY_RE = /^invoices\/po\/[0-9a-f-]{36}\.[a-z0-9]+$/

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
  /^https:\/\/[^.]+\.sequelsounds\.app$/,
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

/** The raw filename never enters the key — only its allowlisted extension. */
function extensionOf(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return ALLOWED_EXT.has(ext) ? ext : null
}

/** Staff, proved by their session. The publishable key resolves to no user. */
// deno-lint-ignore no-explicit-any
async function staffUserId(req: Request, admin: any): Promise<string | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!bearer) return null
  const { data } = await admin.auth.getUser(bearer)
  const userId = data?.user?.id ?? null
  if (!userId) return null
  const { data: staffRow } = await admin
    .from('staff')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return staffRow ? userId : null
}

/** Config sanity, so a mistyped secret fails loudly instead of as a bad signature. */
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
  const problems = [...missing.map((m) => `${m} is not set`)]
  if (cfg.accessKeyId && cfg.accessKeyId.length !== 20) {
    problems.push(`S3_ACCESS_KEY_ID is ${cfg.accessKeyId.length} chars, expected 20`)
  }
  if (cfg.secretAccessKey && cfg.secretAccessKey.length !== 40) {
    problems.push(`S3_SECRET_ACCESS_KEY is ${cfg.secretAccessKey.length} chars, expected 40`)
  }
  return { cfg, problems }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const { cfg, problems } = readConfig()
  // Names and lengths only — never the values.
  if (problems.length) return json({ error: 'storage is misconfigured', problems }, 500, origin)

  let body: { filename?: string; size_bytes?: number; purpose?: string; read?: string; download?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }

  if (body.purpose !== 'invoice_po') return json({ error: 'unknown purpose' }, 400, origin)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  // Staff either way. A PO is finance paperwork; no token path, ever.
  if (!(await staffUserId(req, admin))) return json({ error: 'not authorised' }, 401, origin)

  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: 's3',
  })

  // ------------------------------------------------------------------- read
  if (typeof body.read === 'string') {
    if (!READ_KEY_RE.test(body.read)) {
      return json({ error: 'not a document key' }, 400, origin)
    }
    const target = new URL(`https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${body.read}`)
    target.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS))
    // A download is a read with a name on it. Without this the browser saves
    // the uuid, which is no use to anyone looking for a PO later.
    if (body.download) {
      target.searchParams.set(
        'response-content-disposition',
        `attachment; filename="${body.download.replace(/["\\]/g, '')}"`,
      )
    }
    const readSigned = await aws.sign(target.toString(), { method: 'GET', aws: { signQuery: true } })
    return json({ url: readSigned.url, expires_in: URL_TTL_SECONDS }, 200, origin)
  }

  // ----------------------------------------------------------------- upload
  const { filename, size_bytes } = body
  if (!filename || typeof size_bytes !== 'number') {
    return json({ error: 'filename and size_bytes are required' }, 400, origin)
  }

  const ext = extensionOf(filename)
  if (!ext) return json({ error: 'a PO must be a PDF, Word document or image' }, 415, origin)
  if (size_bytes <= 0 || size_bytes > MAX_BYTES) {
    return json({ error: `the file must be under ${MAX_BYTES} bytes` }, 413, origin)
  }

  // ⚠️ A NEW KEY EVERY TIME, never a name derived from the invoice. The
  // invoice does not exist yet when this is called — the PO is attached part
  // way through the wizard and the row is written at the end — so there is no
  // id to key on, and reusing a name would let one request overwrite another's
  // PO while both were being filled in.
  const key = `invoices/po/${crypto.randomUUID()}.${ext}`

  const target = new URL(`https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`)
  target.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS))
  const signed = await aws.sign(target.toString(), { method: 'PUT', aws: { signQuery: true } })

  return json(
    { key, upload_url: signed.url, expires_in: URL_TTL_SECONDS, filename },
    200,
    origin,
  )
})
