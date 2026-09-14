import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { formatMoney } from '../lib/format'
import { useInvoice, useInvoiceLines } from '../lib/xanoMirror'
import type { InvoiceDetail, InvoiceLine } from '../lib/xanoMirror'

/**
 * One invoice — Sequel Track's `/invoice`, rebuilt. The screen finance uses to
 * check an invoice before it is raised in QuickBooks.
 *
 * ⚠️ READ-ONLY, and that is a scope decision rather than an oversight. Track's
 * version edits every header field, every fee box and every supplier line, and
 * raises the invoice into QuickBooks. None of that is here, because `invoices`
 * and `invoice_line_items` are on the BLOCKED side of the migration: QuickBooks
 * reads them out of Xano, so those tables cannot leave the sync and anything
 * written to them on this side would be deleted on the hour. See §3a of
 * `claude/sequel-track-supabase-migration.md`.
 *
 * What this page is for today is the link several rebuilt pages already want:
 * every bar segment on `/management` and `/dashboard` is one job, and a project
 * invoice row is one job, and until now neither had anywhere to go.
 *
 * ⚠️ EVERY FIGURE IS IN THE INVOICE'S OWN CURRENCY. The reporting pages convert
 * with `exchange_rate_lock` because they sum across invoices; this one shows a
 * single invoice with its own symbol and converts nothing. The sterling figure
 * is shown separately where QuickBooks has supplied one.
 *
 * The three totals are read from the database, never worked out here. Four
 * separate bugs on Track's create form came from a screen and a stored value
 * each implementing the same sum slightly differently, and the rule that came
 * out of it is that Xano's `recompute_invoice_totals` is the only
 * implementation. This page is the display half of that rule.
 */

const TABS = ['Details', 'Sequel fees', 'Supplier costs', 'Cost avoidance'] as const
type Tab = (typeof TABS)[number]

const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function fmtDate(raw: string | null) {
  if (!raw) return '—'
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? '—' : date.format(d)
}

