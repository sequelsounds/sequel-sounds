// xano-mirror-sync — Xano pushes whole tables here to keep `xano_mirror` in step.
//
// Sibling to xano-webhook, and deliberately not the same thing. That function
// mirrors three shapes into the Studio app's own tables, translating each field
// by hand. This one keeps a faithful replica of Xano's schema in the
// `xano_mirror` schema while Sequel Track migrates across, so it is generic: it
// takes a table name and rows, and the caller does not describe the columns.
//
// Xano stays the system of record. Nothing in the app writes to `xano_mirror` —
// it has no insert, update or delete policies at all — so this function, running
// as service_role, is the only writer.
//
// Auth is a shared secret in a header, as in xano-webhook: the caller is a
// server, so a publishable key would add nothing. Deployed with verify_jwt
// disabled, which makes this check the gate. Keep it that way.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const MIN_SECRET_LENGTH = 32

// Upserts go in batches so one oversized table cannot time the function out.
const BATCH = 500

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Shares XANO_WEBHOOK_SECRET with xano-webhook rather than minting its own.
 * Same caller, same trust boundary, and one less secret to keep in step in two
 * places. Names and lengths only — never values.
 */
function readConfig() {
  const problems: string[] = []
  const secret = Deno.env.get('XANO_WEBHOOK_SECRET') ?? ''
  if (!secret) problems.push('XANO_WEBHOOK_SECRET is not set')
  else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `XANO_WEBHOOK_SECRET is ${secret.length} chars, expected at least ${MIN_SECRET_LENGTH}`,
    )
  }
  return { secret, problems }
}

/** Hashed both sides first, so length cannot be measured either. */
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

const TIME_TYPES = new Set([
  'timestamp with time zone',
  'timestamp without time zone',
  'date',
])
const NUMBER_TYPES = new Set([
  'integer',
  'bigint',
  'smallint',
  'numeric',
  'double precision',
  'real',
])

/**
 * Xano's conventions, turned into Postgres ones:
 *
 *  - timestamps arrive as epoch milliseconds, and `0` means "never set"
 *  - every unset field arrives as `""`, which a numeric, date, uuid or boolean
 *    column rejects outright
 *
 * Empty strings are kept for text columns, where "" and null are genuinely
 * different, and dropped everywhere else.
 */
function coerce(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null

  if (TIME_TYPES.has(dataType)) {
    if (value === '' || value === 0 || value === '0') return null
    if (typeof value === 'number') return new Date(value).toISOString()
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return new Date(Number(value)).toISOString()
    }
    return value
  }

  if (value === '') {
    if (NUMBER_TYPES.has(dataType)) return null
    if (dataType === 'uuid' || dataType === 'boolean') return null
    if (dataType === 'jsonb' || dataType === 'json') return null
  }

  return value
}

type Payload = {
  table?: string
  rows?: Record<string, unknown>[]
  full?: boolean
  allow_empty?: boolean
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const { secret, problems } = readConfig()
  if (problems.length) return json({ error: 'sync is misconfigured', problems }, 500)

  const provided = req.headers.get('x-webhook-secret')
  if (!provided) return json({ error: 'missing webhook secret' }, 401)
  if (!(await secretMatches(provided, secret))) {
    return json({ error: 'invalid webhook secret' }, 401)
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  const table = typeof payload.table === 'string' ? payload.table.trim() : ''
  const rows = Array.isArray(payload.rows) ? payload.rows : null
  const full = payload.full === true

  if (!table) return json({ error: 'table is required' }, 400)
  if (!rows) return json({ error: 'rows must be an array' }, 400)

  // A full push of nothing means "Xano has no rows", and would empty the
  // mirror table. That is almost always a failed query upstream rather than a
  // real emptying, and a scheduled job must not turn one bad read into data
  // loss. Genuinely emptying a table has to say so.
  if (full && rows.length === 0 && payload.allow_empty !== true) {
    return json(
      {
        error: 'refusing to empty a table on an empty full push',
        table,
        hint: 'pass allow_empty: true if the table really is empty in Xano',
      },
      400,
    )
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false }, db: { schema: 'xano_mirror' } },
  )

  // The table name is never interpolated into SQL, but an unknown one should
  // say so plainly rather than surfacing as a PostgREST 404 later. An empty
  // column list is what "no such table in xano_mirror" looks like.
  const { data: columns, error: columnsError } = await admin
    .schema('public')
    .rpc('xano_mirror_columns', { p_table: table })
  if (columnsError) {
    return json({ error: 'could not read table columns', detail: columnsError.message }, 500)
  }
  if (!columns || columns.length === 0) {
    return json({ error: 'unknown table', table }, 404)
  }

  const types = new Map<string, string>(
    (columns as { column_name: string; data_type: string }[]).map((c) => [
      c.column_name,
      c.data_type,
    ]),
  )

  // Columns Xano no longer sends are left alone rather than nulled; columns it
  // sends that the mirror does not have are dropped, so adding a field in Xano
  // does not break the sync before the mirror catches up.
  const prepared: Record<string, unknown>[] = []
  for (const row of rows) {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      const type = types.get(key)
      if (!type) continue
      out[key] = coerce(value, type)
    }
    if (out.id === null || out.id === undefined) {
      return json({ error: 'every row needs an id', table }, 400)
    }
    prepared.push(out)
  }

  let upserted = 0
  for (let i = 0; i < prepared.length; i += BATCH) {
    const slice = prepared.slice(i, i + BATCH)
    const { error } = await admin.from(table).upsert(slice, { onConflict: 'id' })
    if (error) {
      return json(
        { error: 'upsert failed', table, at_row: i, detail: error.message },
        500,
      )
    }
    upserted += slice.length
  }

  // A replica that only ever gains rows drifts: this is how a delete in Xano
  // reaches the mirror. `full` says the payload is the whole table, so anything
  // else in the mirror is gone from Xano. Deliberately opt-in — a partial push
  // with `full` set would empty the table.
  let deleted: number | null = null
  if (full) {
    const ids = prepared.map((r) => r.id)
    const query = admin.from(table).delete({ count: 'exact' })
    const { count, error } = ids.length
      ? await query.not('id', 'in', `(${ids.join(',')})`)
      : await query.not('id', 'is', null)
    if (error) {
      return json({ error: 'delete of removed rows failed', table, detail: error.message }, 500)
    }
    deleted = count ?? 0
  }

  return json(
    { ok: true, table, received: rows.length, upserted, deleted, full },
    200,
  )
})
