// The MCP server: the same tools Coda has, offered to Claude on the desktop so
// it can work on Sequel alongside its own connectors — read an email, then
// raise the project it is about, in one go.
//
// This replaces the `track-mcp` function, which offered two tools and called a
// version of `track_create_project` that no longer exists.
//
// The protocol is hand-rolled rather than taken from a library: it is about a
// hundred lines of JSON-RPC, and a function that writes to the production
// database is the wrong place to inherit a dependency tree.
//
// Authorisation is not done here, on purpose. The caller's own token is
// forwarded to PostgREST, so every statement runs as that person and the
// database decides. Adding a tool can never widen what someone may do.
import { callTool, ctxFor, type Caller } from './runtime.ts'
import { toolsFor } from './tools.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SERVER_NAME = 'sequel'
const SERVER_VERSION = '1.0.0'
const PROTOCOL_VERSION = '2025-06-18'

type Id = string | number | null

export async function handleMcp(
  body: Record<string, unknown>,
  sb: SupabaseClient,
  caller: Caller,
  reply: (payload: unknown, status?: number) => Response,
  accepted: () => Response,
): Promise<Response> {
  const id: Id = (body?.id as Id) ?? null
  const method = String(body?.method ?? '')
  const isNotification = body?.id === undefined

  const result = (value: unknown) => reply({ jsonrpc: '2.0', id, result: value })
  const fail = (code: number, message: string) =>
    reply({ jsonrpc: '2.0', id, error: { code, message } })

  switch (method) {
    case 'initialize': {
      const asked = (body?.params as { protocolVersion?: string } | undefined)?.protocolVersion
      return result({
        protocolVersion:
          typeof asked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asked)
            ? asked
            : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Sequel Track — the music supervision platform for Sequel Sounds. Start with ' +
          'describe_data to see what is readable and find to turn a name into a record. ' +
          'Everything runs as the signed-in person, so a refusal is a real permission ' +
          'boundary, not a bug. References like the Sequel No. are allocated by the ' +
          'database, never supplied.',
      })
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return accepted()

    case 'ping':
      return result({})

    case 'tools/list':
      return result({
        tools: toolsFor(caller.who).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.schema,
          annotations: { readOnlyHint: !t.writes, destructiveHint: Boolean(t.writes) },
        })),
      })

    case 'tools/call': {
      const params = (body?.params ?? {}) as { name?: string; arguments?: unknown }
      const name = String(params.name ?? '')
      const args = (params.arguments ?? {}) as Record<string, unknown>

      const out = await callTool(
        ctxFor(sb, caller.who),
        { authUid: caller.authUid, source: 'mcp' },
        name,
        args,
      )
      return result({ content: [{ type: 'text', text: out.text }], isError: Boolean(out.isError) })
    }

    default:
      if (isNotification) return accepted()
      return fail(-32601, `Method not found: ${method}`)
  }
}
