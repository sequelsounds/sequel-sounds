import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useRosterMember } from '../lib/xanoMirror'

/**
 * One composition team — Sequel Track's `/roster-edit`, rebuilt.
 *
 * The page `/partner-edit` was duplicated from, and the one the August notes
 * record as verified working. It is: every field loads. The two things it
 * shares with its sibling are the two that came from duplicating `/project` —
 * the Demos / Wins / Win Fees tiles are bound to `project_service_type`,
 * `project_sequel_no` and `project_status` and render empty, and the Projects
 * tab has no markup at all. Both recreated, because unlike `/roster`'s filters
 * there is nothing here to make work: the tiles have no source to read.
 *
 * Read-only. Track saves each field on blur; nothing here writes.
 */

const TABS = ['Overview', 'Contact', 'Projects', 'Finance'] as const
type Tab = (typeof TABS)[number]

function Stat({
  label,
  className = '',
}: {
  label: string
  className?: string
}) {
  return (
    <div className={`stat ${className}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value" />
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

export default function RosterMember() {
  const { uuid } = useParams()
  const member = useRosterMember(uuid)
  const [tab, setTab] = useState<Tab>('Overview')

  if (member.isPending) {
    return (
      <div className="flex flex-1 justify-center py-16">
        <Loader />
      </div>
    )
  }
  if (member.error) return <p className="form-error px-8 py-8">{member.error.message}</p>
  if (!member.data) return <p className="empty-note py-8">No composition team with that link.</p>

  const m = member.data

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Roster</div>
        <div className="title-row">
          <h1 className="page-title">{m.title ?? `Untitled (#${m.id})`}</h1>
        </div>
        <div className="page-subtitle">Edit our partners&rsquo; details...</div>
      </div>

      {/* Empty on Track, and empty here: the bindings behind these three
          labels belong to a project. A number invented on this side would be
          worse than the blank. */}
      <div className="tab-band">
        <Stat label="Demos" className="mx-0" />
        <div className="tab-band-divider" />
        <Stat label="Wins" />
        <div className="tab-band-divider" />
        <Stat label="Win Fees" />
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
            {/* "Composition Team Name" here, "Partner Name" on /partner-edit —
                the same column and the same binding, labelled for who is
                being looked at. */}
            <Field label="Composition Team Name" value={m.title} />
            <Field label="Composition Show Reel" value={m.composition_showreel} />
            <Field label="Sound Design Showreel" value={m.sounddesign_showreel} />
            <Field label="Library Url" value={m.library_link} />
            <Field label="Bio" value={m.bio} textarea />
            <Field label="Studio" value={m.studio_setup} />
          </div>
        )}

        {tab === 'Contact' && (
          <div className="edit-form">
            {/* "Contact Email" here, "Briefing Email" on /partner-edit. Same
                column, Brief_Email, and the same binding. */}
            <Field label="Contact Email" value={m.brief_email} />
            <Field label="Contact Number" value={m.phone_number} />
            <Field label="Website" value={m.website} />
            <Field label="Country" value={m.country_text} />
          </div>
        )}

        {/* No markup on Track. Kept empty so the two agree. */}
        {tab === 'Projects' && null}

        {tab === 'Finance' && (
          <div className="edit-form">
            {/* Track resolves this to "SpaceBar Audio — EUR" by calling
                QuickBooks; the currency is load-bearing, because a supplier
                billing in two currencies is two vendors. The mirror holds the
                id alone. */}
            <Field label="QuickBooks Vendor" value={m.qbo_vendor_id} />
            <Field label="Finance Email" value={m.finance_email} />
            {/* QuickBooks is the source of truth for the address and Xano
                keeps no copy, so there is nothing to read. */}
            <Field label="Billing Address (from QuickBooks)" value="" />
          </div>
        )}
      </div>
    </>
  )
}
