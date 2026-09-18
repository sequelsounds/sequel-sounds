import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useProjectContracts } from '../lib/contracts'
import { Loader } from '../components/Loader'
import { formatBytes, formatDate, formatMoney } from '../lib/format'
import {
  useProject,
  useProjectBriefs,
  useProjectCreativeLinks,
  useProjectFiles,
  useProjectInvoices,
  useProjectQuotes,
  useProjectSongs,
} from '../lib/xanoMirror'

/**
 * One project, rebuilt from Sequel Track's own page.
 *
 * Structure, tab order, field groupings, column ratios and type sizes are all
 * read out of Webflow's element tree and style definitions for `/project`
 * rather than designed here. The notes on each section say which Webflow class
 * a rule came from, so the next person can check it rather than trust it.
 *
 * Read-only. Xano is still the only writer, so the form controls are marked
 * readonly rather than made to look live — see .edit-field-input in the design
 * system. The editing, the quote wizard and the invoice wizard are the bulk of
 * the real page and are not here: 512 Wized bindings sit on `/project`, out of
 * roughly 1,250 in the whole app.
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

const yesNo = (v: boolean | null | undefined) =>
  v === null || v === undefined ? '' : v ? 'Yes' : 'No'

/** A label over a fixed-height control, as `project edit field group wrap`. */
function EditField({
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
        <textarea
          className="edit-field-input"
          style={{ minHeight: '4rem', maxHeight: 'none' }}
          value={v}
          readOnly
        />
      ) : (
        <input className="edit-field-input" value={v} readOnly />
      )}
    </div>
  )
}

/** The two-column form body the Overview, Client and Terms tabs share. */
function Form({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid max-w-3xl grid-cols-2 gap-x-8 px-8">{children}</div>
  )
}

