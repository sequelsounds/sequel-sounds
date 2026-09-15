import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { formatMoney } from '../lib/format'
import { useInvoice, useInvoiceLines } from '../lib/xanoMirror'
import { isS3PoKey, signPoRead, useInvoiceLookups, USAGE_REGIONS } from '../lib/invoiceWrites'
import {
  LINE_CATEGORIES,
  useAddInvoiceLine,
  useDeleteInvoiceLine,
  useUpdateInvoice,
  useUpdateInvoiceLine,
} from '../lib/invoiceEdits'
import { EditEnum, EditField, EditSelect } from '../components/staff/EditField'
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

/**
 * The nine fee boxes, in the order the old page shows them.
 *
 * ⚠️ Two studios fees and two licence fees, one per side, and they do NOT
 * merge. They can legitimately differ, and an earlier version of Xano's read
 * shim folded both licence rows into master and left publishing at zero. That
 * they are one commission conceptually is a statement about the fee, not an
 * instruction about the screen — it has been read as the latter twice.
 */
const FEE_BOXES: { label: string; column: string; fromRows: string }[] = [
  { label: 'Demo contingency', column: 'demo_contingency_fee', fromRows: 'demo_contingency_from_rows' },
  { label: 'Sequel demo fee', column: 'sequel_demo_fee', fromRows: 'sequel_demo_from_rows' },
  { label: 'Search contingency', column: 'search_contingency_fee', fromRows: 'search_contingency_from_rows' },
  { label: 'Sequel search fee', column: 'sequel_search_fee', fromRows: 'sequel_search_from_rows' },
  { label: 'Master studios fee', column: 'master_sequel_studios_fee', fromRows: 'master_studios_from_rows' },
  { label: 'Master licence fee', column: 'master_sequel_licence_fee', fromRows: 'master_licence_from_rows' },
  { label: 'Publishing studios fee', column: 'publishing_sequel_studios_fee', fromRows: 'publishing_studios_from_rows' },
  { label: 'Publishing licence fee', column: 'publishing_sequel_licence_fee', fromRows: 'publishing_licence_from_rows' },
  { label: 'Consultancy fee', column: 'sequel_consultancy_fee', fromRows: 'consultancy_from_rows' },
]

const AVOIDANCE_BOXES: { label: string; column: string }[] = [
  { label: 'Demos', column: 'demo_cost_avoidance' },
  { label: 'Searches', column: 'search_cost_avoidance' },
  { label: 'Library Master', column: 'master_cost_avoidance' },
  { label: 'Publishing', column: 'publishing_cost_avoidance' },
  { label: 'Other fees', column: 'other_cost_avoidance' },
]
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

/**
 * A fee box that saves itself.
 *
 * Built on EditField rather than beside it, so the save state, the revert on
 * refusal and the blur race are the ones already proven on the supplier pages.
 * The value is handed over as plain digits — the grouped display belongs to
 * the read-only view, and a thousands separator sent to a numeric column is
 * how the old form silently stored 0 on a valid 200.
 */
function MoneyField({
  label,
  value,
  note,
  onSave,
}: {
  label: string
  value: number | null
  note?: string
  onSave: (next: number) => Promise<unknown>
}) {
  return (
    <div className="money-row is-editable">
      <EditField
        label={note ? `${label} (${note})` : label}
        value={value === null ? '' : String(value)}
        onSave={(next) => {
          const n = Number((next ?? '').replace(/[^\d.-]/g, ''))
          // ⚠️ A blank box is zero, not "leave it alone". Clearing a fee back
          // to zero has to be possible, and 0 is not null so it still saves.
          return onSave(Number.isFinite(n) ? n : 0)
        }}
      />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="money-row has-rule">
      <span className="money-row-label">{label}</span>
      <span className="money-row-value">{value}</span>
    </div>
  )
}

/**
 * The PO attachment, which arrives in one of three shapes.
 *
 *   an `invoices/po/…` key  — this app's own, in S3. Signed on demand.
 *   an absolute http URL    — a migrated SharePoint row's AWS_link.
 *   anything else           — a RELATIVE Xano vault path, on the 147 imported
 *                             invoices. It resolves only against the Xano
 *                             instance and dies at cutover, so it is named
 *                             rather than linked.
 *
 * ⚠️ The S3 URL is signed WHEN CLICKED, never stored. A presigned URL lasts
 * fifteen minutes; putting one in the column would give every invoice a dead
 * link by the afternoon.
 */
