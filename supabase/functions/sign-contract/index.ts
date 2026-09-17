// sign-contract — presigned S3 URLs for CONTRACTS, and the AI read of a PDF.
//
//   staff (their session as bearer):
//     { action: "upload", project_id, file_name, size_bytes, file_type }
//         -> the row is written FIRST (track_create_contract), then a PUT url
//            for the key the database chose
//     { action: "read", uuid, download?: true }
//         -> a GET url for the file
//     { action: "extract", uuid }
//         -> reads the PDF out of S3 and returns SUGGESTED fields. Writes
//            nothing: the person saving the form is what commits them.
//
// ⚠️ THE DATABASE DECIDES, NOT THIS FILE. Every action calls a SECURITY
// DEFINER function AS THE CALLER, which checks track_is_staff() and hands back
// the only key this function will sign. The caller never names a key.
//
// ⚠️ THE MODEL NEVER PICKS THE SUPPLIER. It returns every rights-holder name
// printed on the page, and `track_match_supplier` does the lookup in SQL. The
// old app asked the model to choose from a list of 92 companies and got
// "Universal Music UK" on a Warner licence — a confident wrong answer that
// nothing downstream could tell from a right one. A model reading a name off
// a page with code doing the lookup can only ever produce NO match.
//
// ⚠️ THE MODEL IS PINNED. `-latest` aliases hot-swap on release and can land
// on a preview build. Check the model list once or twice a year.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const READ_TTL_SECONDS = 3600
const PUT_TTL_SECONDS = 900
/** A contract is a document. 50 MB is already ten times the biggest we hold. */
const MAX_BYTES = 50 * 1024 * 1024
/** What the model will be shown. Bigger than this and the read is skipped. */
const MAX_READ_BYTES = 20 * 1024 * 1024
/** Belt and braces: only this prefix is ever signed, whatever the row says. */
const KEY_RE = /^contracts\/[0-9a-f-]{36}_[^/\\]+$/
const MODEL = 'gemini-3.5-flash-lite'

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

function objectUrl(bucket: string, region: string, key: string) {
  const path = key.split('/').map(encodeURIComponent).join('/')
  return new URL(`https://${bucket}.s3.${region}.amazonaws.com/${path}`)
}

function nameFromKey(key: string) {
  const last = key.split('/').pop() ?? key
  const cut = last.indexOf('_')
  return cut > -1 ? last.slice(cut + 1) : last
}

function disposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function dbError(error: { code?: string; message?: string }) {
  const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 400
  return { status, message: error.message ?? 'That did not work.' }
}

/** Bytes to base64 in chunks — a spread over a megabyte-long array blows the
 *  call stack, which looks like a corrupt file rather than a crash. */
