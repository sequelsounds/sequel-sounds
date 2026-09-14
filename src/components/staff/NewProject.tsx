import { useEffect, useState } from 'react'
import {
  PROJECT_TYPES,
  useCreateProject,
  useProjectLookups,
  useProjectPeople,
  type Option,
} from '../../lib/projectWrites'
import { useMe } from '../../lib/xanoMirror'

/**
 * Add a project.
 *
 * Nine fields, which is more than the supplier band asks for and not a
 * judgement about thoroughness: they are exactly what the create guard in the
 * database refuses to go without. Everything else — agency, service, client
 * contact, ad producer, terms, notes — is editable the moment the page opens.
 *
 * The Sequel No. is absent on purpose. It is allocated by the database, so
 * nobody types one and two people creating at the same moment cannot collide.
 *
 * ⚠️ While `project_master_list` is still in Xano task 42, a project created
 * here is DELETED on the hour. Do not hand this to staff before those two
 * blocks come out of the task.
 */

function Picker({
  label,
  value,
  options,
  onChange,
  pending,
}: {
  label: string
  value: number | ''
  options: Option[] | undefined
  onChange: (next: number | '') => void
  pending: boolean
}) {
  return (
    <label className="create-field">
      <span className="create-field-label">{label}</span>
      <select
        className="edit-field-input edit-field-select"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">{pending ? 'Loading…' : '—'}</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Text({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  autoFocus?: boolean
}) {
  return (
    <label className="create-field">
      <span className="create-field-label">{label}</span>
      <input
        className="edit-field-input"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function NewProject({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (id: number) => void
}) {
  const create = useCreateProject()
  const lookups = useProjectLookups()
  const people = useProjectPeople()
  const me = useMe()

  const [title, setTitle] = useState('')
  const [brand, setBrand] = useState('')
  const [product, setProduct] = useState('')
  const [campaign, setCampaign] = useState('')
  const [type, setType] = useState('')
  const [country, setCountry] = useState('')
  const [group, setGroup] = useState<number | ''>('')
  const [category, setCategory] = useState<number | ''>('')
  const [supervisor, setSupervisor] = useState<number | ''>('')

  // Yours unless you say otherwise — and it matters more than it looks:
  // `/projects` is the projects you supervise, so a project created against
  // somebody else vanishes off the list you made it from.
  useEffect(() => {
    if (supervisor === '' && me.data?.id) setSupervisor(me.data.id)
  }, [me.data?.id, supervisor])

  const ready =
    title.trim() !== '' &&
    brand.trim() !== '' &&
    product.trim() !== '' &&
    campaign.trim() !== '' &&
    type !== '' &&
    country.trim() !== '' &&
    group !== '' &&
    category !== '' &&
    supervisor !== ''

  async function submit() {
    if (!ready || create.isPending) return
    const row = await create.mutateAsync({
      title: title.trim(),
      brand: brand.trim(),
      product: product.trim(),
      campaignname: campaign.trim(),
      project_type: type,
      country: country.trim(),
      client: group as number,
      brand_category: category as number,
      music_supervisor: supervisor as number,
    })
    onCreated(row.id)
  }

  return (
    <div className="create-band">
      <div className="create-grid">
        <Text label="Title" value={title} onChange={setTitle} autoFocus />
        <Text label="Brand" value={brand} onChange={setBrand} />
        <Text label="Product" value={product} onChange={setProduct} />
        <Text label="Campaign" value={campaign} onChange={setCampaign} />

        <label className="create-field">
          <span className="create-field-label">Type</span>
          <select
            className="edit-field-input edit-field-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">—</option>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {/* Free text, as it is on the record. The spellings already in use are
            inconsistent — "United States" on 17 projects and "United States of
            America" on one — and `countries_list` is not the list to fix that
            with: it does not hold "United Kingdom" either. */}
        <Text label="Country" value={country} onChange={setCountry} />

        <Picker
          label="Client"
          value={group}
          options={lookups.data?.clientGroups}
          onChange={setGroup}
          pending={lookups.isPending}
        />
        <Picker
          label="Brand category"
          value={category}
          options={lookups.data?.brandCategories}
          onChange={setCategory}
          pending={lookups.isPending}
        />
        <Picker
          label="Supervisor"
          value={supervisor}
          options={people.data?.supervisors}
          onChange={setSupervisor}
          pending={people.isPending}
        />
      </div>

      <div className="create-band-row">
        <button
          type="button"
          className="btn btn-mono btn-dark"
          disabled={!ready || create.isPending}
          onClick={() => void submit()}
        >
          {create.isPending ? 'Creating…' : 'Create project'}
        </button>
        <button type="button" className="btn btn-mono btn-outline" onClick={onCancel}>
          Cancel
        </button>
        <span className="create-band-note">
          The Sequel No. is allocated when you create.
        </span>
      </div>

      {/* Staff only, and the database is what says so — a non-staff account is
          refused by the insert policy rather than by this form. */}
      {create.error && <p className="form-error mt-2">{create.error.message}</p>}
    </div>
  )
}
