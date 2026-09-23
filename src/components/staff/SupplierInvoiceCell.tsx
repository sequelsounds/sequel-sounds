import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { billUploadRecipient, billUploadToken, billUploadUrl, requestBillInvoice } from '../../lib/billUploads'
import { billOverdue, billStage, isMcpsBill, type QboBill } from '../../lib/finance'
import { Modal, ShareIcon } from './RowActions'

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
  const [requesting, setRequesting] = useState(false)

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
  const canRequest = canUpload && !isMcpsBill(bill) && bill.upload_status !== 'review' && bill.upload_status !== 'failed'

  return (
    <>
      <span className="row-field">
        {billStage(bill)}
        {billStage(bill) === 'Awaiting invoice' && bill.upload_requested_at ? ` · requested ${shortDay(bill.upload_requested_at)}` : ''}
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
                {needsReview ? 'Approve' : 'Open'}
              </button>
              <button type="button" className="rf-menu-item" disabled={busy} onClick={copy}>
                {copied ? 'Link copied' : busy ? 'Copying…' : 'Copy link'}
              </button>
              {/* Not for MCPS: that invoice comes from taking out the licence,
                  not from asking for it. Not once an invoice is in. */}
              {canRequest && (
                <button
                  type="button"
                  className="rf-menu-item"
                  onClick={() => {
                    setMenu(false)
                    setRequesting(true)
                  }}
                >
                  Request invoice…
                </button>
              )}
              {note && <span className="rf-menu-note">{note}</span>}
            </div>
          </>
        )}
      </span>
      {requesting && <RequestInvoiceModal bill={bill} onClose={() => setRequesting(false)} />}
    </>
  )
}

const shortDay = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)}`
}

/**
 * REQUEST INVOICE… — says what is about to happen and to whom, and sends only
 * on CONFIRM (Andy, 23 Sep). The address is the app's best guess for the
 * supplier and can be changed here. Like the release form send, it does not
 * close on success: a request that reaches a supplier cannot be taken back, so
 * the modal says where it went.
 */
function RequestInvoiceModal({ bill, onClose }: { bill: QboBill; onClose: () => void }) {
  const qc = useQueryClient()
  const recipient = useQuery({
    queryKey: ['bill-upload-recipient', bill.id],
    queryFn: () => billUploadRecipient(bill.id),
    retry: false,
  })
  const [edited, setEdited] = useState<string | null>(null)
  const to = edited ?? recipient.data?.suggestion?.email ?? ''
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ to: string; cc: string[] } | null>(null)
  const supplier = bill.vendor_name.replace(/\b(GBP|USD|EUR|EURO|SGD|JPY|YEN)\b|[$£€¥]/gi, '').trim()
  const po = bill.invoice_number ? `PO ${bill.invoice_number}` : 'this bill'

  const send = () => {
    if (!to.trim() || sending) return
    setSending(true)
    setError(null)
    requestBillInvoice(bill.id, to.trim())
      .then((r) => {
        setSent({ to: r.sent_to, cc: r.cc })
        void qc.invalidateQueries({ queryKey: ['qbo'] })
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSending(false))
  }

  if (sent) {
    return (
      <Modal onClose={onClose}>
        <div className="rm-header">Invoice requested</div>
        <div className="rm-subheader">
          The request for {po} has gone to {sent.to}
          {sent.cc.length ? ', copied to you' : ''}.
        </div>
        <div className="rm-buttons">
          <button type="button" className="wizard-btn rm-button" onClick={onClose}>
            CLOSE
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} className="am-box cm-box rf-send-box">
      <div className="rm-header">Request invoice</div>
      <div className="rm-subheader">
        {error ??
          `This emails ${supplier || 'the supplier'} asking for their invoice for ${po}, with a link to upload it. A copy comes to you, and so do any replies.`}
      </div>
      <div className="am-form">
        <div className="am-group">
          <label className="am-label" htmlFor="bill-request-to">
            To
          </label>
          <input
            id="bill-request-to"
            type="email"
            className="am-input"
            autoComplete="off"
            placeholder={recipient.isPending ? 'Finding their email…' : 'accounts@supplier.com'}
            value={to}
            onChange={(e) => setEdited(e.target.value)}
          />
        </div>
      </div>
      <div className="rm-buttons">
        <button
          type="button"
          className="wizard-btn rm-button"
          disabled={!to.trim() || sending}
          onClick={send}
        >
          {sending ? 'SENDING…' : 'CONFIRM'}
        </button>
        <button type="button" className="wizard-btn rm-button" onClick={onClose}>
          CANCEL
        </button>
      </div>
    </Modal>
  )
}
