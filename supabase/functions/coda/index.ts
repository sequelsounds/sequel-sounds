// coda — the assistant, serving two front ends from one set of tools.
//
//   POST /coda       the chat panel in the app. Streams newline-delimited JSON
//                    events so the panel can say what she is doing while she
//                    does it.
//   POST /coda/mcp   the MCP server Claude on the desktop connects to.
//
// One function rather than two because the tools are the thing worth having
// exactly once. Two deploys of the same registry is how the MCP server ends up
// calling a database function that was changed a month ago — which is what had
// happened to `track-mcp` by the time this replaced it.
//
// Deployed with verify_jwt ON: the gateway rejects a missing or malformed token
// before this code runs, and `identify` then refuses anything without a real
// session.
import { run, settings, type Turn } from './agent.ts'
import { handleMcp } from './mcp.ts'
import { callTool, clientFor, corsHeaders, ctxFor, identify, json } from './runtime.ts'

/**
 * A conversation to append to: the one asked for, or a new one.
 *
 * ⚠️ A CONVERSATION BELONGS TO ITS PROVIDER. Turns are stored in the shape the
 * model that produced them uses — Anthropic's content blocks are not Gemini's
 * parts — so a thread started under one provider cannot be replayed to the
 * other. Changing the provider row therefore starts a new thread rather than
 * feeding a model a transcript it cannot read.
 */
async function conversation(
  // deno-lint-ignore no-explicit-any
  sb: any,
  id: string | null,
  provider: string,
): Promise<{ id: string; history: Turn[]; restarted?: boolean } | { error: string }> {
  const start = async (restarted = false) => {
    const { data, error } = await sb
      .from('coda_conversations')
      .insert({ provider })
      .select('id')
      .single()
    if (error) return { error: error.message }
    return { id: (data as { id: string }).id, history: [] as Turn[], restarted }
  }

  if (!id) return await start()

  const { data: row, error: rowError } = await sb
    .from('coda_conversations')
    .select('id, provider')
    .eq('id', id)
    .maybeSingle()
  if (rowError) return { error: rowError.message }
  // Row-level security refuses someone else's id by returning nothing, which
  // is the same shape as an id that does not exist. Either way, a new thread.
  if (!row) return await start()
  if ((row as { provider: string | null }).provider !== provider) return await start(true)

  const { data, error } = await sb
    .from('coda_messages')
    .select('content')
    .eq('conversation_id', id)
    .order('id')
  if (error) return { error: error.message }
  return { id, history: ((data ?? []) as { content: Turn }[]).map((m) => m.content) }
}

/** 'user' or 'assistant', whichever shape the turn arrived in. */
function roleOf(turn: Turn): 'user' | 'assistant' {
  const role = (turn as { role?: string })?.role
  return role === 'user' ? 'user' : 'assistant'
}

/**
 * The turn as a person reads it, or null when there is nothing to show.
 *
 * Handles both providers because a conversation can only ever be one of them,
 * and this is not the place to care which: Anthropic puts text in `content`
 * blocks, Gemini in `parts`. A turn carrying only tool results has no display
 * text at all — it belongs to the conversation the model sees, not the one on
 * screen.
 */
function textOf(turn: Turn): string | null {
  const t = turn as { content?: unknown; parts?: unknown }
  const blocks = Array.isArray(t.content) ? t.content : Array.isArray(t.parts) ? t.parts : []
  const text = (blocks as { type?: string; text?: unknown }[])
    .filter((b) => typeof b.text === 'string' && b.text)
    .map((b) => b.text as string)
    .join('\n\n')
  return text.trim() ? text : null
}

/**
 * How much of a conversation the model is shown.
 *
 * ⚠️ EVERY TURN RESENDS THE WHOLE THREAD, TOOL RESULTS INCLUDED, and one
 * `list_records` result runs to several kilobytes. Left unbounded, a
 * conversation someone keeps going all day gets slower and dearer with every
 * message — the same twenty seconds that the describe_data loop caused,
 * arriving by a different route.
 *
 * The window is trimmed to a turn the model can start from: a plain user
 * message. Cutting between an assistant's tool call and its results would hand
 * the model a call with no answer, which both providers reject.
 */
const REPLAY_TURNS = 24

function windowOf(history: Turn[]): Turn[] {
  if (history.length <= REPLAY_TURNS) return history

  const tail = history.slice(-REPLAY_TURNS)
  const first = tail.findIndex((turn) => {
    const t = turn as { role?: string; content?: unknown; parts?: unknown }
    if (t.role !== 'user') return false
    const blocks = Array.isArray(t.content) ? t.content : Array.isArray(t.parts) ? t.parts : []
    // A user turn that is really tool results is not a starting point.
    return !(blocks as { type?: string; functionResponse?: unknown }[]).some(
      (b) => b.type === 'tool_result' || b.functionResponse,
    )
  })

  return first <= 0 ? tail : tail.slice(first)
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const isMcp = url.pathname.endsWith('/mcp')
  const cors = corsHeaders(req.headers.get('origin'), isMcp)

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST, OPTIONS' } })
  }

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return isMcp
      ? json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 200, cors)
      : json({ error: 'Expected JSON.' }, 400, cors)
  }

  if (isMcp && Array.isArray(body)) {
    return json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batched requests are not supported' } },
      200,
      cors,
    )
  }

  const sb = clientFor(req)
  const caller = await identify(sb)
  if ('error' in caller) {
    return isMcp
      ? json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32001, message: caller.error } }, 200, cors)
      : json({ error: caller.error }, 401, cors)
  }

  // ------------------------------------------------------------------ MCP --

  if (isMcp) {
    return await handleMcp(
      body,
      sb,
      caller,
      (payload, status = 200) => json(payload, status, cors),
      () => new Response(null, { status: 202, headers: cors }),
    )
  }

  // --------------------------------------------------------------- the app --

  const ctx = ctxFor(sb, caller.who)

  // A direct tool call from the panel — the confirm button on a write runs the
  // tool itself rather than asking the model to do it again, so what happens is
  // exactly what the person was shown.
  if (body.tool) {
    const out = await callTool(
      ctx,
      { authUid: caller.authUid, source: 'panel', conversationId: body.conversation_id ?? null },
      String(body.tool),
      (body.args ?? {}) as Record<string, unknown>,
    )
    return json({ text: out.text, ok: !out.isError }, 200, cors)
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return json({ error: 'Say something.' }, 400, cors)

  const { provider } = await settings(ctx)
  const thread = await conversation(sb, body.conversation_id ?? null, provider)
  if ('error' in thread) return json({ error: thread.error }, 400, cors)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'))
      send({ type: 'conversation', id: thread.id })
      if (thread.restarted) {
        send({
          type: 'text',
          text: 'Coda has been switched to a different model, so this is a new conversation.',
        })
      }

      try {
        const { turns } = await run(ctx, {
          authUid: caller.authUid,
          conversationId: thread.id,
          history: windowOf(thread.history),
          message,
          page: typeof body.page === 'string' ? body.page : null,
          emit: send,
        })

        if (turns.length) {
          const { error } = await sb.from('coda_messages').insert(
            turns.map((t) => ({
              conversation_id: thread.id,
              role: roleOf(t),
              content: t,
              text: textOf(t),
            })),
          )
          if (error) console.error('transcript write failed', error.message)
          await sb
            .from('coda_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', thread.id)
        }
      } catch (e) {
        console.error('coda', e)
        send({ type: 'error', text: 'Something went wrong. Nothing was changed.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { ...cors, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  })
})
