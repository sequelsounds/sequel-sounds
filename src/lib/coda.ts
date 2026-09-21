import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/**
 * Talking to Coda.
 *
 * The edge function answers with newline-delimited JSON rather than one blob,
 * so the panel can say what she is doing while she does it. A chain of four
 * lookups takes fifteen seconds and a spinner for all of it reads as broken —
 * "Looking up projects…" reads as working.
 */

export type ToolRun = { name: string; ok?: boolean }

export type Message = {
  role: 'user' | 'coda'
  text: string
  /** The tools that ran to produce this answer, in order. */
  tools?: ToolRun[]
  error?: boolean
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/coda`

/** What a tool call looks like in the panel while it runs. */
const PHRASES: Record<string, string> = {
  describe_data: 'Checking what data there is',
  find: 'Searching',
  list_records: 'Reading records',
  get_record: 'Reading a record',
  report: 'Running a report',
  update_record: 'Saving a change',
  create_supplier: 'Creating a supplier',
  create_project: 'Creating a project',
  create_quote: 'Creating a quote',
  create_song: 'Creating a song',
  request_brief: 'Requesting a brief',
  set_invoice_status: 'Changing an invoice',
  update_invoice: 'Updating an invoice',
  update_invoice_line: 'Updating an invoice line',
  save_contract: 'Saving a contract',
  share: 'Making a link',
  archive: 'Archiving',
}

export function phraseFor(name: string): string {
  return PHRASES[name] ?? name.replace(/_/g, ' ')
}

/**
 * How long a conversation stays warm.
 *
 * Open the app within this of your last message and you carry on where you
 * were; leave it longer and she starts clean. Twelve hours means this
 * morning's thread is still there after lunch, and yesterday's is not.
 */
const WARM_HOURS = 12

export function useCoda() {
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [doing, setDoing] = useState<string | null>(null)
  const conversation = useRef<string | null>(null)

  /**
   * Pick the thread back up on load.
   *
   * ⚠️ FROM THE DATABASE, NOT localStorage. The transcripts are already stored
   * server-side for the audit trail, and reading them back means the same
   * conversation follows you to a second tab, a refresh and another machine —
   * none of which browser storage can do. The policies scope both tables to
   * the signed-in person, so this needs no endpoint of its own.
   */
  useEffect(() => {
    let cancelled = false

    const resume = async () => {
      const since = new Date(Date.now() - WARM_HOURS * 3600_000).toISOString()

      const { data: thread } = await supabase
        .from('coda_conversations')
        .select('id')
        .gt('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelled || !thread) return

      const { data: rows } = await supabase
        .from('coda_messages')
        .select('role, text')
        .eq('conversation_id', thread.id)
        .not('text', 'is', null)
        .order('id')

      if (cancelled) return

      conversation.current = thread.id
      setMessages(
        (rows ?? []).map((r) => ({
          role: r.role === 'user' ? 'user' : 'coda',
          text: r.text as string,
        })),
      )
    }

    void resume()
    return () => {
      cancelled = true
    }
  }, [])

  const clear = useCallback(() => {
    // A new thread rather than a delete: the transcript is the audit trail's
    // companion and deleting it on a whim would take the context for a tool
    // call with it. The old one stays in the database, just no longer the one
    // being added to.
    conversation.current = null
    setMessages([])
  }, [])

  const send = useCallback(async (text: string, page: string | null) => {
    setMessages((m) => [...m, { role: 'user', text }])
    setBusy(true)
    setDoing(null)

    const tools: ToolRun[] = []
    let answer = ''
    let failed = false

    const fail = (why: string) => {
      failed = true
      answer = why
    }

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Signed out. Sign in again and ask me then.')

      const res = await fetch(FUNCTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          conversation_id: conversation.current,
          page,
        }),
      })

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        throw new Error(detail || `Coda is not answering (HTTP ${res.status}).`)
      }

      // NDJSON: one event per line, and the last line of a chunk may be half an
      // event, so the tail is carried into the next read rather than parsed.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let tail = ''

      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        tail += decoder.decode(value, { stream: true })
        const lines = tail.split('\n')
        tail = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let e: Record<string, unknown>
          try {
            e = JSON.parse(line)
          } catch {
            continue
          }

          if (e.type === 'conversation') conversation.current = String(e.id)
          else if (e.type === 'tool') {
            tools.push({ name: String(e.name) })
            setDoing(phraseFor(String(e.name)))
          } else if (e.type === 'tool_result') {
            const run = [...tools].reverse().find((t) => t.name === e.name && t.ok === undefined)
            if (run) run.ok = Boolean(e.ok)
            setDoing(null)
          } else if (e.type === 'text') {
            answer += (answer ? '\n\n' : '') + String(e.text)
          } else if (e.type === 'error') {
            fail(String(e.text))
          }
        }
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }

    setMessages((m) => [
      ...m,
      {
        role: 'coda',
        text: answer || 'No answer came back.',
        tools: tools.length ? tools : undefined,
        error: failed,
      },
    ])
    setBusy(false)
    setDoing(null)
  }, [])

  return { messages, busy, doing, send, clear }
}
