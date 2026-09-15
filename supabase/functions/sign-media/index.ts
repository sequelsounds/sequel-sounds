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
//
// A download is a read with a name on it. `download: { key: filename }` asks
// for URLs that make the browser save the object under that name rather
// than play it in a tab, and it is where the playlist's two switches bite:
// a viewer only gets a download URL at all when the playlist allows
// downloads, and only gets an `original.*` key when it allows originals.
// Staff are not switched.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const URL_TTL_SECONDS = 3600
const MAX_KEYS = 200

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/, // the app's own domain (Andy, 13 Sep)
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

/**
 * A Content-Disposition for a filename someone typed. Two spellings, as RFC
 * 6266 has it: an ASCII fallback in the quoted form, and the real name
 * percent-encoded as UTF-8 for browsers that read the starred form — which
 * is all of them now, but the fallback costs nothing. Path separators,
 * quotes and control characters are stripped rather than escaped, because
 * none of them belong in a file name and a browser's handling of the
 * escaped forms is the kind of thing that differs per browser.
 */
function disposition(filename: string): string {
  const clean = filename
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, '')
    .trim()
    .slice(0, 150) || 'download'
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}

/**
 * Only keys under a track prefix are ever signed. `artwork-<uuid>.<ext>` is
 * the staff-replaced cover: sign-upload mints a fresh name each time rather
 * than overwriting the Lambda's artwork.jpg, so both have to be readable.
 */
const KEY_RE =
  /^tracks\/[0-9a-f-]{36}\/(original\.[a-z0-9]+|preview\.(mp3|mp4)|artwork(-[0-9a-f-]{36})?\.(jpg|jpeg|png|webp)|peaks\.json)$/

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const { cfg, problems } = readConfig()
  if (problems.length) return json({ error: 'storage is misconfigured', problems }, 500, origin)

  let body: { keys?: unknown; download?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }
  // The names a caller wants its downloads saved under, by key. Only keys
  // that pass the same pattern as everything else get through.
  const download: Record<string, string> = {}
  if (body.download && typeof body.download === 'object') {
    for (const [k, v] of Object.entries(body.download as Record<string, unknown>)) {
      if (KEY_RE.test(k) && typeof v === 'string' && v.trim()) download[k] = v
    }
  }
  const keys = [
    ...new Set([
      ...(Array.isArray(body.keys)
        ? body.keys.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k))
        : []),
      ...Object.keys(download),
    ]),
  ]
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
  // Staff get everything. A link holder gets what the link's switches say —
  // and a track link, which has no switches, gets previews only.
  let mayDownload = true
  let mayHaveOriginals = true

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

    const { data: playlist } = await admin
      .from('playlists')
      .select('allow_download, allow_originals')
      .eq('token', token)
      .maybeSingle()
    mayDownload = !!playlist?.allow_download
    mayHaveOriginals = !!playlist?.allow_download && !!playlist?.allow_originals
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
      const original = /\/original\.[a-z0-9]+$/.test(key)
      const name = download[key]
      if (original && !mayHaveOriginals) return
      if (name && !mayDownload) return
      const target = new URL(`https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`)
      target.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS))
      // Part of what is signed, so it cannot be changed after the fact. The
      // browser saves the object rather than opening it, under the name
      // given — which is the track's title and the right extension, not
      // "original.wav" forty times over.
      if (name) target.searchParams.set('response-content-disposition', disposition(name))
      const signed = await aws.sign(target.toString(), { method: 'GET', aws: { signQuery: true } })
      urls[key] = signed.url
    }),
  )

  return json({ urls, expires_in: URL_TTL_SECONDS }, 200, origin)
})
