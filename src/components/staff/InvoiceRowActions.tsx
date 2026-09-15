import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useArchiveInvoice } from '../../lib/invoiceEdits'
import { useIsFinance } from '../../lib/xanoMirror'
import type { Invoice } from '../../lib/xanoMirror'

/**
 * The share and delete cells on a project's invoice row, and the two modals
 * behind them — the old app's `shareable_invoice_menu` and
 * `Delete_invoice_modal`, wording and layout read off the staging page.
 *
 * Two changes from the old app, both Andy's, 15 Sep:
 *  - SHARE copies the link to the invoice's own page. The old app shared
 *    AWS_link, which is empty on every invoice.
 *  - DELETE archives, as the old app does, but an invoice already in
 *    QuickBooks can be archived by finance only. The cell is drawn and dead for
 *    everyone else; the database refuses anyway.
 *
 * ⚠️ These sit inside the row's link. Every click here stops at the cell, and
 * the modals are portalled out — but React still bubbles a portal's clicks
 * through the tree to the link, so each modal stops them at its own root.
 */
export function InvoiceRowActions({
  invoice,
  projectId,
}: {
  invoice: Invoice
  projectId: number | undefined
}) {
  const [sharing, setSharing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const finance = useIsFinance()

  const raised = (invoice.qbo_invoice_id ?? '') !== ''
  const canArchive = !raised || finance.data === true

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Share this invoice"
          disabled={!invoice.uuid}
          onClick={(e) => {
            stop(e)
            setSharing(true)
          }}
        >
          <ShareIcon />
        </button>
      </span>
      <span className={`row-action${canArchive ? '' : ' is-inert'}`}>
        <button
          type="button"
          className="row-action-button"
          aria-label="Delete this invoice"
          title={canArchive ? undefined : 'In QuickBooks — only finance can delete it'}
          disabled={!canArchive}
          onClick={(e) => {
            stop(e)
            if (canArchive) setArchiving(true)
          }}
        >
          <ArchiveIcon />
        </button>
      </span>

      {sharing && invoice.uuid && (
        <ShareModal
          link={`${window.location.origin}/invoices/${invoice.uuid}`}
          onClose={() => setSharing(false)}
        />
      )}
      {archiving && (
        <ArchiveModal
          invoiceId={invoice.id}
          projectId={projectId}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  )
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div
      className="rm-darken"
      onClick={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="rm-message" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  )
}

function ShareModal({ link, onClose }: { link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Modal onClose={onClose}>
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">Shareable Link Generated</div>
      <div className="rm-subheader">Click copy to share your invoice link</div>
      <div className="rm-buttons">
        <div className="rm-link">{link}</div>
        <button
          type="button"
          className="wizard-btn rm-copy"
          onClick={() => {
            navigator.clipboard.writeText(link).then(
              () => {
                setCopied(true)
                // The old app's 1.5 seconds.
                window.setTimeout(() => setCopied(false), 1500)
              },
              () => {
                // The browser refuses the clipboard when the page is not
                // focused. Select the link instead so it can be copied by hand.
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

function ArchiveModal({
  invoiceId,
  projectId,
  onClose,
}: {
  invoiceId: number
  projectId: number | undefined
  onClose: () => void
}) {
  const archive = useArchiveInvoice(projectId)
  return (
    <Modal onClose={onClose}>
      <div className="rm-header">Are you sure you want to delete this invoice?</div>
      <div className="rm-subheader">Your client will no longer be able to see it.</div>
      {archive.error && <p className="form-error">{archive.error.message}</p>}
      <div className="rm-buttons">
        {/* Closes only once the archive has worked — the old app learned
            that a modal closing on a failed archive looks like a success. */}
        <button
          type="button"
          className="wizard-btn rm-button"
          disabled={archive.isPending}
          onClick={() => archive.mutate(invoiceId, { onSuccess: onClose })}
        >
          {archive.isPending ? 'DELETING…' : 'CONFIRM'}
        </button>
        <button type="button" className="wizard-btn rm-button" onClick={onClose}>
          CANCEL
        </button>
      </div>
    </Modal>
  )
}

/** share-2, 1rem, stroke 1.5 — the icon Webflow embeds in the row. */
function ShareIcon() {
  return (
    <svg
      width="1rem"
      height="1rem"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

/** The old app's delete mark on invoice rows: a cross, on a 40-unit box. */
function ArchiveIcon() {
  return (
    <svg width="1rem" height="1rem" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true">
      <path d="M21.499 19.994L32.755 8.727a1.064 1.064 0 0 0-.001-1.502c-.398-.396-1.099-.398-1.501.002L20 18.494L8.743 7.224c-.4-.395-1.101-.393-1.499.002a1.05 1.05 0 0 0-.309.751c0 .284.11.55.309.747L18.5 19.993L7.245 31.263a1.064 1.064 0 0 0 .003 1.503c.193.191.466.301.748.301h.006c.283-.001.556-.112.745-.305L20 21.495l11.257 11.27c.199.198.465.308.747.308a1.06 1.06 0 0 0 1.061-1.061c0-.283-.11-.55-.31-.747z" />
    </svg>
  )
}