function PoAttachment({ url }: { url: string | null }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!url) return <>—</>

  if (isS3PoKey(url)) {
    return (
      <>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setFailed(false)
            try {
              window.open(await signPoRead(url), '_blank', 'noreferrer')
            } catch {
              setFailed(true)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Opening…' : 'Open'}
        </button>
        {failed && <span className="form-error"> could not be opened</span>}
      </>
    )
  }

  if (url.startsWith('http')) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        Open
      </a>
    )
  }

  return <span title={url}>{url.split('/').pop()} (in the Xano vault)</span>
}

export default function Invoice() {
  const { uuid } = useParams()
  const invoice = useInvoice(uuid)
  const lines = useInvoiceLines(uuid)
  const lookups = useInvoiceLookups()
  const updateInvoice = useUpdateInvoice(invoice.data?.id, uuid)
  const addLine = useAddInvoiceLine(invoice.data?.id, uuid)
  const updateLine = useUpdateInvoiceLine(uuid)
  const deleteLine = useDeleteInvoiceLine(uuid)
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

  /** Any box that is a fold of a column and a row cannot be written back. */
  const feeRowsFolded = FEE_BOXES.some(
    (b) => ((v as unknown as Record<string, number>)[b.fromRows] ?? 0) > 0,
  )

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Finance</div>
        <div className="title-row">
          <h1 className="page-title">
            {v.invoice_number ? `Invoice ${v.invoice_number}` : `Invoice ID ${v.id}`}
          </h1>
          {/* Where the invoice stands, in one of the app's button squares —
              Andy, 15 Sep, in place of the old "Raised in QuickBooks" banner.
              RAISED keys off the same single flag every write refuses on. */}
          <span className="btn btn-mono btn-outline invoice-state">
            {v.status === 'Paid' ? 'PAID' : v.locked ? 'RAISED' : 'NOT RAISED'}
          </span>
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

      {/* The three totals, in the invoice's own currency.
            to invoice = all Sequel fees + paythrough third-party rows only
            spend      = all Sequel fees + every third-party row
            profit     = all Sequel fees, no third-party rows
          Spend equalling the invoice total is correct, not a fault: it means
          every row was a paythrough, so the client paid for everything through
          Sequel. */}
      <div className="tab-band">
        <Stat label="Total to invoice" value={amt(v.total_to_invoice)} className="ml-0" />
        <div className="tab-band-divider" />
        <Stat label="Total spend" value={amt(v.gross_spend)} />
        <div className="tab-band-divider" />
        <Stat label="Profit" value={amt(v.total_sequel_profit)} />
        <div className="tab-band-divider" />
        <Stat label="Status" value={v.status ?? '—'} />
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
            {v.locked ? (
              <>
                <Detail label="Description" value={v.description || 'Untitled invoice'} />
                <Detail label="Client" value={v.client_name ?? '—'} />
              </>
            ) : (
              <>
                <div className="money-row is-editable">
                  <EditField
                    label="Description"
                    value={v.description}
                    onSave={(next) => updateInvoice.mutateAsync({ description: next ?? '' })}
                  />
                </div>
                <div className="money-row is-editable">
                  <EditSelect
                    label="Client"
                    value={v.client_id}
                    options={lookups.data?.clients ?? []}
                    onSave={(next) => updateInvoice.mutateAsync({ clientId: next })}
                  />
                </div>
              </>
            )}
            {/* ⚠️ Whoever RAISED the invoice, not whoever owns the project now.
                The column is stamped server-side at submit and never rewritten,
                so a reassigned project does not re-attribute its history. */}
            <Detail label="Raised by" value={v.music_supervisor ?? '—'} />
            <Detail label="Invoice date" value={fmtDate(v.invoice_date)} />
            {/* Null on 148 of 150 — a historic backfill gap, not a missing
                feature. Anything raised through QuickBooks now gets one. */}
            <Detail label="Due date" value={fmtDate(v.due_date)} />
            <Detail label="QuickBooks ID" value={v.qbo_invoice_id || '—'} />
            {v.locked ? (
              <>
                <Detail label="Currency" value={v.currency ?? '—'} />
                <Detail label="PO number" value={v.po_number || '—'} />
                <Detail label="PO attachment" value={<PoAttachment url={v.po_attachment_url} />} />
                <Detail label="AdPro number" value={v.adpro_number || '—'} />
                <Detail label="Usage region" value={v.usage_region || '—'} />
                <Detail label="Territories" value={v.usage_territories || '—'} />
                <Detail label="Song" value={v.song_name || '—'} />
                <Detail label="Artist" value={v.artist_name || '—'} />
              </>
            ) : (
              <>
                {/* ⚠️ Changing the currency REINTERPRETS every figure on the
                    invoice — nothing converts. Editable anyway, as on the old
                    page, because the alternative is re-keying the invoice when
                    it was raised in the wrong one. */}
                <div className="money-row is-editable">
                  <EditSelect
                    label="Currency"
                    value={v.currency_id}
                    options={lookups.data?.currencies ?? []}
                    onSave={(next) => updateInvoice.mutateAsync({ currencyId: next })}
                  />
                </div>
                <div className="money-row is-editable">
                  <EditField
                    label="PO number"
                    value={v.po_number}
                    onSave={(next) => updateInvoice.mutateAsync({ poNumber: next ?? '' })}
                  />
                </div>
                <Detail label="PO attachment" value={<PoAttachment url={v.po_attachment_url} />} />
                <Detail label="AdPro number" value={v.adpro_number || '—'} />
                <div className="money-row is-editable">
                  {/* ⚠️ Ten values and Xano rejects anything else, taking the
                      whole write with it rather than just the field. */}
                  <EditEnum
                    label="Usage region"
                    value={v.usage_region}
                    options={USAGE_REGIONS}
                    onSave={(next) => updateInvoice.mutateAsync({ usageRegion: next ?? '' })}
                  />
                </div>
                <div className="money-row is-editable">
                  <EditField
                    label="Territories"
                    value={v.usage_territories}
                    onSave={(next) => updateInvoice.mutateAsync({ usageTerritories: next ?? '' })}
                  />
                </div>
                <div className="money-row is-editable">
                  <EditField
                    label="Song"
                    value={v.song_name}
                    onSave={(next) => updateInvoice.mutateAsync({ songName: next ?? '' })}
                  />
                </div>
                <div className="money-row is-editable">
                  <EditField
                    label="Artist"
                    value={v.artist_name}
                    onSave={(next) => updateInvoice.mutateAsync({ artistName: next ?? '' })}
                  />
                </div>
              </>
            )}
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

        {tab === 'Sequel fees' && !v.locked && (
          <div className="money-list">
            {/* ⚠️ A box cannot be edited on an invoice whose fees are LINE
                ROWS — the box shows column plus rows folded together, so
                writing it back to the column counts the money twice. The
                database refuses it; this is only the explanation. */}
            {feeRowsFolded && (
              <p className="section-note">
                This invoice holds some of its Sequel fees as line rows, so the boxes below
                cannot be edited here.
              </p>
            )}
            {FEE_BOXES.map((box) => (
              <MoneyField
                key={box.column}
                label={box.label}
                value={(v as unknown as Record<string, number>)[box.column]}
                note={folded((v as unknown as Record<string, number>)[box.fromRows])}
                onSave={(n) => updateInvoice.mutateAsync({ fees: { [box.column]: n } })}
              />
            ))}
            {updateInvoice.error && <p className="form-error">{updateInvoice.error.message}</p>}
            {/* The stored profit, not a sum of the boxes above. If the two ever
                disagree, the database is right and the boxes are the bug. */}
            <Row label="Profit — all Sequel fees" value={amt(v.total_sequel_profit)} total />
          </div>
        )}

        {tab === 'Sequel fees' && v.locked && (
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
            {lines.isPending && (
              <div className="flex justify-center py-8">
                <Loader />
              </div>
            )}
            {lines.error && <p className="form-error px-8 py-4">{lines.error.message}</p>}
            {lines.data?.length === 0 && <p className="empty-note">No supplier costs.</p>}

            {/* Read-only once the invoice is in QuickBooks. The page hides its
                controls off the same single flag the endpoints refuse on, so
                the two cannot disagree — and a stale tab is refused anyway. */}
            {v.locked &&
              lines.data?.map((l: InvoiceLine) => (
                <div key={l.id} className="project-row project-row-invoice-line">
                  <span className="row-title">{l.supplier || 'No supplier'}</span>
                  <span className="row-field">{l.category ?? ''}</span>
                  <span className="row-field">{l.is_paythrough ? 'Paythrough' : 'Non-Paythrough'}</span>
                  <span className="row-field">{l.qbo_bill_id ? 'Billed' : ''}</span>
                  <span className="row-field">{amt(l.fee_amount)}</span>
                </div>
              ))}

            {!v.locked && (
              <>
                {lines.data?.map((l: InvoiceLine) => (
                  <div key={l.id} className="invoice-line-edit">
                    <select
                      className="edit-field-input"
                      aria-label="Supplier"
                      value={l.supplier_id ?? ''}
                      onChange={(e) =>
                        void updateLine.mutateAsync({
                          lineId: l.id,
                          supplierId: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    >
                      {/* A placeholder may be selected, never disabled — a
                          disabled option cannot be displayed, so the browser
                          falls through to the first real supplier and an
                          unanswered select looks answered. */}
                      <option value="">Select supplier</option>
                      {(lookups.data?.suppliers ?? []).map((sup) => (
                        <option key={sup.id} value={sup.id}>
                          {sup.label}
                        </option>
                      ))}
                    </select>

                    <select
                      className="edit-field-input"
                      aria-label="Category"
                      value={l.category ?? ''}
                      onChange={(e) =>
                        void updateLine.mutateAsync({ lineId: l.id, category: e.target.value })
                      }
                    >
                      {LINE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>

                    <select
                      className="edit-field-input"
                      aria-label="Paythrough"
                      value={l.is_paythrough ? 'true' : 'false'}
                      onChange={(e) =>
                        void updateLine.mutateAsync({
                          lineId: l.id,
                          paythrough: e.target.value === 'true',
                        })
                      }
                    >
                      <option value="true">Paythrough</option>
                      <option value="false">Non-Paythrough</option>
                    </select>

                    <input
                      className="edit-field-input text-right"
                      aria-label="Amount"
                      inputMode="decimal"
                      defaultValue={l.fee_amount === null ? '' : String(l.fee_amount)}
                      onBlur={(e) => {
                        const n = Number(e.target.value.replace(/[^\d.-]/g, ''))
                        void updateLine.mutateAsync({
                          lineId: l.id,
                          amount: Number.isFinite(n) ? n : 0,
                        })
                      }}
                    />

                    <button
                      type="button"
                      className="qw-fee-delete"
                      aria-label="Remove this line"
                      onClick={() => void deleteLine.mutateAsync(l.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}

                <div className="px-8 py-6">
                  <button
                    type="button"
                    className="btn btn-mono btn-outline w-auto whitespace-nowrap"
                    disabled={addLine.isPending}
                    onClick={() => void addLine.mutateAsync('Demos')}
                  >
                    {addLine.isPending ? 'ADDING…' : '+ ADD SUPPLIER COST'}
                  </button>
                </div>

                {(updateLine.error || deleteLine.error || addLine.error) && (
                  <p className="form-error px-8">
                    {(updateLine.error ?? deleteLine.error ?? addLine.error)?.message}
                  </p>
                )}
              </>
            )}
          </>
        )}

        {tab === 'Cost avoidance' && (
          <>
            <div className="money-list">
              {v.locked ? (
                <>
                  <Row label="Demos" value={amt(v.demo_cost_avoidance)} />
                  <Row label="Searches" value={amt(v.search_cost_avoidance)} />
                  <Row label="Library Master" value={amt(v.master_cost_avoidance)} />
                  <Row label="Publishing" value={amt(v.publishing_cost_avoidance)} />
                  <Row label="Other fees" value={amt(v.other_cost_avoidance)} />
                </>
              ) : (
                AVOIDANCE_BOXES.map((box) => (
                  <MoneyField
                    key={box.column}
                    label={box.label}
                    value={(v as unknown as Record<string, number>)[box.column]}
                    onSave={(n) => updateInvoice.mutateAsync({ fees: { [box.column]: n } })}
                  />
                ))
              )}
              <Row label="Total cost avoidance" value={amt(v.total_cost_avoidance)} total />
            </div>
          </>
        )}
      </div>
    </>
  )
}
