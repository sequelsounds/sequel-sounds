// The tools. One definition of what Coda can do, used by two front ends: the
// chat panel in the app (`index.ts`) and the MCP server (`mcp.ts`) that Claude
// on the desktop connects to. Adding a tool here adds it to both.
//
// NOTHING HERE GRANTS ANYTHING. Every call runs on a Supabase client carrying
// the caller's own access token, so PostgREST applies that person's row-level
// policies and column grants. The `requires` field on a tool only decides
// whether the tool is *offered* — the database decides whether it works. The
// two can never disagree in a dangerous direction: the worst case is a tool
// that is offered and then refused, which reads as a refusal and not as a
// silent success.
//
// ⚠️ THE READ SURFACE IS NOT LISTED HERE, DELIBERATELY. `list_records` and
// `get_record` work against whatever views exist in `xano_mirror`, discovered
// at call time by `coda_catalogue()`. Andy's requirement was that Coda keeps up
// with the app as it is built; a hand-kept list of resources would be wrong
// within a week. Views only — base tables hold columns like `login_code`.
//
// ⚠️ WRITES ARE THE OPPOSITE: typed, named and listed. A model filling in a
// free-form row is how you get a supplier called "TBC" with a null country. The
// generic `update_record` exists for the three tables the app itself edits
// directly, and even there the column grants decide what may be set — the same
// grants that make the edit pages refuse.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

// ------------------------------------------------------------------ people --

export type Who = {
  user_id: number | null
  name: string | null
  email: string | null
  is_staff: boolean
  is_finance: boolean
  is_management: boolean
}

export type Ctx = {
  sb: SupabaseClient
  who: Who
  appBase: string
}

export type Role = 'any' | 'staff' | 'finance' | 'management'

export function passes(who: Who, role: Role): boolean {
  if (role === 'any') return true
  if (role === 'staff') return who.is_staff
  if (role === 'finance') return who.is_finance
  return who.is_management
}

// ------------------------------------------------------------------- shape --

export type ToolResult = { text: string; isError?: boolean }

export type Tool = {
  name: string
  title: string
  description: string
  requires: Role
  /** JSON Schema for the arguments. Both front ends serve this verbatim. */
  schema: Record<string, unknown>
  /** True for anything that changes a record. Drives the audit and the UI. */
  writes?: boolean
  run: (ctx: Ctx, args: Record<string, unknown>) => Promise<ToolResult>
}

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
})

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const int = (description: string) => ({ type: 'integer', description })
const bool = (description: string) => ({ type: 'boolean', description })

/** Postgres speaking to a person. Our own RAISEs are already readable. */
// deno-lint-ignore no-explicit-any
export function readable(error: any): string {
  const code = error?.code ?? ''
  const message: string = error?.message ?? 'Unknown error'
  if (code === '42501') {
    // Two different refusals share this code: a guard's own `raise`, which is
    // already a sentence, and a bare column-grant refusal, which is not.
    return /access|staff|finance/i.test(message)
      ? `Refused: ${message}`
      : 'Refused: that column cannot be edited from here.'
  }
  if (code === 'PGRST116') return 'Not found, or not visible to this account.'
  return `Refused: ${message}`
}

const ok = (text: string): ToolResult => ({ text })
const bad = (text: string): ToolResult => ({ text, isError: true })

/**
 * Gemini's function declarations cannot describe a free-form object or a list
 * of them, so those arguments are declared as strings holding JSON and arrive
 * that way. Anthropic sends the real thing. Both are accepted here rather than
 * in one provider's adapter, because a model of either kind will occasionally
 * send the other shape anyway.
 */
function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // Not JSON. Treated as nothing, and the caller says so in its own words.
    }
  }
  return {}
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // As above.
    }
  }
  return []
}

/** Rows as JSON, capped, with the true count said out loud. */
function rows(data: unknown[], total: number | null, cap: number): string {
  const shown = data.slice(0, cap)
  const head =
    total !== null && total > shown.length
      ? `${shown.length} of ${total} rows:\n`
      : `${shown.length} row${shown.length === 1 ? '' : 's'}:\n`
  return head + JSON.stringify(shown, null, 1)
}

// ------------------------------------------------------------- the reads --

const MIRROR = 'xano_mirror'

/**
 * Where a free-text search looks, and at what. Hardcoded on purpose — unlike
 * the resource list, this is about what a person means by "find the Dove job",
 * which no catalogue can tell you.
 */
