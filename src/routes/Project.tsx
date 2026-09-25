import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Loader } from '../components/Loader'
import { EditEnum, EditField, EditSelect } from '../components/staff/EditField'
import { NewQuote } from '../components/staff/NewQuote'
import { NewInvoice } from '../components/staff/NewInvoice'
import { InvoiceRowActions, QuoteRowActions } from '../components/staff/RowActions'
import {
  BriefRowActions,
  BriefShareModal,
  BriefViewModal,
  type ShareState,
} from '../components/staff/BriefActions'
import { briefLink, useRequestBrief } from '../lib/briefs'
import { fileTypeLabel } from '../lib/assets'
import {
  AssetModal,
  AssetRowActions,
  openAssetPage,
  type AssetModalMode,
} from '../components/staff/AssetActions'
import { formatBytes, formatMoney } from '../lib/format'
import { useProjectBills, type QboBill } from '../lib/finance'
import { SupplierInvoiceCell } from '../components/staff/SupplierInvoiceCell'
import {
  useProjectLookups,
  useProjectPeople,
  useSaveProject,
  type Option,
  type ProjectPatch,
} from '../lib/projectWrites'
import {
  useIsStaff,
  useProject,
  useProjectBriefs,
  useProjectCreativeLinks,
  useProjectFiles,
  useProjectInvoices,
  useProjectQuotes,
  useProjectSongs,
} from '../lib/xanoMirror'
import type { Brief, CreativeLink, Invoice, ProjectFile, Quote, Song } from '../lib/xanoMirror'
import { useProjectContracts, type ContractRow } from '../lib/contracts'
import { useProjectReleaseForms } from '../lib/releaseForms'
import {
  ContractRowActions,
  ContractModal,
  type ContractModalMode,
} from '../components/staff/ContractActions'
import {
  ReleaseFormModal,
  ReleaseFormRowActions,
  type ReleaseFormMode,
} from '../components/staff/ReleaseFormActions'
import { NewSongModal } from '../components/staff/NewSong'

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
 * The four form tabs — Overview, Client, Terms, Notes — now WRITE. Every field
 * saves itself on blur, the way Track's supplier pages do, and says so. The
 * list tabs are still read-only: the wizards behind them (11 steps for a quote,
 * 15 for an invoice) and the uploads are the bulk of the real page and are not
 * built yet, so their add buttons stay disabled.
 *
 * ⚠️ `project_master_list` is STILL IN Xano's hourly sync as this is written.
 * Every edit made here is put back on the hour until its two blocks come out of
 * task 42. See the note at the top of `projectWrites.ts`.
 *
 * Staff see boxes; a client user sees the same page read-only. That split is
 * cosmetic — the real gate is the update policy, which asks `track_is_staff()`
 * inside the database and hands a client user zero rows.
 *
 * Three fields stay read-only for staff too, and each for its own reason:
 * Region belongs to the agency rather than to the project, and the two Studio
 * links are minted by Studio when a project gets its upload inbox.
 */

const TABS = [
  'Overview',
  'Client',
  'Terms',
  'Assets',
  'Estimates',
  'Briefs',
  'Music',
  'Invoicing',
  'Bills',
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

const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? '' : v ? 'Yes' : 'No')

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

/**
 * The same field, editable, when the reader is staff.
 *
 * A pair rather than one component with a flag inside it, because the read-only
 * `Field` above is a plain input and `EditField` carries save state, a pending
 * ref and an auto-growing textarea. Switching between them at the top keeps
 * both simple.
 */
function TextField({
  label,
  value,
  column,
  textarea,
  edit,
  save,
}: {
  label: string
  value: string | null | undefined
  column: keyof ProjectPatch
  textarea?: boolean
  edit: boolean
  save: (patch: ProjectPatch) => Promise<unknown>
}) {
  if (!edit) return <Field label={label} value={value} textarea={textarea} />
  return (
    <EditField
      label={label}
      value={value}
      textarea={textarea}
      onSave={(next) => save({ [column]: next } as ProjectPatch)}
    />
  )
}

