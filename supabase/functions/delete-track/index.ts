// delete-track — removes a track's row and every object it owns in S3.
//
// The browser holds no S3 credentials and should not: a delete that the page
// could issue is a delete anyone holding the page could issue. So the whole
// operation runs here, behind a staff session.
//
// Order matters. The objects go first, then the row. If a delete fails
// halfway the row survives, which means the track is still listed and the
// call can simply be repeated — the alternative loses the only record that
// the files exist, and they then sit in the bucket forever with nothing
// pointing at them.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/, // the app's own domain (Andy, 13 Sep)
  /^https:\/\/studio\.sequelsounds\.com$/,
  /^https:\/\/[^.]+\.sequelsounds\.app$/,
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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

async function staffUserId(
  req: Request,
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<string | null> {
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

/**
 * Every key under the track's prefix, however many pages that takes. The
 * Lambda writes a known handful — original, preview, peaks, artwork — but
 * listing rather than assuming means a key added later is still cleaned up.
 */
async function listPrefix(aws: AwsClient, host: string, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | null = null
  do {
    const url = new URL(`https://${host}/`)
    url.searchParams.set('list-type', '2')
    url.searchParams.set('prefix', prefix)
    if (token) url.searchParams.set('continuation-token', token)

    const res = await aws.fetch(url.toString(), { method: 'GET' })
    if (!res.ok) throw new Error(`list failed (${res.status})`)
    const xml = await res.text()

    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    const next = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)
    token = truncated && next ? next[1] : null
  } while (token)
  return keys
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const { cfg, problems } = readConfig()
  if (problems.length) return json({ error: 'function is misconfigured', problems }, 500, origin)

  let body: { id?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }

  const id = typeof body.id === 'string' ? body.id.toLowerCase() : ''
  // The id becomes an S3 prefix, so it is checked before it is used as one.
  if (!UUID_RE.test(id)) return json({ error: 'id must be a track uuid' }, 400, origin)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  if (!(await staffUserId(req, admin))) return json({ error: 'not authorised' }, 401, origin)

  const { data: track, error: lookupError } = await admin
    .from('tracks')
    .select('id, title')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return json({ error: 'lookup failed' }, 500, origin)
  if (!track) return json({ error: 'unknown track' }, 404, origin)

  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: 's3',
  })
  const host = `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`

  let keys: string[]
  try {
    keys = await listPrefix(aws, host, `tracks/${id}/`)
  } catch (e) {
    return json({ error: 'could not list the track objects', detail: String(e) }, 502, origin)
  }

  // One DELETE each rather than the batch API: a track owns a handful of
  // objects, and the batch call needs a signed body with its own checksum —
  // more to get wrong than the round trips are worth.
  for (const key of keys) {
    const res = await aws.fetch(`https://${host}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE',
    })
    // S3 returns 204 for a delete, and for a key that was already gone.
    if (!res.ok && res.status !== 404) {
      return json(
        { error: 'could not delete the track objects', key, status: res.status },
        502,
        origin,
      )
    }
  }

  // Only now the row. playlist_tracks and comments cascade; the playlist
  // video, project assets and events null out.
  const { error: deleteError } = await admin.from('tracks').delete().eq('id', id)
  if (deleteError) {
    return json(
      { error: 'objects deleted but the row remains', detail: deleteError.message },
      500,
      origin,
    )
  }

  return json({ ok: true, id, objects_deleted: keys.length }, 200, origin)
})