const SEARCHABLE: Record<string, { columns: string[]; label: string }> = {
  project_list: {
    columns: ['title', 'sequel_no', 'brand', 'client_name', 'campaign'],
    label: 'projects',
  },
  client_list: { columns: ['company', 'country'], label: 'clients' },
  partner_list: { columns: ['title', 'country'], label: 'partners' },
  roster_list: { columns: ['title', 'country'], label: 'roster members' },
  user_directory: { columns: ['name', 'email', 'company'], label: 'people' },
  song_list: { columns: ['song_name', 'artist', 'project_title'], label: 'songs' },
}

type CatalogueEntry = { resource: string; columns: { name: string; type: string }[] }

/**
 * The catalogue, read once per request.
 *
 * ⚠️ `find` asks for it per resource. Without this it made six round trips to
 * the database for the same answer inside one tool call, and `coda_catalogue`
 * is an information_schema scan, not a cheap read. Keyed on the request's own
 * Supabase client, so it cannot leak between callers.
 */
const CATALOGUE = new WeakMap<object, Promise<CatalogueEntry[]>>()

function catalogueOf(ctx: Ctx): Promise<CatalogueEntry[]> {
  const key = ctx.sb as unknown as object
  const cached = CATALOGUE.get(key)
  if (cached) return cached

  const pending: Promise<CatalogueEntry[]> = ctx.sb
    .rpc('coda_catalogue')
    .then((res: { data: unknown; error: unknown }) => {
      if (res.error) throw res.error
      return (res.data ?? []) as CatalogueEntry[]
    })

  CATALOGUE.set(key, pending)
  return pending
}

/** Only columns that exist on the view — the search map is shared across views. */
async function columnsOf(ctx: Ctx, resource: string): Promise<string[]> {
  const entry = (await catalogueOf(ctx)).find((r) => r.resource === resource)
  return entry ? entry.columns.map((c) => c.name) : []
}

const describeData: Tool = {
  name: 'describe_data',
  title: 'What data is available',
  description:
    'Lists every resource you can read and, for one named resource, its columns. Call this ' +
    'when you are not sure which resource holds something, or what a column is called, ' +
    'rather than guessing. The list reflects the app as it stands today.',
  requires: 'any',
  schema: obj({
    resource: str('Optional. One resource name, to get its full column list.'),
  }),
  run: async (ctx, args) => {
    let all: CatalogueEntry[]
    try {
      all = await catalogueOf(ctx)
    } catch (e) {
      return bad(readable(e))
    }

    const one = typeof args.resource === 'string' ? args.resource : null
    if (one) {
      const entry = all.find((r) => r.resource === one)
      if (!entry) {
        return bad(
          `No resource called "${one}". Available: ${all.map((r) => r.resource).join(', ')}`,
        )
      }
      return ok(
        `${entry.resource}\n` + entry.columns.map((c) => `  ${c.name} (${c.type})`).join('\n'),
      )
    }

    return ok(
      'Resources you can read (use list_records or get_record):\n' +
        all.map((r) => `  ${r.resource} — ${r.columns.length} columns`).join('\n') +
        '\n\nCall describe_data with a resource name for its columns.',
    )
  },
}

