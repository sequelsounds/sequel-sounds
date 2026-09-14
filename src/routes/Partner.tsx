import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { EditField, EditSelect, ReadOnlyField } from '../components/staff/EditField'
import { usePartner } from '../lib/xanoMirror'
import { useCountries, useSaveSupplier, type SupplierPatch } from '../lib/supplierWrites'

/**
 * One supplier — Sequel Track's `/partner-edit`, rebuilt, and the first page
 * in the rebuild that writes.
 *
 * `supplier_list` came out of Xano's sync task on 13 September 2026, so this
 * table is Supabase's own now and an edit made here survives. It does NOT
 * reach Xano: Track's `/partner-edit` and this page have been separate copies
 * of the same supplier since that date. See `lib/supplierWrites.ts`.
 *
 * Track saves each field on blur with no submit button, and that is kept.
 * What is not kept is Track's silence about it — every field there fires a
 * request and the page says nothing either way, so a refused write is
 * indistinguishable from a saved one until a reload. Here each field reports
 * itself, which matters more on this side because the database refuses some of
 * these writes deliberately.
 *
 * Three things on Track's version are unfinished, and the first two are still
 * recreated rather than quietly repaired:
 *
 *  1. **The three tiles are empty and always will be.** Labelled Demos, Wins
 *     and Win Fees, bound to `project_service_type`, `project_sequel_no` and
 *     `project_status` — left over from duplicating `/project`. They are bound
 *     to a project that does not exist on this page, so they render nothing.
 *  2. **The Projects tab is empty markup.** Not an empty state — no markup.
 *  3. **The eyebrow said "Roster"** on a page showing a sync rep, because the
 *     page was duplicated from `/roster-edit`. That one IS fixed: it was a
 *     one-word mistake with nothing behind it, and reproducing a wrong label
 *     on a page people now actually edit is not faithfulness, it is a bug.
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

export default function Partner() {
  const { uuid } = useParams()
  const partner = usePartner(uuid)
  const countries = useCountries()
  const save = useSaveSupplier(uuid)
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
  const put = (patch: SupplierPatch) => save.mutateAsync({ id: p.id, patch })
  const text = (column: keyof SupplierPatch) => (next: string | null) =>
    put({ [column]: next } as SupplierPatch)

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Partners</div>
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
            <EditField label="Partner Name" value={p.title} onSave={text('title')} />
            <EditField label="Bio" value={p.bio} textarea onSave={text('bio')} />
            <EditField label="Strengths" value={p.strengths} onSave={text('strengths')} />
          </div>
        )}

        {tab === 'Contact' && (
          <div className="edit-form">
            <EditField label="Briefing Email" value={p.brief_email} onSave={text('brief_email')} />
            <EditField
              label="Contact Number"
              value={p.phone_number}
              onSave={text('phone_number')}
            />
            <EditField label="Website" value={p.website} onSave={text('website')} />
            <EditField label="City" value={p.city} onSave={text('city')} />
            {/* Country is an FK to countries_list, which is why it is a select
                and why it writes `countries_list_id` rather than the text the
                view joins in. `Country_to_delete` is the legacy text column and
                nothing here touches it. */}
            <EditSelect
              label="Country"
              value={p.country_id}
              options={(countries.data ?? []).map((c) => ({ id: c.id, label: c.country ?? '—' }))}
              onSave={(next) => put({ countries_list_id: next })}
            />
            <EditField
              label="Creative Contact 1 Name"
              value={p.creative_team_member_1_name}
              onSave={text('creative_team_member_1_name')}
            />
            <EditField
              label="Creative Contact 1 Email"
              value={p.creative_team_member_1_email}
              onSave={text('creative_team_member_1_email')}
            />
            <EditField
              label="Creative Contact 2 Name"
              value={p.creative_team_member_2_name}
              onSave={text('creative_team_member_2_name')}
            />
            <EditField
              label="Creative Contact 2 Email"
              value={p.creative_team_member_2_email}
              onSave={text('creative_team_member_2_email')}
            />
            <EditField
              label="Creative Contact 3 Name"
              value={p.creative_team_member_3_name}
              onSave={text('creative_team_member_3_name')}
            />
            <EditField
              label="Creative Contact 3 Email"
              value={p.creative_team_member_3_email}
              onSave={text('creative_team_member_3_email')}
            />
            <EditField
              label="Clearance Contact 1 Name"
              value={p.clearance_contact_name_1}
              onSave={text('clearance_contact_name_1')}
            />
            <EditField
              label="Clearance Contact 1 Email"
              value={p.clearance_contact_email_1}
              onSave={text('clearance_contact_email_1')}
            />
            <EditField
              label="Clearance Contact 2 Name"
              value={p.clearance_contact_name_2}
              onSave={text('clearance_contact_name_2')}
            />
            <EditField
              label="Clearance Contact 2 Email"
              value={p.clearance_contact_email_2}
              onSave={text('clearance_contact_email_2')}
            />
          </div>
        )}

        {/* Empty on Track — no markup in the pane at all, not an empty state.
            Kept empty so the two pages agree. */}
        {tab === 'Projects' && null}

        {tab === 'Finance' && (
          <div className="edit-form">
            {/* ⚠️ NOT editable here, on purpose, and the one field on this page
                that is a real gap rather than a copy of one.

                Track edits it through a picker that lists QuickBooks' own
                vendors as "Name — CURRENCY", because QuickBooks ties a vendor
                to one currency and the same supplier can exist twice —
                "Audio Network GBP" and "Audio Network Milan". Without the
                currency the two are indistinguishable and a bill goes to the
                wrong entity. The mirror holds only the id, so a text box here
                would be a raw id typed by hand into exactly that trap.

                The database already refuses this column to anyone who is not
                finance (supplier_list_write_guard), so the guard is in place
                and waiting for the picker rather than the other way round. */}
            <ReadOnlyField
              label="QuickBooks Vendor"
              value={p.qbo_vendor_id}
              note="needs the vendor picker"
            />
            <EditField
              label="Finance Email"
              value={p.finance_email}
              onSave={text('finance_email')}
            />
            {/* QuickBooks is the source of truth for a vendor's billing address
                and Xano stores no copy, so there is nothing in the mirror to
                read. An unlinked supplier has no address anywhere in the
                system. */}
            <ReadOnlyField
              label="Billing Address (from QuickBooks)"
              value=""
              note="lives in QuickBooks"
            />
          </div>
        )}
      </div>
    </>
  )
}
