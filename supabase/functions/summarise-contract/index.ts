// summarise-contract — the Coda overview on the contract page.
//
//   staff (their session as bearer):
//     { action: "summarise", uuid, force?: true }
//
// The old app did this in Xano function 43 + api 564. Same shape, same model,
// same caching rules.
//
// ⚠️ THE CACHE IS THE POINT. A read costs money and three seconds. The page
// calls this ONLY when `track_contract_detail` says the stored summary is
// missing, failed, or was written by an older prompt — or when the person
// presses TRY AGAIN, which arrives here as force.
//
// ⚠️ THE PROMPT LIVES IN THE DATABASE (`track_ai_prompts`), not here, so it can
// be tuned without a deploy. Bump `prompt_version` in the same edit or nothing
// regenerates.
//
// ⚠️ NO responseMimeType. This one returns prose. Forcing JSON on it is the
// mistake the extraction's settings invite.
//
// ⚠️ THE MODEL IS PINNED. `-latest` aliases hot-swap on release.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const READ_TTL_SECONDS = 300
/** What the model will be shown. Bigger than this and the read is refused. */
const MAX_READ_BYTES = 20 * 1024 * 1024
const KEY_RE = /^contracts\/[0-9a-f-]{36}_[^/\\]+$/
const MODEL = 'gemini-3.5-flash-lite'
const PROMPT_KEY = 'contract_summary'

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

function dbError(error: { code?: string; message?: string }) {
  const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 400
  return { status, message: error.message ?? 'That did not work.' }
}

/** Chunked, because a spread over a megabyte-long array blows the call stack
 *  and the crash reads exactly like a corrupt file. */
function toBase64(bytes: Uint8Array) {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

/** The failure the page shows, and the text stored against the row so a second
 *  visit does not re-run the model on a file that cannot be read. */
const FAILED_TEXT =
  'The document could not be read. Try again, and if it keeps failing the stored file may be unreadable.'

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const bucket = Deno.env.get('S3_BUCKET') ?? ''
  const region = Deno.env.get('S3_REGION') ?? ''
  const accessKeyId = Deno.env.get('S3_ACCESS_KEY_ID') ?? ''
  const secretAccessKey = Deno.env.get('S3_SECRET_ACCESS_KEY') ?? ''
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return json({ error: 'storage is misconfigured' }, 500, origin)
  }
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  if (!apiKey) return json({ error: 'The contract reader is not switched on yet.' }, 503, origin)

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }
  if (body.action !== 'summarise') return json({ error: 'unknown action' }, 400, origin)

  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
  })

  const uuid = String(body.uuid ?? '')

  // The database hands back the only key this will sign; the caller never
  // names one.
  const { data: key, error: keyErr } = await asCaller.rpc('track_contract_key', { p_uuid: uuid })
  if (keyErr) {
    const e = dbError(keyErr)
    return json({ error: e.message }, e.status, origin)
  }
  if (!KEY_RE.test(key)) {
    return json({ error: 'This contract is still in the old app’s storage.', legacy: true }, 409, origin)
  }

  const { data: prompt, error: promptErr } = await asCaller.rpc('track_ai_prompt', { p_key: PROMPT_KEY })
  if (promptErr) {
    const e = dbError(promptErr)
    return json({ error: e.message }, e.status, origin)
  }
  const version: string = prompt.prompt_version

  const save = async (summary: string, status: 'ok' | 'failed') => {
    const { error } = await asCaller.rpc('track_save_contract_summary', {
      p_uuid: uuid,
      p_summary: summary,
      p_status: status,
      p_version: version,
    })
    // A failed write is worth knowing about but must not lose the summary the
    // person is waiting for — it just means the next visit re-reads.
    if (error) console.error('summarise-contract: the cache write failed', error.message)
  }

  const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: 's3' })
  const target = new URL(
    `https://${bucket}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`,
  )
  target.searchParams.set('X-Amz-Expires', String(READ_TTL_SECONDS))
  const signed = await aws.sign(target.toString(), { method: 'GET', aws: { signQuery: true } })

  const file = await fetch(signed.url)
  if (!file.ok) {
    console.error('summarise-contract: S3 refused the read', file.status)
    await save(FAILED_TEXT, 'failed')
    return json({ status: 'failed', summary: FAILED_TEXT, version }, 200, origin)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength > MAX_READ_BYTES) {
    return json({ error: 'That file is too big to read automatically.' }, 413, origin)
  }
  const mime = file.headers.get('content-type') ?? 'application/pdf'
  if (!mime.includes('pdf')) {
    return json({ error: 'Only PDFs can be summarised.' }, 415, origin)
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              // Rules first, document second — the order Xano sends.
              { text: prompt.prompt_text },
              { inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    },
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('summarise-contract: the model refused', res.status, detail.slice(0, 300))
    await save(FAILED_TEXT, 'failed')
    return json({ status: 'failed', summary: FAILED_TEXT, version }, 200, origin)
  }

  // deno-lint-ignore no-explicit-any
  const payload = (await res.json()) as any
  const text: string =
    payload?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  const clean = text.trim()
  if (!clean) {
    console.error('summarise-contract: the model returned nothing')
    await save(FAILED_TEXT, 'failed')
    return json({ status: 'failed', summary: FAILED_TEXT, version }, 200, origin)
  }

  await save(clean, 'ok')
  return json({ status: 'ok', summary: clean, version }, 200, origin)
})
