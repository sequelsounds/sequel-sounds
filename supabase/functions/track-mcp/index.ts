// track-mcp — an MCP server for Sequel Track.
//
// It exposes the one thing staff actually want to do from Coda or Claude
// without opening the app: create a project.
//
// AUTHORISATION IS NOT DONE HERE, ON PURPOSE. This function does exactly one
// security-relevant thing: it forwards the caller's own Supabase access token to
// PostgREST, so every statement runs as that person. From there the database
// decides:
//
//   - public.track_create_project is SECURITY INVOKER, so it has no more power
//     than its caller
//   - the insert policy on xano_mirror.project_master_list requires
//     track_is_staff()
//   - the create guard allocates the Sequel No. and refuses a project missing
//     any of its nine required fields
//
// So a client's token, or a token belonging to nobody, cannot create a project
// however this function is called. Adding a tool here can never widen what a
// person may do — only narrow it.
//
// Deployed with verify_jwt ON: the gateway rejects a missing or malformed token
// before this code runs.
//
// The protocol is hand-rolled rather than taken from a library. It is about a
// hundred lines of JSON-RPC, and a function that writes to the production
// database is the wrong place to inherit a dependency tree.
//
// ⚠️ project_master_list is STILL IN the hourly Xano sync (task 42). Until its
// two blocks come out, anything created through here is deleted on the hour.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SERVER_NAME = 'sequel-track'
const SERVER_VERSION = '0.1.0'
const PROTOCOL_VERSION = '2025-06-18'
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://studio.sequelsounds.com'

const CORS = {
  // The bearer token is the only thing that authorises anything, and browsers
  // never attach it cross-origin on their own, so the origin is not a gate.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
}

// ---------------------------------------------------------------- JSON-RPC --

type Id = string | number | null

function result(id: Id, value: unknown) {
  return json({ jsonrpc: '2.0', id, result: value })
}

function rpcError(id: Id, code: number, message: string) {
  return json({ jsonrpc: '2.0', id, error: { code, message } })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** A tool result the model is meant to read, whether it went well or not. */
function toolText(id: Id, text: string, isError = false) {
  return result(id, { content: [{ type: 'text', text }], isError })
}

// ------------------------------------------------------------------ tools --

const TOOLS = [
  {
    name: 'create_project',
    title: 'Create a project',
    description:
      'Create a new Sequel project. The Sequel No., the project id and the created date are ' +
      'allocated by the database — never supply them. Every name below must match an existing ' +
      'record exactly (case does not matter); call list_project_options first if you are not ' +
      'sure what is available. All nine required fields must be present: a project cannot be ' +
      'created half-filled and completed later.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'title', 'brand', 'product', 'campaign', 'project_type',
        'country', 'client_group', 'brand_category', 'music_supervisor',
      ],
      properties: {
        title: { type: 'string', description: 'What the project is called internally, e.g. "Dove Hair Global — Real Beauty".' },
        brand: { type: 'string', description: 'The brand, e.g. "Hellmann\'s". The first three letters become the Sequel No. brand code.' },
        product: { type: 'string', description: 'The specific product, e.g. "Hellmann\'s Real Mayonnaise".' },
        campaign: { type: 'string', description: 'The campaign name.' },
        project_type: { type: 'string', description: 'One of: Advert, Film, Social post.' },
        country: { type: 'string', description: 'The country the work is for, e.g. "United Kingdom".' },
        client_group: { type: 'string', description: 'Unilever or Non-Unilever.' },
        brand_category: { type: 'string', description: 'One of: Beauty & Wellbeing, Foods, Non-Unilever.' },
        music_supervisor: { type: 'string', description: 'The Sequel supervisor, by full name or email address. Use the email if two people share a name.' },
        client_agency: { type: 'string', description: 'Optional. The agency, by company name.' },
        service: { type: 'string', description: 'Optional. One of: Composition, Commercial, Library, Sonic Branding, Sound Design, Talent.' },
        client_user: { type: 'string', description: 'Optional. The client contact, by full name or email.' },
        adpro_user: { type: 'string', description: 'Optional. The ad producer, by full name or email.' },
        project_status: { type: 'string', description: 'Optional. Defaults to New.' },
        concept: { type: 'string', description: 'Optional. The creative concept.' },
        notes: { type: 'string', description: 'Optional.' },
        proposed_air_date: { type: 'string', format: 'date', description: 'Optional. YYYY-MM-DD.' },
        pipeline_gbp: { type: 'number', description: 'Optional. Expected value in GBP.' },
      },
    },
  },
  {
    name: 'list_project_options',
    title: 'List the valid options for a new project',
    description:
      'Every value create_project will accept for its name-matched fields: client groups, ' +
      'brand categories, services, project types, statuses and music supervisors. Read-only. ' +
      'Call this before guessing at a name.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
]

// -------------------------------------------------------------- the caller --

/**
 * A Supabase client that IS the caller. Nothing here elevates: the token is
 * passed through untouched and PostgREST applies that person's row-level
 * security. The publishable key only identifies the project.
 */
