import { useEffect, useMemo, useState } from 'react'
import {
  useCreateProject,
  useProjectLookups,
  useProjectPeople,
  type NewProjectInput,
  type Option,
} from '../../lib/projectWrites'

/**
 * The New Project wizard, rebuilt from Track's rather than designed here.
 *
 * Eleven questions, one per screen, then a success step — the same eleven, in
 * the same order, with the same wording and the same two typeaheads. Track's
 * own `Question-wrapper` steps and its `is_form_complete` rule are the source:
 *
 *    1  Which user is this project for?*    client_user_id   typeahead
 *    2  And which Brand?*                   brand
 *    3  The project title?*                 title
 *    4  And the Client?*                    client_agency    typeahead
 *    5  Client Job No          (optional)   brand_no
 *    6  Project Type?*                      services_id      select
 *    7  Projected Pipeline in GBP*          pipeline_gbp
 *    8  Proposed start date*                proposed_start_date
 *    9  Account*                            client           select
 *    10 AdPro Lead*                         adpro_user       select
 *    11 Brand Category*                     brand_category   select
 *    12 Project created!
 *
 * ⚠️ Step 6 says "Project Type?" and writes the SERVICE. The column called
 * `project_type` (Advert / Film / Social post) is a different field that this
 * wizard has never touched, and the project page calls the thing step 6 writes
 * "Service". Two names for one field and one name for two fields. Copied as it
 * is, because this is the wording staff are asked today; worth reconciling
 * across both pages at once rather than inventing a third vocabulary here.
 *
 * ⚠️ Step 4 asks for "the Client" and writes the AGENCY; step 9 asks for the
 * "Account" and writes the client group. The project page calls those two
 * "Agency" and "Client". Same problem, same reason for leaving it.
 *
 * Two of Track's bugs are deliberately NOT reproduced:
 *
 *   - its Enter handler caps at step 9 (`current_step < 9 ? +1 : 9`), a leftover
 *     from when there were nine steps, so pressing Enter on step 10 or 11 throws
 *     you backwards two screens. Here Enter advances, and on the last step it
 *     creates.
 *   - Xano's POST writes the literal "CampaignName" into every new project.
 *     Left blank instead; the field is on the project page.
 *
 * ⚠️ While `project_master_list` is still in Xano task 42, a project created
 * here is DELETED on the hour.
 */

const LAST_QUESTION = 11
const SUCCESS = 12

type Answers = {
  client_user_id: number | null
  brand: string
  title: string
  client_agency: number | null
  brand_no: string
  services_id: number | null
  pipeline_gbp: string
  proposed_start_date: string
  client: number | null
  adpro_user: number | null
  brand_category: number | null
}

const EMPTY: Answers = {
  client_user_id: null,
  brand: '',
  title: '',
  client_agency: null,
  brand_no: '',
  services_id: null,
  pipeline_gbp: '',
  proposed_start_date: '',
  client: null,
  adpro_user: null,
  brand_category: null,
}

/** Track's `is_form_complete`: every answer present, job no exempted. */
function answered(a: Answers, step: number): boolean {
  switch (step) {
    case 1: return a.client_user_id != null
    case 2: return a.brand.trim() !== ''
    case 3: return a.title.trim() !== ''
    case 4: return a.client_agency != null
    case 5: return true // Client Job No — the one question with no asterisk
    case 6: return a.services_id != null
    case 7: return a.pipeline_gbp.trim() !== '' && Number.isFinite(Number(a.pipeline_gbp))
    case 8: return a.proposed_start_date.trim() !== ''
    case 9: return a.client != null
    case 10: return a.adpro_user != null
    case 11: return a.brand_category != null
    default: return true
  }
}

const complete = (a: Answers) =>
  Array.from({ length: LAST_QUESTION }, (_, i) => i + 1).every((s) => answered(a, s))

