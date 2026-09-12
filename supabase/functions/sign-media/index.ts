// sign-media — presigned GET URLs for previews, artwork and originals.
//
// The media bucket is private, so the player cannot fetch `preview.mp3`
// directly. This signs reads for a batch of keys at once, because a project
// inbox shows forty tracks and forty round trips before the first artwork
// paints is not acceptable.
//
// Two callers, two authorisations:
//   - staff, identified by their Supabase session (the Authorization bearer)
//   - a viewer holding a playlist token, who may only read keys that belong
//     to tracks on that playlist
// Neither chooses anything but the key, and the key is checked against the
// tracks table before it is signed, so a caller cannot sign a read for
// arbitrary objects in the bucket.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const URL_TTL_SECONDS = 3600
const MAX_KEYS = 200

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
  /^https:\/\/[^.]+\.sequelsounds\.app$/,
]

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

/** Only keys under a track prefix are ever signed. */
const KEY_RE = /^tracks\/[0-9a-f-]{36}\/(original\.[a-z0-9]+|preview\.(mp3|mp4)|artwork\.jpg|peaks\.json)$/

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const { cfg, problems } = readConfig()
  if (problems.length) return json({ error: 'storage is misconfigured', problems }, 500, origin)

  let body: { keys?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }
  const keys = Array.isArray(body.keys)
    ? [...new Set(body.keys.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)))]
    : []
  if (keys.length === 0) return json({ urls: {} }, 200, origin)
  if (keys.length > MAX_KEYS) return json({ error: `at most ${MAX_KEYS} keys per call` }, 413, origin)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Which tracks may this caller read? Staff: all of them. A token holder: the
  // playlist's tracks, resolved by the same RLS the viewer page uses, so the
  // rules cannot drift apart.
  const trackIds = keys.map((k) => k.split('/')[1])
  let allowed: Set<string>

  const token = req.headers.get('x-share-token')
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''

  const { data: userData } = bearer
    ? await admin.auth.getUser(bearer)
    : { data: { user: null } }
  const userId = userData?.user?.id ?? null

  const { data: staffRow } = userId
    ? await admin.from('staff').select('user_id').eq('user_id', userId).maybeSingle()
    : { data: null }

  if (staffRow) {
    allowed = new Set(trackIds)
  } else if (token) {
    // Anon/viewer client with the token header; RLS does the scoping.
    const scoped = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false },
      global: {
        headers: {
          'x-share-token': token,
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
      },
    })
    const { data: visible, error } = await scoped
      .from('tracks')
      .select('id')
      .in('id', trackIds)
    if (error) return json({ error: 'lookup failed' }, 500, origin)
    allowed = new Set((visible ?? []).map((t) => t.id))
  } else {
    return json({ error: 'not authorised' }, 401, origin)
  }

  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: 's3',
  })

  const urls: Record<string, string> = {}
  await Promise.all(
    keys.map(async (key) => {
      if (!allowed.has(key.split('/')[1])) return
      const target = new URL(`https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`)
      target.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS))
      const signed = await aws.sign(target.toString(), { method: 'GET', aws: { signQuery: true } })
      urls[key] = signed.url
    }),
  )

  return json({ urls, expires_in: URL_TTL_SECONDS }, 200, origin)
})
