import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { billUploadToken, billUploadUrl } from '../../lib/billUploads'
import { billOverdue, billStage, type QboBill } from '../../lib/finance'
import { ShareIcon } from './RowActions'

/** upload, 1rem, stroke 1.5 — drawn to sit beside the share icon. */
function UploadIcon() {
  return (
    <svg width="1rem" height="1rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

/**
 * The bill's stage (see billStage) on a bill row, and its share menu — the same
 * share icon and small menu as a release form row (Andy, 23 Sep), so it reads
 * as one app. The menu opens the upload page or copies its link; the link is
 * made the first time either is used.
 *
 * Renders THREE cells: the status, the upload action, the share action. The row around them is
 * itself a link, so every click here stops there.
 */

export function SupplierInvoiceCell({ bill }: { bill: QboBill }) {
  const qc = useQueryClient()
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const close = () => {
    setMenu(false)
    setCopied(false)
    setNote(null)
  }

  const token = async () => {
    if (bill.upload_token) return bill.upload_token
    const t = await billUploadToken(bill.id)
    void qc.invalidateQueries({ queryKey: ['qbo'] })
    return t
  }
  const link = async () => billUploadUrl(await token())

  const copy = () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    link()
      .then(async (url) => {
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          window.setTimeout(close, 1200)
        } catch {
          // The browser refuses the clipboard in some contexts. The link exists
          // either way, so show it rather than lose it.
          setNote(url)
        }
      })
      .catch((e: Error) => setNote(e.message))
      .finally(() => setBusy(false))
  }

  // ⚠️ The tab is opened on the click, blank, and pointed at the page when the
  // link arrives. One opened after the await is a pop-up and is blocked.
  const open = () => {
    const tab = window.open('about:blank', '_blank')
    link()
      .then((url) => {
        if (tab && !tab.closed) tab.location.href = url
        close()
      })
      .catch((e: Error) => {
        if (tab && !tab.closed) tab.close()
        setNote(e.message)
      })
  }

  const needsReview = bill.upload_status === 'review' || bill.upload_status === 'failed'
  const canUpload = !bill.has_supplier_invoice && bill.upload_status !== 'attached' && bill.balance > 0

  return (
    <>
      <span className="row-field">
        {billStage(bill)}
        {billOverdue(bill) ? ' · overdue' : ''}
      </span>
      {/* Upload: opens the same page the supplier's link opens, where staff
          upload it signed in (Andy, 23 Sep). Gone once the invoice is in. */}
      <span className="row-action">
        {canUpload && (
          <button
            type="button"
            className="row-action-button"
            aria-label="Upload the supplier's invoice"
            title="Upload invoice"
            onClick={(e) => {
              stop(e)
              open()
            }}
          >
            <UploadIcon />
          </button>
        )}
      </span>
      <span className="row-action rf-menu-wrap">
        <button
          type="button"
          className="row-action-button"
          aria-label="Share the supplier invoice upload page"
          aria-expanded={menu}
          onClick={(e) => {
            stop(e)
            setMenu((m) => !m)
          }}
        >
          <ShareIcon />
        </button>
        {menu && (
          <>
            <div className="rf-menu-catch" onClick={(e) => { stop(e); close() }} />
            <div className="rf-menu" role="menu" onClick={stop}>
              <button type="button" className="rf-menu-item" onClick={open}>
                {needsReview ? 'Review' : 'Open'}
              </button>
              <button type="button" className="rf-menu-item" disabled={busy} onClick={copy}>
                {copied ? 'Link copied' : busy ? 'Copying…' : 'Copy link'}
              </button>
              {note && <span className="rf-menu-note">{note}</span>}
            </div>
          </>
        )}
      </span>
    </>
  )
}
