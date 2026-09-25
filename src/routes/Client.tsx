import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import {
  useClient,
  useClientProfit,
  useClientProjects,
  type ClientProject,
} from '../lib/xanoMirror'

/**
 * One client — Sequel Track's `/client`, rebuilt.
 *
 * Track reaches it as `/client?uuid=…`; here it is `/clients/:uuid`, which is
 * the only thing on the page that is not Track's. Everything else — the three
 * tabs, the field order, the six tiles and their labels, the five-column
 * project row — was read off the page rendered on the staging branch.
 *
 * Read-only. Track saves every field on blur through its own Patch_client, so
 * the controls here are marked readonly rather than made to look live.
 *
 * Two things the August notes have wrong, because the page moved on:
 * the profit tiles are no longer static zeroes — get_client_profit (api 589)
 * was written on 4 September and both tiles are live.
 */

const TABS = ['Details', 'Finance', 'Projects'] as const
type Tab = (typeof TABS)[number]

/** Services table 28, which is what the counters key on. */
const COMPOSITION = 1
const COMMERCIAL = 2
const LIBRARY = 3

/** "£14,214" — whole pounds, which is all the tile has room for. */
const pounds = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

function Stat({
  label,
  value,
  className = '',
}: {
  label: string
  value: string | number | null | undefined
  className?: string
}) {
  return (
    <div className={`stat ${className}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value ?? ''}</span>
    </div>
  )
}

function Field({
  label,
  value,
  textarea,
}: {
  label: string
  value: string | number | null | undefined
  textarea?: boolean
}) {
  const v = value === null || value === undefined ? '' : String(value)
  return (
    <div className="edit-field">
      <label className="edit-field-label">{label}</label>
      {textarea ? (
        <textarea className="edit-field-input edit-field-input-text" value={v} readOnly />
      ) : (
        <input className="edit-field-input" value={v} readOnly />
      )}
    </div>
  )
}

export default function Client() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const client = useClient(uuid)
  const id = client.data?.id
  const projects = useClientProjects(id)
  // Track passes new Date().getFullYear() rather than deriving the year on the
  // server, so a past year can be asked for without changing the endpoint.
  const profit = useClientProfit(id, new Date().getFullYear())
  const [tab, setTab] = useState<Tab>('Details')

  if (client.isPending) {
    return (
      <Loader />
    )
  }
  if (client.error) return <p className="form-error px-8 py-8">{client.error.message}</p>
  if (!client.data) return <p className="empty-note py-8">No client with that link.</p>

  const c = client.data
  const rows = projects.data ?? []
  const byService = (s: number) => rows.filter((p) => p.services_id === s).length

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Clients</div>
        <div className="title-row">
          <h1 className="page-title">{c.company ?? `Untitled (#${c.id})`}</h1>
        </div>
        {/* Track's own line, kept as it is. Nothing on this page edits yet;
            the readonly controls are what say so. */}
        <div className="page-subtitle">Edit this client&rsquo;s details&hellip;</div>
      </div>

      {/* Six tiles. The three service counts do not add up to Projects and are
          not meant to: Sonic Branding, Sound Design and Talent are counted in
          the total and appear in no tile.

          "Commerical" is Track's spelling, on the label only. */}
      <div className="tab-band">
        <Stat label="Projects" value={rows.length} className="mx-0" />
        <div className="tab-band-divider" />
        <Stat label="Commerical" value={byService(COMMERCIAL)} />
        <div className="tab-band-divider" />
        <Stat label="Library" value={byService(LIBRARY)} />
        <div className="tab-band-divider" />
        <Stat label="Composition" value={byService(COMPOSITION)} />
        <div className="tab-band-divider" />
        <Stat
          label="YTD profit"
          value={profit.data ? `£${pounds.format(profit.data.ytd_profit_gbp)}` : ''}
        />
        <div className="tab-band-divider" />
        <Stat
          label="Total Profit"
          value={profit.data ? `£${pounds.format(profit.data.total_profit_gbp)}` : ''}
        />
      </div>

      {/* app-tabs: the label is the tab's own text with no element inside it,
          so it sits at the inherited weight until w--current adds 500 and the
          rule beneath. */}
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
          <div className="edit-form">
            <Field label="Company Name" value={c.company} />
            <Field label="City" value={c.city} />
            <Field label="Street Address" value={c.street_address} />
            {/* Client Type and Region are dropdowns on Track, off hardcoded
                five- and four-option lists in the Wized config rather than off
                their tables — so a row added to either table would not appear
                in them. Here they are the resolved text either way. */}
            <Field label="Client Type" value={c.client_type_text} />
            <Field label="Region" value={c.region_text} />
            <Field label="Postal Code" value={c.postal_code} />
            {/* Country is the one dropdown Track fills from a request, and the
                one that had to be fixed per-option: its value binding was
                applied before the ~250 options existed and every client showed
                Afghanistan. Nothing to race here. */}
            <Field label="Country" value={c.country_text} />
          </div>
        )}

        {tab === 'Finance' && (
          <div className="edit-form">
            {/* Track shows the customer's name and currency, which it gets by
                calling QuickBooks (qbo_list_entities). The mirror holds the id
                the client is linked by and nothing else, so the id is what
                this shows until that call exists on this side. */}
            <Field label="QuickBooks Customer" value={c.qbo_customer_id} />
            <Field label="Finance Instructions" value={c.invoice_instructions} textarea />
            {/* ⚠️ These two sit under Finance for grouping and are NOT
                finance-gated on Track: any staff account that opens the tab can
                edit them. Open question from August, still open. */}
            <Field label="Invoice Email" value={c.invoice_email} />
            <Field label="Accounts Payable Email" value={c.accounts_payable_email} />
          </div>
        )}

        {tab === 'Projects' && (
          <>
            {projects.isPending && (
              <Loader />
            )}
            {projects.error && (
              <p className="form-error px-8 py-4">{projects.error.message}</p>
            )}
            {/* dashboard_project_row_user_edit: the five-column row, not the
                list's eight. Agency is dropped because every row here belongs
                to the client being viewed. */}
            {rows.map((p: ClientProject) => (
              <div
                key={p.id}
                className="client-project-row"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <span className="project-list-title" title={p.title ?? undefined}>
                  {p.title ?? `Untitled (#${p.id})`}
                </span>
                <span className="project-list-cell">{p.brand}</span>
                <span className="project-list-cell">{p.sequel_no}</span>
                <span className="project-list-cell">{p.stage_text}</span>
                <span className="project-list-cell">{p.service_name}</span>
              </div>
            ))}
            {projects.data && rows.length === 0 && (
              <p className="empty-note py-6">Nothing here yet</p>
            )}
          </>
        )}
      </div>
    </>
  )
}
