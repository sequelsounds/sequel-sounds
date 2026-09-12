// xano-webhook — Xano pushes project, supplier and asset changes here.
//
// Xano is the system of record for projects, suppliers and project assets;
// this app only keeps mirrors of them. Upserts are keyed on `xano_id`, so the same change can be
// replayed safely — Xano can retry a failed call without creating duplicates.
//
// Auth is a shared secret in a header, not a Supabase JWT: the caller is a
// server, and the publishable key would add nothing since it is public. The
// function is therefore deployed with verify_jwt disabled and this check IS the
// gate. Keep it that way.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

// Long enough that guessing is hopeless; short enough to paste.
const MIN_SECRET_LENGTH = 32

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Config sanity, in the same spirit as sign-upload: a misconfigured secret
 * should say so, rather than silently rejecting every call from Xano and
 * looking like a Xano bug. Names and lengths only — never values.
 */
function readConfig() {
  const problems: string[] = []
  const secret = Deno.env.get('XANO_WEBHOOK_SECRET') ?? ''
  const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? ''

  if (!secret) problems.push('XANO_WEBHOOK_SECRET is not set')
  else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `XANO_WEBHOOK_SECRET is ${secret.length} chars, expected at least ${MIN_SECRET_LENGTH}`,
    )
  }

  if (!appBaseUrl) problems.push('APP_BASE_URL is not set')
  else if (!/^https?:\/\/[^/]+$/.test(appBaseUrl)) {
    problems.push('APP_BASE_URL must be an origin with no trailing path, e.g. https://app.sequelsounds.app')
  }

  return { secret, appBaseUrl, problems }
}

/**
 * Constant-time comparison. Both sides are hashed first so that a difference in
 * length cannot be measured either.
 */
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

/** Trimmed string, or null. Xano sends "" for empty fields rather than omitting them. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** A date column will reject "", so anything unparseable becomes null. */
function date(value: unknown): string | null {
  const s = text(value)
  if (!s) return null
  return Number.isNaN(Date.parse(s)) ? null : s.slice(0, 10)
}

type Payload = { type?: string; record?: Record<string, unknown> }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const { secret, appBaseUrl, problems } = readConfig()
  if (problems.length) return json({ error: 'webhook is misconfigured', problems }, 500)

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

  const { type, record } = payload
  if (type !== 'project' && type !== 'supplier' && type !== 'asset') {
    return json({ error: "type must be 'project', 'supplier' or 'asset'" }, 400)
  }
  if (!record || typeof record !== 'object') {
    return json({ error: 'record is required' }, 400)
  }

  const xanoId = text(record.xano_id)
  const name = text(record.name)
  if (!xanoId) return json({ error: 'record.xano_id is required' }, 400)
  if (!name) return json({ error: 'record.name is required' }, 400)

  // Mirrors are written only by this function, with service_role. RLS on those
  // tables grants staff read and nothing else.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  // Assets hang off a project, so the parent has to be mirrored first. Xano
  // sends the project's own id; the mirror row is looked up by it.
  if (type === 'asset') {
    const projectXanoId = text(record.project_xano_id)
    if (!projectXanoId) return json({ error: 'record.project_xano_id is required' }, 400)

    const { data: project, error: projectError } = await admin
      .from('projects_mirror')
      .select('id')
      .eq('xano_id', projectXanoId)
      .maybeSingle()
    if (projectError) return json({ error: 'lookup failed' }, 500)
    if (!project) {
      // Not an error to retry blindly: the project record has to arrive first.
      return json({ error: 'unknown project', project_xano_id: projectXanoId }, 409)
    }

    const { data: before } = await admin
      .from('project_assets')
      .select('id')
      .eq('xano_id', xanoId)
      .maybeSingle()

    const size = typeof record.size_bytes === 'number' ? record.size_bytes : null
    const { data: saved, error: upsertError } = await admin
      .from('project_assets')
      .upsert(
        {
          xano_id: xanoId,
          project_id: project.id,
          name,
          source_bucket: text(record.bucket) ?? 'sequel-uploaded-project-assets',
          source_key: text(record.key),
          mime_type: text(record.mime_type),
          size_bytes: size,
          raw: record,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'xano_id' },
      )
      .select('id')
      .single()
    if (upsertError || !saved) {
      return json({ error: 'could not save record', detail: upsertError?.message }, 500)
    }
    return json({ ok: true, type, id: saved.id, xano_id: xanoId, created: !before }, 200)
  }

  const table = type === 'project' ? 'projects_mirror' : 'suppliers_mirror'

  // Looked up first so the response can tell Xano whether this call created the
  // row. Xano uses that to decide whether it needs to store the inbox URL.
  const { data: before, error: lookupError } = await admin
    .from(table)
    .select('id')
    .eq('xano_id', xanoId)
    .maybeSingle()
  if (lookupError) return json({ error: 'lookup failed' }, 500)

  const row =
    type === 'project'
      ? {
          xano_id: xanoId,
          name,
          client_name: text(record.client_name),
          status: text(record.status),
          brief: text(record.brief),
          starts_on: date(record.starts_on),
          ends_on: date(record.ends_on),
          raw: record,
          synced_at: new Date().toISOString(),
        }
      : {
          xano_id: xanoId,
          name,
          contact_email: text(record.contact_email)?.toLowerCase() ?? null,
          notes: text(record.notes),
          raw: record,
          synced_at: new Date().toISOString(),
        }

  const { data: saved, error: upsertError } = await admin
    .from(table)
    .upsert(row, { onConflict: 'xano_id' })
    .select('id')
    .single()

  if (upsertError || !saved) {
    return json({ error: 'could not save record', detail: upsertError?.message }, 500)
  }

  const result: Record<string, unknown> = {
    ok: true,
    type,
    id: saved.id,
    xano_id: xanoId,
    created: !before,
  }

  if (type === 'project') {
    // Inserting a project fires projects_mirror_create_inbox, so the inbox
    // normally exists by now. The insert below is for projects that predate
    // that trigger; `on conflict do nothing` keeps it idempotent.
    let { data: inbox } = await admin
      .from('inboxes')
      .select('token, is_active, expires_at')
      .eq('project_id', saved.id)
      .maybeSingle()

    if (!inbox) {
      const { data: created } = await admin
        .from('inboxes')
        .insert({ project_id: saved.id })
        .select('token, is_active, expires_at')
        .maybeSingle()
      inbox = created ?? null
    }

    result.inbox = inbox
      ? {
          token: inbox.token,
          url: `${appBaseUrl}/inbox/${inbox.token}`,
          is_active: inbox.is_active,
          expires_at: inbox.expires_at,
        }
      : null

    // Where "Open in Studio" on the Track side should point: the project's
    // workspace, landing on its Inbox tab. Not /p/ — that prefix is the
    // viewer playlist route.
    result.studio_url = `${appBaseUrl}/projects/${saved.id}`
  }

  return json(result, 200)
})
