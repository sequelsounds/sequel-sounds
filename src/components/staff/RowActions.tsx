import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useArchiveInvoice } from '../../lib/invoiceEdits'
import { useArchiveProject } from '../../lib/projectWrites'
import { useArchiveQuote } from '../../lib/quoteWrites'
import { useArchiveSupplier } from '../../lib/supplierWrites'
import { useIsFinance } from '../../lib/xanoMirror'
import type { Invoice, Quote } from '../../lib/xanoMirror'

/**
 * The share and delete cells on a project's invoice and estimate rows, and the
 * two modals behind them — the old app's `shareable_invoice_menu` /
 * `shareable_quote_menu` and `Delete_invoice_modal` / `Delete_quote_Modal`,
 * wording and layout read off the staging page.
 *
 * Changes from the old app, all Andy's, 15 Sep:
 *  - An invoice's SHARE copies the link to the invoice's own page. The old app
 *    shared AWS_link, which is empty on every invoice. A quote's share is the
 *    old app's: the quote document, which opens for anyone holding the link.
 *  - DELETE archives, as the old app does, but an invoice already in
 *    QuickBooks can be archived by finance only. The cell is drawn and dead for
 *    everyone else; the database refuses anyway. Quotes: any staff member.
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
  const finance = useIsFinance()
  const archive = useArchiveInvoice(projectId)
  const raised = (invoice.qbo_invoice_id ?? '') !== ''
  return (
    <RowActions
      id={invoice.id}
      what="invoice"
      shareLink={invoice.uuid ? `${window.location.origin}/invoices/${invoice.uuid}` : null}
      shareHeader="Shareable Link Generated"
      shareSubheader="Click copy to share your invoice link"
      canArchive={!raised || finance.data === true}
      inertTitle="In QuickBooks — only finance can delete it"
      archive={archive}
    />
  )
}

export function QuoteRowActions({
  quote,
  projectId,
}: {
  quote: Quote
  projectId: number | undefined
}) {
  const archive = useArchiveQuote(projectId)
  return (
    <RowActions
      id={quote.id}
      what="quote"
      shareLink={quote.uuid ? `${window.location.origin}/quotes/${quote.uuid}` : null}
      shareHeader="Share your quote"
      shareSubheader="Please use this link to share your quote."
      canArchive
      archive={archive}
    />
  )
}

/**
 * The archive cell on the Partners and Roster rows. The old app draws the mark
 * (delete_Partner_button) with nothing behind it; archiving a supplier is new,
 * Andy's call, 15 Sep. Archived suppliers leave both lists and every supplier
 * picker; lines that already point at one keep its name.
 */
