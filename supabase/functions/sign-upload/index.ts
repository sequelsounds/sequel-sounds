// sign-upload — validates an inbox share token and returns a presigned S3 PUT
// URL for the track's original file.
//
// The caller never chooses the object key: this function mints the track uuid
// and builds the key itself, so a partner cannot aim an upload at an existing
// track's prefix.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const ALLOWED_EXT = new Set([
  'wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'ogg', 'opus',
  'mov', 'mp4', 'm4v',
])

const MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB — single PUT tops out at 5 GB
const URL_TTL_SECONDS = 900

const ALLOWED_ORIGINS = [/^http:\/\/localhost:\d+$/, /^https:\/\/[^.]+\.sequelsounds\.app$/]

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.some((re) => re.test(origin)) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, x-share-token, x-client-info',
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

/** Extension from the filename, allowlisted. The raw name never enters the key. */
function extensionOf(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return ALLOWED_EXT.has(ext) ? ext : null
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

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405, origin)
  }

  const { cfg, problems } = readConfig()
  if (problems.length) {
    // Names and lengths only — never the values.
    return json({ error: 'storage is misconfigured', problems }, 500, origin)
  }

  const token = req.headers.get('x-share-token')
  if (!token) return json({ error: 'missing share token' }, 401, origin)

  let body: { filename?: string; content_type?: string; size_bytes?: number }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }

  const { filename, content_type, size_bytes } = body
  if (!filename || !content_type || typeof size_bytes !== 'number') {
    return json({ error: 'filename, content_type and size_bytes are required' }, 400, origin)
  }
  if (!content_type.startsWith('audio/') && !content_type.startsWith('video/')) {
    return json({ error: 'only audio and video files are accepted' }, 415, origin)
  }
  if (size_bytes <= 0 || size_bytes > MAX_BYTES) {
    return json({ error: `file must be between 1 byte and ${MAX_BYTES} bytes` }, 413, origin)
  }

  const ext = extensionOf(filename)
  if (!ext) return json({ error: 'unsupported file type' }, 415, origin)

  // Service role: the token check below is the authorisation, so it has to read
  // past RLS to find the inbox in the first place.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: inbox, error } = await admin
    .from('inboxes')
    .select('id, project_id, is_active, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (error) return json({ error: 'lookup failed' }, 500, origin)
  if (!inbox || !inbox.is_active) return json({ error: 'invalid token' }, 403, origin)
  if (inbox.expires_at && new Date(inbox.expires_at) <= new Date()) {
    return json({ error: 'this link has expired' }, 403, origin)
  }

  // Cheap duplicate pre-check. Advisory only: it still signs the upload, so a
  // partner is never blocked by a guess — the browser uses this to warn before
  // pushing tens of megabytes that the project already has. The authoritative
  // check is the Lambda's content hash, which sees the actual bytes.
  const { data: existing } = await admin
    .from('tracks')
    .select('id, created_at')
    .eq('project_id', inbox.project_id)
    .eq('original_filename', filename)
    .eq('size_bytes', size_bytes)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: 's3',
  })

  const trackId = crypto.randomUUID()
  const key = `tracks/${trackId}/original.${ext}`

  const target = new URL(`https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`)
  target.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS))

  const signed = await aws.sign(target.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  })

  return json(
    {
      track_id: trackId,
      key,
      upload_url: signed.url,
      expires_in: URL_TTL_SECONDS,
      project_id: inbox.project_id,
      inbox_id: inbox.id,
      // Same name and byte length already in this project. Not proof — two
      // different masters can share both — so it is surfaced, never enforced.
      already_uploaded: existing
        ? { track_id: existing.id, created_at: existing.created_at }
        : null,
    },
    200,
    origin,
  )
})
