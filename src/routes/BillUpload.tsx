import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import SequelLogo from '../components/SequelLogo'
import { formatMoney } from '../lib/format'
import { useBillUploadPage, useDecideBillUpload, useSubmitBillUpload, type BillUploadPage } from '../lib/billUploads'

/**
 * `/bill-upload/:token` — where a supplier sends us their invoice for a bill
 * (Andy, 23 Sep). Public: the token is the credential. The share page's shell
 * (wordmark bar, one card), so a supplier sees the same Sequel as a client.
 *
 * On upload, the quickbooks edge function reads the invoice and compares it
 * with the bill. Nothing goes to QuickBooks until finance approves it here,
 * with the comparison in front of them (Andy, 23 Sep).
 *
 * ⚠️ A SUPPLIER NEVER SEES THE CHECK. They are told "received" whether it
 * matched or not — whether it needs a second look is Sequel's business.
 */

const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'

function when(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)} ${d.getFullYear()}`
}

function StatusLine({ page }: { page: BillUploadPage }) {
  switch (page.status) {
    case 'attached':
      return <p className="bu-status">Received{page.uploaded_at ? ` ${when(page.uploaded_at)}` : ''}. Thank you.</p>
    case 'received':
      return <p className="bu-status">Received{page.uploaded_at ? ` ${when(page.uploaded_at)}` : ''}. Thank you — our finance team will be in touch if anything is missing.</p>
    case 'review':
      return (
        <p className="bu-status">
          Uploaded {when(page.uploaded_at)}.{' '}
          {page.ai_check?.pass ? 'It matches the bill and is waiting for approval.' : 'It does not match the bill exactly.'}
        </p>
      )
    case 'failed':
      return <p className="bu-status">Uploaded {when(page.uploaded_at)}. It could not be attached in QuickBooks automatically.</p>
    case 'rejected':
      return <p className="bu-status">The last invoice sent here could not be accepted. Please upload a corrected one.</p>
    default:
      return null
  }
}

function Check({ page }: { page: BillUploadPage }) {
  const decide = useDecideBillUpload(useParams().token ?? '')
  const items = page.ai_check?.items ?? []
  return (
    <div className="bu-staff">
      <div className="bu-staff-title">What the check found</div>
      {page.error && <p className="form-error">{page.error}</p>}
      {items.length > 0 && (
        <div className="bu-check">
          <span className="bu-check-head">Check</span>
          <span className="bu-check-head">Bill says</span>
          <span className="bu-check-head">Invoice says</span>
          <span className="bu-check-head" />
          {items.map((i) => (
            <div key={i.key} className="bu-check-row">
              <span>{i.label}{i.required ? '' : ' (for information)'}</span>
              <span>{i.expected}</span>
              <span>{i.found}</span>
              <span className={i.ok ? 'bu-ok' : 'bu-bad'}>{i.ok ? 'Matches' : 'Different'}</span>
            </div>
          ))}
        </div>
      )}
      {page.uploader_note && <p className="bu-note">Note from the uploader: {page.uploader_note}</p>}
      <div className="bu-actions">
        {page.file_url && (
          <a className="bp-button is-ghost" href={page.file_url} target="_blank" rel="noreferrer">
            Open the invoice
          </a>
        )}
        {page.finance && page.file_name && page.status !== 'attached' && (
          <>
            <button
              type="button"
              className={`bp-button${decide.isPending ? ' is-disabled' : ''}`}
              disabled={decide.isPending}
              onClick={() => decide.mutate('attach')}
            >
              Approve and add to QuickBooks
            </button>
            {page.status !== 'rejected' && (
              <button
                type="button"
                className={`bp-button is-ghost${decide.isPending ? ' is-disabled' : ''}`}
                disabled={decide.isPending}
                onClick={() => decide.mutate('reject')}
              >
                Reject
              </button>
            )}
          </>
        )}
      </div>
      {decide.error && <p className="form-error">{decide.error.message}</p>}
    </div>
  )
}

export default function BillUpload() {
  const token = useParams().token ?? ''
  const page = useBillUploadPage(token)
  const submit = useSubmitBillUpload(token)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = 'Sequel | Upload your invoice'
  }, [])

  const p = page.data
  const canUpload = p && (p.status === 'waiting' || p.status === 'rejected' || (p.staff && p.status !== 'attached'))

  return (
    <div className="sf-page">
      <div className="qw-head">
        <SequelLogo wordmark className="qw-logo !h-auto !w-20" />
      </div>

      <div className="sf-main">
        <div className="sf-card">
          {page.isPending && (
            <Loader />
          )}
          {page.error && (
            <div className="sf-error">This link is not valid. It may be incomplete — ask Sequel for a new one.</div>
          )}
          {p && (
            <>
              <div className="sf-header">Upload your invoice</div>
              <div className="sf-name">{p.vendor_name}</div>
              <div className="sf-head">
                <div className="sf-meta">
                  {[
                    // Our invoice number goes out as the PO number: it is what
                    // the supplier quotes, and what matches the bill back.
                    p.invoice_number ? `PO ${p.invoice_number}` : null,
                    p.project_sequel_no ? `Sequel No. ${p.project_sequel_no}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>

              <div className="bu-amount">
                <span className="bu-amount-label">Amount</span>
                <span className="bu-amount-value">{formatMoney(p.total, p.currency)}</span>
              </div>

              <StatusLine page={p} />

              {canUpload && (
                <form
                  className="bu-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (file && !submit.isPending) submit.mutate({ file, note: '' })
                  }}
                >
                  <p className="bu-help">
                    Please make sure your invoice shows
                    {p.invoice_number && p.project_sequel_no
                      ? ` PO ${p.invoice_number} and Sequel No. ${p.project_sequel_no}`
                      : p.invoice_number
                        ? ` PO ${p.invoice_number}`
                        : p.project_sequel_no
                          ? ` Sequel No. ${p.project_sequel_no}`
                          : ' our PO and Sequel No.'}
                    , so we can match it to your payment.
                  </p>
                  {/* The partner inbox's dropzone, one file instead of many. */}
                  <div
                    className={`bu-drop${dragging ? ' is-dragging' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragging(true)
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragging(false)
                      const f = e.dataTransfer.files?.[0]
                      if (f) setFile(f)
                    }}
                    onClick={() => input.current?.click()}
                  >
                    <p className="bu-drop-title">{file ? file.name : 'Drop your invoice here'}</p>
                    <p className="bu-drop-sub">{file ? 'Drop another to replace it' : 'PDF, PNG or JPG — up to 15 MB'}</p>
                    <span className="btn btn-mono btn-outline bu-drop-button">Browse</span>
                    <input
                      ref={input}
                      type="file"
                      accept={ACCEPT}
                      className="hidden"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <div className="bu-actions">
                    <button type="submit" className={`bp-button${!file || submit.isPending ? ' is-disabled' : ''}`} disabled={!file || submit.isPending}>
                      {submit.isPending ? 'Uploading and checking…' : 'Upload invoice'}
                    </button>
                  </div>
                  {submit.error && <p className="form-error">{submit.error.message}</p>}
                </form>
              )}

              {p.staff && p.file_name && <Check page={p} />}
            </>
          )}
        </div>
      </div>

      <div className="qw-foot" />
    </div>
  )
}
