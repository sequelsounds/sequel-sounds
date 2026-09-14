import { useEffect, useRef, useState } from 'react'

/**
 * A field that saves itself.
 *
 * Track's supplier pages save each field on blur through its own request, with
 * no submit button, and that is the pattern recreated here rather than
 * replaced: staff know it, and a form that saves as a whole would need a
 * dirty-state and a leave warning that Track has never had.
 *
 * What Track does NOT have is any sign that a save happened, or failed. Every
 * field on `/roster-edit` fires a request on blur and the page says nothing
 * either way — so a refused write looks exactly like a saved one until the
 * page is reloaded. That is worth fixing rather than copying, and it matters
 * more here than it did on Track, because the database now refuses some of
 * these writes on purpose: a non-finance account editing a payment mapping
 * gets a real error, and a client user gets zero rows. Both have to be
 * visible.
 *
 * ⚠️ The value is reverted to the server's on failure. Leaving what was typed
 * in the box after a refusal reads as saved, which is the thing this exists to
 * prevent.
 */

type Status = 'idle' | 'saving' | 'saved' | 'error'

/** How long "Saved" stays up. Long enough to catch, short enough not to nag. */
const SAVED_MS = 1800

function useSaveState(serverText: string) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  /** Returns true when the value was written, false when it was refused. */
  async function run(save: () => Promise<unknown>): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current)
    setStatus('saving')
    setError(null)
    try {
      await save()
      setStatus('saved')
      timer.current = setTimeout(() => setStatus('idle'), SAVED_MS)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.')
      setStatus('error')
      return false
    }
  }

  return { status, error, run, serverText }
}

function Status({ status, error }: { status: Status; error: string | null }) {
  if (status === 'error') {
    return (
      <span className="edit-field-status is-error" role="alert">
        {error}
      </span>
    )
  }
  if (status === 'saving') return <span className="edit-field-status">Saving…</span>
  if (status === 'saved') return <span className="edit-field-status is-saved">Saved</span>
  return null
}

export function EditField({
  label,
  value,
  textarea,
  onSave,
}: {
  label: string
  value: string | null | undefined
  textarea?: boolean
  onSave: (next: string | null) => Promise<unknown>
}) {
  const serverText = value ?? ''
  const [draft, setDraft] = useState(serverText)
  const [focused, setFocused] = useState(false)
  const { status, error, run } = useSaveState(serverText)

  // The value this field has written and is still waiting to see come back.
  //
  // ⚠️ Without this the field visibly reverts while it saves, which is the
  // opposite of what happened. Blur does two things at once: it starts the
  // write, and it clears `focused` — and clearing `focused` lets the effect
  // below put the SERVER's value back, which is still the old one until the
  // refetch lands a second later. Typing a new bio and tabbing away showed the
  // old bio again under a "Saving…", then snapped to the new one. Caught in
  // the browser; nothing about it is visible to the type checker.
  const pending = useRef<string | null>(null)

  // The server's value is the one to show — except while this field is being
  // typed in, and except while its own write is in flight.
  useEffect(() => {
    if (pending.current !== null) {
      if (serverText === pending.current) pending.current = null
      return
    }
    if (focused) return
    setDraft(serverText)
  }, [serverText, focused])

  async function commit() {
    // Trailing whitespace on an email address is a real cause of a bounced
    // brief, and nothing is lost by taking it off.
    const next = draft.trim()
    if (next !== draft) setDraft(next)
    // Xano writes "" where this side would write null, so the two are the same
    // absence: comparing the trimmed text against the server's stops an
    // untouched empty field from being rewritten as null on every blur.
    if (next === serverText) {
      setFocused(false)
      return
    }
    // Set before the focus flips, so the effect above sees it on the very next
    // render rather than one render too late.
    pending.current = next
    setFocused(false)
    const ok = await run(() => onSave(next === '' ? null : next))
    if (!ok) {
      pending.current = null
      setDraft(serverText)
    }
  }

  const shared = {
    className: 'edit-field-input',
    value: draft,
    disabled: status === 'saving',
    onFocus: () => setFocused(true),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => void commit(),
  }

  return (
    <div className="edit-field">
      <div className="edit-field-head">
        <label className="edit-field-label">{label}</label>
        <Status status={status} error={error} />
      </div>
      {textarea ? (
        <textarea
          {...shared}
          className="edit-field-input edit-field-input-text"
          // Enter belongs to the text in a textarea; Escape puts the field back.
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(serverText)
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <input
          {...shared}
          // Blur is what saves, so Enter saves by leaving the field, and
          // Escape abandons the edit the way it does everywhere else.
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(serverText)
              e.currentTarget.blur()
            }
          }}
        />
      )}
    </div>
  )
}

/**
 * The same field, for a foreign key.
 *
 * A select saves on CHANGE rather than on blur: there is no half-finished
 * state to wait for, and blurring a select the person only looked at would
 * otherwise fire a write.
 */
export function EditSelect({
  label,
  value,
  options,
  placeholder = '—',
  onSave,
}: {
  label: string
  value: number | null | undefined
  options: { id: number; label: string }[]
  placeholder?: string
  onSave: (next: number | null) => Promise<unknown>
}) {
  const { status, error, run } = useSaveState('')

  return (
    <div className="edit-field">
      <div className="edit-field-head">
        <label className="edit-field-label">{label}</label>
        <Status status={status} error={error} />
      </div>
      <select
        className="edit-field-input edit-field-select"
        value={value ?? ''}
        disabled={status === 'saving'}
        onChange={(e) => {
          const next = e.target.value === '' ? null : Number(e.target.value)
          if (next === (value ?? null)) return
          void run(() => onSave(next))
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * A field that is not editable, and says so.
 *
 * `note` is why — a blank disabled box invites someone to "fix" it. The two
 * on these pages are the QuickBooks vendor and the billing address, and
 * neither is a gap in this page: one needs a live QuickBooks call to be safe
 * to change, the other is not stored anywhere on this side at all.
 */
export function ReadOnlyField({
  label,
  value,
  note,
}: {
  label: string
  value: string | number | null | undefined
  note?: string
}) {
  return (
    <div className="edit-field">
      <div className="edit-field-head">
        <label className="edit-field-label">{label}</label>
        {note ? <span className="edit-field-status">{note}</span> : null}
      </div>
      <input
        className="edit-field-input"
        value={value === null || value === undefined ? '' : String(value)}
        readOnly
      />
    </div>
  )
}
