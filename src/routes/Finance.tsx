import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { formatMoney } from '../lib/format'
import {
  billStageOf,
  stageOf,
  useAllInvoices,
  useBillLinks,
  usePaymentTimes,
  useQboBills,
  type FinanceInvoice,
  type Stage,
} from '../lib/finance'
import { useIsFinance } from '../lib/xanoMirror'

/**
 * Finance — `/invoices`.
 *
 * ⚠️ NOT A REBUILD. The old app's nav links to `/finance` and the page does
 * not exist (a Webflow 404), so there was nothing to copy. What is here was
 * agreed with Andy on 15 Sep: client invoices and supplier bills, switched by
 * an INVOICES / BILLS toggle in the top right, and the average time each client takes to pay. It is built from the
 * pieces the other list pages already use — the header band, the counters
 * band, the filter tabs and the projects list row — so it looks like the
 * rest of the app.
 *
 * Read only. `invoices` is still a synced table, so nothing here writes.
 */

/** The switch in the top right — Andy, 15 Sep: INVOICES and BILLS, styled as
 *  the Management page's year toggle. */
const TABS = ['Invoices', 'Bills'] as const
type Tab = (typeof TABS)[number]

const FILTERS = ['All', 'To raise', 'Awaiting payment', 'Overdue', 'Paid', 'Payment times'] as const
type Filter = (typeof FILTERS)[number]

/** "04 Sep 26", the date format the other rows use. */
const shortDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
function fmtDate(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : shortDate.format(d)
}