function toBase64(bytes: Uint8Array) {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

// Every rule below is in the prompt because it is a way this goes wrong; see
// sequel-track-contracts.md §3.3–3.6. When changing one, RE-CHECK THE OTHERS —
// three prompt "improvements" each moved one field and broke another.
const PROMPT = `You are reading a music licence or agreement for a music supervision company.
Answer with JSON only, no prose and no code fences, with exactly these keys:

{
  "companies_printed": [string],   // EVERY rights-holder company name printed on the document,
                                   // imprint AND parent, exactly as written. Never the brand,
                                   // the agency, the licensee or a collecting society acting as
                                   // administrator. If none is printed, [].
  "supplier_address": string|null, // the granting party's address, only if printed
  "supplier_country": string|null, // the granting party's country, only if printed
  "contract_type": string|null,    // one of: Library, Master, Publishing, Master & Publishing,
                                   // Talent, Sonic Branding, Buy Out
  "artist": string|null,           // performing artist, if stated
  "song_name": string|null,        // the musical work licensed, if stated
  "master_pct": number|null,       // the master share GRANTED by this document
  "publishing_pct": number|null,   // the publishing share GRANTED by this document
  "mcps": boolean,                 // true only if MCPS is named as a party or administrator
  "start_date": string|null,       // commencement, YYYY-MM-DD
  "end_date": string|null,         // expiry, YYYY-MM-DD, ONLY if a calendar date is printed
  "term_value": number|null,       // the licence period as a number
  "term_unit": string|null,        // days | weeks | months | years
  "perpetual": boolean,            // true for a perpetual, in-perpetuity or buy-out grant
  "summary": string|null           // two sentences a colleague could act on
}

Rules:
- TYPE IS DECIDED BY THE RIGHTS GRANTED, not by the word "licence" on the page. A publishing
  sync licence is Publishing even when it comes from a library. Getting this wrong forces the
  wrong shares onto the record, which is worse than leaving it null.
- ONLY GRANTED SHARES COUNT. Shares carved out, reserved, or administered by a third party are
  excluded. Sum multiple granted writers.
- COMMENCEMENT IS NOT THE SIGNATURE DATE, not the letterhead date, and not the invoice date;
  all three routinely appear on the same document. If commencement is not stated, return null.
  A null is safe, a signature date is not.
- NEVER INFER A DATE FROM THE FILE NAME.
- end_date ONLY if a calendar date is printed. Otherwise give the term and leave end_date null.
- OPTIONS TO EXTEND ARE NOT TERM. "12 months with an option for a further 12" is 12 months.
- PERPETUAL OVERRIDES TERM even where a period also appears.
- If something is not printed, return null. Do not guess.`

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

  const sign = async (key: string, method: 'GET' | 'PUT', ttl: number, download?: string) => {
    const target = objectUrl(cfg.bucket, cfg.region, key)
    target.searchParams.set('X-Amz-Expires', String(ttl))
    if (download) target.searchParams.set('response-content-disposition', disposition(download))
    const signed = await aws.sign(target.toString(), { method, aws: { signQuery: true } })
    return signed.url
  }

  const authorization = req.headers.get('authorization') ?? ''
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  })

  // ----------------------------------------------------------------- upload
  if (body.action === 'upload') {
    const size = Number(body.size_bytes)
    if (!Number.isFinite(size) || size <= 0) return json({ error: 'That file is empty.' }, 400, origin)
    if (size > MAX_BYTES) return json({ error: 'Contracts must be under 50 MB.' }, 413, origin)
    const { data, error } = await asCaller.rpc('track_create_contract', {
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

  // ------------------------------------------------------------------- read
  if (body.action === 'read') {
    const { data: key, error } = await asCaller.rpc('track_contract_key', {
      p_uuid: String(body.uuid ?? ''),
    })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    // ⚠️ A contract uploaded before the rebuild lives in the old bucket
    // (contract-hub) under a YYYY/ key, and this signer has no reach there
    // until those files are synced across at cutover. Say so plainly rather
    // than signing a URL that will 403.
    if (!KEY_RE.test(key)) {
      return json({ error: 'This contract is still in the old app’s storage.', legacy: true }, 409, origin)
    }
    const url = await sign(key, 'GET', READ_TTL_SECONDS, body.download ? nameFromKey(key) : undefined)
    return json({ url, expires_in: READ_TTL_SECONDS }, 200, origin)
  }

  // ---------------------------------------------------------------- extract
  if (body.action === 'extract') {
    const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
    if (!apiKey) return json({ error: 'The contract reader is not switched on yet.' }, 503, origin)

    const { data: key, error } = await asCaller.rpc('track_contract_key', {
      p_uuid: String(body.uuid ?? ''),
    })
    if (error) {
      const e = dbError(error)
      return json({ error: e.message }, e.status, origin)
    }
    if (!KEY_RE.test(key)) {
      return json({ error: 'This contract is still in the old app’s storage.', legacy: true }, 409, origin)
    }

    // From S3, not from the upload — which is what makes re-reading an old
    // contract possible.
    const file = await fetch(await sign(key, 'GET', READ_TTL_SECONDS))
    if (!file.ok) {
      console.error('sign-contract: S3 refused the read', file.status)
      return json({ error: `Storage would not hand over the file (${file.status}).` }, 502, origin)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > MAX_READ_BYTES) {
      return json({ error: 'That file is too big to read automatically.' }, 413, origin)
    }
    // ⚠️ Never measure or log a binary body as text — it mangles high bytes
    // and reads exactly like data loss.
    const mime = file.headers.get('content-type') ?? 'application/pdf'
    if (!mime.includes('pdf')) {
      return json({ error: 'Only PDFs can be read automatically.' }, 415, origin)
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
                { inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } },
                { text: PROMPT },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('sign-contract: the model refused', res.status, detail.slice(0, 300))
      return json({ error: `The contract reader could not read it (${res.status}).` }, 502, origin)
    }
    // deno-lint-ignore no-explicit-any
    const payload = (await res.json()) as any
    const text: string = payload?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
    // responseMimeType is not reliably honoured, so fences are stripped.
    const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
    // deno-lint-ignore no-explicit-any
    let read: any
    try {
      read = JSON.parse(cleaned)
    } catch {
      console.error('sign-contract: the model did not return JSON', cleaned.slice(0, 200))
      return json({ error: 'The contract reader returned something unreadable.' }, 502, origin)
    }

    const names: string[] = Array.isArray(read.companies_printed)
      ? read.companies_printed.filter((n: unknown) => typeof n === 'string' && n.trim()).slice(0, 20)
      : []
    const { data: match } = await asCaller.rpc('track_match_supplier', {
      p_names: names,
      p_country: read.supplier_country ?? null,
    })

    // The same date engine the save uses, so what the form shows is what would
    // be stored — never a second copy of the arithmetic.
    const perpetual = read.perpetual === true || read.contract_type === 'Buy Out'
    const { data: dates } = await asCaller.rpc('track_contract_dates', {
      p_start: read.start_date ?? null,
      p_end: read.end_date ?? null,
      p_term_value: Number.isFinite(Number(read.term_value)) ? Number(read.term_value) : null,
      p_term_unit: read.term_unit ?? null,
      p_perpetual: perpetual,
    })

    return json(
      {
        suggested: {
          contract_type: read.contract_type ?? null,
          supplier_id: match?.supplier_id ?? null,
          supplier: match?.supplier ?? null,
          supplier_matched_on: names,
          country_matched: match?.country_matched ?? false,
          supplier_address: read.supplier_address ?? null,
          artist: read.artist ?? null,
          song_name: read.song_name ?? null,
          master_pct: read.master_pct ?? null,
          publishing_pct: read.publishing_pct ?? null,
          mcps: read.mcps === true,
          start_date: read.start_date ?? null,
          end_date: dates?.end_date ?? read.end_date ?? null,
          term_value: read.term_value ?? null,
          term_unit: read.term_unit ?? null,
          perpetual,
          summary: read.summary ?? null,
          // Null dates with nothing perpetual about them is the failure the
          // renewals page exists to catch, so the form says it out loud.
          dates_resolved: perpetual || Boolean(dates?.end_date),
        },
      },
      200,
      origin,
    )
  }

  return json({ error: 'unknown action' }, 400, origin)
})
