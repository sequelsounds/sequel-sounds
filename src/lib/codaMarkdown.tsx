import { Fragment, type ReactNode } from 'react'

/**
 * The little bit of markdown Coda actually writes.
 *
 * The old widget rendered `chat_text_ai` as markdown, so raw `* **Bold:**` on
 * screen is a rebuild defect, not a model one — she is writing what she has
 * always written.
 *
 * ⚠️ NO LIBRARY, AND NO `dangerouslySetInnerHTML`. react-markdown brings a
 * remark tree along with it, which is a lot of dependency for a chat bubble,
 * and the alternative — assembling HTML from model output and injecting it —
 * puts whatever a model echoes from a client-written row straight into the
 * page. Everything here builds React elements, so text stays text however odd
 * it looks.
 *
 * Supported, because it is what she uses: paragraphs, `-`/`*` bullets,
 * numbered lists, `**bold**`, `` `code` ``, and bare URLs. Anything else is
 * shown as written.
 */

const BOLD_CODE_OR_URL = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g

/** Bold, code and links inside one line. */
function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(BOLD_CODE_OR_URL).map((part, i) => {
    const key = `${keyBase}-${i}`
    if (!part) return null

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const inner = part.slice(1, -1)
      // Only things that look like code get code styling. Coda backticks whole
      // sentences when she quotes a refusal back — setting those in monospace
      // makes one reply look like two different voices, so they render as the
      // prose they are.
      const looksLikeCode = inner.length <= 40 && inner.trim().split(/\s+/).length <= 3
      if (!looksLikeCode) return <span key={key}>{inner}</span>
      return (
        <code key={key} className="font-mono text-[0.9em] px-1 py-px rounded bg-black/[0.06]">
          {inner}
        </code>
      )
    }

    if (/^https?:\/\//.test(part)) {
      return (
        <a key={key} href={part} target="_blank" rel="noreferrer" className="underline">
          {part}
        </a>
      )
    }

    return <Fragment key={key}>{part}</Fragment>
  })
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }

const BULLET = /^\s*[-*]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
/** A heading reads as a bold line here; she is writing into a chat bubble. */
const HEADING = /^\s*#{1,6}\s+(.*)$/

function parse(text: string): Block[] {
  const blocks: Block[] = []

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const last = blocks[blocks.length - 1]

    if (!line.trim()) {
      // A blank line ends whatever was open.
      if (last && last.kind === 'p') blocks.push({ kind: 'p', lines: [] })
      continue
    }

    const bullet = line.match(BULLET)
    if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1])
      else blocks.push({ kind: 'ul', items: [bullet[1]] })
      continue
    }

    const numbered = line.match(NUMBERED)
    if (numbered) {
      if (last?.kind === 'ol') last.items.push(numbered[1])
      else blocks.push({ kind: 'ol', items: [numbered[1]] })
      continue
    }

    const heading = line.match(HEADING)
    const content = heading ? `**${heading[1]}**` : line

    if (last?.kind === 'p' && last.lines.length) last.lines.push(content)
    else blocks.push({ kind: 'p', lines: [content] })
  }

  return blocks.filter((b) => (b.kind === 'p' ? b.lines.length : b.items.length))
}

export default function CodaMarkdown({ text }: { text: string }) {
  const blocks = parse(text)

  return (
    <div className="text-[0.8rem] leading-[1.4] text-sequel-brown">
      {blocks.map((block, i) => {
        if (block.kind === 'p') {
          return (
            <p key={i} className={i ? 'mt-2' : ''}>
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(line, `${i}-${j}`)}
                </Fragment>
              ))}
            </p>
          )
        }

        const Tag = block.kind === 'ul' ? 'ul' : 'ol'
        return (
          <Tag
            key={i}
            className={`${i ? 'mt-2' : ''} ml-4 ${
              block.kind === 'ul' ? 'list-disc' : 'list-decimal'
            }`}
          >
            {block.items.map((item, j) => (
              <li key={j} className="mt-1 first:mt-0">
                {inline(item, `${i}-${j}`)}
              </li>
            ))}
          </Tag>
        )
      })}
    </div>
  )
}
