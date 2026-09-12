import { useEffect, useRef } from 'react'

type Props = {
  title: string
  body?: string
  /** The word on the button that does the thing. "Delete", not "OK". */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The app's own confirm, in place of the browser's.
 *
 * `confirm()` draws the user agent's dialog, headed by the origin —
 * "localhost:5173 says" — with an OK button and a checkbox offering to
 * silence the page. That last one is the real problem: it lets someone
 * turn off the only guard in front of an irreversible delete, and the app
 * is never told they did.
 */
export default function Confirm({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus the destructive button, so the dialog can be dismissed with
    // Escape but not completed by hitting Return without reading it.
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-sequel-brown/40 p-6"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="surface-light w-full max-w-[30rem] border border-sequel-line p-7 shadow-[0_10px_40px_rgba(55,43,41,0.25)]"
      >
        <h2 className="submission-title [overflow-wrap:anywhere]">{title}</h2>
        {body && <p className="mt-3 text-[0.8rem] text-sequel-mid">{body}</p>}
        <div className="mt-7 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-tool btn-quiet"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-tool btn-dark"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
