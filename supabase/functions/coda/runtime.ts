// Shared plumbing for both front ends: who the caller is, a Supabase client
// that IS them, and the audited path through which every tool runs.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { passes, readable, toolByName, type Ctx, type ToolResult, type Who } from './tools.ts'

export const APP_BASE_URL =
  Deno.env.get('APP_BASE_URL') ?? 'https://app.sequelsounds.com'

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/app\.sequelsounds\.com$/,
  /^https:\/\/studio\.sequelsounds\.com$/,
  /^https:\/\/[^.]+\.sequelsounds\.app$/,
  /^https:\/\/sequel-sounds\.andy-4c2\.workers\.dev$/,
]

/**
 * The panel is a browser and gets the app's own origin rules. The MCP server is
 * not a browser — Claude on the desktop sends no Origin at all — so it answers
 * `*`, which costs nothing: the bearer token is the only thing that authorises
 * anything there, and a browser never attaches one cross-origin by itself.
 */
export function corsHeaders(origin: string | null, wildcard = false) {
  const allowed = wildcard
    ? '*'
    : origin && ALLOWED_ORIGINS.some((re) => re.test(origin))
      ? origin
      : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, x-client-info, mcp-protocol-version, mcp-session-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'mcp-session-id',
    Vary: 'Origin',
  }
}

export function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

/**
 * A Supabase client that IS the caller. Nothing here elevates: the access token
 * is passed through untouched and PostgREST applies that person's row-level
 * security. The publishable key only identifies the project.
 */
export function clientFor(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key =
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? ''
  return createClient(url, key, {
    global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * The service-role client, used for exactly one thing: writing the audit row.
 * The audit table has no insert policy, so a caller cannot forge a row and —
 * more to the point — cannot suppress one by failing to write it.
 */
function auditClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export type Caller = { who: Who; authUid: string | null }

/** Who is talking to us, and which role gates they pass. */
export async function identify(sb: SupabaseClient): Promise<Caller | { error: string }> {
  const { data: session } = await sb.auth.getUser()
  const authUid = session?.user?.id ?? null
  if (!authUid) return { error: 'Not signed in.' }

  const { data, error } = await sb.rpc('coda_whoami')
  if (error) return { error: readable(error) }

  const who = data as Who
  return { who, authUid }
}

export function ctxFor(sb: SupabaseClient, who: Who): Ctx {
  return { sb, who, appBase: APP_BASE_URL }
}

/**
 * Run one tool and write down that it ran.
 *
 * The audit is written for refusals and crashes too. A tool that was tried and
 * refused is the interesting row — it is how you find out someone has been
 * asking Coda for the finance pages.
 */
export async function callTool(
  ctx: Ctx,
  opts: { authUid: string | null; source: 'panel' | 'mcp'; conversationId?: string | null },
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const started = Date.now()
  const tool = toolByName(name)

  let out: ToolResult
  if (!tool) {
    out = { text: `No tool called "${name}".`, isError: true }
  } else if (!passes(ctx.who, tool.requires)) {
    // Belt and braces: the tool was not offered to this person, so arriving
    // here means it was named directly.
    out = { text: `Refused: ${name} is not available to this account.`, isError: true }
  } else {
    try {
      out = await tool.run(ctx, args)
    } catch (e) {
      out = { text: `Refused: ${e instanceof Error ? e.message : String(e)}`, isError: true }
    }
  }

  const audit = auditClient()
  if (audit) {
    const { error } = await audit.from('coda_tool_calls').insert({
      conversation_id: opts.conversationId ?? null,
      auth_uid: opts.authUid,
      track_user_id: ctx.who.user_id,
      actor_email: ctx.who.email,
      source: opts.source,
      tool: name,
      args,
      ok: !out.isError,
      summary: out.isError ? null : out.text.slice(0, 500),
      error: out.isError ? out.text.slice(0, 500) : null,
      duration_ms: Date.now() - started,
    })
    // An audit that cannot be written is worth knowing about, but failing the
    // person's request over it would be worse. It goes to the function log.
    if (error) console.error('audit write failed', error.message)
  } else {
    console.error('SUPABASE_SERVICE_ROLE_KEY missing — tool calls are not being audited')
  }

  return out
}