/** App subtitle wraps: the tab's own subtitle, and what acts on it. */
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

  const counts: Partial<Record<Tab, number | undefined>> = {
    Assets: files.data?.length,
    Estimates: quotes.data?.length,
    Briefs: briefs.data?.length,
    Creative: creative.data?.length,
    Invoicing: invoices.data?.length,
    Songs: songs.data?.length,
    Contracting: contracts.data?.length,
  }

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
      {/* header_app: brand, title, then the person. */}
      <div className="header-band">
        <div className="page-eyebrow">{p.brand ?? 'Project'}</div>
        <div className="title-row">
          <h1 className="page-title">{p.title ?? `Untitled (#${p.id})`}</h1>
        </div>
        <div className="page-subtitle">{p.supervisor ?? ' '}</div>
      </div>

      {/* tab_bar_app holds the stats, not the tabs. */}
      <div className="tab-band">
        <div className="stat">
          <span className="stat-label">Started</span>
          <span className="stat-value">
            {p.created_at ? formatDate(p.created_at) : (p.proposed_start_date ?? '—')}
          </span>
        </div>
        <div className="tab-band-divider" />
        <div className="stat">
          <span className="stat-label">Air date</span>
          <span className="stat-value">
            {p.confirmed_first_air_date
              ? formatDate(p.confirmed_first_air_date)
              : p.proposed_air_date
                ? formatDate(p.proposed_air_date)
                : '—'}
          </span>
        </div>
        <div className="tab-band-divider" />
        <div className="stat">
          <span className="stat-label">Type</span>
          <span className="stat-value">{p.service ?? p.project_type ?? '—'}</span>
        </div>
        <div className="tab-band-divider" />
        <div className="stat">
          <span className="stat-label">No.</span>
          <span className="stat-value">{p.sequel_no ?? '—'}</span>
        </div>
        <div className="tab-band-divider" />
        <div className="stat">
          <span className="stat-label">Status</span>
          <span className="stat-value">{p.stage ?? '—'}</span>
        </div>
      </div>

      {/* Project tabs: App tabs are 1rem either side, their text 0.7rem/500. */}
      <div className="flex flex-none border-b border-sequel-line px-8">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`tab px-4 text-[0.7rem] font-medium ${
              tab === t ? 'border-sequel-brown text-sequel-brown' : ''
            }`}
          >
            {t}
            {counts[t] !== undefined && counts[t]! > 0 && (
              <span className="count">{counts[t]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pt-4">
        {tab === 'Overview' && (
          <>
            <PaneBar title="Overview" />
            <Form>
              <EditField label="Title" value={p.title} />
              <EditField label="Status" value={p.stage} />
              <EditField label="Campaign Name" value={p.campaign_name} />
              <EditField label="Proposed Start Date" value={p.proposed_start_date} />
              <EditField
                label="Projected Pipeline GBP"
                value={p.pipeline_gbp ? formatMoney(p.pipeline_gbp) : ''}
              />
              <EditField label="Supervisor" value={p.supervisor} />
              <EditField label="Service" value={p.service} />
            </Form>
          </>
        )}

        {tab === 'Client' && (
          <>
            <PaneBar title="Client" />
            <Form>
              <EditField label="User" value={p.client_user} />
              <EditField label="Client" value={p.client_group} />
              <EditField label="Brand" value={p.brand} />
              <EditField label="Product" value={p.product} />
              <EditField label="Brand No." value={p.brand_no} />
              <EditField label="AdPro Lead" value={p.adpro_lead} />
              <EditField label="Brand Category" value={p.brand_category} />
              <EditField label="Agency" value={p.agency} />
              <EditField label="Country" value={p.country} />
              <EditField label="Region" value={p.region} />
            </Form>
          </>
        )}

        {tab === 'Terms' && (
          <>
            <PaneBar title="Terms" />
            <Form>
              <EditField label="Term" value={p.term} />
              <EditField label="Territory" value={p.territory} />
              {/* Media and Scripts are textareas on Track, not inputs. */}
              <EditField label="Media" value={p.media} textarea />
              <EditField label="Scripts" value={p.scripts} textarea />
              <EditField label="Durations" value={p.durations} />
              <EditField label="Cutdowns" value={yesNo(p.cutdowns)} />
              <EditField label="Extension" value={yesNo(p.extension_yn)} />
            </Form>
          </>
        )}

        {tab === 'Assets' && (
          <Rows
            title="Assets"
            action="+ NEW ASSET"
            state={files}
            variant="asset"
            head={['File', 'Description', 'Size', 'Tag', 'Uploaded by', 'Added']}
            row={(f) => [
              f.file_name,
              f.description,
              formatBytes(f.file_size),
              f.asset_tag,
              f.uploaded_by,
              f.created_at ? formatDate(f.created_at) : null,
            ]}
          />
        )}

        {tab === 'Estimates' && (
          <Rows
            title="Estimates"
            action="CREATE ESTIMATE"
            state={quotes}
            variant="quote"
            head={['Description', 'Type', 'Status', 'Total', 'Service', 'Raised']}
            row={(q) => [
              q.song_name ?? q.artist_name ?? `Quote #${q.id}`,
              q.music_type,
              q.status,
              formatMoney(q.grand_total_amount, q.currency),
              q.service,
              q.created_at ? formatDate(q.created_at) : null,
            ]}
          />
        )}

        {tab === 'Briefs' && (
          <Rows
            title="Briefs"
            action="+ NEW BRIEF"
            state={briefs}
            variant="contract"
            head={['Brief', 'Type', 'Status', 'Source', 'Deadline', 'Submitted']}
            row={(b) => [
              b.name ?? b.one_sentence_brief,
              b.brief_type,
              b.status,
              b.source,
              b.client_deadline ? formatDate(b.client_deadline) : null,
              b.submitted_at ? formatDate(b.submitted_at) : null,
            ]}
          />
        )}

        {tab === 'Creative' && (
          <>
            <PaneBar title="Creative" action="+ CREATIVE LINK" />
            <Form>
              <EditField label="Studio Inbox Link" value={p.studio_inbox_link} />
              <EditField label="Sequel Studio" value={p.studio_link} />
              <EditField label="DISCO Inbox" value={p.disco_inbox_link} />
              <EditField label="Final DISCO Link" value={p.final_disco_link} />
            </Form>
            <Rows
              state={creative}
              variant="song"
              head={['Name', 'Link', '', '']}
              row={(l) => [
                l.name,
                l.url,
                l.created_at ? formatDate(l.created_at) : null,
                null,
              ]}
            />
          </>
        )}

        {tab === 'Invoicing' && (
          <Rows
            title="Invoicing"
            action="+ NEW INVOICE"
            state={invoices}
            variant="invoice"
            head={['Description', 'Total', 'Status', 'Invoice', 'Client', 'Invoiced', 'Due']}
            row={(i) => [
              i.song_name ?? i.client ?? `Invoice ${i.invoice_number ?? i.id}`,
              formatMoney(i.total_amount, i.currency),
              i.status,
              i.invoice_number,
              i.client,
              i.invoice_date ? formatDate(i.invoice_date) : null,
              i.due_date ? formatDate(i.due_date) : null,
            ]}
          />
        )}

        {tab === 'Songs' && (
          <Rows
            title="Songs"
            action="+ NEW SONG"
            state={songs}
            variant="song"
            head={['Track', 'Composer', 'Registration', 'Schedule A']}
            row={(s) => [
              s.track_title,
              s.composer,
              s.registration_status,
              s.schedule_a_status,
            ]}
          />
        )}

        {tab === 'Contracting' && (
          <Rows
            title="Contracting"
            action="+ NEW CONTRACT"
            state={contracts}
            variant="contract"
            head={['File', 'Supplier', 'Type', 'Artist', 'Status', 'Signed']}
            row={(c) => [
              c.file_name ?? c.description,
              c.supplier,
              c.contract_type,
              c.artist,
              c.status,
              c.confirmed ? 'Yes' : 'No',
            ]}
          />
        )}

        {tab === 'Notes' && (
          <>
            <PaneBar title="Notes" />
            <div className="max-w-3xl px-8">
              <EditField label="Notes" value={p.notes} textarea />
              <EditField label="Notes or Request" value={p.notes_or_request} textarea />
            </div>
          </>
        )}
      </div>
    </>
  )
}

/**
 * One of the project's lists. Each is a CSS grid whose column ratios differ
 * per list — see .project-row-* in the design system, taken from Webflow's
 * project_quote_row, project_invoice_row and friends.
 */
function Rows<T>({
  title,
  action,
  state,
  variant,
  head,
  row,
}: {
  title?: string
  action?: string
  state: { isPending: boolean; error: Error | null; data?: T[] }
  variant: 'quote' | 'invoice' | 'asset' | 'contract' | 'song'
  head: string[]
  row: (item: T) => (string | null | undefined)[]
}) {
  const grid = `project-row project-row-${variant}`

  return (
    <>
      {title && <PaneBar title={title} action={action} />}
      {state.isPending && (
        <div className="flex justify-center py-16">
          <Loader />
        </div>
      )}
      {state.error && <p className="form-error px-8 py-4">{state.error.message}</p>}
      {state.data && state.data.length === 0 && (
        <p className="empty-note">Nothing here yet.</p>
      )}
      {state.data && state.data.length > 0 && (
        <>
          <div className={`${grid} project-row-head`}>
            {head.map((h, i) => (
              <span key={i} className="row-field">
                {h}
              </span>
            ))}
          </div>
          {state.data.map((item, n) => {
            const cells = row(item)
            return (
              <div key={n} className={grid}>
                {cells.map((c, i) => (
                  <span
                    key={i}
                    className={i === 0 ? 'row-title' : 'row-field'}
                    title={typeof c === 'string' ? c : undefined}
                  >
                    {c || '—'}
                  </span>
                ))}
              </div>
            )
          })}
        </>
      )}
    </>
  )
}
