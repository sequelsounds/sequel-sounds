import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { formatBytes, formatDate, formatMoney } from '../lib/format'
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

/**
 * One project.
 *
 * The tabs, their order and the field groupings are read off the live Sequel
 * Track page rather than invented — Overview / Client / Terms / Assets /
 * Estimates / Briefs / Creative / Invoicing / Songs / Contracting / Notes, and
 * each tab holds what it holds there. An earlier version of this page had
 * seven tabs of my own devising, which is not a migration.
 *
 * Read-only. Track still runs on Xano and is the only thing that writes: the
 * editing, the quote wizard and the invoice wizard are not here yet. Those are
 * the bulk of the real page — 512 Wized bindings on it, against the ~1,250 in
 * the whole app — and they come one at a time.
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
  v === null || v === undefined ? null : v ? 'Yes' : 'No'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-sequel-line py-3">
      <div className="field-label">{label}</div>
      <div className="mt-1 break-words">{value || '—'}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="field-label">{label}</span>
      <span className="text-[13px]">{value || '—'}</span>
    </div>
  )
}

function Fields({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid max-w-3xl grid-cols-2 gap-x-10 px-7 py-4">{children}</div>
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

  // Counts on the tabs, so the shape of a project is legible before clicking:
  // nine contracts and no estimates is a different project from the reverse.
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
    return <p className="form-error px-7 py-4">{project.error.message}</p>
  }
  if (!project.data) {
    return (
      <p className="px-7 py-6 text-sequel-mid">
        No project with that id, or you do not have access to it.
      </p>
    )
  }

  const p = project.data

  return (
    <>
      {/* header_app: brand above, title, then the person — as on Track. */}
      <div className="header-band">
        <div className="page-eyebrow">{p.brand ?? 'Project'}</div>
        <div className="title-row">
          <h1 className="page-title">{p.title ?? `Untitled (#${p.id})`}</h1>
        </div>
        <div className="page-subtitle">{p.supervisor ?? ' '}</div>
      </div>

      {/* tab_bar_app on Track is a stats strip, not the tabs: started and
          deadline dates, then type, number and status. */}
      <div className="tab-band">
        <div className="flex items-center gap-7">
          <Stat
            label="Started"
            value={p.created_at ? formatDate(p.created_at) : p.proposed_start_date}
          />
          <Stat
            label="Air date"
            value={
              p.confirmed_first_air_date
                ? formatDate(p.confirmed_first_air_date)
                : p.proposed_air_date
                  ? formatDate(p.proposed_air_date)
                  : null
            }
          />
          <Stat label="Type" value={p.service ?? p.project_type} />
          <Stat label="No." value={p.sequel_no} />
          <Stat label="Status" value={p.stage} />
        </div>
      </div>

      <div className="border-b border-sequel-line px-7">
        <nav className="flex flex-wrap gap-5">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`cursor-pointer border-b-2 pb-2 pt-1 text-[13px] ${
                tab === t
                  ? 'border-sequel-brown text-sequel-ink'
                  : 'border-transparent text-sequel-mid hover:text-sequel-ink'
              }`}
            >
              {t}
              {counts[t] !== undefined && counts[t]! > 0 && (
                <span className="ml-1.5 text-sequel-mid">{counts[t]}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'Overview' && (
          <Fields>
            <Field label="Title" value={p.title} />
            <Field label="Status" value={p.stage} />
            <Field label="Campaign name" value={p.campaign_name} />
            <Field label="Proposed start date" value={p.proposed_start_date} />
            <Field
              label="Projected pipeline GBP"
              value={p.pipeline_gbp ? formatMoney(p.pipeline_gbp, '£') : null}
            />
            <Field label="Supervisor" value={p.supervisor} />
            <Field label="Service" value={p.service} />
          </Fields>
        )}

        {tab === 'Client' && (
          <Fields>
            <Field label="User" value={p.client_user} />
            <Field label="Client" value={p.client_group} />
            <Field label="Brand" value={p.brand} />
            <Field label="Product" value={p.product} />
            <Field label="Brand no." value={p.brand_no} />
            <Field label="AdPro lead" value={p.adpro_lead} />
            <Field label="Brand category" value={p.brand_category} />
            <Field label="Agency" value={p.agency} />
            <Field label="Country" value={p.country} />
            <Field label="Region" value={p.region} />
          </Fields>
        )}

        {tab === 'Terms' && (
          <Fields>
            <Field label="Term" value={p.term} />
            <Field label="Territory" value={p.territory} />
            <Field label="Media" value={p.media} />
            <Field label="Scripts" value={p.scripts} />
            <Field label="Durations" value={p.durations} />
            <Field label="Cutdowns" value={yesNo(p.cutdowns)} />
            <Field label="Extension" value={yesNo(p.extension_yn)} />
          </Fields>
        )}

        {tab === 'Assets' && (
          <Table
            state={files}
            what="assets"
            head={['File', 'Tag', 'Size', 'Uploaded by', 'Added']}
            widths={[undefined, 120, 90, 160, 110]}
            row={(f) => [
              f.file_name ?? f.description,
              f.asset_tag,
              formatBytes(f.file_size),
              f.uploaded_by,
              f.created_at ? formatDate(f.created_at) : null,
            ]}
          />
        )}

        {tab === 'Estimates' && (
          <Table
            state={quotes}
            what="estimates"
            head={['Quote', 'Status', 'Type', 'Service', 'Total', 'Raised']}
            widths={[90, 120, 110, 130, 160, 100]}
            row={(q) => [
              `#${q.id}`,
              q.status,
              q.music_type,
              q.service,
              formatMoney(q.grand_total_amount, q.currency),
              q.created_at ? formatDate(q.created_at) : null,
            ]}
          />
        )}

        {tab === 'Briefs' && (
          <Table
            state={briefs}
            what="briefs"
            head={['Brief', 'Type', 'Status', 'Source', 'Client deadline', 'Submitted']}
            widths={[undefined, 120, 120, 110, 130, 110]}
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
            <Fields>
              <Field
                label="Studio inbox link"
                value={
                  p.studio_inbox_link ? (
                    <a href={p.studio_inbox_link} className="underline">
                      {p.studio_inbox_link}
                    </a>
                  ) : null
                }
              />
              <Field
                label="Sequel Studio"
                value={
                  p.studio_link ? (
                    <a href={p.studio_link} className="underline">
                      Open in Studio
                    </a>
                  ) : null
                }
              />
              <Field
                label="DISCO inbox"
                value={
                  p.disco_inbox_link ? (
                    <a href={p.disco_inbox_link} className="underline">
                      {p.disco_inbox_link}
                    </a>
                  ) : null
                }
              />
              <Field
                label="Final DISCO link"
                value={
                  p.final_disco_link ? (
                    <a href={p.final_disco_link} className="underline">
                      {p.final_disco_link}
                    </a>
                  ) : null
                }
              />
            </Fields>
            <Table
              state={creative}
              what="creative links"
              head={['Name', 'Link', 'Added']}
              widths={[260, undefined, 110]}
              row={(l) => [
                l.name,
                l.url,
                l.created_at ? formatDate(l.created_at) : null,
              ]}
            />
          </>
        )}

        {tab === 'Invoicing' && (
          <Table
            state={invoices}
            what="invoices"
            head={['Invoice', 'Status', 'Client', 'Total', 'Invoiced', 'Due']}
            widths={[100, 140, undefined, 150, 110, 110]}
            row={(i) => [
              i.invoice_number ?? `#${i.id}`,
              i.status,
              i.client,
              formatMoney(i.total_amount, i.currency),
              i.invoice_date ? formatDate(i.invoice_date) : null,
              i.due_date ? formatDate(i.due_date) : null,
            ]}
          />
        )}

        {tab === 'Songs' && (
          <Table
            state={songs}
            what="songs"
            head={['Track', 'Composer', 'Registration', 'Schedule A', 'Ownership', 'Duration']}
            widths={[undefined, 170, 130, 120, 130, 90]}
            row={(s) => [
              s.track_title,
              s.composer,
              s.registration_status,
              s.schedule_a_status,
              s.ownership,
              s.duration,
            ]}
          />
        )}

        {tab === 'Contracting' && (
          <Table
            state={contracts}
            what="contracts"
            head={['File', 'Type', 'Supplier', 'Artist', 'Status', 'Signed']}
            widths={[undefined, 130, 170, 140, 100, 80]}
            row={(c) => [
              c.file_name ?? c.description,
              c.contract_type,
              c.supplier,
              c.artist,
              c.status,
              c.confirmed ? 'Yes' : 'No',
            ]}
          />
        )}

        {tab === 'Notes' && (
          <div className="max-w-3xl px-7 py-4">
            <Field label="Notes" value={p.notes} />
            <Field label="Notes or request" value={p.notes_or_request} />
          </div>
        )}
      </div>
    </>
  )
}

/**
 * The list tabs are all the same shape — loading, failed, empty, or a table —
 * so they share one component rather than seven near-copies that drift apart.
 */
function Table<T>({
  state,
  what,
  head,
  widths,
  row,
}: {
  state: { isPending: boolean; error: Error | null; data?: T[] }
  what: string
  head: string[]
  widths: (number | undefined)[]
  row: (item: T) => (string | null | undefined)[]
}) {
  if (state.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader />
      </div>
    )
  }
  if (state.error) {
    return <p className="form-error px-7 py-4">{state.error.message}</p>
  }
  if (!state.data?.length) {
    return <p className="px-7 py-6 text-sequel-mid">No {what} on this project.</p>
  }

  return (
    <table className="track-table">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={w ? { width: w } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} className={i === 0 ? 'pl-7' : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {state.data.map((item, n) => {
          const cells = row(item)
          return (
            <tr key={n} className="track-row">
              {cells.map((c, i) => (
                <td
                  key={i}
                  className={i === 0 ? 'pl-7' : 'secondary'}
                  title={typeof c === 'string' ? c : undefined}
                >
                  <span className="block truncate">{c || '—'}</span>
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
