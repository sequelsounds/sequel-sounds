// The tools. One definition of what Coda can do, used by two front ends: the
// chat panel in the app (`index.ts`) and the MCP server (`mcp.ts`) that Claude
// on the desktop connects to. Adding a tool here adds it to both.
//
// NOTHING HERE GRANTS ANYTHING. Every call runs on a Supabase client carrying
// the caller's own access token, so PostgREST applies that person's row-level
// policies and column grants. The `requires` field on a tool only decides
// whether the tool is *offered* — the database decides whether it works.
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
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import {
  priceMcps,
  type McpsAnswers,
  type McpsPrice,
  type McpsReference,
  type RateCardRow,
  type TerritoryStructure,
} from '../_shared/mcpsPricing.ts'

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
 * What a resource's numbers MEAN, where the column names do not say.
 *
 * ⚠️ These travel with the data — on every read, every total and in the column
 * list both doors are given — rather than living in Coda's prompt. A fact about
 * a view belongs to the view (Andy, 23 Sep). Add one here whenever a resource's
 * money is in a unit or currency its column names do not show.
 */
export const NOTES: Record<string, string> = {
  management_invoices:
    'Money columns (invoiced, profit, spend, cost_avoidance and the fee columns) are GBP, ' +
    "converted at each invoice's locked exchange rate. Margin is profit / spend.",
  dashboard_invoices:
    'Money columns (invoiced, profit, spend, cost_avoidance and the fee columns) are GBP, ' +
    "converted at each invoice's locked exchange rate. Margin is profit / spend.",
  quote_detail:
    'local_grand_total is in MINOR units (pence / cents): divide by 100. It is in the ' +
    "quote's own currency (currency_code), so never add quotes in different currencies together.",
  quote_lines:
    "cost is in MINOR units (pence / cents): divide by 100. It is in its quote's currency — " +
    'read currency_code off quote_detail.',
}

const noted = (resource: string, text: string) =>
  NOTES[resource] ? `Note: ${NOTES[resource]}\n\n${text}` : text

/**
 * Where a free-text search looks, and at what. Hardcoded on purpose — unlike
 * the resource list, this is about what a person means by "find the Dove job",
 * which no catalogue can tell you.
 */
// Text columns only: `ilike` on a number column is an error, not a miss, and
// one bad column fails the whole search. Names must match the views exactly —
// a column that is not there is skipped silently.
const SEARCHABLE: Record<string, { columns: string[]; label: string }> = {
  project_list: {
    columns: ['title', 'sequel_no', 'brand', 'campaign_name', 'agency', 'client_user'],
    label: 'projects',
  },
  client_list: { columns: ['company', 'country_text'], label: 'clients' },
  partner_list: { columns: ['title', 'country_text'], label: 'partners' },
  roster_list: { columns: ['title', 'country_text'], label: 'roster members' },
  user_directory: { columns: ['name', 'email', 'company_name'], label: 'people' },
  song_list: { columns: ['track_title', 'composer', 'project', 'brand'], label: 'songs' },
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
    'Lists every resource you can read and, for one named resource, its columns. The column ' +
    'names are already in your instructions, so you should rarely need this — use it only if ' +
    'a resource is missing from that list.',
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
        noted(
          entry.resource,
          `${entry.resource}\n` + entry.columns.map((c) => `  ${c.name} (${c.type})`).join('\n'),
        ),
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

/** The filter list list_records and totals share. A string back is a refusal. */
// deno-lint-ignore no-explicit-any
function withFilters(q: any, given: unknown): any {
  for (const raw of asArray(given)) {
    const f = raw as { column?: string; op?: string; value?: unknown }
    if (!f.column) continue
    const op = (f.op ?? 'eq') as (typeof OPS)[number]
    if (!OPS.includes(op)) return `Unknown operator "${op}".`
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
      q = q[op](f.column, f.value)
    }
  }
  return q
}

const FILTERS = {
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
}

/**
 * Counts and sums done by the database's rows, not by the model.
 *
 * ⚠️ WHY THIS EXISTS. On 23 Sep Coda read all 159 management invoices and then
 * added them up herself: every billing, profit and margin figure she gave was
 * wrong, and she "corrected" them with more wrong ones. A model cannot be
 * trusted to sum a page of rows. This reads every matching row (not a page of
 * 25) and does the arithmetic here.
 */
const totals: Tool = {
  name: 'totals',
  title: 'Count and add up',
  description:
    'Count rows and add up number columns on any resource, optionally split by one column ' +
    '(per supervisor, per client, per service, per year…). Use this for EVERY total, sum, ' +
    'average, margin or "how many" question. Never add up rows from list_records yourself. ' +
    'Covers every matching row, not a page. You only see what this person is allowed to see.',
  requires: 'any',
  schema: obj(
    {
      resource: str('The resource name.'),
      group_by: str('Optional. One column to split the totals by, e.g. supervisor_id.'),
      sum: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional. Number columns to add up, e.g. ["invoiced", "profit", "spend"].',
      },
      filters: FILTERS,
    },
    ['resource'],
  ),
  run: async (ctx, args) => {
    const resource = String(args.resource ?? '')
    if (!resource) return bad('Which resource?')
    const by = typeof args.group_by === 'string' && args.group_by ? args.group_by : null
    const sums = (asArray(args.sum) as unknown[]).map(String).filter(Boolean)
    const cols = [...new Set([...(by ? [by] : []), ...sums])]

    const PAGE = 1000
    const CAP = 20000
    const all: Record<string, unknown>[] = []
    for (let from = 0; from < CAP; from += PAGE) {
      let q = ctx.sb
        .schema(MIRROR)
        .from(resource)
        .select(cols.length ? cols.join(',') : 'id')
      const filtered = withFilters(q, args.filters)
      if (typeof filtered === 'string') return bad(filtered)
      q = filtered
      const { data, error } = await q.range(from, from + PAGE - 1)
      if (error) return bad(readable(error))
      all.push(...((data ?? []) as Record<string, unknown>[]))
      if (!data || data.length < PAGE) break
    }
    if (all.length >= CAP) return bad(`More than ${CAP} rows match. Narrow it with a filter.`)

    type Group = { count: number; sums: Record<string, number> }
    const fresh = (): Group => ({ count: 0, sums: Object.fromEntries(sums.map((c) => [c, 0])) })
    const overall = fresh()
    const groups = new Map<string, Group>()
    for (const row of all) {
      const key = by ? String(row[by] ?? '(blank)') : ''
      const g = groups.get(key) ?? fresh()
      g.count += 1
      overall.count += 1
      for (const c of sums) {
        const n = Number(row[c])
        if (Number.isFinite(n)) {
          g.sums[c] += n
          overall.sums[c] += n
        }
      }
      groups.set(key, g)
    }

    const tidy = (g: Group): Record<string, number> => ({
      count: g.count,
      ...Object.fromEntries(Object.entries(g.sums).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    })
    const out: Record<string, unknown> = { rows_counted: all.length, overall: tidy(overall) }
    if (by) {
      const first = sums[0]
      out.by = by
      out.groups = [...groups.entries()]
        .map(([key, g]): Record<string, unknown> => ({ [by]: key, ...tidy(g) }))
        .sort((a, b) =>
          first ? Number(b[first]) - Number(a[first]) : Number(b.count) - Number(a.count),
        )
    }
    return ok(noted(resource, JSON.stringify(out, null, 1)))
  },
}

