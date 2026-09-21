// Two models, one conversation loop.
//
// Coda's provider is a row in `track_ai_prompts`, not a line of code, so this
// file is what makes that row mean something. Each provider turns a request
// into its own shape and its reply back into a common one; `agent.ts` never
// learns which is in use.
//
// ⚠️ A CONVERSATION BELONGS TO ITS PROVIDER. The transcript is stored in the
// provider's own message shape — Anthropic's content blocks are not Gemini's
// parts — so switching the row mid-thread does not convert anything. The
// conversation is started again instead (see `index.ts`), which is why
// `coda_conversations` carries a provider.
import type { Tool } from './tools.ts'

/** What a turn looks like to `agent.ts`, whoever produced it. */
export type Reply = {
  /** Anything the model said out loud. */
  text: string[]
  /** Tools it wants run, in order. */
  calls: { id: string; name: string; args: Record<string, unknown> }[]
  /** The turn as it must be stored and replayed, in the provider's own shape. */
  turn: unknown
}

export type Provider = {
  name: string
  /** One round trip. Throws with a readable message on an HTTP failure. */
  ask: (args: {
    model: string
    system: string[]
    tools: Tool[]
    messages: unknown[]
    maxTokens: number
  }) => Promise<Reply>
  /** The user-side turn carrying tool results, in the provider's own shape. */
  results: (
    calls: { id: string; name: string; args: Record<string, unknown> }[],
    outs: { text: string; isError?: boolean }[],
  ) => unknown
  /** The first turn of a conversation. */
  userTurn: (text: string) => unknown
}

class ModelError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function httpFail(provider: string, status: number, detail: string): never {
  // The key and the request body never reach the person; the log gets enough
  // to tell a bad model name from a rate limit.
  console.error(provider, status, detail.slice(0, 500))
  throw new ModelError(
    status,
    status === 429
      ? 'Coda is rate limited at the moment. Try again in a minute.'
      : `Coda could not reach the model (HTTP ${status}).`,
  )
}

export function messageFor(e: unknown): string {
  return e instanceof ModelError
    ? e.message
    : `Coda could not reach the model: ${e instanceof Error ? e.message : String(e)}`
}

// ------------------------------------------------------------- Anthropic --

const anthropic: Provider = {
  name: 'anthropic',

  userTurn: (text) => ({ role: 'user', content: [{ type: 'text', text }] }),

  results: (calls, outs) => ({
    role: 'user',
    content: calls.map((c, i) => ({
      type: 'tool_result',
      tool_use_id: c.id,
      content: outs[i].text,
      is_error: Boolean(outs[i].isError),
    })),
  }),

  ask: async ({ model, system, tools, messages, maxTokens }) => {
    const declared = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    }))
    // The system prompt and the tool list are identical on every turn of every
    // conversation and are most of the tokens. Caching them is what keeps the
    // bill in tens of pounds rather than hundreds.
    if (declared.length) {
      // deno-lint-ignore no-explicit-any
      ;(declared[declared.length - 1] as any).cache_control = { type: 'ephemeral' }
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: system.map((text, i) => ({
          type: 'text',
          text,
          ...(i === system.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
        })),
        messages,
        tools: declared,
      }),
    })

    if (!res.ok) httpFail('anthropic', res.status, await res.text().catch(() => ''))

    const body = await res.json()
    // deno-lint-ignore no-explicit-any
    const content: any[] = body.content ?? []

    return {
      text: content.filter((b) => b.type === 'text' && b.text).map((b) => b.text as string),
      calls: content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> })),
      turn: { role: 'assistant', content },
    }
  },
}

// ---------------------------------------------------------------- Gemini --

/**
 * JSON Schema as Gemini will accept it.
 *
 * Three differences that matter, all of them found the hard way by anyone who
 * has tried to hand it an Anthropic schema:
 *
 *   - types are upper case, and `additionalProperties` is rejected outright
 *   - an OBJECT must declare its properties; a free-form one is not allowed
 *   - so is an ARRAY of free-form objects
 *
 * The last two are real arguments here — the fee lines on a quote, the columns
 * on an update — so they are declared as strings holding JSON, and `tools.ts`
 * accepts either shape. Losing the field entirely would be worse than asking
 * the model to serialise it.
 */
