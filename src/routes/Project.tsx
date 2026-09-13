import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { formatBytes, formatMoney } from '../lib/format'
import {
  useProject,
  useProjectBriefs,
  useProjectContracts,
  useProjectCreativeLinks,
  useProjectFiles,
  useProjectInvoices,
  useProjectQuotes,
  useProjectSongs,
} from '../lib/xanoMirror'
import type { Brief, Contract, CreativeLink, Invoice, ProjectFile, Quote, Song } from '../lib/xanoMirror'

/**
 * One project — Sequel Track's `/project`, rebuilt.
 *
 * Nothing on this page was designed here. The tabs and their order, the field
 * names and their groupings, the column ratios, the empty-state wording and
 * the date formats are all read out of the Webflow element tree and the Wized
 * bindings behind it, and checked against the page rendered on the staging
 * branch. Where a comment names a class (project_quote_row) or a binding
 * (project_age_in_days), that is the source it came from.
 *
 * It is read-only. Xano is still the only writer, so the controls are marked
 * readonly rather than made to look live, and the add-new buttons are present
 * but disabled — the wizards behind them (11 steps for a quote, 15 for an
 * invoice), the uploads and the inline editing are the bulk of the real page
 * and are not built yet.
 */

const TABS = [
  'Overview',
  'Client',
  'Terms',
  'Assets',
  'Estimates',
  'Briefs',
  'Creative',
  'Invoicing',
  'Songs',
  'Contracting',
  'Notes',
] as const
type Tab = (typeof TABS)[number]

/** "4 Sep 2026" — the header's own format (project_created_date). */
const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "04 Sep 26" — the format the rows use (project_asset_date_txt). */
const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
})

function fmt(f: Intl.DateTimeFormat, value: string | null | undefined) {
  // Xano writes "" rather than null for an unset date, so both are nothing.
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : f.format(d)
}

/**
 * project_age_in_days: days from created_at to the closing date if there is
 * one, otherwise to today.
 */
function ageInDays(created: string | null, closed: string | null) {
  if (!created) return ''
  const start = new Date(created)
  if (Number.isNaN(start.getTime())) return ''
  const end = closed ? new Date(closed) : new Date()
  const to = Number.isNaN(end.getTime()) ? new Date() : end
  const days = Math.floor(Math.abs(+to - +start) / 86_400_000)
  return `${days} days`
}

const yesNo = (v: boolean | null | undefined) =>
  v === null || v === undefined ? '' : v ? 'Yes' : 'No'