const listRecords: Tool = {
  name: 'list_records',
  title: 'List records',
  description:
    'Read rows from any resource in your instructions. Filters are ANDed. Use this to SEE ' +
    "records — open projects, unpaid invoices, this year's quotes. For any count, sum or " +
    'margin use totals instead; never add rows up yourself. ' +
    'You only ever see what the person you are talking to is allowed to see.',
  requires: 'any',
  schema: obj(
    {
      resource: str('The resource name.'),
      filters: FILTERS,
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

    const filtered = withFilters(q, args.filters)
    if (typeof filtered === 'string') return bad(filtered)
    q = filtered

    if (typeof args.order_by === 'string' && args.order_by) {
      q = q.order(args.order_by, { ascending: !args.descending })
    }

    const { data, error, count } = await q.limit(limit)
    if (error) return bad(readable(error))
    return ok(noted(resource, rows(data ?? [], count ?? null, limit)))
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
    return ok(noted(resource, JSON.stringify(data, null, 1)))
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
  project_licences: {
    rpc: 'track_project_composition_licences',
    requires: 'staff',
    args: ['project_id'],
    what: 'Every composition and library licence on a project (kind says which).',
  },
  licence_detail: {
    rpc: 'track_composition_licence_detail',
    requires: 'staff',
    args: ['uuid'],
    what: 'One licence in full, composition or library.',
  },
  licence_activity: {
    rpc: 'track_licence_activity',
    requires: 'staff',
    args: ['uuid'],
    what: 'Who a licence was sent to, and whether each has opened or downloaded it.',
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
    '. Read the record first and say what you are changing before you call this.',
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

// ------------------------------------------------------- PO from an email --

/**
 * An app-only Microsoft Graph token for the "Sequel Mail Reader" Entra app.
 *
 * ⚠️ WHICH MAILBOXES IT CAN READ IS DECIDED IN EXCHANGE, NOT HERE. The app has
 * NO tenant-wide Mail.Read grant in Entra; Exchange RBAC for Applications gives
 * it "Application Mail.Read" over the "Sequel Mail" scope only — mailboxes with
 * CustomAttribute1 = SequelMail (Andy, Phil, Camila; 23 Sep 2026). Adding a
 * person is `Set-Mailbox <address> -CustomAttribute1 SequelMail`. Never grant
 * Mail.Read in Entra as well: the two are a union, and it would open every
 * mailbox in the company.
 */
async function graphToken(): Promise<string> {
  // Trimmed: a value pasted into the dashboard can carry a space or newline.
  const tenant = (Deno.env.get('MS_TENANT_ID') ?? '').trim()
  const clientId = (Deno.env.get('MS_CLIENT_ID') ?? '').trim()
  const secret = (Deno.env.get('MS_CLIENT_SECRET') ?? '').trim()
  if (!tenant || !clientId || !secret) {
    throw new Error('Email access is not set up (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET).')
  }
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    // The description, never the secret. An expired secret reads AADSTS7000222.
    // The SHAPE of what is stored is safe to show and settles most of these:
    // a Secret ID is a 36-char GUID; a real secret value is ~40 chars with a "~".
    const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(secret)
    const shape = `stored MS_CLIENT_SECRET is ${secret.length} characters${
      looksLikeId ? ' and looks like a Secret ID, not the Value' : secret.includes('~') ? ', contains "~"' : ', has no "~"'
    }`
    throw new Error(
      `Microsoft refused the sign-in (${shape}): ${String(body.error_description ?? res.status).split(' Trace ID')[0]}`,
    )
  }
  return body.access_token as string
}

const PO_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'])
const PO_MAX_BYTES = 25 * 1024 * 1024

const attachPoFromEmail: Tool = {
  name: 'attach_po_from_email',
  title: 'Attach a PO from an email',
  description:
    "Take a PO file straight from an email in YOUR OWN mailbox and attach it to an invoice as " +
    "its PO attachment. `message_id` is the email's id as the Outlook / Microsoft 365 tools " +
    'return it. If the email has more than one file, give `attachment_name` (part of the file ' +
    'name is enough). Only invoices not yet in QuickBooks can be changed. Say which file and ' +
    'which invoice before you call this.',
  requires: 'staff',
  writes: true,
  schema: obj(
    {
      invoice_id: int('The invoice to attach the PO to.'),
      message_id: str('The email id, as the Outlook tools give it.'),
      attachment_name: str('Optional. Part of the file name, when the email has several files.'),
    },
    ['invoice_id', 'message_id'],
  ),
  run: async (ctx, args) => {
    // ⚠️ THE CALLER'S OWN MAILBOX, ALWAYS. The Entra app can read every
    // mailbox in the Sequel Mail scope; this is what stops Camila attaching
    // something from Andy's inbox. Never take a mailbox as an argument.
    const mailbox = ctx.who.email
    if (!mailbox) return bad('This account has no email address, so there is no mailbox to read.')

    const invoiceId = Number(args.invoice_id)
    // Refuse before touching the mailbox or storage. Read through the view the
    // caller can see — ⚠️ NOT track_invoice_editable(), which is an internal
    // helper with no execute grant for signed-in users (it refused the first
    // real run, 23 Sep). track_update_invoice still enforces the same rule at
    // the end; this only saves an upload that would be thrown away.
    const inv = await ctx.sb
      .schema(MIRROR)
      .from('invoice_detail')
      .select('id, qbo_invoice_id')
      .eq('id', invoiceId)
      .maybeSingle()
    if (inv.error) return bad(readable(inv.error))
    if (!inv.data) return bad('No such invoice, or not visible to this account.')
    if (String(inv.data.qbo_invoice_id ?? '') !== '') {
      return bad('That invoice is already in QuickBooks and can no longer be changed.')
    }

    let raw = String(args.message_id ?? '').trim()
    if (!raw) return bad('Which email?')
    if (raw.includes('%')) raw = decodeURIComponent(raw)
    const base =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
      `/messages/${encodeURIComponent(raw)}/attachments`

    let token: string
    try {
      token = await graphToken()
    } catch (e) {
      return bad(e instanceof Error ? e.message : String(e))
    }
    const auth = { Authorization: `Bearer ${token}` }

    const list = await fetch(`${base}?$select=id,name,contentType,size,isInline`, { headers: auth })
    if (list.status === 404) return bad(`That email is not in ${mailbox}.`)
    if (list.status === 403) {
      return bad(`Sequel is not allowed to read ${mailbox}. Ask Andy to add it to the Sequel Mail scope.`)
    }
    if (!list.ok) return bad(`Microsoft would not list the attachments (${list.status}).`)

    type Att = { id: string; name: string; contentType: string; size: number; isInline: boolean; '@odata.type'?: string }
    const all = ((await list.json()).value ?? []) as Att[]
    const files = all.filter(
      (a) =>
        !a.isInline &&
        (a['@odata.type'] ?? '#microsoft.graph.fileAttachment') === '#microsoft.graph.fileAttachment' &&
        PO_EXTENSIONS.has((a.name.split('.').pop() ?? '').toLowerCase()),
    )
    const wanted = typeof args.attachment_name === 'string' ? args.attachment_name.toLowerCase().trim() : ''
    let pick = wanted ? files.filter((a) => a.name.toLowerCase().includes(wanted)) : files
    // With no name given, a single PDF beats a pile of images.
    if (!wanted && pick.length > 1) {
      const pdfs = pick.filter((a) => a.name.toLowerCase().endsWith('.pdf'))
      if (pdfs.length === 1) pick = pdfs
    }
    if (!pick.length) {
      return bad(
        files.length
          ? `No attachment matches "${args.attachment_name}". Files on that email: ${files.map((a) => a.name).join(', ')}.`
          : 'That email has no PDF, Word or image attachment.',
      )
    }
    if (pick.length > 1) {
      return bad(`That email has several files — say which: ${pick.map((a) => a.name).join(', ')}.`)
    }
    const att = pick[0]
    if (att.size > PO_MAX_BYTES) return bad(`${att.name} is over 25 MB.`)

    const file = await fetch(`${base}/${encodeURIComponent(att.id)}/$value`, { headers: auth })
    if (!file.ok) return bad(`Microsoft would not hand over ${att.name} (${file.status}).`)
    const bytes = new Uint8Array(await file.arrayBuffer())

    // Stored exactly where the app's own PO upload puts it (sign-document), so
    // the invoice page opens it with no special case.
    const bucket = Deno.env.get('S3_BUCKET') ?? ''
    const region = Deno.env.get('S3_REGION') ?? ''
    const aws = new AwsClient({
      accessKeyId: Deno.env.get('S3_ACCESS_KEY_ID') ?? '',
      secretAccessKey: Deno.env.get('S3_SECRET_ACCESS_KEY') ?? '',
      region,
      service: 's3',
    })
    const ext = (att.name.split('.').pop() ?? 'pdf').toLowerCase()
    const key = `invoices/po/${crypto.randomUUID()}.${ext}`
    const put = await aws.fetch(`https://${bucket}.s3.${region}.amazonaws.com/${key}`, {
      method: 'PUT',
      body: bytes,
      headers: { 'Content-Type': att.contentType || 'application/octet-stream' },
    })
    if (!put.ok) {
      console.error('attach_po_from_email: S3 refused', put.status, (await put.text()).slice(0, 300))
      return bad(`Storage refused the file (${put.status}). Nothing was changed on the invoice.`)
    }

    const saved = await ctx.sb.rpc('track_update_invoice', {
      p_invoice_id: invoiceId,
      p_po_attachment_url: key,
    })
    if (saved.error) return bad(readable(saved.error))

    return ok(`Attached ${att.name} to invoice ${invoiceId} as its PO.`)
  },
}

/**
 * Suppliers are never created by Coda (Andy, 25 Sep 2026): they fill in their
 * own details. What she can do is send the form — the same invite as
 * + Add team on the Roster and + Add partner on Partners, through the
 * roster-onboarding function, as the caller.
 */
const inviteSupplier: Tool = {
  name: 'invite_supplier',
  title: 'Invite a supplier',
  description:
    'Email someone a link to a form where they add their own details, which puts them on the ' +
    'Roster or on Partners. You cannot create a supplier any other way. kind "roster" is for a ' +
    'composition team (composers); kind "partner" is for everyone else: labels, publishers, ' +
    'libraries, agents, managers, sync reps, musicologists. Only an email is needed. Say who ' +
    'you are inviting and to which (Roster or Partners) and wait for a yes.',
  requires: 'staff',
  writes: true,
  schema: obj(
    {
      email: str('Their email address. The form link is sent here.'),
      kind: {
        type: 'string',
        enum: ['roster', 'partner'],
        description: 'roster for a composition team, partner for any other supplier.',
      },
    },
    ['email', 'kind'],
  ),
  run: async (ctx, args) => {
    const email = String(args.email ?? '').trim().toLowerCase()
    const kind = args.kind === 'roster' ? 'roster' : 'partner'
    const { data, error } = await ctx.sb.functions.invoke('roster-onboarding', {
      body: { action: 'invite', email, kind },
    })
    if (error) {
      let message = error.message
      const res = (error as { context?: Response }).context
      if (res && typeof res.json === 'function') {
        try {
          const b = (await res.json()) as { error?: string }
          if (b?.error) message = b.error
        } catch {
          /* keep the generic message */
        }
      }
      return bad(message)
    }
    const r = data as { uuid?: string; emailed?: boolean; email_error?: string } | null
    const where = kind === 'roster' ? 'the Roster' : 'Partners'
    if (!r?.emailed) {
      return bad(`Added to ${where} as Invited, but the email did not send: ${r?.email_error ?? 'no reason given'}`)
    }
    return ok(`Invited ${email}. They show on ${where} as Invited until they fill in the form.`)
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
      'the client, the client contact and the AdPro lead before calling this. Only the ' +
      'start date and client job number may be left out; ask for anything else ' +
      'that is missing rather than guessing.',
    requires: 'staff',
    rpc: 'track_create_project',
    schema: obj(
      {
        title: str('What the project is called, e.g. "Dove Hair Global — Real Beauty".'),
        brand: str('The brand. Its first three letters become the Sequel No. brand code.'),
        client: str('The client company (usually the agency), by name as in client_list.'),
        client_user: str(
          'The client contact the project is for — an Agency, Brand or Freelance user — by ' +
          'full name or email.',
        ),
        project_type: str(
          'The service: Composition, Commercial, Library, Sonic Branding, Sound Design or Talent.',
        ),
        brand_category: str('Beauty & Wellbeing, Foods, or Non-Unilever.'),
        account: str('Unilever or Non-Unilever.'),
        adpro_lead: str('The AdPro lead (an Adpro user), by full name or email.'),
        client_job_no: str("Optional. The client's own job number."),
        pipeline_gbp: num('The projected pipeline in GBP.'),
        proposed_start_date: str('Optional. YYYY-MM-DD.'),
      },
      ['title', 'brand', 'client', 'client_user', 'project_type', 'brand_category', 'account', 'adpro_lead', 'pipeline_gbp'],
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
          'we already have — find it first if you are unsure of the spelling.',
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
    name: 'create_invoice_draft',
    title: 'Draft an invoice',
    description:
      'Create an invoice REQUEST on a project, for a person to review in the app — status ' +
      'Submitted, never raised: nothing goes to QuickBooks or the client. The same path as the ' +
      "app's invoice request form. Build it from the project's accepted quote and the client's " +
      'PO: find the project, read its quotes (quote_detail, quote_lines — minor units, divide ' +
      'by 100) and an earlier invoice on the project for the client and currency ids. Sequel ' +
      'fees go in `fees`; third-party costs go in `lines`. A library licence, for example, is ' +
      'one line (supplier MCPS, id 117, category "Library Master", paythrough true) plus the ' +
      'Sequel cut in fees.master_sequel_licence_fee. If the PO total and the quote differ, ' +
      'say so and ask which to use. The totals are computed by the database. Say what you are ' +
      'about to create and wait for a yes.',
    requires: 'staff',
    rpc: 'track_create_invoice_request',
    schema: obj(
      {
        project_id: int('The project (project_list id).'),
        client_id: int('The client being billed (client_list id) — the company on the PO.'),
        currency_id: int(
          "The currency id — quote_currency on the project's quote, or currency_id on an " +
            'earlier invoice to the same client.',
        ),
        description: str('What is being invoiced, e.g. "Library music licence: Mozart, Queen of the Night".'),
        po_number: str("Optional. The client's PO number, exactly as on the PO."),
        song_name: str('Optional.'),
        artist_name: str('Optional.'),
        usage_territories: str('Optional. Where it is licensed, e.g. "Indonesia".'),
        usage_region: {
          type: 'string',
          enum: [
            'Africa', 'Asia', 'Europe', 'Global', 'Latin America',
            'NAMET & RUB', 'North America', 'North Asia', 'SEAA', 'South Asia',
          ],
          description: 'Optional. The usage region.',
        },
        fees: obj({
          sequel_demo_fee: num('Optional.'),
          demo_contingency_fee: num('Optional.'),
          sequel_search_fee: num('Optional.'),
          search_contingency_fee: num('Optional.'),
          master_sequel_licence_fee: num('Optional. Sequel licence fee on the master / library track.'),
          master_sequel_studios_fee: num('Optional.'),
          publishing_sequel_licence_fee: num('Optional.'),
          publishing_sequel_studios_fee: num('Optional.'),
          sequel_consultancy_fee: num('Optional. "Other fees".'),
        }),
        lines: {
          type: 'array',
          description: 'Third-party costs, one per supplier. Major units (e.g. 8241.75).',
          items: obj(
            {
              supplier_id: int('The supplier (partner_list / roster_list id).'),
              amount: num('The amount, in the invoice currency.'),
              category: {
                type: 'string',
                enum: ['Demos', 'Searches', 'Library Master', 'Publishing', 'Other Fees'],
                description: 'The line category.',
              },
              is_paythrough: bool('True if the client pays this cost through Sequel (it is on the invoice).'),
            },
            ['supplier_id', 'amount', 'category', 'is_paythrough'],
          ),
        },
      },
      ['project_id', 'client_id', 'currency_id', 'description'],
    ),
    say: (r, _a, ctx) => {
      const row = first(r)
      if (!row) return 'Nothing was created.'
      return (
        `Draft invoice request ${row.id} created (status Submitted — not raised, nothing sent).\n` +
        `${ctx.appBase}/invoices/${row.uuid}`
      )
    },
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
      'Mint a link to send outside Sequel. `kind` is asset, contract, project_assets, ' +
      'release_form or licence. Assets, contracts, release forms and licences take a uuid; ' +
      'project_assets takes a project id.',
    requires: 'staff',
    rpc: '',
    schema: obj(
      {
        kind: {
          type: 'string',
          enum: ['asset', 'contract', 'project_assets', 'release_form', 'licence'],
          description: 'What to share.',
        },
        uuid: str("The record's uuid, for asset, contract, release_form and licence."),
        project_id: int('The project, for project_assets.'),
      },
      ['kind'],
    ),
    say: (r, a, ctx) => {
      const row = first(r)
      // A licence link opens the licence page, as the app's Copy link does.
      if (a.kind === 'licence' && row?.code) return `Link: ${ctx.appBase}/licence?id=${row.code}`
      return `Link: ${JSON.stringify(row)}`
    },
  },
  {
    name: 'archive',
    title: 'Archive a record',
    description:
      'Archiving is what "delete" means across Sequel — the record leaves the lists and keeps ' +
      'its history. `kind` is invoice, quote, supplier, brief, contract, release_form or ' +
      'licence. Invoices, quotes, suppliers and briefs take an id; contracts, release forms ' +
      'and licences a uuid.',
    requires: 'staff',
    rpc: '',
    schema: obj(
      {
        kind: {
          type: 'string',
          enum: ['invoice', 'quote', 'supplier', 'brief', 'contract', 'release_form', 'licence'],
          description: 'What to archive.',
        },
        id: int('The numeric id, for invoice, quote, supplier and brief.'),
        uuid: str('The uuid, for contract, release_form and licence.'),
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
  licence: { rpc: 'track_share_composition_licence', arg: 'uuid' },
  project_assets: { rpc: 'track_share_project_assets', arg: 'project_id' },
}

const ARCHIVE_RPCS: Record<string, { rpc: string; arg: 'id' | 'uuid'; param: string }> = {
  invoice: { rpc: 'track_archive_invoice', arg: 'id', param: 'p_invoice_id' },
  quote: { rpc: 'track_archive_quote', arg: 'id', param: 'p_quote_id' },
  supplier: { rpc: 'track_archive_supplier', arg: 'id', param: 'p_supplier_id' },
  brief: { rpc: 'track_archive_brief', arg: 'id', param: 'p_brief_id' },
  contract: { rpc: 'track_archive_contract', arg: 'uuid', param: 'p_uuid' },
  release_form: { rpc: 'track_archive_release_form', arg: 'uuid', param: 'p_uuid' },
  licence: { rpc: 'track_archive_composition_licence', arg: 'uuid', param: 'p_uuid' },
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

// ---------------------------------------------------------- the contracts --
//
// Licences (composition and library) and release forms, through the SAME edge
// functions the app's modals use, as the caller — so every rule the app has
// (invoice first, paythrough only for library, 100% share on library, the key
// the PDF goes to) is the database's and the function's, not repeated here.
// Added 26 Sep 2026 for the MCP (Andy: "the thing that gets Phil excited").
//
// ⚠️ PREVIEW FIRST. Creating a licence fills most of it from the project and
// the invoice. `preview: true` returns exactly what would be printed and
// creates nothing, so the person sees the whole document's details and says
// yes once — Andy, 25 Sep: gather everything, one confirmation.
//
// ⚠️ SENDING IS ITS OWN TOOL AND ITS OWN YES. An email to a client cannot be
// taken back. The address must be one the person gave — never looked up.

/** Call one of our own edge functions as the caller; its error text, not a generic one. */
async function invokeFn(
  ctx: Ctx,
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await ctx.sb.functions.invoke(name, { body })
  if (!error) return { data: (data ?? null) as Record<string, unknown> | null, error: null }
  let message = error.message
  const res = (error as { context?: Response }).context
  if (res && typeof res.json === 'function') {
    try {
      const b = (await res.json()) as { error?: string }
      if (b?.error) message = b.error
    } catch {
      /* keep the generic message */
    }
  }
  return { data: null, error: message }
}

const LICENCE_FIELDS = [
  'licensee_name', 'licensee_address', 'rights_granted', 'licensor_share', 'composition_title',
  'writer_names', 'production_name', 'client_name', 'brand', 'campaign', 'scripts', 'cutdowns',
  'media', 'territory', 'term', 'first_transmission', 'licence_fee',
] as const
type LicenceField = (typeof LICENCE_FIELDS)[number]

const LICENCE_LABELS: Record<LicenceField, string> = {
  licensee_name: 'Licensee', licensee_address: 'Licensee address', rights_granted: 'Rights granted',
  licensor_share: "Licensor's share", composition_title: 'Title', writer_names: 'Writer(s)',
  production_name: 'Production', client_name: 'Client', brand: 'Brand', campaign: 'Campaign',
  scripts: 'Scripts', cutdowns: 'Cutdowns included', media: 'Media', territory: 'Territory',
  term: 'Term', first_transmission: 'First transmission', licence_fee: 'Licence fee',
}

type Parts = { currency: string | null; master: number; publishing: number }

/** The fee follows the rights granted — the app's feeFor(), the same rule. */
function licenceFee(rights: string, parts: Parts | null): string {
  if (!parts) return ''
  const n =
    rights === 'Master Only'
      ? Number(parts.master)
      : rights === 'Publishing Only'
        ? Number(parts.publishing)
        : Number(parts.master) + Number(parts.publishing)
  if (!(n > 0)) return ''
  const s = n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${parts.currency ?? ''} ${s}`.trim()
}

const licenceKindName = (k: string) => (k === 'library' ? 'Library Licence' : 'Composition Licence')

const createLicence: Tool = {
  name: 'create_licence',
  title: 'Create a licence',
  description:
    'Create a composition or library licence for a client — Sequel is the licensor. ' +
    'INVOICE FIRST: it is made from a RAISED invoice on the project (Awaiting Payment or Paid), ' +
    'whose number prints on it; the licence comes into effect when that invoice is paid. ' +
    'kind "library": only invoices with a paythrough library line qualify, the fee is the ' +
    "library's lines only and the licensor's share is always 100%. " +
    'Everything the project and invoice know is filled in for you (licensee, address, brand, ' +
    'campaign, production, scripts, media, territory, term, first transmission, fee); pass a ' +
    'field only to change it. Composition licences take the title and writers from the ' +
    "project's song when there is one; otherwise give writer_names (individual writers, " +
    'never a composer team). ALWAYS call with preview true first, show the person every field ' +
    'it returns, and only call again with preview false once they say yes. Leave invoice_id ' +
    'out to be told which invoices qualify.',
  requires: 'staff',
  writes: true,
  schema: obj(
    {
      project_id: int('The project (project_list id).'),
      kind: { type: 'string', enum: ['composition', 'library'], description: 'Which licence.' },
      invoice_id: int('The raised licence invoice (invoice id, not its number).'),
      preview: bool('True: show what would be created and create nothing. False: create it.'),
      licensee_name: str('Optional override.'),
      licensee_address: str('Optional override. Lines separated by commas.'),
      rights_granted: {
        type: 'string',
        enum: ['Master & Publishing', 'Master Only', 'Publishing Only'],
        description: 'Optional. Default Master & Publishing. The fee follows it.',
      },
      licensor_share: str('Optional, composition only, e.g. "100%". Library is always 100%.'),
      composition_title: str('Optional override. The track title.'),
      writer_names: str('Individual writers, comma separated.'),
      production_name: str('Optional override.'),
      client_name: str('Optional override, e.g. "Unilever".'),
      brand: str('Optional override.'),
      campaign: str('Optional override.'),
      scripts: str('Optional override, e.g. 1 x 30".'),
      cutdowns: { type: 'string', enum: ['Yes', 'No'], description: 'Optional override.' },
      media: str('Optional override.'),
      territory: str('Optional override.'),
      term: str('Optional override.'),
      first_transmission: str('Optional override, written as it prints, e.g. "1 October 2026".'),
      licence_fee: str('Optional override, with currency code, e.g. "SGD 8,242.00".'),
    },
    ['project_id', 'kind', 'preview'],
  ),
  run: async (ctx, args) => {
    const projectId = Number(args.project_id)
    const kind = args.kind === 'library' ? 'library' : 'composition'
    const library = kind === 'library'

    const inv = await ctx.sb.rpc('track_licence_invoices', { p_project_id: projectId })
    if (inv.error) return bad(readable(inv.error))
    type Inv = { id: number; invoice_number: string; total: number; currency: string; client: string; licences: number; library_fee?: boolean }
    const eligible = ((inv.data ?? []) as Inv[]).filter((i) => !library || i.library_fee)
    const listing = eligible
      .map((i) => `invoice_id ${i.id} = invoice ${i.invoice_number} (${i.currency} ${i.total}, ${i.client ?? ''}${i.licences ? ', already has a licence' : ''})`)
      .join('\n')
    if (!eligible.length) {
      return bad(
        library
          ? 'No raised invoice on this project has a paythrough library fee. Raise the licence invoice first. If the client pays the library direct, the library issues the licence, not Sequel.'
          : 'There is no raised invoice on this project yet. Raise the licence invoice first — its number prints on the licence.',
      )
    }
    let invoiceId = args.invoice_id === undefined || args.invoice_id === null ? NaN : Number(args.invoice_id)
    if (!Number.isFinite(invoiceId)) {
      if (eligible.length > 1) return bad(`Which invoice? The ones that qualify:\n${listing}`)
      invoiceId = eligible[0].id
    }
    const chosen = eligible.find((i) => i.id === invoiceId)
    if (!chosen) return bad(`That invoice does not qualify. The ones that do:\n${listing}`)

    const pre = await ctx.sb.rpc('track_licence_prefill', { p_project_id: projectId, p_invoice_id: invoiceId })
    if (pre.error) return bad(readable(pre.error))
    const p = (pre.data ?? {}) as Record<string, unknown>

    const f = {} as Record<LicenceField, string>
    for (const k of LICENCE_FIELDS) f[k] = String(p[k] ?? '').trim()

    if (!library) {
      const songs = await ctx.sb.rpc('track_licence_songs', { p_project_id: projectId })
      const list = (songs.data ?? []) as { title: string; writers: string }[]
      if (list.length === 1) {
        f.composition_title = list[0].title
        f.writer_names = list[0].writers
      }
    }
    // Overrides, then the rules.
    for (const k of LICENCE_FIELDS) {
      const v = args[k]
      if (typeof v === 'string' && v.trim()) f[k] = v.trim()
    }
    if (!f.rights_granted) f.rights_granted = 'Master & Publishing'
    if (!(typeof args.licence_fee === 'string' && args.licence_fee.trim())) {
      const parts = (library ? p.library_parts : p.fee_parts) as Parts | null
      f.licence_fee = licenceFee(f.rights_granted, parts)
    }
    if (library) f.licensor_share = '100%'

    const missing = LICENCE_FIELDS.filter((k) => k !== 'licensee_address' && !f[k])
    const shown =
      `${licenceKindName(kind)} on invoice ${chosen.invoice_number}\n` +
      LICENCE_FIELDS.map((k) => `${LICENCE_LABELS[k]}: ${f[k] || '— missing —'}`).join('\n')

    if (missing.length) {
      return bad(
        `${shown}\n\nStill needed before it can be created: ${missing.map((k) => LICENCE_LABELS[k]).join(', ')}.` +
          (!f.licence_fee ? ' (Nothing is billed for those rights on this invoice — ask what the fee is.)' : ''),
      )
    }
    if (args.preview !== false) {
      return ok(`${shown}\n\nNothing created yet. Show these to the person; on a yes, call again with preview false (and any changes they asked for).`)
    }

    const r = await invokeFn(ctx, 'composition-licence', {
      action: 'create',
      project_id: projectId,
      invoice_id: invoiceId,
      kind,
      fields: f,
    })
    if (r.error) return bad(r.error)
    return ok(
      `Created ${licenceKindName(kind)} ${r.data?.ref} (uuid ${r.data?.uuid}). Not sent — use send_licence for that.\n` +
        `PDF (link works for an hour): ${r.data?.url}\n` +
        `Project: ${ctx.appBase}/projects/${projectId} → Contracting`,
    )
  },
}

const sendLicence: Tool = {
  name: 'send_licence',
  title: 'Email a licence',
  description:
    'Email a licence to someone outside Sequel: a button to the licence page, from you, with ' +
    "you copied in and replies coming to you; you're notified when they open it. The address " +
    'MUST be one the person gave you in this conversation — never look one up or reuse a stored ' +
    'one. Say who it is going to and which licence, and wait for a yes. It cannot be unsent.',
  requires: 'staff',
  writes: true,
  schema: obj(
    { uuid: str("The licence's uuid."), to: str('The email address the person gave you.') },
    ['uuid', 'to'],
  ),
  run: async (ctx, args) => {
    const r = await invokeFn(ctx, 'composition-licence', {
      action: 'send',
      uuid: String(args.uuid ?? ''),
      to: String(args.to ?? '').trim(),
    })
    if (r.error) return bad(r.error)
    const cc = (r.data?.cc as string[] | undefined) ?? []
    return ok(`Sent to ${r.data?.sent_to}${cc.length ? `, copied to ${cc.join(', ')}` : ''}.`)
  },
}

const RELEASE_FIELDS = [
  'recipient_name', 'recipient_address', 'track_name', 'brand', 'campaign',
  'term', 'territory', 'media', 'scripts',
] as const

const createReleaseForm: Tool = {
  name: 'create_release_form',
  title: 'Create a release form',
  description:
    'Create a music release form: Sequel confirming to a broadcaster (or whoever asked) that ' +
    'ONE track is cleared, and on what terms. It never shows money. One track per form. The ' +
    'track is just its name — no owner in brackets. Brand, campaign, term, territory, media ' +
    'and scripts usually come from the project (get_record project_detail); the recipient ' +
    'name and address come from the person. ALWAYS call with preview true first and show the ' +
    'person every field; call again with preview false once they say yes.',
  requires: 'staff',
  writes: true,
  schema: obj(
    {
      project_id: int('The project (project_list id).'),
      preview: bool('True: show what would be created and create nothing. False: create it.'),
      recipient_name: str('Who it is addressed to (the company or person).'),
      recipient_address: str('Optional. Their address, commas between lines.'),
      track_name: str('The track title only.'),
      brand: str('The brand.'),
      campaign: str('The campaign.'),
      term: str('e.g. "12 months".'),
      territory: str('e.g. "Singapore".'),
      media: str('e.g. "All Media".'),
      scripts: str('e.g. 1 x 30".'),
    },
    ['project_id', 'preview', 'recipient_name', 'track_name', 'brand', 'campaign', 'term', 'territory', 'media', 'scripts'],
  ),
  run: async (ctx, args) => {
    const f: Record<string, string> = {}
    for (const k of RELEASE_FIELDS) f[k] = String(args[k] ?? '').trim()
    const missing = RELEASE_FIELDS.filter((k) => k !== 'recipient_address' && !f[k])
    const shown = 'Release form\n' + RELEASE_FIELDS.map((k) => `${k.replace(/_/g, ' ')}: ${f[k] || '— missing —'}`).join('\n')
    if (missing.length) return bad(`${shown}\n\nStill needed: ${missing.join(', ')}.`)
    if (args.preview !== false) {
      return ok(`${shown}\n\nNothing created yet. On a yes, call again with preview false.`)
    }
    const r = await invokeFn(ctx, 'release-form', {
      action: 'create',
      project_id: Number(args.project_id),
      ...f,
    })
    if (r.error) return bad(r.error)
    return ok(
      `Created release form ${r.data?.ref} (uuid ${r.data?.uuid}). Not sent — use send_release_form for that.\n` +
        `PDF (link works for an hour): ${r.data?.url}\n` +
        `Project: ${ctx.appBase}/projects/${args.project_id} → Contracting`,
    )
  },
}

const sendReleaseForm: Tool = {
  name: 'send_release_form',
  title: 'Email a release form',
  description:
    'Email a release form to someone outside Sequel, from you, with you copied in. The address ' +
    'MUST be one the person gave you in this conversation — never look one up or reuse a stored ' +
    'one. Say who it is going to and which form, and wait for a yes. It cannot be unsent.',
  requires: 'staff',
  writes: true,
  schema: obj(
    { uuid: str("The release form's uuid."), to: str('The email address the person gave you.') },
    ['uuid', 'to'],
  ),
  run: async (ctx, args) => {
    const r = await invokeFn(ctx, 'release-form', {
      action: 'send',
      uuid: String(args.uuid ?? ''),
      to: String(args.to ?? '').trim(),
    })
    if (r.error) return bad(r.error)
    const cc = (r.data?.cc as string[] | undefined) ?? []
    return ok(`Sent to ${r.data?.sent_to}${cc.length ? `, copied to ${cc.join(', ')}` : ''}.`)
  },
}

// ------------------------------------------------ the library (MCPS) estimate --
//
// The app's seventh quote path, for the MCP (Andy, 26 Sep 2026: "library
// estimates as they are the estimates we raise the most of"). Same engine as
// the wizard — `_shared/mcpsPricing.ts`, the very file the browser imports —
// same reference tables, same classifier function, same write
// (`track_create_mcps_quote`). Nothing about the price is decided here.
//
// ⚠️ THE CLASSIFIER REFUSES RATHER THAN GUESSING (Andy, 14 Sep). A territory it
// cannot read stops the estimate; there is no fallback to Worldwide here either.
//
// ⚠️ PREVIEW FIRST, as with licences: the whole priced estimate is shown and
// nothing is written until the person says yes.

const MCPS_MEDIA = [
  'All Media', 'Linear TV (Excluding VOD)', 'Video On Demand',
  'Online incl. Social (Excluding VOD)', 'Social Media (Only)', 'Radio',
  'Public Location', 'Cinema / DVD',
]
const MCPS_DURATIONS = ['Longer than 30 seconds', '30 seconds or less']

function mcpsRateEnum(rate: McpsPrice['rateType']): string {
  if (rate === 'campaign_rate') return 'Campaign_Rate'
  if (rate === 'track_rate') return 'Track_Rate'
  return 'Per_30s'
}

async function mcpsReference(ctx: Ctx): Promise<McpsReference> {
  const m = ctx.sb.schema(MIRROR)
  const [rates, fx, minimums, searches] = await Promise.all([
    m.from('mcps_rate_card').select('id, media, territory, per_30s, track_rate, campaign_rate'),
    m.from('fx_rates').select('*').eq('base_currency', 'GBP').limit(1),
    m.from('unilever_minimum_licensing_fees').select('*'),
    m.from('unilever_library_search_fees').select('*'),
  ])
  const failed = [rates, fx, minimums, searches].find((r) => r.error)
  if (failed?.error) throw new Error(readable(failed.error))
  // Exactly the wizard's shaping (src/lib/mcpsQuote.ts useMcpsReference).
  const perRegion = (list: Record<string, unknown>[]) => {
    const out: Record<string, Record<string, number>> = {}
    for (const row of list) {
      const region = String(row.region ?? '')
      if (!region) continue
      const cols: Record<string, number> = {}
      for (const [k, val] of Object.entries(row)) {
        if (k === 'region' || k === 'id' || k === 'created_at') continue
        const n = Number(val)
        if (Number.isFinite(n)) cols[k] = n
      }
      out[region] = cols
    }
    return out
  }
  const fxRow = ((fx.data ?? [])[0] ?? {}) as Record<string, unknown>
  const fxRates: Record<string, number> = {}
  for (const [k, val] of Object.entries(fxRow)) {
    if (k === 'id' || k === 'created_at' || k === 'base_currency') continue
    const n = Number(val)
    if (Number.isFinite(n)) fxRates[k] = n
  }
  return {
    rateCard: (rates.data ?? []) as RateCardRow[],
    fx: fxRates,
    minimumFees: perRegion((minimums.data ?? []) as Record<string, unknown>[]),
    searchFees: perRegion((searches.data ?? []) as Record<string, unknown>[]),
  }
}

const createLibraryEstimate: Tool = {
  name: 'create_library_estimate',
  title: 'Create a library (MCPS) estimate',
  description:
    'Price and create an MCPS library music estimate — the app\'s LIBRARY (MCPS) quote, with ' +
    'the same pricing engine. Nobody types an amount: the price comes from the MCPS rate card, ' +
    "the client's region and the quote currency. The territory is read by the same classifier " +
    'as the app; if it cannot be read, say so and ask — never guess Worldwide. Media values ' +
    `must be exactly: ${MCPS_MEDIA.join(' | ')}. ` +
    'Use find / get_record for the project, the client (client_list id) and the currency ' +
    '(currencies_bank_accounts id — the currency the client is billed in). ALWAYS call with ' +
    'preview true first and show the person the whole priced estimate; call again with ' +
    'preview false only on a yes. Searches-only estimates need just searches.',
  requires: 'staff',
  writes: true,
  schema: obj(
    {
      project_id: int('The project (project_list id).'),
      client_id: int('The client being quoted (client_list id). Its region sets the minimum and the search fee.'),
      currency_id: int('The quote currency (currencies_bank_accounts id).'),
      description: str('A short description, e.g. "Library music: Mozart, Queen of the Night".'),
      preview: bool('True: price it and show it, create nothing. False: create it.'),
      searches_only: bool('Optional. True for a searches-only estimate. Default false.'),
      media: {
        type: 'array',
        items: { type: 'string', enum: MCPS_MEDIA },
        description: 'The media, as the exact values listed.',
      },
      worldwide: bool('True for a worldwide licence (the territory text is then ignored).'),
      territory: str('Where it runs, as the client said it, e.g. "Spain, France". Needed unless worldwide.'),
      online_worldwide: bool('Optional. Online usage worldwide? Default true — it usually is.'),
      multiple_scripts: bool('More than one script?'),
      duration: { type: 'string', enum: MCPS_DURATIONS, description: 'The longest edit.' },
      cutdowns: bool('Are there cutdowns?'),
      tracks: int('Optional. How many tracks the estimate covers. Leave out for one.'),
      searches: int('Optional. Searches requested, 0–10. Default 0.'),
      song_name: str('Optional. The track title.'),
      artist_name: str('Optional. The artist / library.'),
    },
    ['project_id', 'client_id', 'currency_id', 'description', 'preview'],
  ),
  run: async (ctx, args) => {
    const searchesOnly = args.searches_only === true
    const searches = Math.max(0, Math.min(10, Math.trunc(Number(args.searches ?? 0)) || 0))
    const rawMedia = Array.isArray(args.media)
      ? args.media
      : typeof args.media === 'string'
        ? (asArray(args.media).length ? asArray(args.media) : String(args.media).split(','))
        : []
    const media = rawMedia.map((x) => String(x).trim()).filter(Boolean)
    const unknown = media.filter((x) => !MCPS_MEDIA.includes(x))
    if (unknown.length) return bad(`Not an MCPS medium: ${unknown.join(', ')}. Use exactly: ${MCPS_MEDIA.join(' | ')}.`)

    const worldwide = args.worldwide === true
    const territoryText = String(args.territory ?? '').trim()
    const duration = String(args.duration ?? '')
    if (!searchesOnly) {
      const missing: string[] = []
      if (!media.length) missing.push('media')
      if (!worldwide && !territoryText) missing.push('territory (or worldwide)')
      if (typeof args.multiple_scripts !== 'boolean') missing.push('multiple scripts yes/no')
      if (!MCPS_DURATIONS.includes(duration)) missing.push('duration')
      if (typeof args.cutdowns !== 'boolean') missing.push('cutdowns yes/no')
      if (missing.length) return bad(`Still needed: ${missing.join(', ')}.`)
    } else if (searches < 1) {
      return bad('A searches-only estimate needs at least one search.')
    }

    // Currency label as table 48 stores it ("EURO", not "EUR") — the engine's key.
    const cur = await ctx.sb.schema(MIRROR).from('currencies_bank_accounts')
      .select('id, currency').eq('id', Number(args.currency_id)).maybeSingle()
    if (cur.error) return bad(readable(cur.error))
    const currency = String(cur.data?.currency ?? '')
    if (!currency) return bad('No such currency id. Look it up in currencies_bank_accounts.')

    const cl = await ctx.sb.schema(MIRROR).from('clients')
      .select('id, company, region').eq('id', Number(args.client_id)).maybeSingle()
    if (cl.error) return bad(readable(cl.error))
    if (!cl.data) return bad('No such client id.')
    let region = ''
    if (cl.data.region) {
      const rg = await ctx.sb.schema(MIRROR).from('regions').select('region').eq('id', cl.data.region).maybeSingle()
      if (rg.error) return bad(readable(rg.error))
      region = String(rg.data?.region ?? '')
    }
    if (!region) return bad(`${cl.data.company} has no region set, so the minimum and search fee cannot be priced. Set the client's region first.`)

    let structure: TerritoryStructure = {
      is_worldwide: worldwide, whole_continents: [], countries: [], distinct_continents: [],
    }
    if (!searchesOnly && !worldwide) {
      const c = await invokeFn(ctx, 'classify-territory', { text: territoryText })
      if (c.error) return bad(`The territory could not be read: ${c.error}`)
      const body = c.data as { ok?: boolean; error?: string; territory?: TerritoryStructure } | null
      if (!body?.ok || !body.territory) return bad(`The territory could not be read: ${body?.error ?? 'no reason given'}`)
      structure = body.territory
    }

    let reference: McpsReference
    try {
      reference = await mcpsReference(ctx)
    } catch (e) {
      return bad(e instanceof Error ? e.message : String(e))
    }

    const tracksRaw = args.tracks === undefined || args.tracks === null ? null : Math.trunc(Number(args.tracks))
    const answers: McpsAnswers = {
      media,
      territoryText,
      worldwideAnswer: worldwide,
      territory: structure,
      multipleScripts: args.multiple_scripts === true,
      duration,
      cutdowns: args.cutdowns === true,
      onlineWorldwide: args.online_worldwide !== false,
      tracks: tracksRaw !== null && Number.isFinite(tracksRaw) ? tracksRaw : null,
      searchesCount: searches,
      searchesOnly,
    }
    const p = priceMcps(answers, reference, { region, currency })

    const money = (minor: number) =>
      `${currency} ${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const shown = [
      `Library (MCPS) estimate — ${String(args.description ?? '').trim()}`,
      `Client: ${cl.data.company} (region ${region})`,
      ...(searchesOnly
        ? []
        : [
            `Media bought: ${p.mediaBought.join(', ')}${p.capped ? ' (capped at All Media)' : ''}`,
            `Territory bought: ${p.territory}${p.territoriesAsked && p.territoriesAsked !== p.territory ? ` (asked: ${p.territoriesAsked})` : ''}`,
            ...(p.onlineWorldwide !== null ? [`Online worldwide: ${p.onlineWorldwide ? 'yes' : 'no'}`] : []),
            `Term: ${p.term} · Scripts: ${p.scripts} · Duration: ${p.duration} · Cutdowns: ${p.cutdowns ? 'yes' : 'no'}`,
            `Rate: ${mcpsRateEnum(p.rateType).replace('_', ' ')} · Tracks: ${p.tracks}`,
            ...(p.notSoldAtScope ? ['Note: a medium is not sold at that scope, so it is priced at All Media.'] : []),
            `MCPS licence fee: ${money(p.licenceFeeLocal)}`,
            `Sequel licensing fee: ${money(p.sequelLicensingFee)}`,
          ]),
      `Search fee: ${money(p.searchFee)}${searches ? ` (${searches} search${searches === 1 ? '' : 'es'})` : ''}`,
      `Total: ${money(p.grandTotal)}`,
      ...(p.note ? [`Note on the estimate: ${p.note}`] : []),
    ].join('\n')

    if (args.preview !== false) {
      return ok(`${shown}\n\nNothing created yet. Show this to the person; on a yes, call again with preview false and the same answers.`)
    }

    const song = String(args.song_name ?? '').trim()
    const artist = String(args.artist_name ?? '').trim()
    const { data, error } = await ctx.sb.rpc('track_create_mcps_quote', {
      p_project_id: Number(args.project_id),
      p_client_id: Number(args.client_id),
      p_currency_id: Number(args.currency_id),
      p_description: String(args.description ?? '').trim(),
      p_song_name: song || null,
      p_artist_name: artist || null,
      p_tracks_quoted: answers.tracks,
      p_term: p.term || null,
      p_territory: p.territory || null,
      p_mcps_territories: p.territoriesAsked || null,
      p_scripts: p.scripts || null,
      p_duration: p.duration || null,
      p_cutdowns: p.cutdowns,
      p_note: p.note,
      p_track_rate: mcpsRateEnum(p.rateType),
      p_media: p.mediaBought,
      p_media_mcps: answers.media,
      p_online_worldwide: p.onlineWorldwide,
      p_region: null,
      p_mcps_fee_gbp: p.perTrackGbp * p.tracks,
      p_mcps_local_fee: p.licenceFeeLocal,
      p_sequel_licensing_fee: p.sequelLicensingFee,
      p_search_fee: p.searchFee,
      p_searches_requested: answers.searchesCount,
      p_grand_total: p.grandTotal,
    })
    if (error) return bad(readable(error))
    const row = first(data)
    if (!row?.uuid) return bad('The estimate was created but came back with no link. Tell Andy.')
    return ok(`Created estimate ${row.id} — ${money(p.grandTotal)}.\n${ctx.appBase}/quotes/${row.uuid}`)
  },
}

// ------------------------------------------------------------------ export --

export const TOOLS: Tool[] = [
  describeData,
  find,
  listRecords,
  totals,
  getRecord,
  report,
  updateRecord,
  inviteSupplier,
  // No create_supplier (Andy, 25 Sep 2026): suppliers fill in their own
  // details through a form, as roster teams do with /join-roster.
  attachPoFromEmail,
  createLibraryEstimate,
  createLicence,
  sendLicence,
  createReleaseForm,
  sendReleaseForm,
  ...ACTIONS.map(actionTool),
]

/** The tools this person may be offered. The database still decides the rest. */
export function toolsFor(who: Who): Tool[] {
  return TOOLS.filter((t) => passes(who, t.requires))
}

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name)
}
