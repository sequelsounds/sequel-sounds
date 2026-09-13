import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { formatBytes, formatDate, formatMoney } from '../lib/format'
import {
  useProject,
  useProjectBriefs,
  useProjectContracts,
  useProjectFiles,
  useProjectInvoices,
  useProjectQuotes,
} from '../lib/xanoMirror'

/**
 * One project, read from the Xano mirror.
 *
 * This is where the two halves of Sequel meet. The commercial side — quotes,
 * invoices, contracts, briefs, files — comes from Sequel Track. The Music tab
 * is Studio's inbox and playlists, and is not wired up yet: its tables still
 * hang off the old projects_mirror, which is on its way out.
 *
 * Read-only throughout. Track still runs on Xano and is the only thing that
 * writes.
 */

const TABS = [
  'Overview',
  'Music',
  'Quotes',
  'Invoices',
  'Contracts',
  'Briefs',
  'Files',
] as const
type Tab = (typeof TABS)[number]

function Empty({ what }: { what: string }) {
  return <p className="px-7 py-6 text-sequel-mid">No {what} on this project.</p>
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-sequel-line py-3">
      <div className="field-label">{label}</div>
      <div className="mt-1">{value || '—'}</div>
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

  // Counts sit on the tabs so the shape of a project is legible before you
  // click anything — nine contracts and no quotes is a different project from
  // the reverse.
  const counts: Partial<Record<Tab, number | undefined>> = {
    Quotes: quotes.data?.length,
    Invoices: invoices.data?.length,
    Contracts: contracts.data?.length,
    Briefs: briefs.data?.length,
    Files: files.data?.length,
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
      <div className="header-band">
        <div className="page-eyebrow">{p.sequel_no ?? 'Project'}</div>
        <div className="title-row">
          <h1 className="page-title">{p.title ?? `Untitled (#${p.id})`}</h1>
        </div>
        <div className="page-subtitle">
          {[p.brand, p.agency, p.stage].filter(Boolean).join(' · ') || ' '}
        </div>
      </div>

      <div className="tab-band">
        <nav className="flex gap-6">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`cursor-pointer border-b-2 pb-2 text-[13px] ${
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
          <div className="grid max-w-3xl grid-cols-2 gap-x-10 px-7 py-4">
            <Field label="Brand" value={p.brand} />
            <Field label="Client" value={p.client_group} />
            <Field label="Agency" value={p.agency} />
            <Field label="Service" value={p.service} />
            <Field label="Stage" value={p.stage} />
            <Field label="Supervisor" value={p.supervisor} />
            <Field
              label="Proposed air date"
              value={p.proposed_air_date ? formatDate(p.proposed_air_date) : null}
            />
            <Field
              label="Confirmed first air date"
              value={
                p.confirmed_first_air_date
                  ? formatDate(p.confirmed_first_air_date)
                  : null
              }
            />
            <Field
              label="Pipeline"
              value={p.pipeline_gbp ? formatMoney(p.pipeline_gbp, 'GBP £') : null}
            />
            <Field label="Record status" value={p.record_status} />
          </div>
        )}

        {tab === 'Music' && (
          <p className="px-7 py-6 text-sequel-mid">
            Studio's inbox and playlists will live here. Not wired up yet — those
            tables still hang off the old projects_mirror.
          </p>
        )}

        {tab === 'Quotes' && (
          <Table
            state={quotes}
            what="quotes"
            head={['Quote', 'Status', 'Type', 'Service', 'Total', 'Raised']}
            widths={[90, 110, 110, 130, 160, 110]}
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

        {tab === 'Invoices' && (
          <Table
            state={invoices}
            what="invoices"
            head={['Invoice', 'Status', 'Client', 'Total', 'Invoiced', 'Due']}
            widths={[100, 130, undefined, 150, 110, 110]}
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

        {tab === 'Contracts' && (
          <Table
            state={contracts}
            what="contracts"
            head={['File', 'Type', 'Supplier', 'Artist', 'Status', 'Signed']}
            widths={[undefined, 130, 160, 140, 100, 90]}
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

        {tab === 'Files' && (
          <Table
            state={files}
            what="files"
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
      </div>
    </>
  )
}

/**
 * The five child tabs are all the same shape — a list that is loading, failed,
 * empty, or a table — so they share one component rather than five near-copies
 * that drift apart.
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
  if (!state.data?.length) return <Empty what={what} />

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