/** A foreign key: shows the name, writes the id. */
function PickField({
  label,
  value,
  label_,
  column,
  options,
  edit,
  save,
}: {
  label: string
  /** The id, for the select. */
  value: number | null | undefined
  /** The name, for the read-only version. */
  label_: string | null | undefined
  column: keyof ProjectPatch
  options: Option[] | undefined
  edit: boolean
  save: (patch: ProjectPatch) => Promise<unknown>
}) {
  if (!edit) return <Field label={label} value={label_} />
  return (
    <EditSelect
      label={label}
      value={value}
      options={options ?? []}
      onSave={(next) => save({ [column]: next } as ProjectPatch)}
    />
  )
}

/** Yes / No over a real boolean column, with a blank for "not said". */
const YES_NO = ['Yes', 'No'] as const

function BoolField({
  label,
  value,
  column,
  edit,
  save,
}: {
  label: string
  value: boolean | null | undefined
  column: keyof ProjectPatch
  edit: boolean
  save: (patch: ProjectPatch) => Promise<unknown>
}) {
  if (!edit) return <Field label={label} value={yesNo(value)} />
  return (
    <EditEnum
      label={label}
      value={value === null || value === undefined ? null : value ? 'Yes' : 'No'}
      options={YES_NO}
      onSave={(next) => save({ [column]: next === null ? null : next === 'Yes' } as ProjectPatch)}
    />
  )
}

/**
 * A number typed into a box.
 *
 * Track shows the pipeline figure raw — "4000", not "4,000.00" — because it is
 * a number you type into, not an amount you read, and that is kept. What is
 * added is a refusal: "4,000" and "£4k" would otherwise reach a numeric column
 * as NaN and land there as null, which reads exactly like a saved zero.
 */
function NumberField({
  label,
  value,
  column,
  edit,
  save,
}: {
  label: string
  value: number | null | undefined
  column: keyof ProjectPatch
  edit: boolean
  save: (patch: ProjectPatch) => Promise<unknown>
}) {
  if (!edit) return <Field label={label} value={value} />
  return (
    <EditField
      label={label}
      value={value === null || value === undefined ? '' : String(value)}
      onSave={(next) => {
        if (next === null) return save({ [column]: null } as ProjectPatch)
        const n = Number(next.replace(/[\s,£$]/g, ''))
        if (!Number.isFinite(n)) throw new Error('Numbers only.')
        return save({ [column]: n } as ProjectPatch)
      }}
    />
  )
}

/** Form Block 8 / creative link form: 40% wide, 2rem in from the left. */
function Form({ children }: { children: React.ReactNode }) {
  return <div className="edit-form">{children}</div>
}

/** App subtitle wraps: the tab's own subtitle, and the button that adds to it. */
type MenuItem = {
  label: string
  onClick?: () => void
  /** Choices of its own: clicking swaps the row for these, as CREATE does on
   *  the Contracting tab. An item with neither onClick nor menu is drawn
   *  disabled. */
  menu?: MenuItem[]
}

