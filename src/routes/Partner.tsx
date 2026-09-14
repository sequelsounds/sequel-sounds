import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { EditEnum, EditField, EditSelect, ReadOnlyField } from '../components/staff/EditField'
// The house format for a GBP figure on a stats band: rounded to the pound, the
// same as /management and /dashboard. Pennies belong on an invoice, not a tile.
import { money } from '../components/staff/reporting'
import { SupplierInvoices } from '../components/staff/SupplierInvoices'
import { usePartner, useSupplierStats } from '../lib/xanoMirror'
import {
  BRIEFING_LISTS,
  CA_STATUSES,
  SUPPLIER_TYPES,
  useCountries,
  useSaveSupplier,
  type SupplierPatch,
} from '../lib/supplierWrites'

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
 *  1. **The three tiles were empty and are not any more.** Labelled Demos,
 *     Wins and Win Fees, they were bound to `project_service_type`,
 *     `project_sequel_no` and `project_status` — left over from duplicating
 *     `/project` — so on Track they render nothing and always have. They are
 *     counted off the invoice lines here, to Andy's definitions, and the last
 *     is now "Fees" because it is every line rather than the winning ones.
 *  2. **The Projects tab is empty markup.** Not an empty state — no markup.
 *  3. **The eyebrow said "Roster"** on a page showing a sync rep, because the
 *     page was duplicated from `/roster-edit`. That one IS fixed: it was a
 *     one-word mistake with nothing behind it, and reproducing a wrong label
 *     on a page people now actually edit is not faithfulness, it is a bug.
 */

const TABS = ['Overview', 'Contact', 'Invoices', 'Finance'] as const
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
  const stats = useSupplierStats(partner.data?.id)
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

      {/* Empty on Track, and empty here until 14 Sep: the pages were duplicated
          from /project and these three came with them, still bound to
          project_service_type, project_sequel_no and project_status. Andy's
          definitions, and the arithmetic is in the supplier_stats view.
          ⚠️ Fees is in STERLING; every other money figure on this page is in
          its own invoice's currency, which is why this one is labelled. */}
      <div className="tab-band">
        <Stat label="Demos" value={stats.data?.demos ?? ''} className="ml-0" />
        <div className="tab-band-divider" />
        <Stat label="Wins" value={stats.data?.wins ?? ''} />
        <div className="tab-band-divider" />
        <Stat
          label="Fees (GBP)"
          value={stats.data ? money(Number(stats.data.fees_gbp)) : ''}
        />
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
            {/* The three enum columns Track never exposed. Its own
                `Patch_supplier` had drifted from all three — every real value
                would have failed input validation — and it went unnoticed
                precisely because no page offered them. The lists come from the
                table, not the endpoint. */}
            <EditEnum
              label="Supplier Type"
              value={p.supplier_type}
              options={SUPPLIER_TYPES}
              note="Composition Team moves this to the Roster"
              onSave={(next) => put({ supplier_type: next })}
            />
            <EditEnum
              label="Briefing List"
              value={p.briefing_list}
              options={BRIEFING_LISTS}
              onSave={(next) => put({ briefing_list: next })}
            />
            <EditEnum
              label="Composer Agreement"
              value={p.ca_status}
              options={CA_STATUSES}
              note="blank reads as Not Sent"
              onSave={(next) => put({ ca_status: next })}
            />
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

        {/* ⚠️ This tab has NO MARKUP AT ALL on Track — not an empty state, not a
            heading, nothing was ever built. So there is nothing to reproduce,
            and it is invoices rather than projects because an invoice line is
            the only place a supplier is actually named. Andy's call. */}
        {tab === 'Invoices' && <SupplierInvoices supplierId={p.id} />}

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
