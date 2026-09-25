import { Link } from 'react-router-dom'
import { Loader } from '../Loader'
import { formatMoney } from '../../lib/format'
import { useSupplierInvoices } from '../../lib/xanoMirror'

/**
 * The invoices a supplier appears on, for the tab that used to say "Projects".
 *
 * Shared by `/partners/:uuid` and `/roster/:uuid` because it is the same list
 * on both — the two pages differ in their fields, not in this.
 *
 * ⚠️ Track's version of this tab has NO MARKUP AT ALL, on either page. Not an
 * empty state, not a heading — nothing was ever built. So there is nothing to
 * reproduce here and this is Andy's shape: invoices rather than projects,
 * because an invoice line is the only place a supplier is named.
 *
 * Every row opens the invoice. An anchor rather than a click handler, so
 * middle-click and open-in-new-tab work, the same as the project lists and the
 * chart segments.
 */

const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })

function when(raw: string | null) {
  if (!raw) return ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? '' : date.format(d)
}

export function SupplierInvoices({ supplierId }: { supplierId: number | undefined }) {
  const invoices = useSupplierInvoices(supplierId)

  if (invoices.isPending) {
    return (
      <Loader />
    )
  }
  if (invoices.error) return <p className="form-error px-8 py-4">{invoices.error.message}</p>
  if (invoices.data.length === 0) {
    return <p className="empty-note">Not on any invoice yet.</p>
  }

  return (
    <>
      <div className="project-row project-row-supplier-invoice is-head">
        <span className="project-list-head-cell">Project</span>
        <span className="project-list-head-cell">Invoice</span>
        <span className="project-list-head-cell">Date</span>
        <span className="project-list-head-cell">Status</span>
        <span className="project-list-head-cell">Their fee</span>
      </div>
      {invoices.data.map((r) => (
        <Link
          key={r.invoice_id}
          to={`/invoices/${r.invoice_uuid}`}
          className="project-row project-row-supplier-invoice"
        >
          <span className="row-title" title={r.project_title ?? undefined}>
            {r.project_title || r.description || 'Untitled'}
          </span>
          <span className="row-field">{r.invoice_number || `ID ${r.invoice_id}`}</span>
          <span className="row-field">{when(r.invoice_date)}</span>
          <span className="row-field">{r.status ?? ''}</span>
          {/* The invoice's own currency, with its symbol — the Fees tile above
              is sterling because it sums across invoices and this does not. */}
          <span className="row-field">
            {r.currency_symbol ?? ''}
            {formatMoney(r.supplier_amount)}
          </span>
        </Link>
      ))}
    </>
  )
}