// deno-lint-ignore no-explicit-any
function geminiSchema(node: any): Record<string, unknown> {
  if (!node || typeof node !== 'object') return { type: 'STRING' }

  const kind = String(node.type ?? '').toLowerCase()
  const description: string = node.description ?? ''

  if (kind === 'object') {
    const props = (node.properties ?? {}) as Record<string, unknown>
    const keys = Object.keys(props)
    if (!keys.length) {
      return { type: 'STRING', description: `${description} Send this as a JSON object.`.trim() }
    }
    const out: Record<string, unknown> = {}
    for (const k of keys) out[k] = geminiSchema(props[k])
    return {
      type: 'OBJECT',
      ...(description ? { description } : {}),
      properties: out,
      ...(Array.isArray(node.required) && node.required.length
        ? { required: node.required }
        : {}),
    }
  }

  if (kind === 'array') {
    const items = node.items
    const itemIsFreeForm =
      !items ||
      (String(items.type ?? '').toLowerCase() === 'object' &&
        !Object.keys(items.properties ?? {}).length)
    if (itemIsFreeForm) {
      return { type: 'STRING', description: `${description} Send this as a JSON array.`.trim() }
    }
    return {
      type: 'ARRAY',
      ...(description ? { description } : {}),
      items: geminiSchema(items),
    }
  }

  if (kind === 'string' || kind === 'number' || kind === 'integer' || kind === 'boolean') {
    return {
      type: kind.toUpperCase(),
      ...(description ? { description } : {}),
      ...(kind === 'string' && Array.isArray(node.enum) ? { enum: node.enum } : {}),
    }
  }

  // A property with a description and no type — `list_records`' filter value,
  // which is deliberately anything. Gemini insists on a type.
  return { type: 'STRING', ...(description ? { description } : {}) }
}

const gemini: Provider = {
  name: 'google',

  userTurn: (text) => ({ role: 'user', parts: [{ text }] }),

  results: (calls, outs) => ({
    role: 'user',
    parts: calls.map((c, i) => ({
      functionResponse: {
        name: c.name,
        // Gemini wants an object, and it reads `error` differently from a
        // result that merely says no.
        response: outs[i].isError ? { error: outs[i].text } : { result: outs[i].text },
      },
    })),
  }),

  ask: async ({ model, system, tools, messages, maxTokens }) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': Deno.env.get('GEMINI_API_KEY') ?? '',
        },
        body: JSON.stringify({
          systemInstruction: { parts: system.map((text) => ({ text })) },
          contents: messages,
          tools: [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: geminiSchema(t.schema),
              })),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          // Temperature 0 for the same reason the other Gemini calls in this
          // repo use it: this is retrieval and tool choice, not writing.
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
        }),
      },
    )

    if (!res.ok) httpFail('gemini', res.status, await res.text().catch(() => ''))

    const body = await res.json()
    const candidate = body.candidates?.[0]
    // deno-lint-ignore no-explicit-any
    const parts: any[] = candidate?.content?.parts ?? []

    // A blocked or empty candidate comes back with no parts at all, which would
    // otherwise look like a silent, contented end to the turn.
    if (!parts.length) {
      const why = candidate?.finishReason ?? body.promptFeedback?.blockReason ?? 'no reason given'
      console.error('gemini: empty candidate', JSON.stringify(body).slice(0, 500))
      throw new ModelError(200, `The model returned nothing (${why}).`)
    }

    return {
      text: parts.filter((p) => typeof p.text === 'string' && p.text).map((p) => p.text as string),
      calls: parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({
          // Gemini does not issue call ids; results are matched by name and
          // order instead, so one is made up for the audit's benefit.
          id: `${p.functionCall.name}-${i}`,
          name: p.functionCall.name as string,
          args: (p.functionCall.args ?? {}) as Record<string, unknown>,
        })),
      turn: { role: 'model', parts },
    }
  },
}

export const PROVIDERS: Record<string, Provider> = {
  anthropic,
  google: gemini,
}

export function providerFor(name: string | null | undefined): Provider {
  return PROVIDERS[name ?? ''] ?? anthropic
}