const find: Tool = {
  name: 'find',
  title: 'Find a record by name',
  description:
    'Free-text search across projects, clients, partners, roster members, people and songs. ' +
    'Use this first whenever someone names something in words — "the Dove job", "Ogilvy", ' +
    '"Camila" — to get the id before doing anything else with it.',
  requires: 'any',
  schema: obj(
    {
      text: str('What to look for. Two characters minimum.'),
      kinds: {
        type: 'array',
        items: { type: 'string', enum: Object.keys(SEARCHABLE) },
        description: 'Optional. Limit the search to these resources.',
      },
      limit: int('Optional. Rows per resource, default 8.'),
    },
    ['text'],
  ),
  run: async (ctx, args) => {
    const text = String(args.text ?? '').trim()
    if (text.length < 2) return bad('Give at least two characters to search for.')
    const limit = Math.min(Number(args.limit) || 8, 25)
    const asked = asArray(args.kinds) as string[]
    const kinds = asked.length
      ? asked.filter((k) => k in SEARCHABLE)
      : Object.keys(SEARCHABLE)

    // A comma, a parenthesis or a quote inside the text would be read as
    // PostgREST's own `or` syntax rather than as something to search for.
    const safe = text.replace(/[(),"*]/g, ' ').trim()
    if (!safe) return ok(`Nothing to search for in "${text}".`)

    // In parallel. Searching six resources one after another turned a single
    // tool call into six sequential round trips for no reason.
    let found: { resource: string; rows: unknown[] }[]
    try {
      found = await Promise.all(
        kinds.map(async (resource) => {
          const wanted = SEARCHABLE[resource].columns
          const present = (await columnsOf(ctx, resource)).filter((c) => wanted.includes(c))
          if (!present.length) return { resource, rows: [] }

          const { data, error } = await ctx.sb
            .schema(MIRROR)
            .from(resource)
            .select('*')
            .or(present.map((c) => `${c}.ilike."*${safe}*"`).join(','))
            .limit(limit)

          if (error) throw error
          return { resource, rows: data ?? [] }
        }),
      )
    } catch (e) {
      return bad(readable(e))
    }

    const out = found
      .filter((f) => f.rows.length)
      .map(
        (f) =>
          `${SEARCHABLE[f.resource].label} (${f.resource}) — ${f.rows.length}:\n` +
          JSON.stringify(f.rows, null, 1),
      )

    return out.length ? ok(out.join('\n\n')) : ok(`Nothing matches "${text}".`)
  },
}

const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is'] as const

const listRecords: Tool = {
  name: 'list_records',
  title: 'List records',
  description:
    'Read rows from any resource describe_data lists. Filters are ANDed. Use this for ' +
    "anything countable or comparable — open projects, unpaid invoices, this year's quotes. " +
    'You only ever see what the person you are talking to is allowed to see.',
  requires: 'any',
  schema: obj(
    {
      resource: str('The resource name, as describe_data gives it.'),
      filters: {
        type: 'array',
        description: 'Optional. Each filter is a column, an operator and a value.',
        items: obj(
          {
            column: str('Column name.'),
            op: { type: 'string', enum: OPS, description: 'Comparison. Default eq.' },
            value: {
              description: 'The value. For "in", a comma-separated list. For "is", null.',
            },
          },
          ['column', 'value'],
        ),
      },
      order_by: str('Optional. Column to sort on.'),
      descending: bool('Optional. Sort highest first.'),
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional. Only these columns. Narrower is better on wide resources.',
      },
      limit: int('Optional. Default 25, maximum 200.'),
    },
    ['resource'],
  ),
  run: async (ctx, args) => {
    const resource = String(args.resource ?? '')
    if (!resource) return bad('Which resource?')
    const limit = Math.min(Number(args.limit) || 25, 200)
    const asked = asArray(args.columns) as string[]
    const cols = asked.length ? asked.join(',') : '*'

    let q = ctx.sb.schema(MIRROR).from(resource).select(cols, { count: 'exact' })

    const filters = asArray(args.filters)
    for (const raw of filters) {
      const f = raw as { column?: string; op?: string; value?: unknown }
      if (!f.column) continue
      const op = (f.op ?? 'eq') as (typeof OPS)[number]
      if (!OPS.includes(op)) return bad(`Unknown operator "${op}".`)
      if (op === 'in') {
        const list = Array.isArray(f.value)
          ? (f.value as unknown[])
          : String(f.value ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        q = q.in(f.column, list)
      } else if (op === 'is') {
        q = q.is(f.column, f.value === 'null' || f.value === null ? null : (f.value as boolean))
      } else {
        // deno-lint-ignore no-explicit-any
        q = (q as any)[op](f.column, f.value)
      }
    }

    if (typeof args.order_by === 'string' && args.order_by) {
      q = q.order(args.order_by, { ascending: !args.descending })
    }

    const { data, error, count } = await q.limit(limit)
    if (error) return bad(readable(error))
    return ok(rows(data ?? [], count ?? null, limit))
  },
}

const getRecord: Tool = {
  name: 'get_record',
  title: 'Get one record',
  description:
    'One row in full, by id or by uuid. Use it once find has told you which record is meant.',
  requires: 'any',
  schema: obj(
    {
      resource: str('The resource name.'),
      id: int('The numeric id. Give this or uuid.'),
      uuid: str('The uuid. Give this or id.'),
    },
    ['resource'],
  ),
  run: async (ctx, args) => {
    const resource = String(args.resource ?? '')
    const hasId = args.id !== undefined && args.id !== null
    const hasUuid = typeof args.uuid === 'string' && args.uuid
    if (!resource) return bad('Which resource?')
    if (!hasId && !hasUuid) return bad('Give an id or a uuid.')

    const q = ctx.sb.schema(MIRROR).from(resource).select('*')
    const { data, error } = hasId
      ? await q.eq('id', args.id).maybeSingle()
      : await q.eq('uuid', args.uuid).maybeSingle()

    if (error) return bad(readable(error))
    if (!data) return bad('Not found, or not visible to this account.')
    return ok(JSON.stringify(data, null, 1))
  },
}

// ------------------------------------------------------------ the reports --

/**
 * The computed reads, behind one tool with an enum rather than nine tools.
 * They are all "call this function, show what comes back", and nine near
 * identical entries in the tool list make every other choice harder.
 */
const REPORTS: Record<string, { rpc: string; requires: Role; args: string[]; what: string }> = {
  unilever_report: {
    rpc: 'track_unilever_report',
    requires: 'staff',
    args: ['year'],
    what: 'The full Unilever reporting rows for a calendar year.',
  },
  contract_renewals: {
    rpc: 'track_contract_renewals',
    requires: 'staff',
    args: [],
    what: 'Licences expiring and expired, grouped by project.',
  },
  client_profit: {
    rpc: 'track_client_profit',
    requires: 'finance',
    args: ['client', 'year'],
    what: 'Profit for one client in one year. Takes a client id.',
  },
  contract_detail: {
    rpc: 'track_contract_detail',
    requires: 'staff',
    args: ['uuid'],
    what: 'Everything on one contract, including its extracted fields and summary.',
  },
  release_form_detail: {
    rpc: 'track_release_form_detail',
    requires: 'staff',
    args: ['uuid'],
    what: 'One release form in full.',
  },
  project_release_forms: {
    rpc: 'track_project_release_forms',
    requires: 'staff',
    args: ['project_id'],
    what: 'Every release form on a project.',
  },
  release_form_activity: {
    rpc: 'track_release_form_activity',
    requires: 'staff',
    args: ['uuid'],
    what: 'What has happened to a release form — sent, opened, signed.',
  },
  match_supplier: {
    rpc: 'track_match_supplier',
    requires: 'staff',
    args: ['names', 'country'],
    what: 'Find the supplier record behind one or more names. Takes a list of names.',
  },
  my_notifications: {
    rpc: 'track_my_notifications',
    requires: 'any',
    args: ['limit'],
    what: "The signed-in person's notifications.",
  },
}

const report: Tool = {
  name: 'report',
  title: 'Run a report',
  description:
    'The computed reads that are not plain lists:\n' +
    Object.entries(REPORTS)
      .map(
        ([k, v]) =>
          `  ${k} — ${v.what}${v.args.length ? ` Arguments: ${v.args.join(', ')}.` : ''}`,
      )
      .join('\n'),
  requires: 'any',
  schema: obj(
    {
      name: { type: 'string', enum: Object.keys(REPORTS), description: 'Which report.' },
      args: { type: 'object', description: "The report's arguments, named as above." },
    },
    ['name'],
  ),
  run: async (ctx, args) => {
    const name = String(args.name ?? '')
    const def = REPORTS[name]
    if (!def) return bad(`No report called "${name}".`)
    if (!passes(ctx.who, def.requires)) {
      return bad(`Refused: ${name} is not available to this account.`)
    }

    const given = asObject(args.args)
    const params: Record<string, unknown> = {}
    for (const a of def.args) params[`p_${a}`] = given[a] ?? null

    const { data, error } = await ctx.sb.rpc(def.rpc, params)
    if (error) return bad(readable(error))
    const text = JSON.stringify(data, null, 1)
    return ok(text.length > 60_000 ? text.slice(0, 60_000) + '\n… truncated' : text)
  },
}

// ------------------------------------------------------------- the writes --

/**
 * The tables the app's own pages write directly, rather than through a
 * function. Coda gets the same doors and no others.
 *
 * ⚠️ The column grants on these tables are what decide which fields may be
 * set — the same grants that make the edit pages say "that column cannot be
 * edited from here". Listing columns here as well would be a second, weaker
 * copy of that rule, and the two would drift. So this map names the table and
 * its key, and the database refuses the rest.
 */
const WRITABLE: Record<string, { key: string; what: string }> = {
  project_master_list: {
    key: 'id',
    what: 'a project — use create_project for new ones, it allocates the Sequel No.',
  },
  supplier_list: {
    key: 'id',
    what: 'a supplier — partners and roster composition teams are one table',
  },
  user: { key: 'id', what: 'a person: staff, client, agency or supplier contact' },
}

const updateRecord: Tool = {
  name: 'update_record',
  title: 'Change a record',
  description:
    'Change fields on an existing record in one of: ' +
    Object.entries(WRITABLE)
      .map(([k, v]) => `${k} (${v.what})`)
      .join('; ') +
    '. Read the record first and say what you are changing before you call this. Use ' +
    'describe_data on the matching list resource if you are unsure of a column name.',
  requires: 'staff',
  writes: true,
  schema: obj(
    {
      resource: { type: 'string', enum: Object.keys(WRITABLE), description: 'Which table.' },
      id: int("The record's id."),
      values: { type: 'object', description: 'The columns to set, and their new values.' },
    },
    ['resource', 'id', 'values'],
  ),
  run: async (ctx, args) => {
    const resource = String(args.resource ?? '')
    const def = WRITABLE[resource]
    if (!def) return bad(`Cannot write to "${resource}".`)
    const values = asObject(args.values)
    if (!Object.keys(values).length) return bad('Nothing to change.')

    const { data, error } = await ctx.sb
      .schema(MIRROR)
      .from(resource)
      .update(values)
      .eq(def.key, args.id)
      .select(def.key)

    if (error) return bad(readable(error))
    // Row-level security refuses an update by matching no rows, not by
    // erroring. Reporting that as a success is how a page claims a write that
    // never happened — the app's own write paths carry this same check.
    if (!data || data.length === 0) {
      return bad('Not saved — this account cannot edit that record, or no record has that id.')
    }
    return ok(`Updated ${resource} ${args.id}: ${Object.keys(values).join(', ')}.`)
  },
}

const createSupplier: Tool = {
  name: 'create_supplier',
  title: 'Create a supplier',
  description:
    'Create a supplier with a name and a type. Everything else is editable afterwards with ' +
    'update_record, which is why only two fields are asked for. A type of "Composition Team" ' +
    'puts the record on the Roster; every other type puts it on Partners.',
  requires: 'staff',
  writes: true,
  schema: obj(
    {
      title: str("The supplier's name."),
      supplier_type: {
        type: 'string',
        enum: [
          'Agent',
          'Manager',
          'Publisher',
          'Label',
          'MCPS Library',
          'Non-MCPS Library',
          'Sync Rep',
          'Composition Team',
          'Partner Library',
          'Musicologist',
        ],
        description: 'What kind of supplier.',
      },
    },
    ['title', 'supplier_type'],
  ),
  run: async (ctx, args) => {
    const { data, error } = await ctx.sb
      .schema(MIRROR)
      .from('supplier_list')
      .insert({ title: args.title, supplier_type: args.supplier_type })
      .select('id, uuid')
      .single()

    if (error) return bad(readable(error))
    const row = data as { id: number; uuid: string | null }
    if (!row?.uuid) return bad('The supplier was created but has no link. Tell Andy.')
    const page = args.supplier_type === 'Composition Team' ? 'roster' : 'partners'
    return ok(`Created supplier ${row.id} — ${args.title}\n${ctx.appBase}/${page}/${row.uuid}`)
  },
}

/**
 * The function-backed writes. Each is one RPC, and every property maps to the
 * RPC's argument of the same name with a `p_` in front, so the schema and the
 * call cannot drift apart.
 */
type ActionDef = {
  name: string
  title: string
  description: string
  requires: Role
  rpc: string
  schema: Record<string, unknown>
  /** What to say afterwards. Gets whatever the function returned. */
  say: (result: unknown, args: Record<string, unknown>, ctx: Ctx) => string
}

const first = (r: unknown) => (Array.isArray(r) ? r[0] : r) as Record<string, unknown> | null

const ACTIONS: ActionDef[] = [
  {
    name: 'create_project',
    title: 'Create a project',
    description:
      'Create a project. The Sequel No., the id and the created date are allocated by the ' +
      'database — never supply them. Names must match existing records, so use find to check ' +
      'a client or a person before calling this.',
    requires: 'staff',
    rpc: 'track_create_project',
    schema: obj(
      {
        title: str('What the project is called, e.g. "Dove Hair Global — Real Beauty".'),
        brand: str('The brand. Its first three letters become the Sequel No. brand code.'),
        client: str('The client company, by name.'),
        client_user: str('Optional. The client contact, by full name or email.'),
        project_type: str('Advert, Film or Social post.'),
        brand_category: str('Beauty & Wellbeing, Foods, or Non-Unilever.'),
        account: str('Optional. The account the project sits under.'),
        adpro_lead: str('Optional. The ad producer, by name or email.'),
        client_job_no: str("Optional. The client's own job number."),
        pipeline_gbp: num('Optional. Expected value in GBP.'),
        proposed_start_date: str('Optional. YYYY-MM-DD.'),
      },
      ['title', 'brand', 'client', 'project_type', 'brand_category'],
    ),
    say: (r, a, ctx) => {
      const row = first(r)
      if (!row) return 'Nothing was created.'
      return `Created ${row.project_sequel_no} — ${a.title}\n${ctx.appBase}/projects/${row.project_id}`
    },
  },
  {
    name: 'create_quote',
    title: 'Create a quote',
    description:
      'Raise a quote on a project. `fees` is the list of fee lines the quote wizard builds. ' +
      'This does not cover MCPS quotes, which need the pricing engine in the app — say so ' +
      'rather than approximating one.',
    requires: 'staff',
    rpc: 'track_create_quote',
    schema: obj(
      {
        project_id: int('The project.'),
        client_id: int('The client being quoted.'),
        currency_id: int('The currency.'),
        service_id: int('The service this quote is for.'),
        description: str('Optional. What is being quoted.'),
        song_name: str('Optional.'),
        artist_name: str('Optional.'),
        term: str('Optional. Licence term.'),
        territory: str('Optional.'),
        media: str('Optional.'),
        scripts: str('Optional.'),
        duration: str('Optional.'),
        cutdowns: bool('Optional.'),
        tracks_quoted: int('Optional.'),
        fees: { type: 'array', items: { type: 'object' }, description: 'The fee lines.' },
      },
      ['project_id', 'client_id', 'currency_id', 'service_id'],
    ),
    say: (r, _a, ctx) => {
      const row = first(r)
      return row
        ? `Created quote ${row.id}\n${ctx.appBase}/quotes/${row.uuid}`
        : 'Nothing was created.'
    },
  },
  {
    name: 'create_user',
    title: 'Create a person',
    description:
      'Add someone to the directory: staff, a client contact, an agency producer or a ' +
      'supplier contact. Name, email and company are all required. The email is the login, ' +
      'so it has to be right and cannot already belong to someone else, and the company has ' +
      'to be a client we already have. `user_type`, `status` and `company` are given by ' +
      'name, not by id — say "Adpro" and "Ogilvy London". Check the spelling of the ' +
      'company with find first if you are unsure.\n\n' +
      'Give a type and a status. Left out, they are left blank rather than defaulted, and a ' +
      'person with no status cannot sign in — so ask which they are rather than guessing.\n\n' +
      'Say plainly who you are about to create and wait for a yes. Creating a person is not ' +
      'the same as inviting them: they exist and can sign in, and nobody emails them.',
    requires: 'staff',
    rpc: 'track_create_user',
    schema: obj(
      {
        name: str('Their full name.'),
        email: str('Their email address. This is how they sign in.'),
        user_type: str(
          'Who they are. Agency is an agency contact, Brand a client-side marketer, Adpro an ' +
          'ad producer, Sequel or Admin our own staff, Freelance a contractor. Supplier ' +
          'exists but nobody is one — suppliers are supplier records, not people who sign in.',
        ),
        status: str(
          'Active (can sign in now), Pending (created, not yet let in), Blocked or Archived.',
        ),
        company: str(
          'The client company they belong to, by name. Required. It has to match a client ' +
          'we already have \u2014 find it first if you are unsure of the spelling.',
        ),
        job_title: str('Optional.'),
        notes: str('Optional.'),
      },
      ['name', 'email', 'company'],
    ),
    say: (r, a, ctx) => {
      const row = first(r)
      if (!row) return 'Nothing was created.'
      return (
        `Created ${a.name} <${String(a.email).toLowerCase()}>\n` +
        `${ctx.appBase}/users/${row.uuid}\n\n` +
        'They can sign in as soon as their status is Active. No email has been sent to them.'
      )
    },
  },
  {
    name: 'create_song',
    title: 'Create a song',
    description:
      'Create a Sequel song on a project against a composition supplier. Ownership is Master, ' +
      'Publishing, or Master & Publishing.',
    requires: 'staff',
    rpc: 'track_create_song',
    schema: obj(
      {
        project_id: int('The project.'),
        supplier_id: int('The composition supplier.'),
        ownership: {
          type: 'string',
          enum: ['Master', 'Publishing', 'Master & Publishing'],
          description: 'What Sequel takes.',
        },
      },
      ['project_id', 'supplier_id', 'ownership'],
    ),
    say: (r) => `Created song: ${JSON.stringify(first(r))}`,
  },
  {
    name: 'request_brief',
    title: 'Request a brief',
    description:
      'Mint a briefing link for a project. `internal` true makes a link for a Sequel person ' +
      'to fill in rather than the client.',
    requires: 'staff',
    rpc: 'track_request_brief',
    schema: obj(
      { project_id: int('The project.'), internal: bool('Optional. Default false.') },
      ['project_id'],
    ),
    say: (r) => `Brief requested: ${JSON.stringify(first(r))}`,
  },
  {
    name: 'set_invoice_status',
    title: "Change an invoice's status",
    description:
      'Move an invoice through its lifecycle: Submitted, Returned, Awaiting Payment, Paid, ' +
      'Overdue, Failed, Archived. Overdue is derived from the due date by the payment poll, ' +
      'so it should not be set by hand.',
    requires: 'finance',
    rpc: 'track_set_invoice_status',
    schema: obj(
      { invoice_id: int('The invoice.'), status: str('The new status.') },
      ['invoice_id', 'status'],
    ),
    say: (_r, a) => `Invoice ${a.invoice_id} is now ${a.status}.`,
  },
  {
    name: 'update_invoice',
    title: 'Edit an invoice',
    description:
      "Change an invoice's details and its Sequel fees. Only fields you pass are changed. " +
      'The three totals are recomputed by the database — never work them out yourself.',
    requires: 'finance',
    rpc: 'track_update_invoice',
    schema: obj(
      {
        invoice_id: int('The invoice.'),
        description: str('Optional.'),
        po_number: str('Optional.'),
        po_attachment_url: str('Optional.'),
        song_name: str('Optional.'),
        artist_name: str('Optional.'),
        usage_territories: str('Optional.'),
        usage_region: str('Optional.'),
        client_id: int('Optional.'),
        currency_id: int('Optional.'),
        fees: { type: 'object', description: 'Optional. The Sequel fee fields.' },
      },
      ['invoice_id'],
    ),
    say: (_r, a) => `Invoice ${a.invoice_id} updated.`,
  },
  {
    name: 'update_invoice_line',
    title: 'Edit a supplier line on an invoice',
    description: 'Change one supplier line: its supplier, amount, category or paythrough flag.',
    requires: 'finance',
    rpc: 'track_update_invoice_line',
    schema: obj(
      {
        line_id: int('The line.'),
        supplier_id: int('Optional.'),
        amount: num('Optional.'),
        category: str('Optional.'),
        is_paythrough: bool('Optional. Paythrough or Non-Paythrough.'),
      },
      ['line_id'],
    ),
    say: (_r, a) => `Line ${a.line_id} updated.`,
  },
  {
    name: 'save_contract',
    title: "Save a contract's fields",
    description:
      'Write the extracted fields back onto a contract. Read it with report contract_detail ' +
      'first and pass every field back, changing only what is wrong — a field you omit is ' +
      'cleared.',
    requires: 'staff',
    rpc: 'track_save_contract',
    schema: obj(
      {
        uuid: str('The contract.'),
        contract_type: int('Optional.'),
        supplier_id: int('Optional.'),
        description: str('Optional.'),
        artist: str('Optional.'),
        song_name: str('Optional.'),
        notes: str('Optional.'),
        master_pct: str('Optional.'),
        publishing_pct: str('Optional.'),
        mcps_yn: bool('Optional.'),
        start_date: str('Optional. YYYY-MM-DD.'),
        end_date: str('Optional. YYYY-MM-DD.'),
        term_value: int('Optional.'),
        term_unit: str('Optional.'),
        perpetual: bool('Optional.'),
        supplier_address: str('Optional.'),
      },
      ['uuid'],
    ),
    say: (_r, a) => `Contract ${a.uuid} saved.`,
  },
  {
    name: 'share',
    title: 'Make a share link',
    description:
      'Mint a link to send outside Sequel. `kind` is asset, contract, project_assets or ' +
      'release_form. Assets, contracts and release forms take a uuid; project_assets takes a ' +
      'project id.',
    requires: 'staff',
    rpc: '',
    schema: obj(
      {
        kind: {
          type: 'string',
          enum: ['asset', 'contract', 'project_assets', 'release_form'],
          description: 'What to share.',
        },
        uuid: str("The record's uuid, for asset, contract and release_form."),
        project_id: int('The project, for project_assets.'),
      },
      ['kind'],
    ),
    say: (r) => `Link: ${JSON.stringify(first(r))}`,
  },
  {
    name: 'archive',
    title: 'Archive a record',
    description:
      'Archiving is what "delete" means across Sequel — the record leaves the lists and keeps ' +
      'its history. `kind` is invoice, quote, supplier, brief, contract or release_form. ' +
      'Invoices, quotes, suppliers and briefs take an id; contracts and release forms a uuid.',
    requires: 'staff',
    rpc: '',
    schema: obj(
      {
        kind: {
          type: 'string',
          enum: ['invoice', 'quote', 'supplier', 'brief', 'contract', 'release_form'],
          description: 'What to archive.',
        },
        id: int('The numeric id, for invoice, quote, supplier and brief.'),
        uuid: str('The uuid, for contract and release_form.'),
      },
      ['kind'],
    ),
    say: (_r, a) => `Archived ${a.kind} ${a.id ?? a.uuid}.`,
  },
]

/** The two tools whose RPC depends on an argument rather than being fixed. */
const SHARE_RPCS: Record<string, { rpc: string; arg: 'uuid' | 'project_id' }> = {
  asset: { rpc: 'track_share_asset', arg: 'uuid' },
  contract: { rpc: 'track_share_contract', arg: 'uuid' },
  release_form: { rpc: 'track_share_release_form', arg: 'uuid' },
  project_assets: { rpc: 'track_share_project_assets', arg: 'project_id' },
}

const ARCHIVE_RPCS: Record<string, { rpc: string; arg: 'id' | 'uuid'; param: string }> = {
  invoice: { rpc: 'track_archive_invoice', arg: 'id', param: 'p_invoice_id' },
  quote: { rpc: 'track_archive_quote', arg: 'id', param: 'p_quote_id' },
  supplier: { rpc: 'track_archive_supplier', arg: 'id', param: 'p_supplier_id' },
  brief: { rpc: 'track_archive_brief', arg: 'id', param: 'p_brief_id' },
  contract: { rpc: 'track_archive_contract', arg: 'uuid', param: 'p_uuid' },
  release_form: { rpc: 'track_archive_release_form', arg: 'uuid', param: 'p_uuid' },
}

function actionTool(def: ActionDef): Tool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    requires: def.requires,
    writes: true,
    schema: def.schema,
    run: async (ctx, args) => {
      let rpc = def.rpc
      let params: Record<string, unknown> = {}

      if (def.name === 'share') {
        const target = SHARE_RPCS[String(args.kind)]
        if (!target) return bad(`Cannot share "${args.kind}".`)
        const value = args[target.arg]
        if (value === undefined || value === null) {
          return bad(`share ${args.kind} needs a ${target.arg}.`)
        }
        rpc = target.rpc
        params = { [`p_${target.arg}`]: value }
      } else if (def.name === 'archive') {
        const target = ARCHIVE_RPCS[String(args.kind)]
        if (!target) return bad(`Cannot archive "${args.kind}".`)
        const value = args[target.arg]
        if (value === undefined || value === null) {
          return bad(`archive ${args.kind} needs a ${target.arg}.`)
        }
        rpc = target.rpc
        params = { [target.param]: value }
      } else {
        // Every property is its RPC argument with a `p_` in front. Properties
        // the caller left out are passed as null rather than omitted, because
        // Postgres picks an overload by the arguments it is given, and a
        // missing one can select a different function or none at all.
        const properties = (def.schema.properties ?? {}) as Record<string, Record<string, unknown>>
        for (const [key, shape] of Object.entries(properties)) {
          const given = args[key] ?? null
          // A `fees` list that arrived as a JSON string has to reach Postgres
          // as jsonb, not as a quoted string.
          if (shape?.type === 'array') params[`p_${key}`] = given === null ? null : asArray(given)
          else if (shape?.type === 'object') params[`p_${key}`] = given === null ? null : asObject(given)
          else params[`p_${key}`] = given
        }
      }

      const { data, error } = await ctx.sb.rpc(rpc, params)
      if (error) return bad(readable(error))
      return ok(def.say(data, args, ctx))
    },
  }
}

// ------------------------------------------------------------------ export --

export const TOOLS: Tool[] = [
  describeData,
  find,
  listRecords,
  getRecord,
  report,
  updateRecord,
  createSupplier,
  ...ACTIONS.map(actionTool),
]

/** The tools this person may be offered. The database still decides the rest. */
export function toolsFor(who: Who): Tool[] {
  return TOOLS.filter((t) => passes(who, t.requires))
}

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name)
}