/** A stat in the strip: Stats_txt over Status_value. */
function Stat({
  label,
  value,
  className = '',
}: {
  label: string
  value: string | null | undefined
  className?: string
}) {
  return (
    <div className={`stat ${className}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value || ''}</span>
    </div>
  )
}

/** project edit field group wrap: a label over a fixed-height control. */
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

/** Form Block 8 / creative link form: 40% wide, 2rem in from the left. */
function Form({ children }: { children: React.ReactNode }) {
  return <div className="edit-form">{children}</div>
}

/** App subtitle wraps: the tab's own subtitle, and the button that adds to it. */
function PaneBar({ title, action }: { title: string; action?: string }) {
  return (
    <div className="pane-bar">
      <div className="pane-title">{title}</div>
      {action && (
        <button type="button" className="btn btn-mono btn-outline" disabled>
          {action}
        </button>
      )}
    </div>
  )
}

type List<T> = { isPending: boolean; error: Error | null; data?: T[] }

/**
 * A list pane: the bar, then either the rows or the note that says there are
 * none. Every list is a grid of its own shape — `variant` picks which.
 */
function Rows<T>({
  title,
  action,
  empty,
  state,
  variant,
  row,
}: {
  title: string
  action?: string
  empty: string
  state: List<T>
  variant: 'quote' | 'invoice' | 'asset' | 'brief' | 'contract' | 'song'
  row: (item: T) => React.ReactNode
}) {
  return (
    <>
      <PaneBar title={title} action={action} />
      {state.isPending && (
        <div className="flex justify-center py-16">
          <Loader />
        </div>
      )}
      {state.error && <p className="form-error px-8 py-4">{state.error.message}</p>}
      {state.data?.length === 0 && <p className="empty-note">{empty}</p>}
      {state.data?.map((item, i) => (
        <div key={i} className={`project-row project-row-${variant}`}>
          {row(item)}
        </div>
      ))}
    </>
  )
}

const Title = ({ children }: { children: React.ReactNode }) => (
  <span className="row-title">{children}</span>
)
const Cell = ({ children }: { children: React.ReactNode }) => (
  <span className="row-field">{children}</span>
)

/** brief_row_col1 and brief_row_col2, which say more than the raw status. */
function briefSummary(b: Brief) {
  if (b.status === 'Requested') {
    if (b.source === 'internal') return b.name || 'Being filled in'
    return b.name || 'Waiting on client'
  }
  return b.one_sentence_brief || b.name || 'Brief'
}

function briefState(b: Brief) {
  if (b.source === 'upload') return 'Uploaded'
  if (b.status === 'Submitted') return 'Submitted'
  if (b.status === 'Requested') {
    if (!b.share_link_live) return 'Link expired'
    return b.source === 'internal' ? 'In progress' : 'Link sent'
  }
  return b.status ?? ''
}

export default function Project() {
  const { id } = useParams()
  const projectId = Number(id)
  const project = useProject(projectId)
  const [tab, setTab] = useState<Tab>('Overview')

  const quotes = useProjectQuotes(projectId)
  const invoices = useProjectInvoices(projectId)
  const contracts = useProjectContracts(projectId)
  const briefs = useProjectBriefs(projectId)
  const files = useProjectFiles(projectId)
  const songs = useProjectSongs(projectId)
  const creative = useProjectCreativeLinks(projectId)

  if (project.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader />
      </div>
    )
  }
  if (project.error) {
    return <p className="form-error px-8 py-4">{project.error.message}</p>
  }
  if (!project.data) {
    return (
      <p className="empty-note py-6">
        No project with that id, or you do not have access to it.
      </p>
    )
  }

  const p = project.data

  return (
    <>
      {/* header_app: brand, title, then the client user — who is a mailto
          link on Track, so they are one here too. */}
      <div className="header-band">
        <div className="page-eyebrow">{p.brand ?? ''}</div>
        <div className="title-row">
          <h1 className="page-title">{p.title ?? `Untitled (#${p.id})`}</h1>
        </div>
        {/* user_subtitle_project_edit returns the address and mailto-links
            it, so the address is what shows here — not the name. */}
        <div className="page-subtitle">
          {p.client_user_email ? (
            <a
              href={`mailto:${p.client_user_email}`}
              className="text-inherit no-underline"
              title={p.client_user ?? undefined}
            >
              {p.client_user_email}
            </a>
          ) : (
            ' '
          )}
        </div>
      </div>

      {/* tab_bar_app is a stats strip on this page, not the tabs: the start
          date and how long the project has been running, then three stats. */}
      <div className="tab-band">
        <Stat label="Started" value={fmt(longDate, p.created_at)} className="mx-0" />
        <div className="mx-8 h-px w-6 flex-none bg-sequel-line" />
        <Stat
          label="Active"
          value={ageInDays(p.created_at, p.closed_cancelled_date)}
          className="ml-0 mr-8"
        />
        <div className="tab-band-divider" />
        <Stat label="Type" value={p.service} />
        <div className="tab-band-divider" />
        <Stat label="No." value={p.sequel_no} />
        <div className="tab-band-divider" />
        <Stat label="Status" value={p.stage} />
      </div>

      <div className="project-tabs" role="tablist">
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

      {/* Every Tab Pane opens with 2rem of air. */}
      <div className="min-h-0 flex-1 overflow-auto pt-8">
        {tab === 'Overview' && (
          <>
            <PaneBar title="overview" />
            <Form>
              <Field label="Title" value={p.title} />
              <Field label="Status" value={p.stage} />
              <Field label="Campaign Name" value={p.campaign_name} />
              <Field label="Proposed Start Date" value={p.proposed_start_date} />
              {/* Track shows this one raw — "4000", not "4,000.00". It is a
                  number you type into, not an amount you read. */}
              <Field label="Projected Pipeline GBP" value={p.pipeline_gbp} />
              <Field label="Supervisor" value={p.supervisor} />
              <Field label="Service" value={p.service} />
            </Form>
          </>
        )}

        {tab === 'Client' && (
          <>
            <PaneBar title="client" />
            <Form>
              {/* On Track this first field is a search that picks the user;
                  here it is the user it found. */}
              <Field label="User" value={p.client_user} />
              <Field label="Client" value={p.client_group} />
              <Field label="Brand" value={p.brand} />
              <Field label="Product" value={p.product} />
              <Field label="Brand No." value={p.brand_no} />
              <Field label="AdPro Lead" value={p.adpro_lead} />
              <Field label="Brand Category" value={p.brand_category} />
              <Field label="Agency" value={p.agency} />
              <Field label="Country" value={p.country} />
              <Field label="Region" value={p.region} />
            </Form>
          </>
        )}

        {tab === 'Terms' && (
          <>
            <PaneBar title="Terms" />
            <Form>
              <Field label="Term" value={p.term} />
              <Field label="Territory" value={p.territory} />
              {/* Media and Scripts are the two textareas on Track. */}
              <Field label="Media" value={p.media} textarea />
              <Field label="Scripts" value={p.scripts} textarea />
              <Field label="Durations" value={p.durations} />
              <Field label="Cutdowns" value={yesNo(p.cutdowns)} />
              <Field label="Extension" value={yesNo(p.extension_yn)} />
            </Form>
          </>
        )}

        {tab === 'Assets' && (
          <Rows<ProjectFile>
            title="Assets"
            action="+ New ASSET"
            empty="Nothing here yet, click the New Asset button to get started"
            state={files}
            variant="asset"
            row={(f) => (
              <>
                <Title>{f.description || f.file_name}</Title>
                <Cell>{f.file_name}</Cell>
                <Cell>{formatBytes(f.file_size)}</Cell>
                <Cell>{fmt(shortDate, f.created_at)}</Cell>
                {/* asset_row_tag is hidden rather than blank when untagged:
                    assets filed before tags existed have none. */}
                <span>{f.asset_tag && <span className="row-flag">{f.asset_tag}</span>}</span>
              </>
            )}
          />
        )}

        {tab === 'Estimates' && (
          <Rows<Quote>
            title="ESTIMATES"
            action="CREATE ESTIMATE"
            empty="Nothing here yet, click the Create Estimate button to get started"
            state={quotes}
            variant="quote"
            row={(q) => (
              <>
                <Title>{q.description}</Title>
                <Cell>{q.music_type}</Cell>
                {/* project item row cost wrap: symbol and amount together,
                    the symbol in a fixed column so the amounts line up. */}
                <span className="row-cost">
                  {/* The symbol, resolved through the currency FK — not the
                      quote's own Currency text, which reads "SGD $" on one
                      row and "SGD" on the next. */}
                  <span className="row-cost-symbol">{q.currency_symbol}</span>
                  <span className="row-field">{formatMoney(q.grand_total_amount)}</span>
                </span>
                <Cell>{fmt(shortDate, q.created_at)}</Cell>
              </>
            )}
          />
        )}

        {tab === 'Briefs' && (
          <Rows<Brief>
            title="Briefs"
            action="+ NEW BRIEF"
            empty="No briefs yet. Request one from the client or add it yourself."
            state={briefs}
            variant="brief"
            row={(b) => (
              <>
                <Title>{briefSummary(b)}</Title>
                <Cell>{b.brief_type}</Cell>
                <Cell>{briefState(b)}</Cell>
                <Cell>{fmt(longDate, b.submitted_at ?? b.created_at)}</Cell>
              </>
            )}
          />
        )}

        {tab === 'Creative' && (
          <>
            <PaneBar title="Creative" action="+ Creative Link" />
            <Form>
              <Field label="Studio Inbox Link" value={p.studio_inbox_link} />
              <Field label="Sequel Studio" value={p.studio_link} />
            </Form>
            {creative.data?.map((l: CreativeLink) => (
              <div key={l.id} className="project-row project-row-link">
                <Title>{l.name}</Title>
                <Cell>{l.url}</Cell>
              </div>
            ))}
          </>
        )}

        {tab === 'Invoicing' && (
          <Rows<Invoice>
            title="invoicing"
            action="+ New INVOICE"
            empty="Nothing here yet, click the New invoice button to get started"
            state={invoices}
            variant="invoice"
            row={(i) => (
              <>
                <Title>{i.description || 'Untitled invoice'}</Title>
                <span className="row-cost-symbol">{i.currency_symbol}</span>
                <Cell>{formatMoney(i.total_amount)}</Cell>
                <Cell>{i.invoice_number}</Cell>
                <Cell>{fmt(shortDate, i.invoice_date)}</Cell>
                <Cell>{i.status}</Cell>
              </>
            )}
          />
        )}

        {tab === 'Songs' && (
          <Rows<Song>
            title="Songs"
            action="+ NEW SONG"
            empty="Nothing here yet."
            state={songs}
            variant="song"
            row={(s) => (
              <>
                <Title>{s.track_title}</Title>
                <Cell>{s.composer}</Cell>
              </>
            )}
          />
        )}

        {tab === 'Contracting' && (
          <Rows<Contract>
            title="Contracting"
            action="+ New CONTRACT"
            empty="Nothing here yet.  Upload a file or create a contract to get started"
            state={contracts}
            variant="contract"
            row={(c) => (
              <>
                <Title>{c.supplier}</Title>
                <Cell>{c.contract_type}</Cell>
                <Cell>{fmt(longDate, c.created_at)}</Cell>
              </>
            )}
          />
        )}

        {tab === 'Notes' && (
          <>
            <PaneBar title="NOTES" />
            <Form>
              <Field label="Notes" value={p.notes} textarea />
              <Field label="Notes or Request" value={p.notes_or_request} textarea />
            </Form>
          </>
        )}
      </div>
    </>
  )
}