function PaneBar({
  title,
  action,
  onAction,
  menu,
}: {
  title: string
  action?: string
  /** Without one the button stays disabled — most of these panes have no
      create flow behind them yet, and a live button that does nothing is
      worse than one that says so. */
  onAction?: () => void
  /** contract-btn-swap: the button gives way to these choices when clicked,
      and they stay until the tab is left. An item with no onClick is drawn
      disabled, for the same reason as above. */
  menu?: MenuItem[]
}) {
  /** null while the action button is still showing; otherwise the choices on
   *  screen, which a nested item swaps for its own. */
  const [shown, setShown] = useState<MenuItem[] | null>(null)
  const live = (m: MenuItem) => Boolean(m.onClick || m.menu?.length)
  return (
    <div className="pane-bar">
      <div className="pane-title">{title}</div>
      {action && shown && (
        <div className="pane-menu">
          {shown.map((m) => (
            <button
              key={m.label}
              type="button"
              className="btn btn-mono btn-outline"
              disabled={!live(m)}
              onClick={m.menu ? () => setShown(m.menu!) : m.onClick}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {action && !shown && (
        <button
          type="button"
          className="btn btn-mono btn-outline"
          disabled={menu ? !menu.some(live) : !onAction}
          onClick={menu ? () => setShown(menu) : onAction}
        >
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
  onAction,
  menu,
  open,
  rowClass,
  empty,
  state,
  variant,
  row,
  link,
}: {
  title: string
  action?: string
  onAction?: () => void
  menu?: MenuItem[]
  /** A row that opens something in place (a modal) rather than a page. */
  open?: (item: T) => (() => void) | null
  rowClass?: (item: T) => string
  empty: string
  state: List<T>
  variant: 'quote' | 'invoice' | 'bill' | 'asset' | 'brief' | 'contract' | 'song'
  row: (item: T) => React.ReactNode
  /**
   * Where a row goes when it has somewhere to go. Track makes the whole row a
   * stretched link rather than putting a click handler on one cell, so that
   * middle-click and open-in-new-tab work; a React `Link` is an anchor, which
   * gets the same for free. Returning null leaves the row as a plain div —
   * most of these lists have no page behind them yet.
   */
  link?: (item: T) => string | null
}) {
  return (
    <>
      <PaneBar title={title} action={action} onAction={onAction} menu={menu} />
      {state.isPending && (
        <Loader />
      )}
      {state.error && <p className="form-error px-8 py-4">{state.error.message}</p>}
      {/* An empty string suppresses it: the Contracting tab has release forms
          under the same list, so "nothing here yet" would be a lie whenever
          there are forms but no contracts. */}
      {state.data?.length === 0 && empty !== '' && <p className="empty-note">{empty}</p>}
      {state.data?.map((item, i) => {
        const href = link?.(item) ?? null
        const onOpen = open?.(item) ?? null
        const className = `project-row project-row-${variant}${onOpen ? ' is-openable' : ''}${rowClass ? rowClass(item) : ''}`
        return href ? (
          <Link key={i} to={href} className={className}>
            {row(item)}
          </Link>
        ) : (
          <div key={i} className={className} onClick={onOpen ?? undefined}>
            {row(item)}
          </div>
        )
      })}
    </>
  )
}

const Title = ({ children }: { children: React.ReactNode }) => <span className="row-title">{children}</span>
const Cell = ({ children }: { children: React.ReactNode }) => <span className="row-field">{children}</span>

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

/** The project's Studio record, for the Music tab's OPEN STUDIO button. */
function useStudioId(projectId: number) {
  return useQuery({
    queryKey: ['studio-id', projectId],
    enabled: Number.isFinite(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects_mirror')
        .select('id')
        .eq('xano_id', String(projectId))
        .maybeSingle()
      if (error) throw error
      return data?.id ?? null
    },
  })
}

export default function Project() {
  const { id } = useParams()
  const projectId = Number(id)
  const project = useProject(projectId)
  // ?tab=briefs (the brief-submitted email) or ?tab=playlists opens that tab.
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = (params.get('tab') ?? '').toLowerCase()
    return TABS.find((t) => t.toLowerCase() === wanted) ?? 'Overview'
  })

  const quotes = useProjectQuotes(projectId)
  const invoices = useProjectInvoices(projectId)
  // Supplier bills live in QuickBooks, not Supabase. They are fetched in the
  // background as soon as the page opens (Andy, 25 Sep 2026) so the Bills tab
  // is ready when clicked; the loader only shows if it is clicked before the
  // QuickBooks call has come back. Cached for 5 minutes (useProjectBills).
  const billsQuery = useProjectBills(projectId, true)
  const bills = {
    isPending: billsQuery.isPending,
    error: billsQuery.error ?? (billsQuery.data && !billsQuery.data.connected
      ? new Error(billsQuery.data.error ?? 'QuickBooks is not connected.')
      : null),
    data: billsQuery.data?.connected ? (billsQuery.data.bills ?? []) : undefined,
  }
  const contracts = useProjectContracts(projectId)
  const releaseForms = useProjectReleaseForms(projectId)
  const briefs = useProjectBriefs(projectId)
  const files = useProjectFiles(projectId)
  const songs = useProjectSongs(projectId)
  const creative = useProjectCreativeLinks(projectId)
  const studioId = useStudioId(projectId)
  const navigate = useNavigate()

  // Staff see boxes, everyone else sees the page as it was. The gate that
  // counts is the update policy in the database, not this.
  const staff = useIsStaff()
  const edit = staff.data === true
  const lookups = useProjectLookups()
  const people = useProjectPeople()
  const saveProject = useSaveProject(projectId)
  const requestBrief = useRequestBrief(projectId)
  const [briefShare, setBriefShare] = useState<ShareState | null>(null)
  const [briefView, setBriefView] = useState<Brief | null>(null)
  const [assetModal, setAssetModal] = useState<AssetModalMode | null>(null)
  const [contractModal, setContractModal] = useState<ContractModalMode | null>(null)
  const [releaseModal, setReleaseModal] = useState<ReleaseFormMode | null>(null)
  const [newSong, setNewSong] = useState(false)
  // row_flash: the row just saved blinks, then stops.
  const [flash, setFlash] = useState<string | null>(null)
  const flashRow = (uuid: string) => {
    setFlash(uuid)
    window.setTimeout(() => setFlash((f) => (f === uuid ? null : f)), 1600)
  }

  // REQUEST BRIEF: the modal opens at once and fills in when the token lands.
  const onRequestBrief = () => {
    if (requestBrief.isPending) return
    setBriefShare({ kind: 'pending' })
    requestBrief.mutate(false, {
      onSuccess: (m) =>
        setBriefShare({ kind: 'ready', link: briefLink(m.share_token), expires: m.expires_at }),
      onError: () => setBriefShare({ kind: 'failed' }),
    })
  }

  // CREATE BRIEF: the supervisor fills the same form in, in a new tab. The tab
  // is opened NOW, blank, while the click still counts — one opened after the
  // mint returns is blocked as a popup.
  const onCreateBrief = () => {
    if (requestBrief.isPending) return
    const tab = window.open('about:blank', '_blank')
    requestBrief.mutate(true, {
      onSuccess: (m) => {
        const url = briefLink(m.share_token, true)
        if (tab && !tab.closed) tab.location.href = url
        else window.location.href = url
        // Back on this tab after filling it in: show the brief as Submitted.
        // Focus, as the old app has it, or the tab becoming visible again —
        // whichever comes first.
        const back = () => {
          if (document.visibilityState !== 'visible') return
          window.removeEventListener('focus', back)
          document.removeEventListener('visibilitychange', back)
          void briefs.refetch()
        }
        window.addEventListener('focus', back)
        document.addEventListener('visibilitychange', back)
      },
      onError: () => {
        tab?.close()
        window.alert("Couldn't create the brief. Please try again.")
      },
    })
  }
  const [quoting, setQuoting] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const save = (patch: ProjectPatch) => saveProject.mutateAsync(patch)

  if (project.isPending) {
    return (
      <Loader />
    )
  }
  if (project.error) {
    return <p className="form-error px-8 py-4">{project.error.message}</p>
  }
  if (!project.data) {
    return <p className="empty-note py-6">No project with that id, or you do not have access to it.</p>
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
        <Stat label="Active" value={ageInDays(p.created_at, p.closed_cancelled_date)} className="ml-0 mr-8" />
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
              <TextField label="Title" value={p.title} column="title" edit={edit} save={save} />
              <PickField
                label="Status"
                value={p.status_id}
                label_={p.stage}
                column="projects_status"
                options={lookups.data?.stages}
                edit={edit}
                save={save}
              />
              <TextField
                label="Campaign Name"
                value={p.campaign_name}
                column="campaignname"
                edit={edit}
                save={save}
              />
              {/* Stored as text, not a date — Xano's own choice, and changing
                  it is a migration rather than a form decision. */}
              <TextField
                label="Proposed Start Date"
                value={p.proposed_start_date}
                column="proposed_start_date"
                edit={edit}
                save={save}
              />
              <NumberField
                label="Projected Pipeline GBP"
                value={p.pipeline_gbp}
                column="pipeline_gbp"
                edit={edit}
                save={save}
              />
              <PickField
                label="Supervisor"
                value={p.supervisor_id}
                label_={p.supervisor}
                column="music_supervisor"
                options={people.data?.supervisors}
                edit={edit}
                save={save}
              />
              <PickField
                label="Service"
                value={p.service_id}
                label_={p.service}
                column="services_id"
                options={lookups.data?.services}
                edit={edit}
                save={save}
              />
            </Form>
          </>
        )}

        {tab === 'Client' && (
          <>
            <PaneBar title="client" />
            <Form>
              {/* On Track this first field is a search that picks the user;
                  here it is a list of the 130 agency, brand and freelance
                  contacts, which is short enough not to need one. */}
              <PickField
                label="User"
                value={p.client_user_id}
                label_={p.client_user}
                column="client_user_id"
                options={people.data?.clientUsers}
                edit={edit}
                save={save}
              />
              <PickField
                label="Client"
                value={p.client_group_id}
                label_={p.client_group}
                column="client"
                options={lookups.data?.clientGroups}
                edit={edit}
                save={save}
              />
              {/* Editable, and it does NOT move the Sequel No. The brand code
                  in "271-KNO-26-II" is fixed the moment the project is created;
                  renaming the brand afterwards would otherwise silently
                  renumber a job that has already been quoted. */}
              <TextField label="Brand" value={p.brand} column="brand" edit={edit} save={save} />
              <TextField label="Product" value={p.product} column="product" edit={edit} save={save} />
              <TextField label="Brand No." value={p.brand_no} column="brand_no" edit={edit} save={save} />
              <PickField
                label="AdPro Lead"
                value={p.adpro_user_id}
                label_={p.adpro_lead}
                column="adpro_user"
                options={people.data?.adpros}
                edit={edit}
                save={save}
              />
              <PickField
                label="Brand Category"
                value={p.brand_category_id}
                label_={p.brand_category}
                column="brand_category"
                options={lookups.data?.brandCategories}
                edit={edit}
                save={save}
              />
              <PickField
                label="Agency"
                value={p.agency_id}
                label_={p.agency}
                column="client_agency"
                options={lookups.data?.agencies}
                edit={edit}
                save={save}
              />
              {/* Free text on the record, and the spellings in use disagree —
                  "United States" on 17 projects, "United States of America" on
                  one. A picker would be the fix; `countries_list` is not it,
                  since it does not hold "United Kingdom" either. */}
              <TextField label="Country" value={p.country} column="country" edit={edit} save={save} />
              {/* The agency's region, not the project's. Editing it here would
                  move every project that agency has. */}
              <Field label="Region" value={p.region} />
            </Form>
          </>
        )}

        {tab === 'Terms' && (
          <>
            <PaneBar title="Terms" />
            <Form>
              <TextField label="Term" value={p.term} column="term" edit={edit} save={save} />
              <TextField label="Territory" value={p.territory} column="territory" edit={edit} save={save} />
              {/* Media and Scripts are the two textareas on Track. */}
              <TextField label="Media" value={p.media} column="media" textarea edit={edit} save={save} />
              <TextField
                label="Scripts"
                value={p.scripts}
                column="scripts"
                textarea
                edit={edit}
                save={save}
              />
              <TextField label="Durations" value={p.durations} column="durations" edit={edit} save={save} />
              <BoolField label="Cutdowns" value={p.cutdowns} column="cutdowns" edit={edit} save={save} />
              <BoolField
                label="Extension"
                value={p.extension_yn}
                column="extension_yn"
                edit={edit}
                save={save}
              />
            </Form>
          </>
        )}

        {tab === 'Assets' && (
          <Rows<ProjectFile>
            title="Assets"
            action="+ New ASSET"
            onAction={edit ? () => setAssetModal({ kind: 'upload' }) : undefined}
            empty="Nothing here yet, click the New Asset button to get started"
            state={files}
            variant="asset"
            // The row body opens the file's share page in a new tab; the tag,
            // share and delete cells are their own targets.
            open={(f) => (f.uuid ? () => openAssetPage(f.uuid) : null)}
            rowClass={(f) => (f.uuid === flash ? ' is-flashing' : '')}
            row={(f) => (
              <>
                <Title>{f.description || f.file_name}</Title>
                <Cell>{f.file_name}</Cell>
                <Cell>{formatBytes(f.file_size)}</Cell>
                <Cell>{fmt(shortDate, f.created_at)}</Cell>
                {/* asset_row_tag is hidden rather than blank when untagged:
                    assets filed before tags existed have none. For staff the
                    cell is the edit trigger, pill or not. */}
                {edit ? (
                  <button
                    type="button"
                    className="row-tag-cell"
                    aria-label="Edit this file"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setAssetModal({ kind: 'edit', asset: f })
                    }}
                  >
                    {f.asset_tag && <span className="row-flag">{f.asset_tag}</span>}
                  </button>
                ) : (
                  <span>{f.asset_tag && <span className="row-flag">{f.asset_tag}</span>}</span>
                )}
                {edit && <AssetRowActions asset={f} projectId={projectId} />}
              </>
            )}
          />
        )}

        {assetModal && projectId !== undefined && (
          <AssetModal
            mode={assetModal}
            projectId={projectId}
            onClose={() => setAssetModal(null)}
            onSaved={flashRow}
          />
        )}

        {quoting && projectId !== undefined && (
          <NewQuote
            projectId={projectId}
            prefill={{
              clientId: p.agency_id ?? null,
              term: p.term ?? '',
              territory: p.territory ?? '',
              media: p.media ?? '',
              scripts: p.scripts ?? '',
              // ⚠️ The project column is `durations`, plural; the quote field
              // is Duration, singular. Not a typo.
              duration: p.durations ?? '',
              cutdowns: typeof p.cutdowns === 'boolean' ? p.cutdowns : null,
              // ⚠️ proposed_*, never confirmed_* — those record the track that
              // was actually signed off, and a draft quote must not read from
              // or overwrite them.
              songName: p.proposed_song ?? '',
              artistName: p.proposed_artist ?? '',
            }}
            onClose={() => setQuoting(false)}
            /* ⚠️ Closes back onto the Estimates list, which refreshes itself —
               the old app's behaviour, and the right one. Sending someone to
               the quote document mid-flow takes them off the project, and
               raising two estimates in a row then means navigating back for
               the second. The new row links to the document if they want it. */
            onCreated={() => setQuoting(false)}
          />
        )}

        {invoicing && projectId !== undefined && (
          <NewInvoice
            projectId={projectId}
            /* The agency is who gets billed, the same prefill the quote wizard
               uses and the same one the old app applies. */
            prefill={{ clientId: p.agency_id ?? null }}
            onClose={() => setInvoicing(false)}
            /* Closes back onto the Invoicing list, as raising an estimate
               closes back onto Estimates. */
            onCreated={() => setInvoicing(false)}
          />
        )}

        {tab === 'Estimates' && (
          <Rows<Quote>
            title="ESTIMATES"
            action="CREATE ESTIMATE"
            onAction={edit ? () => setQuoting(true) : undefined}
            empty="Nothing here yet, click the Create Estimate button to get started"
            state={quotes}
            variant="quote"
            link={(q) => (q.uuid ? `/quotes/${q.uuid}` : null)}
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
                  <span className="row-cost-symbol">{q.currency_code ?? q.currency_symbol}</span>
                  <span className="row-field">{formatMoney(q.grand_total_amount)}</span>
                </span>
                <Cell>{fmt(shortDate, q.created_at)}</Cell>
                {edit && <QuoteRowActions quote={q} projectId={projectId} />}
              </>
            )}
          />
        )}

        {tab === 'Briefs' && (
          <Rows<Brief>
            title="Briefs"
            action="+ NEW BRIEF"
            menu={[
              { label: 'REQUEST BRIEF', onClick: edit ? onRequestBrief : undefined },
              { label: 'CREATE BRIEF', onClick: edit ? onCreateBrief : undefined },
              {
                label: 'UPLOAD BRIEF',
                onClick: edit ? () => setAssetModal({ kind: 'brief' }) : undefined,
              },
            ]}
            empty="No briefs yet. Request one from the client or add it yourself."
            state={briefs}
            variant="brief"
            // Only a submitted brief has anything to open.
            open={(b) => (b.status === 'Submitted' ? () => setBriefView(b) : null)}
            row={(b) => (
              <>
                <Title>{briefSummary(b)}</Title>
                {/* An uploaded brief says what kind of file it is. */}
                <Cell>{b.source === 'upload' ? fileTypeLabel(b.file_type, b.file_name) : b.brief_type}</Cell>
                <Cell>{briefState(b)}</Cell>
                <Cell>{fmt(longDate, b.submitted_at ?? b.created_at)}</Cell>
                {edit && <BriefRowActions brief={b} projectId={projectId} />}
              </>
            )}
          />
        )}

        {briefShare && <BriefShareModal state={briefShare} onClose={() => setBriefShare(null)} />}
        {briefView !== null && (
          <BriefViewModal brief={briefView} project={p} onClose={() => setBriefView(null)} />
        )}

        {tab === 'Music' && (
          <>
            <PaneBar
              title="Music"
              action="Open Studio"
              onAction={studioId.data ? () => navigate(`/studio/${studioId.data}`) : undefined}
            />
            {/* Both minted by Studio when a project gets its upload inbox, so
                neither is ours to type over. A project created in Track now
                gets that inbox too — see the studio_record trigger. */}
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
            onAction={edit ? () => setInvoicing(true) : undefined}
            empty="Nothing here yet, click the New invoice button to get started"
            state={invoices}
            variant="invoice"
            link={(i) => (i.uuid ? `/invoices/${i.uuid}` : null)}
            row={(i) => (
              <>
                <Title>{i.description || 'Untitled invoice'}</Title>
                {/* Symbol and amount in one cell, as on the estimates list —
                    in separate columns they sat a column-width apart. */}
                <span className="row-cost">
                  <span className="row-cost-symbol">{i.currency_symbol}</span>
                  <span className="row-field">{formatMoney(i.total_amount)}</span>
                </span>
                <Cell>{i.invoice_number}</Cell>
                <Cell>{fmt(shortDate, i.invoice_date)}</Cell>
                <Cell>{i.status}</Cell>
                {edit && <InvoiceRowActions invoice={i} projectId={projectId} />}
              </>
            )}
          />
        )}

        {tab === 'Bills' && (
          <Rows<QboBill>
            title="bills"
            empty="No supplier bills for this project yet"
            state={bills}
            variant="bill"
            link={(b) => (b.invoice_uuid ? `/invoices/${b.invoice_uuid}` : null)}
            row={(b) => (
              <>
                <Title>{b.vendor_name}</Title>
                <Cell>{formatMoney(b.total, b.currency)}</Cell>
                <Cell>{b.invoice_number ?? ''}</Cell>
                <Cell>{fmt(shortDate, b.txn_date)}</Cell>
                <Cell>{b.due_date ? `Due ${fmt(shortDate, b.due_date)}` : ''}</Cell>
                <SupplierInvoiceCell bill={b} />
              </>
            )}
          />
        )}

        {tab === 'Songs' && (
          <Rows<Song>
            title="Songs"
            action="+ NEW SONG"
            onAction={edit && projectId !== undefined ? () => setNewSong(true) : undefined}
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

        {newSong && projectId !== undefined && (
          <NewSongModal projectId={projectId} onClose={() => setNewSong(false)} />
        )}

        {tab === 'Contracting' && (
          <Rows<ContractRow>
            title="Contracting"
            action="+ New CONTRACT"
            // contract-btn-swap: the button gives way to the choices, as on
            // Track.
            //
            // ⚠️ CREATE CONTRACT turned out to be THREE things, not one — Andy,
            // 18 Sep. Upload and the release form are one click each; the two
            // licences sit behind CREATE, which opens them as its own step
            // (Andy, 19 Sep) because they are the same kind of thing as each
            // other and a different kind from the first two.
            //
            // Only the release form is built. The composition licence waits on
            // how its invoice number gets onto the page; the library contract
            // is not written at all, and cannot be a copy of the composition
            // one, because that catalogue is third-party.
            menu={[
              {
                label: 'UPLOAD CONTRACT',
                onClick: edit ? () => setContractModal({ kind: 'upload' }) : undefined,
              },
              {
                label: 'CREATE CONTRACT',
                menu: [
                  { label: 'LIBRARY CONTRACT', onClick: undefined },
                  { label: 'COMPOSITION CONTRACT', onClick: undefined },
                ],
              },
              // ⚠️ LAST — Andy, 20 Sep. The two contract buttons belong beside
              // each other; the release form is a different kind of document
              // and reads better at the end than wedged between them.
              {
                label: '+ RELEASE FORM',
                onClick: edit ? () => setReleaseModal({ kind: 'new' }) : undefined,
              },
            ]}
            empty={releaseForms.data?.length ? '' : 'Nothing here yet.  Upload a file or create a contract to get started'}
            state={contracts}
            variant="contract"
            // The row opens the edit form, as on Track.
            open={(c) => (edit ? () => setContractModal({ kind: 'edit', contract: c }) : null)}
            rowClass={(c) => (c.uuid === flash ? ' is-flashing' : '')}
            row={(c) => (
              <>
                <Title>{c.supplier}</Title>
                {/* The tab holds two kinds of document and they are not the
                    same thing at all — one is what Sequel licensed IN, the
                    other what it told a broadcaster. The row says which
                    (Andy, 19 Sep) before it says anything else about it. */}
                <Cell>Contract</Cell>
                <Cell>{c.contract_type}</Cell>
                {/* Where the invoice row puts its number: after what the record
                    is, before when it happened. The string is the database's
                    (`track_ref`), never rebuilt here. */}
                <Cell>{c.ref}</Cell>
                <Cell>{fmt(longDate, c.created_at)}</Cell>
                {edit && <ContractRowActions contract={c} projectId={projectId} />}
              </>
            )}
          />
        )}


        {/* Release forms continue the same list — no second header and no
            second empty note. A release form is not a contract, but the row
            says which it is without a heading over it, and two headers on one
            short tab read as clutter (Andy, 19 Sep). */}
        {tab === 'Contracting' &&
          releaseForms.data?.map((r) => (
            <div
              key={r.uuid}
              className={`project-row project-row-release${edit ? ' is-openable' : ''}`}
              onClick={edit ? () => setReleaseModal({ kind: 'edit', form: r }) : undefined}
            >
              {/* ⚠️ The first column is WHO THE DOCUMENT IS FROM, which is
                  what it means on a contract row — the supplier who licensed
                  the music in. A release form comes from Sequel, so it says
                  Sequel, not the broadcaster it went to (Andy, 19 Sep). It is
                  the same word on every row, and that is the point: the two
                  lists read the same way down the page. */}
              <Title>Sequel</Title>
              <Cell>Release Form</Cell>
              <Cell>{r.track_name}</Cell>
              <Cell>{r.ref}</Cell>
              <Cell>{fmt(longDate, r.created_at)}</Cell>
              {edit && <ReleaseFormRowActions form={r} projectId={projectId} />}
            </div>
          ))}

        {releaseModal && projectId !== undefined && (
          <ReleaseFormModal
            mode={releaseModal}
            projectId={projectId}
            // Everything the project already knows, including the four off the
            // Terms tab. All of it is editable in the modal — what a
            // broadcaster is told is often narrower than what the project holds.
            prefill={{
              brand: p.brand ?? '',
              campaign: p.title ?? '',
              term: p.term ?? '',
              territory: p.territory ?? '',
              media: p.media ?? '',
              scripts: p.scripts ?? '',
              // ⚠️ DELIBERATELY EMPTY — Andy, 21 Sep. This used to seed the
              // project's own producer. A release form often goes to a
              // broadcaster who is not on the project at all, and seeding it
              // meant a real client's address sat on every form including the
              // tests — which is how one reached Ogilvy. Typed at send time now.
              recipient_email: '',
            }}
            onClose={() => setReleaseModal(null)}
            onIssued={() => void releaseForms.refetch()}
          />
        )}

        {contractModal && projectId !== undefined && (
          <ContractModal
            mode={contractModal}
            projectId={projectId}
            onClose={() => setContractModal(null)}
            onSaved={(uuid) => flashRow(uuid)}
          />
        )}

        {tab === 'Notes' && (
          <>
            <PaneBar title="NOTES" />
            <Form>
              <TextField
                label="Client Notes"
                value={p.notes_or_request}
                column="notesorrequest"
                textarea
                edit={edit}
                save={save}
              />
              <TextField
                label="Internal (Private) Notes"
                value={p.notes}
                column="notes"
                textarea
                edit={edit}
                save={save}
              />
            </Form>
          </>
        )}
      </div>
    </>
  )
}