const days = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n)}`)

function Counter({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function Finance() {
  const [tab, setTab] = useState<Tab>('Invoices')

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Finance</div>
        <div className="title-row">
          <h1 className="page-title">{tab === 'Invoices' ? 'Invoices' : 'Bills'}</h1>
          <div className="year-toggle finance-toggle" role="tablist" aria-label="Invoices or bills">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`year-btn ${tab === t ? 'is-on' : ''}`}
                onClick={() => setTab(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="page-subtitle">Money in and money out.</div>
      </div>

      {tab === 'Invoices' && <ClientInvoices />}
      {tab === 'Bills' && <SupplierBills />}
    </>
  )
}

function ClientInvoices() {
  const invoices = useAllInvoices()
  const finance = useIsFinance()
  const isFinance = finance.data === true
  const times = usePaymentTimes(isFinance)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('All')

  const all = useMemo(() => invoices.data ?? [], [invoices.data])

  // The counters are the whole list, like /clients — they do not follow the
  // search or the tab.
  const count = (s: Stage) => all.filter((i) => stageOf(i) === s).length

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all.filter((i: FinanceInvoice) => {
      if (filter !== 'All' && filter !== 'Payment times' && stageOf(i) !== filter) return false
      if (!term) return true
      return [i.invoice_number, i.client_name, i.project_title, i.project_sequel_no, i.description, i.status]
        .some((v) => (v ?? '').toLowerCase().includes(term))
    })
  }, [all, q, filter])

  const payRows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = times.data?.clients ?? []
    return term ? list.filter((c) => c.name.toLowerCase().includes(term)) : list
  }, [times.data, q])

  const filters = FILTERS.filter((f) => f !== 'Payment times' || isFinance)

  return (
    <>
      <div className="tab-band">
        <div className="tab-band-search is-narrow">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search invoices"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        <Counter label="To raise" value={count('To raise')} />
        <div className="tab-band-divider" />
        <Counter label="Awaiting payment" value={count('Awaiting payment')} />
        <div className="tab-band-divider" />
        <Counter label="Overdue" value={count('Overdue')} />
        <div className="tab-band-divider" />
        <Counter label="Paid" value={count('Paid')} />
        {isFinance && (
          <>
            <div className="tab-band-divider" />
            <Counter
              label="Avg days to pay"
              value={times.data?.overall ? days(times.data.overall.avg_days_to_pay) : ''}
            />
          </>
        )}
      </div>

      <div className="filter-tabs" role="tablist" aria-label="Invoices">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className="filter-tab"
            onClick={() => setFilter(f)}
          >
            <span className="filter-tab-text">{f}</span>
          </button>
        ))}
      </div>

      {filter === 'Payment times' ? (
        <>
          <div className="finance-grid finance-pay-grid project-list-head finance-head">
            <span className="project-list-head-cell">Client (QuickBooks)</span>
            <span className="project-list-head-cell">Paid invoices</span>
            <span className="project-list-head-cell">Avg days to pay</span>
            <span className="project-list-head-cell">Avg days past due</span>
            <span className="project-list-head-cell">Unpaid now</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {times.isPending && (
              <div className="flex justify-center py-16">
                <Loader />
              </div>
            )}
            {times.error && <p className="form-error px-8 py-4">{times.error.message}</p>}
            {times.data && !times.data.connected && (
              <div className="no-result-row">{times.data.error ?? 'QuickBooks is not connected.'}</div>
            )}
            {payRows.map((c) => (
              <div key={c.id} className="finance-grid finance-pay-grid finance-row">
                <span className="project-list-title" title={c.name}>
                  {c.name}
                </span>
                <span className="project-list-cell">{c.paid_invoices}</span>
                <span className="project-list-cell">{days(c.avg_days_to_pay)}</span>
                <span className="project-list-cell">{days(c.avg_days_late)}</span>
                <span className="project-list-cell">{c.open_invoices}</span>
              </div>
            ))}
            {times.data?.connected && payRows.length === 0 && (
              <div className="no-result-row">No results found.</div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="finance-grid project-list-head finance-head">
            <span className="project-list-head-cell">Number</span>
            <span className="project-list-head-cell">Date</span>
            <span className="project-list-head-cell">Client</span>
            <span className="project-list-head-cell">Project</span>
            <span className="project-list-head-cell">Description</span>
            <span className="project-list-head-cell">Total</span>
            <span className="project-list-head-cell">Due</span>
            <span className="project-list-head-cell">Status</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {invoices.isPending && (
              <div className="flex justify-center py-16">
                <Loader />
              </div>
            )}
            {invoices.error && <p className="form-error px-8 py-4">{invoices.error.message}</p>}
            {rows.map((i) => {
              const stage = stageOf(i)
              return (
                <div
                  key={i.id}
                  className="finance-grid finance-row"
                  onClick={() => i.uuid && navigate(`/invoices/${i.uuid}`)}
                >
                  <span className="project-list-title">{i.invoice_number || '—'}</span>
                  <span className="project-list-cell">{fmtDate(i.invoice_date ?? i.created_at)}</span>
                  <span className="project-list-cell" title={i.client_name ?? undefined}>
                    {i.client_name}
                  </span>
                  <span className="project-list-cell" title={i.project_title ?? undefined}>
                    {i.project_title}
                  </span>
                  <span className="project-list-cell" title={i.description ?? undefined}>
                    {i.description}
                  </span>
                  <span className="project-list-cell">{formatMoney(i.total_to_invoice, i.currency)}</span>
                  <span className="project-list-cell">{fmtDate(i.due_date)}</span>
                  <span className="project-list-cell">
                    {stage === 'Overdue' || stage === 'To raise' ? stage : (i.status ?? stage)}
                  </span>
                </div>
              )
            })}
            {invoices.data && rows.length === 0 && <div className="no-result-row">No results found.</div>}
          </div>
        </>
      )}
    </>
  )
}

const BILL_FILTERS = ['All', 'No supplier invoice', 'Unpaid', 'Overdue', 'Paid'] as const
type BillFilter = (typeof BILL_FILTERS)[number]

/**
 * Supplier bills, read from QuickBooks — every bill, not only the ones the app
 * raised. "No supplier invoice" is a bill with nothing attached: the list the
 * supplier upload emails will work through (Andy, 15 Sep). A row opens the
 * bill in QuickBooks; the Invoice cell is filled where the app raised it.
 */
function SupplierBills() {
  const finance = useIsFinance()
  const isFinance = finance.data === true
  const bills = useQboBills(isFinance)
  const links = useBillLinks()
  const invoices = useAllInvoices()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<BillFilter>('All')

  const all = useMemo(() => bills.data?.bills ?? [], [bills.data])
  const byId = useMemo(() => new Map((invoices.data ?? []).map((i) => [i.id, i])), [invoices.data])
  const invoiceFor = (billId: string) => {
    const invoiceId = links.data?.get(billId)
    return invoiceId != null ? byId.get(invoiceId) : undefined
  }

  const rows = all.filter((b) => {
    if (filter === 'No supplier invoice' && b.has_supplier_invoice) return false
    if ((filter === 'Unpaid' || filter === 'Overdue' || filter === 'Paid') && billStageOf(b) !== filter) return false
    const term = q.trim().toLowerCase()
    if (!term) return true
    const inv = invoiceFor(b.id)
    return [b.vendor_name, b.doc_number, inv?.invoice_number, inv?.project_title, inv?.client_name]
      .some((v) => (v ?? '').toLowerCase().includes(term))
  })

  if (finance.isPending) return null
  if (!isFinance) return <div className="no-result-row">Only finance can see bills.</div>

  const noFile = all.filter((b) => !b.has_supplier_invoice).length

  return (
    <>
      <div className="tab-band">
        <div className="tab-band-search is-narrow">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search bills"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        <Counter label="No supplier invoice" value={bills.data ? noFile : ''} />
        <div className="tab-band-divider" />
        <Counter label="Unpaid" value={bills.data ? all.filter((b) => billStageOf(b) === 'Unpaid').length : ''} />
        <div className="tab-band-divider" />
        <Counter label="Overdue" value={bills.data ? all.filter((b) => billStageOf(b) === 'Overdue').length : ''} />
        <div className="tab-band-divider" />
        <Counter label="Paid" value={bills.data ? all.filter((b) => billStageOf(b) === 'Paid').length : ''} />
      </div>

      <div className="filter-tabs" role="tablist" aria-label="Bills">
        {BILL_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className="filter-tab"
            onClick={() => setFilter(f)}
          >
            <span className="filter-tab-text">{f}</span>
          </button>
        ))}
      </div>

      <div className="finance-grid finance-bill-grid project-list-head finance-head">
        <span className="project-list-head-cell">Bill</span>
        <span className="project-list-head-cell">Date</span>
        <span className="project-list-head-cell">Supplier</span>
        <span className="project-list-head-cell">Invoice</span>
        <span className="project-list-head-cell">Project</span>
        <span className="project-list-head-cell">Total</span>
        <span className="project-list-head-cell">Due</span>
        <span className="project-list-head-cell">Status</span>
        <span className="project-list-head-cell">Supplier invoice</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {bills.isPending && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {bills.error && <p className="form-error px-8 py-4">{bills.error.message}</p>}
        {bills.data && !bills.data.connected && (
          <div className="no-result-row">{bills.data.error ?? 'QuickBooks is not connected.'}</div>
        )}
        {rows.map((b) => {
          const inv = invoiceFor(b.id)
          return (
            <div
              key={b.id}
              className="finance-grid finance-bill-grid finance-row"
              onClick={() => window.open(`https://app.qbo.intuit.com/app/bill?txnId=${b.id}`, '_blank', 'noopener')}
              title="Open in QuickBooks"
            >
              <span className="project-list-title">{b.doc_number ?? ''}</span>
              <span className="project-list-cell">{fmtDate(b.txn_date)}</span>
              <span className="project-list-cell" title={b.vendor_name}>
                {b.vendor_name}
              </span>
              <span className="project-list-cell">
                {inv?.uuid ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/invoices/${inv.uuid}`)
                    }}
                  >
                    {inv.invoice_number || 'Not raised'}
                  </button>
                ) : null}
              </span>
              <span className="project-list-cell" title={inv?.project_title ?? undefined}>
                {inv?.project_title ?? ''}
              </span>
              <span className="project-list-cell">{formatMoney(b.total, b.currency)}</span>
              <span className="project-list-cell">{fmtDate(b.due_date)}</span>
              <span className="project-list-cell">{billStageOf(b)}</span>
              <span className="project-list-cell">{b.has_supplier_invoice ? 'Uploaded' : 'Missing'}</span>
            </div>
          )
        })}
        {bills.data?.connected && rows.length === 0 && <div className="no-result-row">No results found.</div>}
      </div>
    </>
  )
}
