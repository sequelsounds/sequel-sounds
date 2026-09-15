import { useEffect, useState } from 'react'
import {
  BRIEF_QUESTIONS,
  briefDate,
  briefFlow,
  briefItems,
  briefLink,
  fromUkDate,
  toUkDate,
  useArchiveBrief,
  useBriefDetail,
  useUpdateBrief,
  type BriefDetail,
  type BriefItem,
} from '../../lib/briefs'
import { EditEnum, EditField } from './EditField'
import { buildBriefEmail } from '../../lib/briefEmail'
import type { Brief, Project } from '../../lib/xanoMirror'
import { ArchiveIcon, Modal, ShareIcon } from './RowActions'

/**
 * The staff half of briefs on the project page: the row's share and delete
 * cells, the share modal, the brief view and EMAIL BRIEF. The old app's
 * `brief_share_menu`, `brief_view_modal` and `delete_brief_modal`, wording
 * and behaviour read off the staging page and its Wized bindings, 16 Sep.
 */

/* ------------------------------------------------------------ the share modal */

export type ShareState =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'ready'; link: string; expires: string | null }

/**
 * brief_share_menu. Opens the moment REQUEST BRIEF is clicked, saying
 * "Generating link..." while the token mints, so the click visibly does
 * something. The same modal re-shows a live link from the row's share icon.
 */
