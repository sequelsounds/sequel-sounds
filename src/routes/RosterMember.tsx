import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { EditEnum, EditField, EditSelect } from '../components/staff/EditField'
import { QboBillingAddress, QboVendorField } from '../components/staff/QboVendorField'
// The house format for a GBP figure on a stats band: rounded to the pound, the
// same as /management and /dashboard. Pennies belong on an invoice, not a tile.
import { money } from '../components/staff/reporting'
import { SupplierInvoices } from '../components/staff/SupplierInvoices'
import { useRosterMember, useSupplierStats } from '../lib/xanoMirror'
import {
  BRIEFING_LISTS,
  CA_STATUSES,
  SUPPLIER_TYPES,
  useCountries,
  useSaveSupplier,
  type SupplierPatch,
} from '../lib/supplierWrites'

/**
 * One composition team — Sequel Track's `/roster-edit`, rebuilt, and editable.
 *
 * The page `/partner-edit` was duplicated from, and the one the August notes
 * record as verified working. The same table underneath, so the same write
 * path: `lib/supplierWrites.ts`, and the same caveat — `supplier_list` left
 * Xano's sync on 13 September 2026, so an edit here does not reach Track and
 * an edit on Track does not reach here.
 *
 * The Demos / Wins / Fees tiles were empty on Track and empty here, bound to
 * `project_service_type`, `project_sequel_no` and `project_status` — leftovers
 * from duplicating `/project`. They now count off the invoice lines, to Andy's
 * definitions; see `supplier_stats`. The Projects tab still has no markup at
 * all, on either side.
 */

const TABS = ['Overview', 'Contact', 'Invoices', 'Finance'] as const
type Tab = (typeof TABS)[number]

function Stat({
  label,
  value,
  className = '',
}: {
  label: string
  value: string | number
  className?: string
}) {
  return (
    <div className={`stat ${className}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function RosterMember() {
  const { uuid } = useParams()
  const member = useRosterMember(uuid)
  const stats = useSupplierStats(member.data?.id)
  const countries = useCountries()
  const save = useSaveSupplier(uuid)
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
  const put = (patch: SupplierPatch) => save.mutateAsync({ id: m.id, patch })
  const text = (column: keyof SupplierPatch) => (next: string | null) =>
    put({ [column]: next } as SupplierPatch)

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Roster</div>
        <div className="title-row">
          <h1 className="page-title">{m.title ?? `Untitled (#${m.id})`}</h1>
        </div>
        <div className="page-subtitle">Edit our partners&rsquo; details...</div>
      </div>

      {/* Empty on Track, because the bindings behind these three labels belong
          to a project — they came across when this page was duplicated from
          /project and were never repointed. Counted off the invoice lines
          here; the arithmetic is in the supplier_stats view.
          ⚠️ Fees is in STERLING, unlike every other money figure on this page,
          which is why the tile says so. */}
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
            {/* "Composition Team Name" here, "Partner Name" on the partner
                page — the same column, labelled for who is being looked at. */}
            <EditField label="Composition Team Name" value={m.title} onSave={text('title')} />
            <EditField
              label="Composition Show Reel"
              value={m.composition_showreel}
              onSave={text('composition_showreel')}
            />
            <EditField
              label="Sound Design Showreel"
              value={m.sounddesign_showreel}
              onSave={text('sounddesign_showreel')}
            />
            <EditField
              label="Library Url"
              value={m.library_link}
              onSave={text('library_link')}
            />
            <EditField label="Bio" value={m.bio} textarea onSave={text('bio')} />
            <EditField
              label="Studio"
              value={m.studio_setup}
              textarea
              onSave={text('studio_setup')}
            />
            <EditField label="Strengths" value={m.strengths} onSave={text('strengths')} />
            {/* ⚠️ Changing the type off Composition Team moves this record to
                /partners and it disappears from the roster — correct, and
                surprising the first time. The two lists are exactly this
                column. */}
            <EditEnum
              label="Supplier Type"
              value={m.supplier_type}
              options={SUPPLIER_TYPES}
              note="anything but Composition Team leaves the Roster"
              onSave={(next) => put({ supplier_type: next })}
            />
            <EditEnum
              label="Briefing List"
              value={m.briefing_list}
              options={BRIEFING_LISTS}
              onSave={(next) => put({ briefing_list: next })}
            />
            <EditEnum
              label="Composer Agreement"
              value={m.ca_status}
              options={CA_STATUSES}
              note="blank reads as Not Sent"
              onSave={(next) => put({ ca_status: next })}
            />
          </div>
        )}

        {tab === 'Contact' && (
          <div className="edit-form">
            {/* "Contact Email" here, "Briefing Email" on the partner page.
                Same column, Brief_Email. */}
            <EditField label="Contact Email" value={m.brief_email} onSave={text('brief_email')} />
            <EditField
              label="Contact Number"
              value={m.phone_number}
              onSave={text('phone_number')}
            />
            <EditField label="Website" value={m.website} onSave={text('website')} />
            <EditField label="City" value={m.city} onSave={text('city')} />
            {/* An FK to countries_list, so a select writing `countries_list_id`
                rather than the text the view joins in. */}
            <EditSelect
              label="Country"
              value={m.country_id}
              options={(countries.data ?? []).map((c) => ({ id: c.id, label: c.country ?? '—' }))}
              onSave={(next) => put({ countries_list_id: next })}
            />
          </div>
        )}

        {/* ⚠️ This tab has NO MARKUP AT ALL on Track — not an empty state, not a
            heading, nothing was ever built. So there is nothing to reproduce,
            and it is invoices rather than projects because an invoice line is
            the only place a supplier is actually named. Andy's call. */}
        {tab === 'Invoices' && <SupplierInvoices supplierId={m.id} />}

        {tab === 'Finance' && (
          <div className="edit-form">
            {/* The old app's vendor picker, finance only. Choosing a vendor
                saves its id and currency together; the database refuses both
                to anyone who is not finance (supplier_list_write_guard). */}
            <QboVendorField supplierId={m.id} uuid={uuid} vendorId={m.qbo_vendor_id} />
            <EditField
              label="Finance Email"
              value={m.finance_email}
              onSave={text('finance_email')}
            />
            {/* Read from QuickBooks, never stored here. */}
            <QboBillingAddress vendorId={m.qbo_vendor_id} />
          </div>
        )}
      </div>
    </>
  )
}
