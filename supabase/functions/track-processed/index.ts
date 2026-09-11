// track-processed — the ffmpeg Lambda reports here when it has finished with a
// file, and this is the only thing that writes the result to the database.
//
// The Lambda holds no database credentials on purpose: it runs arbitrary
// partner-supplied media through ffmpeg, which is the last place that should
// also hold a service-role key. It gets an S3 role and one shared secret, and
// everything it learns arrives through this endpoint.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const MIN_SECRET_LENGTH = 32

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function readConfig() {
  const problems: string[] = []
  const secret = Deno.env.get('TRACK_PROCESSED_SECRET') ?? ''
  if (!secret) problems.push('TRACK_PROCESSED_SECRET is not set')
  else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `TRACK_PROCESSED_SECRET is ${secret.length} chars, expected at least ${MIN_SECRET_LENGTH}`,
    )
  }
  return { secret, problems }
}

/** Constant-time, and hashed first so length does not leak either. */
async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

type Body = {
  track_id?: string
  status?: 'done' | 'failed'
  error?: string
  fields?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const { secret, problems } = readConfig()
  if (problems.length) return json({ error: 'misconfigured', problems }, 500)

  const provided = req.headers.get('x-processing-secret')
  if (!provided) return json({ error: 'missing processing secret' }, 401)
  if (!(await secretMatches(provided, secret))) {
    return json({ error: 'invalid processing secret' }, 401)
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  const { track_id, status, error, fields } = body
  if (!track_id) return json({ error: 'track_id is required' }, 400)
  if (status !== 'done' && status !== 'failed') {
    return json({ error: "status must be 'done' or 'failed'" }, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: track, error: lookupError } = await admin
    .from('tracks')
    .select('id, project_id, original_filename, created_at')
    .eq('id', track_id)
    .maybeSingle()

  if (lookupError) return json({ error: 'lookup failed' }, 500)
  if (!track) return json({ error: 'unknown track' }, 404)

  if (status === 'failed') {
    await admin
      .from('tracks')
      .update({
        processing_status: 'failed',
        processing_error: error ?? 'processing failed',
      })
      .eq('id', track_id)
    return json({ ok: true, track_id, status: 'failed' }, 200)
  }

  const f = fields ?? {}

  // The title rule, applied to the authoritative read. Identical to the
  // browser's: the embedded title verbatim, or the filename minus extension.
  // Nothing is tidied — that is a staff decision in the library, not a guess
  // made here.
  const embeddedTitle = f.title_from_tag
  const title =
    typeof embeddedTitle === 'string' && embeddedTitle.trim() !== ''
      ? embeddedTitle
      : (track.original_filename ?? '').replace(/\.[^.]+$/, '')

  // Advisory duplicate detection: the earliest track in this project with the
  // same bytes. Never blocks and never deletes — the row and its file stay, and
  // staff decide. Two masters really can be byte-identical and both wanted.
  let duplicateOf: string | null = null
  if (typeof f.content_hash === 'string') {
    const { data: earlier } = await admin
      .from('tracks')
      .select('id')
      .eq('project_id', track.project_id)
      .eq('content_hash', f.content_hash)
      .neq('id', track_id)
      .lte('created_at', track.created_at)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    duplicateOf = earlier?.id ?? null
  }

  const { error: updateError } = await admin
    .from('tracks')
    .update({
      title: title === '' ? (track.original_filename ?? 'Untitled') : title,
      artist: f.artist ?? null,
      album: f.album ?? null,
      composer: f.composer ?? null,
      grouping: f.grouping ?? null,
      genre: f.genre ?? null,
      year: f.year ?? null,
      release_date: f.release_date ?? null,
      bpm: f.bpm ?? null,
      musical_key: f.musical_key ?? null,
      isrc: f.isrc ?? null,
      iswc: f.iswc ?? null,
      pro_number: f.pro_number ?? null,
      track_no: f.track_no ?? null,
      disc_no: f.disc_no ?? null,
      comments: f.comments ?? null,
      duration_seconds: f.duration_seconds ?? null,
      size_bytes: f.size_bytes ?? null,
      content_hash: f.content_hash ?? null,
      preview_key: f.preview_key ?? null,
      artwork_s3_key: f.artwork_s3_key ?? null,
      waveform_peaks: f.waveform_peaks ?? null,
      embedded_tags: f.embedded_tags ?? null,
      duplicate_of: duplicateOf,
      processing_status: 'ready',
      processing_error: null,
    })
    .eq('id', track_id)

  if (updateError) {
    return json({ error: 'could not save', detail: updateError.message }, 500)
  }

  return json({ ok: true, track_id, status: 'ready', duplicate_of: duplicateOf }, 200)
})
