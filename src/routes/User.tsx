import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { EditField, EditSelect, ReadOnlyField } from '../components/staff/EditField'
import {
  useIsStaff,
  useTrackUser,
  useUserProjects,
  type ClientProject,
} from '../lib/xanoMirror'
import { useSaveUser, useUserLookups, type Option, type UserPatch } from '../lib/userWrites'

/**
 * One person — Sequel Track's `/view-user`, rebuilt.
 *
 * Four tabs, of which Track has three built and labels the fourth honestly:
 * the Stats tab says "Coming soon!", which is reproduced rather than filled in
 * or hidden. It is the only unbuilt tab in Track that says so.
 *
 * The Projects tab is the same five-column row as the client page's, on the
 * same class — but in a different order: title, brand, number, **service**,
 * **status**, where the client page has status before service. Checked on both
 * pages rather than assumed.
 *
 * Its status column diverges from Track on purpose. Track reads the legacy
 * `project_status` text here — the only page left that does — and that column
 * is dead: its values include Invoicing and Closed, which the status dropdown
 * has no equivalent for. This shows the FK, like every other page.
 *
 * **Editable since 14 Sep**, in the five fields Track edits and no more: Name,
 * User Type, Status, Company and Notes, each saving on its own as Track's do.
 * The set is Xano's `user_edit` (413), not a guess from the table. Email is
 * read-only on both stacks because it is the login.
 *
 * ⚠️ Two things about these edits, both in `userWrites.ts` at length: `user` is
 * still in the hourly sync, so every edit is overwritten on the hour until
 * cutover; and User Type and Status move the DIRECTORY, not the person's
 * ACCESS, which is decided by `public.track_users` and kept in step by nothing.
 */

const TABS = ['Overview', 'Projects', 'Stats', 'Notes'] as const
type Tab = (typeof TABS)[number]

/**
 * "9th Sep, 2026" — the Joined tile's format, ordinal and all.
 *
 * The months are a literal list rather than toLocaleDateString's `short`,
 * which returns "Sept" for September in current ICU and so disagreed with
 * Track on exactly one month of the year.
 */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function joinedDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.getDate()
  const tens = day % 100
  const suffix =
    tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th')
  return `${day}${suffix} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`
}

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

/**
 * The same field, editable, when the reader is staff — the pair the project
 * page uses, for the same reason: the read-only `Field` is a plain input and
 * `EditField` carries save state, a pending ref and an auto-growing textarea.
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
  column: keyof UserPatch
  textarea?: boolean
  edit: boolean
  save: (patch: UserPatch) => Promise<unknown>
}) {
  if (!edit) return <Field label={label} value={value} textarea={textarea} />
  return (
    <EditField
      label={label}
      value={value}
      textarea={textarea}
      onSave={(next) => save({ [column]: next } as UserPatch)}
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
  column: keyof UserPatch
  options: Option[] | undefined
  edit: boolean
  save: (patch: UserPatch) => Promise<unknown>
}) {
  if (!edit) return <Field label={label} value={label_} />
  return (
    <EditSelect
      label={label}
      value={value}
      options={options ?? []}
      onSave={(next) => save({ [column]: next } as UserPatch)}
    />
  )
}

export default function User() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const user = useTrackUser(uuid)
  const projects = useUserProjects(user.data?.id)
  const [tab, setTab] = useState<Tab>('Overview')

  // Staff see boxes, everyone else sees the page as it was. The gate that
  // counts is the update policy in the database, not this.
  const staff = useIsStaff()
  const edit = staff.data === true
  const lookups = useUserLookups()
  const saveUser = useSaveUser(uuid)
  const userId = user.data?.id

  if (user.isPending) {
    return (
      <Loader />
    )
  }
  if (user.error) return <p className="form-error px-8 py-8">{user.error.message}</p>
  if (!user.data) return <p className="empty-note py-8">No user with that link.</p>

  const u = user.data
  const rows = projects.data ?? []
  const save = (patch: UserPatch) => saveUser.mutateAsync({ id: userId!, patch })

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Let&rsquo;s say hello to...</div>
        <div className="title-row">
          <h1 className="page-title">{u.name ?? `Untitled (#${u.id})`}</h1>
        </div>
        <div className="page-subtitle">
          {u.email ? (
            <a href={`mailto:${u.email}`} className="text-inherit no-underline">
              {u.email}
            </a>
          ) : (
            ' '
          )}
        </div>
      </div>

      <div className="tab-band">
        <Stat label="Joined" value={joinedDate(u.created_at)} className="mx-0" />
        <div className="tab-band-divider" />
        <Stat label="Company" value={u.company_name} />
        <div className="tab-band-divider" />
        {/* Counts the same projects the tab lists, so the two cannot disagree. */}
        <Stat label="Projects" value={rows.length} />
        <div className="tab-band-divider" />
        <Stat label="Status" value={u.status_title} />
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
        {tab === 'Overview' && (
          <div className="edit-form">
            <TextField label="Name" value={u.name} column="name" edit={edit} save={save} />
            {/* Read-only on Track too, and refused by the column grants here:
                the email address is the account's login. */}
            {edit ? (
              <ReadOnlyField label="Email" value={u.email} note="the login" />
            ) : (
              <Field label="Email" value={u.email} />
            )}
            <PickField
              label="User Type"
              value={u.user_type}
              label_={u.user_type_title}
              column="user_type"
              options={lookups.data?.userTypes}
              edit={edit}
              save={save}
            />
            <PickField
              label="Status"
              value={u.status}
              label_={u.status_title}
              column="status"
              options={lookups.data?.statuses}
              edit={edit}
              save={save}
            />
            <PickField
              label="Company"
              value={u.company}
              label_={u.company_name}
              column="company"
              options={lookups.data?.companies}
              edit={edit}
              save={save}
            />

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
                {/* Service before status here, the other way round on the
                    client page. Same class, same grid, different order. */}
                <span className="project-list-cell">{p.service_name}</span>
                {/* The FK status, not the legacy text column Track reads
                    here. Track's binding is .Project_Status, which is the old
                    `project_status` text — Andy confirmed 13 Sep that it is
                    dead, so this tab was the last thing showing values like
                    "Invoicing" that no longer mean anything. Deliberate
                    divergence, and the same status every other page shows. */}
                <span className="project-list-cell">{p.stage_text}</span>
              </div>
            ))}
            {projects.data && rows.length === 0 && (
              <p className="empty-note py-6">Nothing here yet</p>
            )}
          </>
        )}

        {/* Track's own words, and the only unbuilt tab in the app that admits
            to being unbuilt. */}
        {tab === 'Stats' && <p className="empty-note py-6">Coming soon!</p>}

        {tab === 'Notes' && (
          <div className="edit-form">
            <TextField label="Notes" value={u.notes} column="notes" textarea edit={edit} save={save} />
          </div>
        )}
      </div>
    </>
  )
}