export function BriefShareModal({ state, onClose }: { state: ShareState; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const link = state.kind === 'ready' ? state.link : null
  const expires = state.kind === 'ready' ? briefDate(state.expires) : ''
  return (
    <Modal onClose={onClose}>
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">Request a brief</div>
      <div className="rm-subheader">
        Send this link to the client. It opens the briefing form without a login, works once, and
        expires after 30 days.
      </div>
      {expires && (
        <div className="rm-text">
          <br />
          Expires {expires}
        </div>
      )}
      <div className="rm-buttons">
        <div className="rm-link">
          {link ??
            (state.kind === 'failed'
              ? "Couldn't create the link. Close and try again."
              : 'Generating link...')}
        </div>
        <button
          type="button"
          className="wizard-btn rm-copy"
          onClick={() => {
            // Nothing to copy until the mint has landed.
            if (!link) return
            navigator.clipboard.writeText(link).then(
              () => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              },
              () => {
                const el = document.querySelector('.rm-link')
                const sel = window.getSelection()
                if (el && sel) {
                  sel.removeAllRanges()
                  const range = document.createRange()
                  range.selectNodeContents(el)
                  sel.addRange(range)
                }
              },
            )
          }}
        >
          {copied ? 'COPIED!' : 'COPY'}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ the row cells */

/**
 * brief_row_share and delete_brief_row_trigger. The share cell is HIDDEN,
 * never removed, on a row with no live link — removing it shifted every
 * column after it on the old page.
 */
export function BriefRowActions({ brief, projectId }: { brief: Brief; projectId: number | undefined }) {
  const [sharing, setSharing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const archive = useArchiveBrief(projectId)
  const token = brief.share_token

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <span className="row-action" style={{ visibility: token ? 'visible' : 'hidden' }}>
        <button
          type="button"
          className="row-action-button"
          aria-label="Share this brief"
          disabled={!token}
          onClick={(e) => {
            stop(e)
            if (token) setSharing(true)
          }}
        >
          <ShareIcon />
        </button>
      </span>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Remove this brief"
          onClick={(e) => {
            stop(e)
            archive.reset()
            setRemoving(true)
          }}
        >
          <ArchiveIcon />
        </button>
      </span>

      {sharing && token && (
        <BriefShareModal
          state={{ kind: 'ready', link: briefLink(token), expires: brief.share_expires_at }}
          onClose={() => setSharing(false)}
        />
      )}
      {removing && (
        <Modal onClose={() => setRemoving(false)}>
          <div className="rm-header">Are you sure you want to remove this brief?</div>
          <div className="rm-subheader">
            It will be archived and removed from this project, and any link sent to the client will
            stop working.
          </div>
          {archive.error && <p className="form-error">{archive.error.message}</p>}
          <div className="rm-buttons">
            <button
              type="button"
              className="wizard-btn rm-button"
              disabled={archive.isPending}
              onClick={() => archive.mutate(brief.id, { onSuccess: () => setRemoving(false) })}
            >
              {archive.isPending ? 'REMOVING…' : 'CONFIRM'}
            </button>
            <button type="button" className="wizard-btn rm-button" onClick={() => setRemoving(false)}>
              CANCEL
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ------------------------------------------------------------ the brief view */

function viewTitle(d: BriefDetail | undefined): string {
  if (!d) return 'Loading brief...'
  const name = (d.answers.name || '').trim()
  const type = d.answers.brief_type || ''
  if (name && type) return `${name} - ${type}`
  if (type) return `${type} brief`
  return name || 'Brief'
}

function viewMeta(d: BriefDetail | undefined, failed: boolean): string {
  if (failed) return "Couldn't load this brief. Close and try again."
  if (!d) return ''
  if (!d.submitted_at) return 'Not yet submitted'
  return `Submitted ${briefDate(d.submitted_at)}`
}

/**
 * brief_view_modal: the answers, as plain text — they come from a public form
 * and are never rendered as HTML. Only answered questions are listed.
 */
export function BriefViewModal({
  briefId,
  project,
  onClose,
}: {
  briefId: number
  project: Project
  onClose: () => void
}) {
  const detail = useBriefDetail(briefId)
  const d = detail.data
  const items = d ? briefItems(d.answers) : []
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 8000)
    return () => window.clearTimeout(t)
  }, [copied])

  return (
    <Modal onClose={onClose}>
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">{viewTitle(d)}</div>
      <div className="rm-subheader">{viewMeta(d, detail.isError)}</div>
      {editing && d && <BriefEditor detail={d} projectId={project.id} />}
      {!editing && items.length > 0 && (
        <div className="bv-answers">
          {items.map((item) => (
            <div key={item.key} className="bv-qa">
              <div className="rm-subheader bv-question">{item.question}</div>
              <div className="rm-text bv-answer">{item.answer}</div>
            </div>
          ))}
        </div>
      )}
      {/* Only once the brief has loaded, so it cannot send a half-empty email. */}
      {d && (
        <div className="rm-buttons">
          {!editing && (
            <button
              type="button"
              className="wizard-btn rm-button bv-email"
              onClick={() => emailBrief(d, items, project).then(() => setCopied(true))}
            >
              {copied ? 'COPIED - PASTE INTO EMAIL' : 'EMAIL BRIEF'}
            </button>
          )}
          {/* Each field saves as it is left, so DONE only closes the boxes. */}
          <button type="button" className="wizard-btn rm-button" onClick={() => setEditing((e) => !e)}>
            {editing ? 'DONE' : 'EDIT BRIEF'}
          </button>
        </div>
      )}
    </Modal>
  )
}

/**
 * Every question as a box, answered or not, so something the client adds later
 * has somewhere to go. Branching follows the answers as they stand: the budget
 * box shows only for commercially released music, lyrics not for
 * instrumental. The questions read as they do on the client's form.
 */
function BriefEditor({ detail, projectId }: { detail: BriefDetail; projectId: number }) {
  const save = useUpdateBrief(detail.id, projectId)
  const a = detail.answers
  // An uploaded brief has no answers to edit, only its name.
  const questions =
    detail.source === 'upload' ? BRIEF_QUESTIONS.filter((q) => q.key === 'name') : briefFlow(a)
  return (
    <div className="bv-answers bv-edit">
      {questions.map((q) => {
        if (q.type === 'choice') {
          return (
            <EditEnum
              key={q.key}
              label={q.title}
              value={a[q.key] || null}
              options={(q.choices ?? []).map((c) => c.value)}
              onSave={(v) => save(q.key, v)}
            />
          )
        }
        if (q.type === 'date') {
          return (
            <EditField
              key={q.key}
              label={`${q.title} (DD/MM/YYYY)`}
              value={a[q.key] ? toUkDate(a[q.key]) : ''}
              onSave={(v) => save(q.key, v === null ? null : fromUkDate(v))}
            />
          )
        }
        return (
          <EditField
            key={q.key}
            label={q.key === 'name' ? 'Brief name' : q.title}
            value={a[q.key]}
            textarea={q.type === 'long'}
            onSave={(v) => save(q.key, v)}
          />
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------- EMAIL BRIEF */

/**
 * Copies the brief to the clipboard, formatted, then opens a new email with the
 * subject filled in for the sender to paste into. The email opens only once
 * the copy has landed. What goes in it: `lib/briefEmail.ts`.
 */
async function emailBrief(d: BriefDetail, items: BriefItem[], p: Project): Promise<void> {
  const m = buildBriefEmail(d, items, p, /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || ''))
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([m.html], { type: 'text/html' }),
          'text/plain': new Blob([m.text], { type: 'text/plain' }),
        }),
      ])
    } else {
      await navigator.clipboard.writeText(m.text)
    }
  } catch {
    await navigator.clipboard.writeText(m.text)
  }
  window.location.href = `mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.prompt)}`
}
