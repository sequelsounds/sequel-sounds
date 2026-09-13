import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { usePartner } from '../lib/xanoMirror'

/**
 * One supplier — Sequel Track's `/partner-edit`, rebuilt.
 *
 * The August notes had this page built but never once loaded. It loads. What
 * loading it shows is that three things on Track's own version are unfinished,
 * and this recreates all three rather than quietly repairing them:
 *
 *  1. **The three tiles are empty and always will be.** They are labelled
 *     Demos, Wins and Win Fees, and their bindings are `project_service_type`,
 *     `project_sequel_no` and `project_status` — left over from duplicating
 *     `/project`, which the notes predicted in August. They are bound to a
 *     project that does not exist on this page, so they render nothing.
 *  2. **The Projects tab is empty markup.** Not an empty state — no markup at
 *     all.
 *  3. **The eyebrow says "Roster".** Stoddart Music is a Sync Rep, not a
 *     composition team; the line came across when the page was duplicated from
 *     `/roster-edit` and was never changed.
 *
 * Read-only, so Track's save-on-blur behaviour is not here and the controls say
 * so. The one field this cannot fill is the billing address: it is read live
 * from QuickBooks and deliberately not stored in Xano, so there is nothing in
 * the mirror to show.
 */

const TABS = ['Overview', 'Contact', 'Projects', 'Finance'] as const
type Tab = (typeof TABS)[number]

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

export default function Partner() {
  const { uuid } = useParams()
  const partner = usePartner(uuid)
  const [tab, setTab] = useState<Tab>('Overview')

  if (partner.isPending) {
    return (
      <div className="flex flex-1 justify-center py-16">
        <Loader />
      </div>
    )
  }
  if (partner.error) return <p className="form-error px-8 py-8">{partner.error.message}</p>
  if (!partner.data) return <p className="empty-note py-8">No partner with that link.</p>

  const p = partner.data

  return (
    <>
      <div className="header-band">
        {/* Track's word, not a mistake in the copying: /partner-edit was
            duplicated from /roster-edit and the eyebrow came with it. */}
        <div className="page-eyebrow">Roster</div>
        <div className="title-row">
          <h1 className="page-title">{p.title ?? `Untitled (#${p.id})`}</h1>
        </div>
        <div className="page-subtitle">Edit our partners&rsquo; details...</div>
      </div>

      {/* Three tiles with nothing in them, because on Track there is nothing in
          them: the bindings behind these labels belong to a project. Recreated
          empty rather than filled with something plausible — a number invented
          here would be worse than the blank. */}
      <div className="tab-band">
        <Stat label="Demos" value="" className="mx-0" />
        <div className="tab-band-divider" />
        <Stat label="Wins" value="" />
        <div className="tab-band-divider" />
        <Stat label="Win Fees" value="" />
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
            <Field label="Partner Name" value={p.title} />
            <Field label="Bio" value={p.bio} textarea />
            <Field label="Strengths" value={p.strengths} />
          </div>
        )}

        {tab === 'Contact' && (
          <div className="edit-form">
            <Field label="Briefing Email" value={p.brief_email} />
            <Field label="Contact Number" value={p.phone_number} />
            <Field label="Website" value={p.website} />
            <Field label="Country" value={p.country_text} />
            <Field label="Creative Contact 1 Name" value={p.creative_team_member_1_name} />
            <Field label="Creative Contact 1 Email" value={p.creative_team_member_1_email} />
            <Field label="Creative Contact 2 Name" value={p.creative_team_member_2_name} />
            <Field label="Creative Contact 2 Email" value={p.creative_team_member_2_email} />
            <Field label="Creative Contact 3 Name" value={p.creative_team_member_3_name} />
            <Field label="Creative Contact 3 Email" value={p.creative_team_member_3_email} />
            <Field label="Clearance Contact 1 Name" value={p.clearance_contact_name_1} />
            <Field label="Clearance Contact 1 Email" value={p.clearance_contact_email_1} />
            <Field label="Clearance Contact 2 Name" value={p.clearance_contact_name_2} />
            <Field label="Clearance Contact 2 Email" value={p.clearance_contact_email_2} />
          </div>
        )}

        {/* Empty on Track — no markup in the pane at all, not an empty state.
            Kept empty so the two pages agree. */}
        {tab === 'Projects' && null}

        {tab === 'Finance' && (
          <div className="edit-form">
            {/* Track shows the vendor's name and currency, read from QuickBooks
                — the currency matters, because a supplier billing in two
                currencies is two vendors and a bill can go to the wrong one.
                The mirror holds only the id, so the id is what this shows. */}
            <Field label="QuickBooks Vendor" value={p.qbo_vendor_id} />
            <Field label="Finance Email" value={p.finance_email} />
            {/* Deliberately empty. QuickBooks is the source of truth for a
                vendor's billing address and Xano stores no copy, so there is
                nothing in the mirror to read. An unlinked supplier has no
                address anywhere in the system. */}
            <Field label="Billing Address (from QuickBooks)" value="" />
          </div>
        )}
      </div>
    </>
  )
}
