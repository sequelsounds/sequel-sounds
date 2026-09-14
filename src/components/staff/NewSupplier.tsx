import { useState } from 'react'
import { COMPOSITION_TEAM, SUPPLIER_TYPES, useCreateSupplier } from '../../lib/supplierWrites'

/**
 * Add a supplier.
 *
 * The first CREATE anywhere in the rebuild, and the first on either stack:
 * Xano's supplier group is four reads and one patch, and Track has no create
 * form at all. "Huntsmen Production Music" was typed straight into the Xano
 * table because of that, and typed without a uuid, which left it unreachable
 * from every edit page in both apps.
 *
 * ⚠️ This only works because `supplier_list` left the sync on 13 September. A
 * row created while the table was still in Xano task 42 would be DELETED on the
 * hour, because a full push removes rows Xano does not have. Do not copy this
 * component onto a table that is still synced.
 *
 * It asks for two things and then gets out of the way. Every other field on a
 * supplier is editable the moment the page opens, so a create form with twenty
 * inputs would just be a worse copy of the page it hands you to.
 *
 * The type is one of them because it is not decoration: `/partners` and
 * `/roster` are exactly this column, split on Composition Team. A supplier with
 * no type used to land on neither list — `supplier_type <> 'Composition Team'`
 * is NULL for a NULL, and NULL is not true. The view now uses
 * `is distinct from` so an untyped supplier at least lands on /partners, but
 * asking is still better than relying on the backstop.
 */
export function NewSupplier({
  /** Set on /roster, where the answer is never in doubt. */
  fixedType,
  onCancel,
  onCreated,
}: {
  fixedType?: string
  onCancel: () => void
  onCreated: (uuid: string) => void
}) {
  const create = useCreateSupplier()
  const [title, setTitle] = useState('')
  const [type, setType] = useState(fixedType ?? '')

  const ready = title.trim() !== '' && type !== ''

  async function submit() {
    if (!ready || create.isPending) return
    const row = await create.mutateAsync({ title: title.trim(), supplierType: type })
    onCreated(row.uuid!)
  }

  return (
    <div className="create-band">
      <div className="create-band-row">
        <input
          className="edit-field-input"
          value={title}
          autoFocus
          placeholder={fixedType === COMPOSITION_TEAM ? 'Composition team name' : 'Partner name'}
          aria-label="Name"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') onCancel()
          }}
        />

        {!fixedType && (
          <select
            className="edit-field-input edit-field-select"
            value={type}
            aria-label="Supplier type"
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Type…</option>
            {SUPPLIER_TYPES.filter((t) => t !== COMPOSITION_TEAM).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="btn btn-mono btn-dark"
          disabled={!ready || create.isPending}
          onClick={() => void submit()}
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="btn btn-mono btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {/* Staff only, and the database is what says so — a non-staff account is
          refused by the insert policy rather than by this form. */}
      {create.error && <p className="form-error mt-2">{create.error.message}</p>}
    </div>
  )
}
