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

// ⚠️ THE RULES BELOW ARE XANO'S, VERBATIM (function 41, read 18 Sep). They are
// not a summary and must not be tidied: every clause is there because the model
// got that case wrong at least once. A first rebuild paraphrased them from the
// write-up and mislabelled contract types, which is how this came to be copied
// across word for word instead.
//
// When changing one rule, RE-CHECK THE OTHERS — three prompt "improvements"
// over there each moved one field and broke another.
//
// ONE CLAUSE IS OURS, NOT XANO'S: the song rule now carries the shape of an
// MCPS production music licence, where the track sits in a Musical Works and
// Sound Recordings table on a later page while the front page carries a
// Production Title that is the ADVERT, not the track. Xano's "the track title,
// or null" left the model nothing to anchor on and it returned nothing
// (Andy, 18 Sep, licence LMGR-0028386 — "Gonna make it look good" on page 2,
// "Tresemme Thena" on page 1).
const PROMPT = `You are reading a music industry contract. Extract only what the document actually states. Never guess and never infer from the filename. Return a flat JSON object, not an array, with exactly these fourteen keys. KEY contract_type: decide this by asking WHICH RIGHTS THE DOCUMENT GRANTS, not by whether the word licence appears. Work through these in order. Publishing means the document grants publishing, composition, songwriting or publisher share rights only, and does not grant the sound recording. A synchronisation licence from a music publisher for the use of a composition is Publishing. Master means the document grants the sound recording or master rights only, and not the composition. A licence from a record label for the use of a recording is Master. Master and Publishing means the same document grants both sides. Library means specifically a production music or stock music licence, where the track comes from a production music catalogue that exists to be licensed. Do NOT choose Library merely because the document is a licence, and do NOT choose Library for a publisher or label licensing a commercially released track. Talent means a performer, session musician or voiceover agreement. Sonic Branding means a sonic logo or brand identity. Buy Out means a full acquisition of all rights. If none fits, return null, which is far better than a wrong answer. KEY companies_printed: an ARRAY of strings listing EVERY music company named on the document that owns, controls, licenses or supplies the music. Write each EXACTLY as printed, including any Limited or Inc suffix. Include the label, the publisher, the production music library, the imprint AND any parent or group company, listing all of them separately, because we match them against our own list afterwards. KEY supplier_address: the registered or trading address printed for the company GRANTING the rights, copied as it appears. Never the address of the brand, the agency, the licensee or a collecting society, all of which commonly appear on the same page. Return null if the granting company has no address printed, which is normal on a licence issued by a society on a rights holder behalf. KEY supplier_country: just the country from that address, in English, for example United Kingdom or United States. If the country is not written out but the address is plainly identifiable, give the country it belongs to. Return null if you cannot tell or if there is no supplier address. Two rules govern all three of those keys. FIRST, a collecting society or licensing body is never the supplier. MCPS, the Mechanical Copyright Protection Society, PRS, PPL, ASCAP, BMI, GEMA and SACEM are never suppliers, even when one of them issues, administers or signs the licence. SECOND, the end client, the brand and the advertising agency are never the supplier. Do not normalise, translate or invent company names, and never add a company that is not printed on the page. KEY mcps_papered: true if this licence is issued, administered or signed by MCPS, also written as the Mechanical Copyright Protection Society, or by PRS for Music on behalf of MCPS. False if it plainly is not. This is a separate question from supplier and type and does not change either. KEY artist: the recording or performing artist, meaning a person or band and never a company or a publisher. On a publishing document the artist is often given as the recording the composition is known by, written as performed by, as recorded by, or artist. Return null only if no performer is named anywhere. KEY song: the track title, or null. On a production music or society licence the track is listed in a table, often headed Musical Works and Sound Recordings, with columns such as Title, Composer, Library/Publisher, Tunecode, ISWC and Duration. Take the song from the Title column of that table, and the artist from its Composer column. A Production Title, campaign name or advert name printed elsewhere on the licence is the thing the music is used IN, and is never the song. If that table lists several works, give the first. KEY master_pct: the master or recording share granted, as a number from 0 to 100, or null if the document grants no master rights or states no master figure. KEY publishing_pct: the publishing share granted, as a number from 0 to 100, or null if the document grants no publishing rights or states no publishing figure. ON THE PERCENTAGES. master_pct and publishing_pct are different figures and often differ on the same document, so read them separately and never copy one into the other. Count only shares actually GRANTED by this document. If a share is named but excluded, carved out, reserved, or said to be controlled or administered by a third party, do not include it. If several writers or rights holders are each granted separately, SUM only the granted shares into one figure, so three granted writers at 40, 25 and 10 is 75 even if a fourth uncontrolled writer at 25 is also listed. If the document states no share at all, return null. Return 0 only where a zero share is genuinely stated. NOW THE DATES, WHICH DRIVE RENEWAL CHASING AND MUST BE READ CONSERVATIVELY. KEY start_date: the date the licence term COMMENCES, formatted as YYYY-MM-DD. This is the commencement date, effective date, or start of term. It is NOT the date of signature, NOT the date printed on the letterhead, and NOT the invoice or order date. Those routinely all appear on the same document and are routinely different from each other. If no commencement date is stated, return null rather than the nearest date on the page. A null here is correct and safe. A signature date returned as a commencement date is neither. KEY end_date: the date the licence EXPIRES, formatted as YYYY-MM-DD, but ONLY where the document prints an actual calendar end date. If the document instead states a length of time, return null here and use the term keys below. KEY term_value: the length of the licence as a whole number, or null. KEY term_unit: the unit that length is measured in, which must be exactly one of days, weeks, months, years, or null. So one (1) year becomes term_value 1 and term_unit years. Twenty-four months becomes 24 and months. A three week pop up campaign becomes 3 and weeks. If no term is stated, return null for both. An OPTION or right to extend is NOT part of the term, so twelve months with an option for a further twelve is term_value 12 and term_unit months. KEY perpetual: true if the grant is in perpetuity, permanent, irrevocable, for the life of copyright, or a full buy out of all rights. Perpetual OVERRIDES the term keys, so if any part of the grant is perpetual return true even where a period is also mentioned somewhere on the document. Return false where the licence plainly expires. Getting this wrong in the false direction means we chase a client to renew a licence they already own outright, so when a document reads as a buy out, say so.`

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
                // Rules first, document second — the order Xano sends.
                { text: PROMPT },
                { inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } },
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
    // ⚠️ MCPS-PAPERED LICENCES ARE PERPETUAL. They have been for at least ten
    // years, whatever Term or Valid-to date is printed: that date bounds the
    // Campaign Rate bracket, not the grant. Xano applies the same blanket rule.
    // A Buy Out is perpetual by definition.
    const mcps = read.mcps_papered === true
    const perpetual = read.perpetual === true || read.contract_type === 'Buy Out' || mcps
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
          mcps,
          start_date: read.start_date ?? null,
          // ⚠️ No falling back to the printed date when the grant is
          // perpetual: track_contract_dates returns null there and the save
          // stores null, so showing the printed valid-to date would put a
          // figure in the form that never lands in the database. An MCPS
          // licence prints one on every page.
          end_date: perpetual ? null : (dates?.end_date ?? read.end_date ?? null),
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