function Stat({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`stat ${className}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

function Row({
  label,
  value,
  note,
  total,
}: {
  label: string
  value: string
  note?: string
  total?: boolean
}) {
  return (
    <div className={`money-row ${total ? 'is-total' : ''}`}>
      <span className="money-row-label">
        {label}
        {note ? <span className="money-row-note">{note}</span> : null}
      </span>
      <span className="money-row-value">{value}</span>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="money-row">
      <span className="money-row-label">{label}</span>
      <span className="money-row-value">{value}</span>
    </div>
  )
}

export default function Invoice() {
  const { uuid } = useParams()
  const invoice = useInvoice(uuid)
  const lines = useInvoiceLines(uuid)
  const [tab, setTab] = useState<Tab>('Details')

  if (invoice.isPending) {
    return (
      <div className="flex flex-1 justify-center py-16">
        <Loader />
      </div>
    )
  }
  if (invoice.error) return <p className="form-error px-8 py-8">{invoice.error.message}</p>
  if (!invoice.data) {
    // Both views ask track_is_staff(), so a client user gets no row rather than
    // an error. Saying "no invoice" to someone who simply may not see it is
    // the honest answer either way: there is nothing here for them.
    return <p className="empty-note py-8">No invoice with that link.</p>
  }

  const v: InvoiceDetail = invoice.data
  const sym = v.currency_symbol ?? ''
  const amt = (n: number | null) => (n === null ? '—' : `${sym}${formatMoney(n)}`)
  // Ten historic invoices carry a fee as a LINE ROW with the header column at
  // zero, so the box is a fold of both. Worth saying on the box, because
  // someone checking this page against the Invoices table would find a zero
  // there — but only on the boxes it is true of, which is why the view returns
  // a folded amount per box rather than one count for the invoice.
  const folded = (fromRows: number) => (fromRows > 0 ? 'incl. line rows' : undefined)

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Invoicing</div>
        <div className="title-row">
          <h1 className="page-title">
            {v.invoice_number ? `Invoice ${v.invoice_number}` : `Invoice ID ${v.id}`}
          </h1>
        </div>
        <div className="page-subtitle">
          {v.project_master_list_id ? (
            <Link to={`/projects/${v.project_master_list_id}`}>
              {v.project_title || 'Untitled project'}
              {v.project_sequel_no ? ` · ${v.project_sequel_no}` : ''}
            </Link>
          ) : (
            'No project'
          )}
        </div>
      </div>

      {/* One flag, from one column, as Xano computes it — so the page and the
          database cannot disagree about whether an invoice is still open. */}
      {v.locked && (
        <div className="locked-banner">
          Raised in QuickBooks{v.qbo_invoice_id ? ` (id ${v.qbo_invoice_id})` : ''}. This is a
          financial record now, and nothing can change it.
        </div>
      )}

      {/* The three totals, in the invoice's own currency.
            to invoice = all Sequel fees + paythrough third-party rows only
            spend      = all Sequel fees + every third-party row
            profit     = all Sequel fees, no third-party rows
          Spend equalling the invoice total is correct, not a fault: it means
          every row was a paythrough, so the client paid for everything through
          Sequel. */}
      <div className="tab-band">
        <Stat label="Total to invoice" value={amt(v.total_to_invoice)} />
        <div className="tab-band-divider" />
        <Stat label="Total spend" value={amt(v.gross_spend)} />
        <div className="tab-band-divider" />
        <Stat label="Profit" value={amt(v.total_sequel_profit)} />
      </div>

      <div className="project-tabs is-plain" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="project-tab"
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pt-8">
        {tab === 'Details' && (
          <div className="money-list">
            <Detail label="Status" value={v.status ?? '—'} />
            <Detail label="Description" value={v.description || 'Untitled invoice'} />
            <Detail label="Client" value={v.client_name ?? '—'} />
            {/* ⚠️ Whoever RAISED the invoice, not whoever owns the project now.
                The column is stamped server-side at submit and never rewritten,
                so a reassigned project does not re-attribute its history. */}
            <Detail label="Raised by" value={v.music_supervisor ?? '—'} />
            <Detail label="Invoice date" value={fmtDate(v.invoice_date)} />
            {/* Null on 148 of 150 — a historic backfill gap, not a missing
                feature. Anything raised through QuickBooks now gets one. */}
            <Detail label="Due date" value={fmtDate(v.due_date)} />
            <Detail label="Currency" value={v.currency ?? '—'} />
            <Detail label="PO number" value={v.po_number || '—'} />
            <Detail
              label="PO attachment"
              value={
                v.po_attachment_url ? (
                  v.po_attachment_url.startsWith('http') ? (
                    <a href={v.po_attachment_url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    // ⚠️ Stored as a RELATIVE Xano vault path, so it only
                    // resolves against the Xano instance. Not linked here
                    // rather than guessing that host — and it is a link that
                    // dies at cutover anyway. The filename is shown so the
                    // file can be found.
                    <span title={v.po_attachment_url}>
                      {v.po_attachment_url.split('/').pop()} (in the Xano vault)
                    </span>
                  )
                ) : (
                  '—'
                )
              }
            />
            <Detail label="AdPro number" value={v.adpro_number || '—'} />
            <Detail label="Usage region" value={v.usage_region || '—'} />
            <Detail label="Territories" value={v.usage_territories || '—'} />
            <Detail label="Song" value={v.song_name || '—'} />
            <Detail label="Artist" value={v.artist_name || '—'} />
            {/* gbp_total_amount is QuickBooks' HomeTotalAmt: sterling,
                INCLUDING VAT. It is not the net total and never was, which is
                why it can read higher than the invoice total on a UK job.
                Zero on every imported invoice, which never went through the
                raise. Labelled rather than renamed. */}
            <Detail
              label="Sterling total (inc. VAT, from QuickBooks)"
              value={v.gbp_total_amount ? `£${formatMoney(v.gbp_total_amount)}` : '—'}
            />
          </div>
        )}

        {tab === 'Sequel fees' && (
          <div className="money-list">
            <Row label="Demo contingency" value={amt(v.demo_contingency_fee)} note={folded(v.demo_contingency_from_rows)} />
            <Row label="Sequel demo fee" value={amt(v.sequel_demo_fee)} note={folded(v.sequel_demo_from_rows)} />
            <Row label="Search contingency" value={amt(v.search_contingency_fee)} note={folded(v.search_contingency_from_rows)} />
            <Row label="Sequel search fee" value={amt(v.sequel_search_fee)} note={folded(v.sequel_search_from_rows)} />
            {/* Two studios fees and two licence fees, one per side, and they do
                NOT merge — they can legitimately differ, and an earlier version
                of Xano's read shim folded both licence rows into master and
                left publishing at zero. */}
            <Row
              label="Master studios fee"
              value={amt(v.master_sequel_studios_fee)}
              note={folded(v.master_studios_from_rows)}
            />
            <Row
              label="Master licence fee"
              value={amt(v.master_sequel_licence_fee)}
              note={folded(v.master_licence_from_rows)}
            />
            <Row
              label="Publishing studios fee"
              value={amt(v.publishing_sequel_studios_fee)}
              note={folded(v.publishing_studios_from_rows)}
            />
            <Row
              label="Publishing licence fee"
              value={amt(v.publishing_sequel_licence_fee)}
              note={folded(v.publishing_licence_from_rows)}
            />
            <Row
              label="Consultancy fee"
              value={amt(v.sequel_consultancy_fee)}
              note={folded(v.consultancy_from_rows)}
            />
            {/* The stored profit, not a sum of the boxes above. If the two ever
                disagree, the database is right and the boxes are the bug. */}
            <Row label="Profit — all Sequel fees" value={amt(v.total_sequel_profit)} total />
          </div>
        )}

        {tab === 'Supplier costs' && (
          <>
            <p className="section-note">
              A paythrough line is one Sequel bills the client for and pays on. A line that is
              not a paythrough is settled by the client direct — Sequel still records the spend,
              so it counts in Total spend but not in Total to invoice. Sequel&rsquo;s own fees
              are not here; they are on the Sequel fees tab.
            </p>
            {lines.isPending && (
              <div className="flex justify-center py-8">
                <Loader />
              </div>
            )}
            {lines.error && <p className="form-error px-8 py-4">{lines.error.message}</p>}
            {lines.data?.length === 0 && <p className="empty-note">No supplier costs.</p>}
            {lines.data?.map((l: InvoiceLine) => (
              <div key={l.id} className="project-row project-row-invoice-line">
                <span className="row-title">{l.supplier || 'No supplier'}</span>
                <span className="row-field">{l.category ?? ''}</span>
                <span className="row-field">{l.is_paythrough ? 'Paythrough' : 'Client direct'}</span>
                <span className="row-field">{l.qbo_bill_id ? 'Billed' : ''}</span>
                <span className="row-field">{amt(l.fee_amount)}</span>
              </div>
            ))}
          </>
        )}

        {tab === 'Cost avoidance' && (
          <>
            <p className="section-note">
              What the client was saved against the original quote. This is money that did not
              move, so it is a reporting figure only and is deliberately in none of the three
              totals above.
            </p>
            <div className="money-list">
              <Row label="Demos" value={amt(v.demo_cost_avoidance)} />
              <Row label="Searches" value={amt(v.search_cost_avoidance)} />
              <Row label="Library Master" value={amt(v.master_cost_avoidance)} />
              <Row label="Publishing" value={amt(v.publishing_cost_avoidance)} />
              <Row label="Other fees" value={amt(v.other_cost_avoidance)} />
              <Row label="Total cost avoidance" value={amt(v.total_cost_avoidance)} total />
            </div>
          </>
        )}
      </div>
    </>
  )
}