export function SupplierArchiveAction({ id }: { id: number }) {
  const [open, setOpen] = useState(false)
  const archive = useArchiveSupplier()
  return (
    <>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Archive this supplier"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            archive.reset()
            setOpen(true)
          }}
        >
          <ArchiveIcon />
        </button>
      </span>
      {open && (
        <ArchiveModal
          header="Are you sure you want to archive this supplier?"
          subheader="It will no longer appear in the supplier lists."
          archive={archive}
          onConfirm={() => archive.mutate(id, { onSuccess: () => setOpen(false) })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * The share and delete cells on a /projects row. Share opens a menu on the
 * icon (Andy, 23 Sep): the internal link is the project's own page, for staff;
 * the external link, for clients, is not built yet. Delete archives, as the
 * old app's delete_project_button does, with its wording.
 */
export function ProjectRowActions({ id }: { id: number }) {
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const archive = useArchiveProject()
  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const close = () => {
    setMenu(false)
    setCopied(false)
    setNote(null)
  }
  const internal = `${window.location.origin}/projects/${id}`
  const copy = () => {
    navigator.clipboard.writeText(internal).then(
      () => {
        setCopied(true)
        window.setTimeout(close, 1200)
      },
      // The browser refuses the clipboard in some contexts: show the link.
      () => setNote(internal),
    )
  }
  return (
    <>
      <span className="row-action rf-menu-wrap">
        <button
          type="button"
          className="row-action-button"
          aria-label="Share this project"
          aria-expanded={menu}
          onClick={(e) => {
            stop(e)
            if (menu) close()
            else setMenu(true)
          }}
        >
          <ShareIcon />
        </button>
        {menu && (
          <>
            <div className="rf-menu-catch" onClick={(e) => { stop(e); close() }} />
            <div className="rf-menu" role="menu" onClick={stop}>
              <button type="button" className="rf-menu-item" onClick={copy}>
                {copied ? 'Link copied' : 'Copy internal link'}
              </button>
              <button type="button" className="rf-menu-item" disabled>
                External link — coming soon
              </button>
              {note && <span className="rf-menu-note">{note}</span>}
            </div>
          </>
        )}
      </span>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Delete this project"
          onClick={(e) => {
            stop(e)
            archive.reset()
            setArchiving(true)
          }}
        >
          <ArchiveIcon />
        </button>
      </span>
      {archiving && (
        <ArchiveModal
          header="Are you sure you want to delete this project?"
          subheader="It will no longer appear in the projects list. Contracts, quotes, invoices, assets and songs attached to it are kept."
          archive={archive}
          onConfirm={() => archive.mutate(id, { onSuccess: () => setArchiving(false) })}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  )
}

export type Archive = {
  mutate: (id: number, opts?: { onSuccess?: () => void }) => void
  isPending: boolean
  error: Error | null
  reset: () => void
}

function RowActions({
  id,
  what,
  shareLink,
  shareHeader,
  shareSubheader,
  canArchive,
  inertTitle,
  archive,
}: {
  id: number
  what: 'invoice' | 'quote'
  shareLink: string | null
  shareHeader: string
  shareSubheader: string
  canArchive: boolean
  inertTitle?: string
  archive: Archive
}) {
  const [sharing, setSharing] = useState(false)
  const [archiving, setArchiving] = useState(false)

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
          aria-label={`Share this ${what}`}
          disabled={!shareLink}
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
          aria-label={`Delete this ${what}`}
          title={canArchive ? undefined : inertTitle}
          disabled={!canArchive}
          onClick={(e) => {
            stop(e)
            if (canArchive) {
              archive.reset()
              setArchiving(true)
            }
          }}
        >
          <ArchiveIcon />
        </button>
      </span>

      {sharing && shareLink && (
        <ShareModal
          link={shareLink}
          header={shareHeader}
          subheader={shareSubheader}
          onClose={() => setSharing(false)}
        />
      )}
      {archiving && (
        <ArchiveModal
          header={`Are you sure you want to delete this ${what}?`}
          subheader="Your client will no longer be able to see it."
          archive={archive}
          onConfirm={() => archive.mutate(id, { onSuccess: () => setArchiving(false) })}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  )
}

export function Modal({
  onClose,
  children,
  className = '',
}: {
  onClose: () => void
  children: React.ReactNode
  /** A modifier on the box — the upload modal is wider and shorter-footed. */
  className?: string
}) {
  return createPortal(
    <div
      className="rm-darken"
      onClick={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`rm-message ${className}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Shared by every row that hands out a 7-day link. `link` is null while one
 *  is still being generated — contracts mint theirs on the click, invoices and
 *  quotes already hold one. */
export function ShareModal({
  link,
  header,
  subheader,
  onClose,
  status,
  extra,
}: {
  link: string | null
  header: string
  subheader: string
  onClose: () => void
  /** What to show in place of the link until there is one. */
  status?: string
  /** Anything else this row can do with the document — a release form offers
   *  to send or download it from here rather than from inside its form. */
  extra?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Modal onClose={onClose}>
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">{header}</div>
      <div className="rm-subheader">{subheader}</div>
      <div className="rm-buttons">
        <div className="rm-link">{link ?? status ?? 'Generating link…'}</div>
        <button
          type="button"
          className="wizard-btn rm-copy"
          disabled={!link}
          onClick={() => {
            if (!link) return
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
      {extra}
    </Modal>
  )
}

export function ArchiveModal({
  header,
  subheader,
  archive,
  onConfirm,
  onClose,
}: {
  header: string
  subheader: string
  /* Only the two things the modal draws. `onConfirm` does the mutating, so
     this does not care whether the row is keyed by id or by uuid. */
  archive: { isPending: boolean; error: Error | null }
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose}>
      <div className="rm-header">{header}</div>
      <div className="rm-subheader">{subheader}</div>
      {archive.error && <p className="form-error">{archive.error.message}</p>}
      <div className="rm-buttons">
        {/* Closes only once the archive has worked — the old app learned
            that a modal closing on a failed archive looks like a success. */}
        <button
          type="button"
          className="wizard-btn rm-button"
          disabled={archive.isPending}
          onClick={onConfirm}
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
export function ShareIcon() {
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
export function ArchiveIcon() {
  return (
    <svg width="1rem" height="1rem" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true">
      <path d="M21.499 19.994L32.755 8.727a1.064 1.064 0 0 0-.001-1.502c-.398-.396-1.099-.398-1.501.002L20 18.494L8.743 7.224c-.4-.395-1.101-.393-1.499.002a1.05 1.05 0 0 0-.309.751c0 .284.11.55.309.747L18.5 19.993L7.245 31.263a1.064 1.064 0 0 0 .003 1.503c.193.191.466.301.748.301h.006c.283-.001.556-.112.745-.305L20 21.495l11.257 11.27c.199.198.465.308.747.308a1.06 1.06 0 0 0 1.061-1.061c0-.283-.11-.55-.31-.747z" />
    </svg>
  )
}