function clientFor(req: Request) {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? ''
  const authorization = req.headers.get('authorization') ?? ''
  return createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Postgres speaking to a person. Our own RAISEs are already readable. */
// deno-lint-ignore no-explicit-any
function readableError(error: any): string {
  const code = error?.code ?? ''
  const message = error?.message ?? 'Unknown error'
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'Refused: this account is not Sequel staff, so it cannot create projects.'
  }
  if (code === '23514') return message // our own message, already in English
  if (code === '23503') return `Refused: ${message}`
  return `Refused: ${message}`
}

// deno-lint-ignore no-explicit-any
async function createProject(req: Request, args: Record<string, any>) {
  const supabase = clientFor(req)
  const { data, error } = await supabase.rpc('track_create_project', {
    p_title: args.title ?? null,
    p_brand: args.brand ?? null,
    p_product: args.product ?? null,
    p_campaign: args.campaign ?? null,
    p_project_type: args.project_type ?? null,
    p_country: args.country ?? null,
    p_client_group: args.client_group ?? null,
    p_brand_category: args.brand_category ?? null,
    p_music_supervisor: args.music_supervisor ?? null,
    p_client_agency: args.client_agency ?? null,
    p_service: args.service ?? null,
    p_client_user: args.client_user ?? null,
    p_adpro_user: args.adpro_user ?? null,
    p_project_status: args.project_status ?? null,
    p_concept: args.concept ?? null,
    p_notes: args.notes ?? null,
    p_proposed_air_date: args.proposed_air_date ?? null,
    p_pipeline_gbp: args.pipeline_gbp ?? null,
  })

  if (error) return { text: readableError(error), isError: true }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { text: 'Refused: nothing was created.', isError: true }

  return {
    text:
      `Created ${row.project_sequel_no} — ${args.title}\n` +
      `${APP_BASE_URL}/projects/${row.project_id}\n\n` +
      `This project is in Supabase. Until project_master_list comes out of the hourly ` +
      `Xano sync it will be removed on the hour, and it is not visible to QuickBooks, ` +
      `BoldSign or Coda's Xano tools.`,
    isError: false,
  }
}

async function listOptions(req: Request) {
  const supabase = clientFor(req)
  const [groups, categories, services, statuses, supervisors] = await Promise.all([
    supabase.schema('xano_mirror').from('client_groups').select('client').order('id'),
    supabase.schema('xano_mirror').from('brand_category').select('category').order('id'),
    supabase.schema('xano_mirror').from('services').select('service').order('id'),
    supabase.schema('xano_mirror').from('projects_status_options').select('status').order('id'),
    supabase.from('track_users').select('full_name, email')
      .in('user_type', ['Admin', 'Sequel']).not('status', 'in', '("Blocked","Archived")')
      .order('full_name'),
  ])

  const failed = [groups, categories, services, statuses, supervisors].find((r) => r.error)
  if (failed?.error) return { text: readableError(failed.error), isError: true }

  const list = (rows: unknown[] | null, key: string) =>
    (rows ?? []).map((r) => (r as Record<string, string>)[key]).filter(Boolean).join(', ')

  return {
    text: [
      `Client groups: ${list(groups.data, 'client')}`,
      `Brand categories: ${list(categories.data, 'category')}`,
      `Services: ${list(services.data, 'service')}`,
      `Project types: Advert, Film, Social post`,
      `Project statuses: ${list(statuses.data, 'status')} (defaults to New)`,
      `Music supervisors: ${(supervisors.data ?? [])
        .map((u) => `${(u as Record<string, string>).full_name} <${(u as Record<string, string>).email}>`)
        .join(', ')}`,
      ``,
      `Agencies and client contacts are not listed here — there are too many. Give the ` +
      `company name or the person's email and create_project will tell you if it cannot find it.`,
    ].join('\n'),
    isError: false,
  }
}

// ------------------------------------------------------------------ server --

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // No SSE stream is offered; the spec wants 405 rather than a hang.
  if (req.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } })
  }

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  // Batches are gone in the current protocol, but be explicit rather than odd.
  if (Array.isArray(body)) return rpcError(null, -32600, 'Batched requests are not supported')

  const id: Id = body?.id ?? null
  const method: string = body?.method ?? ''
  const isNotification = body?.id === undefined

  switch (method) {
    case 'initialize': {
      const asked = body?.params?.protocolVersion
      return result(id, {
        protocolVersion: typeof asked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asked)
          ? asked
          : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Sequel Track. Use list_project_options before create_project if you are unsure ' +
          'of a client group, brand category, service or supervisor name. The Sequel No. is ' +
          'allocated by the database, never by you.',
      })
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202, headers: CORS })

    case 'ping':
      return result(id, {})

    case 'tools/list':
      return result(id, { tools: TOOLS })

    case 'tools/call': {
      const name = body?.params?.name
      const args = body?.params?.arguments ?? {}
      try {
        if (name === 'create_project') {
          const r = await createProject(req, args)
          return toolText(id, r.text, r.isError)
        }
        if (name === 'list_project_options') {
          const r = await listOptions(req)
          return toolText(id, r.text, r.isError)
        }
        return rpcError(id, -32602, `Unknown tool: ${name}`)
      } catch (e) {
        return toolText(id, `Refused: ${e instanceof Error ? e.message : String(e)}`, true)
      }
    }

    default:
      if (isNotification) return new Response(null, { status: 202, headers: CORS })
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
})
