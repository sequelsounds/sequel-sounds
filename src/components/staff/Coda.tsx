import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useCoda } from '../../lib/coda'
import CodaMarkdown from '../../lib/codaMarkdown'

/**
 * Coda, bottom right of every staff page.
 *
 * ⚠️ A REBUILD OF THE OLD WIDGET, NOT A NEW DESIGN. Structure from the Webflow
 * component tree, measurements from its style records, and the two states from
 * screenshots of the running widget (21 Sep 2026). Three earlier attempts were
 * wrong because they were built from the stylesheet without looking at her.
 *
 *   chat_global_wrapper       fixed, right 24px, bottom 24px, z-index 999 (30 here)
 *   ├── chat_header           12px 16px, brown ground, no bottom border
 *   │   ├── chat_header_title Fahkwang 0.9rem 600 caps, silver, margin-right auto
 *   │   └── (unstyled div)    clear / maximize / minimize
 *   ├── chat_window_container 600 x 35rem, 1rem padding, 1px brown, silver
 *   └── coda_chat_form        OUTSIDE the window, below its border
 *
 * ⚠️ MINIMISED IS NOT "HIDDEN". Shut, she is the header bar AND the input row —
 * you can type a question at her without opening anything, which is the whole
 * point of her sitting there. Only the window goes away. The header also swaps
 * its controls: shut it carries one `^`, open it carries CLEAR CHAT and `—`.
 *
 * ⚠️ THERE IS NO "MAXIMISE TO A BIGGER BOX". An earlier version of this file
 * invented one, and at 46rem it threw the panel across the screen. The old
 * widget's two buttons are open and shut, nothing else.
 *
 * Two things deliberately not carried over: the typing indicator faded to
 * #999, and nothing in this app fades text; and one unused class carried a
 * 12px radius while the live bubbles were square.
 */

/**
 * Open she is 600px — the window's own width. Shut, the window is gone and the
 * old widget falls back to `chat_input_row`'s `min-width: 300px`, so she is
 * half as wide. That 300 is a hardcoded half of the 600 rather than anything
 * derived, and the old write-up flags it as something that will not track a
 * change to the window; kept as it is, because this is a rebuild.
 */
const OPEN_WIDTH = '600px'
const SHUT_WIDTH = '300px'

/** What the model is told about where the person is standing. */
function pageName(pathname: string): string | null {
  const [, first, second] = pathname.split('/')
  if (!first) return null
  const singular: Record<string, string> = {
    projects: 'project',
    clients: 'client',
    partners: 'partner',
    roster: 'roster member',
    songs: 'song',
    users: 'user',
    quotes: 'quote',
    contracts: 'contract',
  }
  return second && singular[first] ? `${singular[first]} ${second}` : first
}

export default function Coda() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const { messages, busy, doing, send, clear } = useCoda()
  const location = useLocation()

  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  // Follow the conversation down as it grows, including while a tool runs.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, doing, open])

  const submit = () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    // Asking from the shut state opens her, so the answer has somewhere to go.
    setOpen(true)
    void send(text, pageName(location.pathname))
  }

  // The last message, if it failed, is shown as the in-thread error line rather
  // than as an answer — the old widget keeps errors out of the bubble list on
  // purpose, so they are never sent back to the model as a conversation turn.
  const last = messages[messages.length - 1]
  const error = last && last.role === 'coda' && last.error ? last.text : null
  const shown = error ? messages.slice(0, -1) : messages

  return (
    <div
      // z-30, not the old widget's 999 (Andy, 26 Sep 2026): every modal and
      // full-screen form (z-40 to z-60) must sit in front of her — at 999 she
      // covered the wizards' Next button. Still above the page's own z-20s.
      className="fixed right-6 bottom-6 z-30 block"
      style={{ width: open ? OPEN_WIDTH : SHUT_WIDTH }}
    >
      {/* chat_header */}
      <div className="flex items-center border border-b-0 border-sequel-brown bg-sequel-brown px-4 py-3 shadow-[0_4px_24px_0_rgba(0,0,0,0.08)]">
        <div className="mr-auto font-title text-[0.9rem] font-semibold text-sequel-silver uppercase">
          Coda (Beta)
        </div>

        {open ? (
          <>
            <button
              type="button"
              onClick={clear}
              className="mr-[10px] cursor-pointer border border-sequel-silver bg-transparent py-1 pr-[13px] pl-[14px] font-mono text-[12px] text-sequel-silver uppercase"
            >
              Clear chat
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Minimise Coda"
              aria-expanded
              className="cursor-pointer bg-transparent px-2 py-1 text-[18px] leading-none text-sequel-silver"
            >
              —
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open Coda"
            aria-expanded={false}
            className="cursor-pointer bg-transparent px-2 py-1 font-mono text-[18px] leading-none text-sequel-silver"
          >
            ^
          </button>
        )}
      </div>

      {/* chat_window_container — the only thing minimising takes away. */}
      {open && (
        <div
          ref={scroller}
          id="coda-chat-window"
          className="flex flex-col overflow-x-hidden overflow-y-auto border border-sequel-brown bg-sequel-silver p-4 shadow-[0_4px_24px_0_rgba(0,0,0,0.08)] [scrollbar-width:none]"
          style={{ height: '35rem' }}
        >
          {shown.map((m, i) => (
            // chat_list_item
            <div key={i} className="mb-4 flex w-full flex-col">
              <div
                className={`mb-2 max-w-[80%] border border-sequel-brown px-4 py-3 ${
                  m.role === 'coda' ? 'self-start bg-sequel-white' : 'self-end bg-sequel-silver'
                }`}
              >
                {m.role === 'coda' ? (
                  <CodaMarkdown text={m.text} />
                ) : (
                  // What the person typed is shown exactly as they typed it.
                  <p className="text-[0.8rem] leading-[1.4] whitespace-pre-wrap text-sequel-brown">
                    {m.text}
                  </p>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2" aria-live="polite">
              {/* chat_thinking_icon_wrapper — a 1rem square holding the old
                  widget's own loading mark, a square flipping on both axes. */}
              <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                <svg
                  viewBox="0 0 20 20"
                  width="100%"
                  height="100%"
                  aria-hidden="true"
                  className="text-sequel-brown"
                >
                  <rect width="20" height="20" fill="currentColor" className="coda-thinking-mark" />
                </svg>
              </div>
              {/* Her reply size and case, in the app's grey so it reads as a status, not a message. */}
              <span className="text-[0.8rem] leading-[1.4] text-sequel-mid">
                {doing ?? 'Thinking'}…
              </span>
            </div>
          )}

          {/* chat_text_error — in the thread, outside the bubble list. */}
          {error && (
            <div className="mt-4 ml-4 text-[0.8rem] leading-[1.4] text-sequel-brown">{error}</div>
          )}
        </div>
      )}

      {/* coda_chat_form — a sibling of the window, and there in both states. */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex items-end gap-2 pt-3">
          <textarea
            ref={input}
            value={draft}
            disabled={busy}
            autoComplete="off"
            placeholder="Ask for help!"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, shift-Enter makes a line. The single-line input
              // growing to ten rems is what `is_single_line` does.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            className="max-h-40 min-h-[36px] w-full min-w-0 flex-grow resize-none overflow-x-hidden overflow-y-auto border border-sequel-brown bg-sequel-white px-3 py-2 font-sans text-[0.8rem] leading-[18px] text-sequel-brown shadow-[0_2px_5px_0_rgba(0,0,0,0.2)] [field-sizing:content]"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="flex-none cursor-pointer border-0 bg-sequel-brown px-4 py-2 font-sans text-[14px] text-sequel-white capitalize"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