/** Step 1 and step 4: a search box over a list, not a dropdown. */
function Typeahead({
  placeholder,
  options,
  value,
  secondary,
  emptyNote,
  onPick,
}: {
  placeholder: string
  options: Option[] | undefined
  value: number | null
  /** The second line on a result — the email, or the country. */
  secondary?: (id: number) => string | undefined
  emptyNote: string
  onPick: (id: number) => void
}) {
  const picked = options?.find((o) => o.id === value)
  const [term, setTerm] = useState(picked?.label ?? '')
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    const t = term.trim().toLowerCase()
    if (!t) return (options ?? []).slice(0, 8)
    return (options ?? []).filter((o) => o.label.toLowerCase().includes(t)).slice(0, 8)
  }, [options, term])

  return (
    <div className="wizard-search">
      <input
        className="edit-field-input"
        value={term}
        autoFocus
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTerm(e.target.value)
          setOpen(true)
        }}
      />
      {open && (
        <div className="wizard-results">
          {matches.length === 0 && <div className="wizard-result-empty">{emptyNote}</div>}
          {matches.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`wizard-result${o.id === value ? ' is-picked' : ''}`}
              onClick={() => {
                onPick(o.id)
                setTerm(o.label)
                setOpen(false)
              }}
            >
              <span className="wizard-result-name">{o.label}</span>
              {secondary?.(o.id) && (
                <span className="wizard-result-sub">{secondary(o.id)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Select({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: number | null
  options: Option[] | undefined
  placeholder: string
  onChange: (next: number | null) => void
}) {
  return (
    <select
      className="edit-field-input edit-field-select"
      value={value ?? ''}
      autoFocus
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{placeholder}</option>
      {(options ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function NewProject({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const create = useCreateProject()
  const lookups = useProjectLookups()
  const people = useProjectPeople()

  const [step, setStep] = useState(1)
  const [a, setA] = useState<Answers>(EMPTY)
  const [incomplete, setIncomplete] = useState(false)
  const [created, setCreated] = useState<{ id: number; sequel_no: string | null } | null>(null)

  const set = <K extends keyof Answers>(key: K, v: Answers[K]) => {
    setIncomplete(false)
    setA((prev) => ({ ...prev, [key]: v }))
  }

  // ⚠️ Both keys are handled on the DOCUMENT, not on the dialog.
  //
  // Enter was on the dialog's own onKeyDown first, and it stopped working the
  // moment anyone used a typeahead: picking a result unmounts the button that
  // was clicked, focus falls back to the body, and a keydown on the body never
  // reaches a handler inside the dialog. So steps 1 and 4 — the two that most
  // need Enter, because you have just chosen something — were the two where it
  // did nothing. Only visible by using it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Enter') return
      // A focused button already treats Enter as its own click.
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return
      e.preventDefault()
      if (step === SUCCESS) return
      if (step === LAST_QUESTION) void submit()
      else next()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  function next() {
    if (!answered(a, step)) {
      setIncomplete(true)
      return
    }
    setIncomplete(false)
    setStep((s) => Math.min(s + 1, LAST_QUESTION))
  }

  async function submit() {
    if (!complete(a)) {
      setIncomplete(true)
      return
    }
    const input: NewProjectInput = {
      client_user_id: a.client_user_id!,
      brand: a.brand.trim(),
      title: a.title.trim(),
      client_agency: a.client_agency!,
      brand_no: a.brand_no.trim() || null,
      services_id: a.services_id!,
      pipeline_gbp: Number(a.pipeline_gbp),
      proposed_start_date: a.proposed_start_date,
      client: a.client!,
      adpro_user: a.adpro_user!,
      brand_category: a.brand_category!,
    }
    const row = await create.mutateAsync(input)
    setCreated(row)
    setStep(SUCCESS)
  }

  const users = people.data?.clientUsers
  const agencies = lookups.data?.agencies

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sequel-brown/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New project"
        className="wizard-modal surface-light border border-sequel-line shadow-[0_10px_40px_rgba(55,43,41,0.25)]"
      >
        <button
          type="button"
          className="wizard-close"
          aria-label="Close"
          onClick={onClose}
        />

        <div className="wizard-body">
        {step === 1 && (
          <>
            <div className="wizard-question">Which user is this project for?*</div>
            <Typeahead
              placeholder="Search"
              options={users}
              value={a.client_user_id}
              secondary={(id) => people.data?.emails?.[id]}
              emptyNote="No user found"
              onPick={(id) => set('client_user_id', id)}
            />
          </>
        )}

        {step === 2 && (
          <>
            <div className="wizard-question">And which Brand?*</div>
            <input
              className="edit-field-input"
              value={a.brand}
              autoFocus
              onChange={(e) => set('brand', e.target.value)}
            />
          </>
        )}

        {step === 3 && (
          <>
            <div className="wizard-question">The project title?*</div>
            <input
              className="edit-field-input"
              value={a.title}
              autoFocus
              onChange={(e) => set('title', e.target.value)}
            />
          </>
        )}

        {step === 4 && (
          <>
            <div className="wizard-question">And the Client?*</div>
            <Typeahead
              placeholder="Search"
              options={agencies}
              value={a.client_agency}
              secondary={(id) => lookups.data?.agencyCountries?.[id]}
              emptyNote="No client found"
              onPick={(id) => set('client_agency', id)}
            />
          </>
        )}

        {step === 5 && (
          <>
            <div className="wizard-question">Client Job No</div>
            <input
              className="edit-field-input"
              value={a.brand_no}
              autoFocus
              onChange={(e) => set('brand_no', e.target.value)}
            />
          </>
        )}

        {step === 6 && (
          <>
            <div className="wizard-question">Project Type?*</div>
            <Select
              value={a.services_id}
              options={lookups.data?.services}
              placeholder="Select"
              onChange={(v) => set('services_id', v)}
            />
          </>
        )}

        {step === 7 && (
          <>
            <div className="wizard-question">Projected Pipeline in GBP*</div>
            <input
              className="edit-field-input"
              value={a.pipeline_gbp}
              autoFocus
              inputMode="decimal"
              onChange={(e) => set('pipeline_gbp', e.target.value)}
            />
          </>
        )}

        {step === 8 && (
          <>
            <div className="wizard-question">Proposed start date*</div>
            <input
              className="edit-field-input"
              type="date"
              value={a.proposed_start_date}
              autoFocus
              onChange={(e) => set('proposed_start_date', e.target.value)}
            />
          </>
        )}

        {step === 9 && (
          <>
            <div className="wizard-question">Account*</div>
            <Select
              value={a.client}
              options={lookups.data?.clientGroups}
              placeholder="Please Select"
              onChange={(v) => set('client', v)}
            />
          </>
        )}

        {step === 10 && (
          <>
            <div className="wizard-question">AdPro Lead*</div>
            <Select
              value={a.adpro_user}
              options={people.data?.adpros}
              placeholder="Please Select"
              onChange={(v) => set('adpro_user', v)}
            />
          </>
        )}

        {step === 11 && (
          <>
            <div className="wizard-question">Brand Category*</div>
            <Select
              value={a.brand_category}
              options={lookups.data?.brandCategories}
              placeholder="Please Select"
              onChange={(v) => set('brand_category', v)}
            />
          </>
        )}

        {step === SUCCESS && (
          <>
            <div className="wizard-question">Project created!</div>
            <p className="wizard-created">{created?.sequel_no}</p>
          </>
        )}

        </div>

        {incomplete && <p className="form-error">PLEASE COMPLETE ALL SECTIONS</p>}
        {/* The database's own words when it refuses — "missing the user it is
            for", "Not saved" — are more use than a generic line, so Track's
            "Something went wrong" is only the fallback. */}
        {create.error && <p className="form-error">{create.error.message}</p>}

        <div className="wizard-buttons">
          {step > 1 && step < SUCCESS && (
            <button
              type="button"
              className="btn btn-mono btn-outline"
              onClick={() => {
                setIncomplete(false)
                setStep((s) => s - 1)
              }}
            >
              BACK
            </button>
          )}

          {/* Not filled in until the question has an answer. A dark NEXT sitting
              there before you have typed anything reads as "this is the thing to
              press", on a screen where the thing to do is answer. */}
          {step < LAST_QUESTION && (
            <button
              type="button"
              className={`btn btn-mono ${answered(a, step) ? 'btn-dark' : 'btn-outline'}`}
              onClick={next}
            >
              NEXT
            </button>
          )}

          {step === LAST_QUESTION && (
            <button
              type="button"
              className={`btn btn-mono ${complete(a) ? 'btn-dark' : 'btn-outline'}`}
              disabled={create.isPending}
              onClick={() => void submit()}
            >
              {create.isPending ? 'CREATING…' : 'CREATE PROJECT'}
            </button>
          )}

          {step === SUCCESS && (
            <button
              type="button"
              className="btn btn-mono btn-dark"
              onClick={() => created && onCreated(created.id)}
            >
              OPEN IT
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
