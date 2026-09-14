import { useMemo, useRef, useState } from 'react'
import SequelLogo from '../SequelLogo'
import {
  emptyInvoice,
  INVOICE_SECTIONS,
  invoiceTotals,
  toAmount,
  uploadPo,
  USAGE_REGIONS,
  useCreateInvoiceRequest,
  useInvoiceLookups,
  type InvoiceForm,
  type InvoiceSection,
  type SectionKey,
} from '../../lib/invoiceWrites'
import { formatAmount, type Option } from '../../lib/quoteWrites'

/**
 * The invoice request form, rebuilt from the old app's rather than designed
 * here. The sibling of the quote wizard: same shell, same buttons, same
 * one-question-per-screen shape.
 *
 * ⚠️ THIS CREATES AN INVOICE. It is not `/invoice`, which is where finance
 * checks and amends one before it goes to QuickBooks and is still read-only in
 * the new app.
 *
 * The steps, with the old app's own wording, read off the live page 14 Sep:
 *
 *    0  Invoice Description
 *    1  Who are we invoicing?              the client to bill
 *    2  PO Number
 *    3  Attach a PO?
 *    4  Currency
 *    5  Demos          ┐
 *    6  Searches       │ supplier lines, then the flat Sequel fees
 *    7  Library/Master │ and the section's cost avoidance
 *    8  Publishing     │
 *    9  Other Fees     ┘
 *   10  Track Name(s)
 *   11  Artist Name(s)
 *   12  What territories does the usage cover?
 *   13  Which region?
 *   14  Summary                            → SUBMIT INVOICE
 *
 * ⚠️ THE OLD APP'S ELEMENT NAMES ALL LIE. `step_10_new_invoice` is the FIRST
 * step and `step_9_new_invoice` is the Summary at the END — the form was
 * reordered twice and renaming the Wized elements would have meant renaming the
 * Webflow attributes too. Nothing of that survives here; the order above is the
 * order it asks, read off the rendered page rather than the names.
 *
 * ⚠️ The track is on the INVOICE, not the project. `Confirmed_Song_Name`
 * describes where the JOB ended up, so reading it per invoice put the track on
 * search and demo invoices raised weeks before it was chosen, and put the same
 * one on both invoices of a job that licensed two tracks. Library jobs
 * regularly licence several at once.
 *
 * ⚠️ An invoice raised here is DELETED ON THE HOUR — `invoices` is on the
 * blocked side of the sync. See `lib/invoiceWrites.ts`.
 */

type Props = {
  projectId: number
  /** Prefilled from the project, as the old app prefills the client. */
  prefill: { clientId: number | null }
  onClose: () => void
  onCreated: (uuid: string) => void
}

type StepKey =
  | 'description'
  | 'client'
  | 'po_number'
  | 'po_attachment'
  | 'currency'
  | `section:${SectionKey}`
  | 'song'
  | 'artist'
  | 'territories'
  | 'region'
  | 'summary'

function flow(): StepKey[] {
  return [
    'description',
    'client',
    'po_number',
    'po_attachment',
    'currency',
    ...INVOICE_SECTIONS.map((s) => `section:${s.key}` as StepKey),
    'song',
    'artist',
    'territories',
    'region',
    'summary',
  ]
}

const amount = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function Question({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="qw-question">
      <h2 className="qw-title">{title}</h2>
      {children}
    </div>
  )
}

/**
 * An amount field. Holds the raw text, shows it grouped when it is not focused.
 *
 * ⚠️ Not formatted on change — reformatting mid-keystroke moves the caret to
 * the front of the field.
 *
 * ⚠️ AND NOT FORMATTED ON THE WAY OUT EITHER. `toAmount` strips the separators
 * before anything is sent. The old form sent a `toLocaleString` string straight
 * into a Xano decimal input, which could not parse the thousands separator and
 * stored 0 — a valid 200 with a zero in the column.
 */
function AmountInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      className="qw-input qw-input-amount"
      inputMode="decimal"
      placeholder="0.00"
      value={focused ? value : formatAmount(value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value.replace(/,/g, '').replace(/[^\d.]/g, ''))}
    />
  )
}

/** One fee section: any number of supplier lines, the flat fees, cost avoidance. */
function SectionScreen({
  section,
  value,
  suppliers,
  onChange,
}: {
  section: (typeof INVOICE_SECTIONS)[number]
  value: InvoiceSection
  suppliers: Option[]
  onChange: (next: InvoiceSection) => void
}) {
  const setLine = (i: number, patch: Partial<InvoiceSection['lines'][number]>) => {
    onChange({ ...value, lines: value.lines.map((l, j) => (i === j ? { ...l, ...patch } : l)) })
  }

  return (
    <div className="qw-question is-wide">
      <div className="qw-fee-head">
        <h2 className="qw-title">{section.heading}</h2>
        <button
          type="button"
          className="qw-choice"
          onClick={() =>
            onChange({
              ...value,
              lines: [...value.lines, { supplierId: null, amount: '', paythrough: true }],
            })
          }
        >
          + ENTRY
        </button>
      </div>

      {value.lines.map((line, i) => (
        <div key={i} className="qw-line-row">
          <select
            className="qw-input"
            value={line.supplierId ?? ''}
            onChange={(e) => setLine(i, { supplierId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            {/* ⚠️ A placeholder option may be `selected`, never `disabled`. A
                disabled option cannot be displayed, so the browser falls
                through to the first real supplier and an unanswered select
                becomes indistinguishable from an answered one. */}
            <option value="">Select supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <AmountInput value={line.amount} onChange={(v) => setLine(i, { amount: v })} />
          <select
            className="qw-input"
            value={line.paythrough ? 'true' : 'false'}
            onChange={(e) => setLine(i, { paythrough: e.target.value === 'true' })}
          >
            <option value="true">Paythrough</option>
            <option value="false">Client pays direct</option>
          </select>
          {value.lines.length > 1 ? (
            <button
              type="button"
              className="qw-fee-delete"
              aria-label="Remove this line"
              onClick={() => onChange({ ...value, lines: value.lines.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}

      {/* ⚠️ Cost avoidance is what the client was SAVED against the original
          quote. It is money that did not move, it is reported and never summed,
          and it is in none of the three totals. */}
      <div className="qw-fee-row">
        <span className="qw-fee-label">Cost Avoidance</span>
        <AmountInput
          value={value.costAvoidance}
          onChange={(costAvoidance) => onChange({ ...value, costAvoidance })}
        />
        <span />
      </div>

      {section.fees.map((fee) => (
        <div key={fee.column} className="qw-fee-row">
          <span className="qw-fee-label">{fee.label}</span>
          <AmountInput
            value={value.fees[fee.column] ?? ''}
            onChange={(v) => onChange({ ...value, fees: { ...value.fees, [fee.column]: v } })}
          />
          <span />
        </div>
      ))}

      {section.key === 'demos' && (
        <p className="qw-note">
          Paythrough means Sequel bills the client and pays the supplier. Client pays direct still
          records the spend — it just does not go on the invoice.
        </p>
      )}
    </div>
  )
}

export function NewInvoice({ projectId, prefill, onClose, onCreated }: Props) {
  const lookups = useInvoiceLookups()
  const create = useCreateInvoiceRequest(projectId)
  const fileInput = useRef<HTMLInputElement>(null)

  const [f, setF] = useState<InvoiceForm>(() => ({ ...emptyInvoice(), clientId: prefill.clientId }))
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const steps = useMemo(() => flow(), [])
  const key = steps[Math.min(step, steps.length - 1)]
  const patch = (next: Partial<InvoiceForm>) => setF((prev) => ({ ...prev, ...next }))

  const totals = invoiceTotals(f)
  const currencyLabel =
    (lookups.data?.currencies ?? []).find((c: Option) => c.id === f.currencyId)?.label ?? ''
  const totalText = [currencyLabel, amount.format(totals.totalToInvoice)].filter(Boolean).join(' ')

  const answered = (): boolean => {
    switch (key) {
      case 'description':
        return f.description.trim() !== ''
      case 'client':
        return f.clientId !== null
      case 'currency':
        return f.currencyId !== null
      default:
        return true
    }
  }

  const showNext = key !== 'summary' && answered() && !uploading
  const canCreate = f.clientId !== null && f.currencyId !== null && f.description.trim() !== ''

  const next = () => {
    setError(null)
    setStep((s) => Math.min(s + 1, steps.length - 1))
  }
  const back = () => {
    setError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function attach(file: File) {
    setError(null)
    setUploading(true)
    try {
      const { key: poKey, filename } = await uploadPo(file)
      patch({ poKey, poFilename: filename })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be attached.')
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (!canCreate) return
    setError(null)
    try {
      const row = await create.mutateAsync({ projectId, form: f })
      onCreated(row.uuid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not raise that invoice.')
    }
  }

  const sectionKey = key.startsWith('section:') ? (key.slice(8) as SectionKey) : null
  const section = sectionKey ? INVOICE_SECTIONS.find((s) => s.key === sectionKey)! : null

  return (
    <div className="qw" role="dialog" aria-modal="true" aria-label="New invoice">
      <div className="qw-head">
        <SequelLogo wordmark className="qw-logo !h-auto !w-20" />
        <button type="button" className="qw-close" aria-label="Close" onClick={onClose}>
          <span className="qw-x" />
          <span className="qw-x is-counter" />
        </button>
      </div>

      <div className="qw-body">
        {key === 'description' && (
          <Question title="Invoice Description">
            <input
              className="qw-input"
              autoFocus
              value={f.description}
              onChange={(e) => patch({ description: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && f.description.trim() !== '') next()
              }}
            />
          </Question>
        )}

        {key === 'client' && (
          <Question title="Who are we invoicing?">
            <select
              className="qw-input"
              value={f.clientId ?? ''}
              onChange={(e) => patch({ clientId: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">Please Select</option>
              {(lookups.data?.clients ?? []).map((c: Option) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Question>
        )}

        {key === 'po_number' && (
          <Question title="PO Number">
            <input
              className="qw-input"
              autoFocus
              value={f.poNumber}
              onChange={(e) => patch({ poNumber: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
            {/* One live invoice reached QuickBooks with a leading space in its
                PO number. Trimmed on the way to the database. */}
          </Question>
        )}

        {key === 'po_attachment' && (
          <Question title="Attach a PO?">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void attach(file)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="qw-choice"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? 'UPLOADING…' : f.poKey ? 'REPLACE FILE' : 'CLICK TO SELECT FILE'}
            </button>
            {f.poFilename && !uploading && <p className="qw-note">Attached: {f.poFilename}</p>}
            {error && <p className="form-error">{error}</p>}
          </Question>
        )}

        {key === 'currency' && (
          <Question title="Currency">
            <select
              className="qw-input"
              value={f.currencyId ?? ''}
              onChange={(e) => {
                if (e.target.value === '') return
                patch({ currencyId: Number(e.target.value) })
                next()
              }}
            >
              <option value="">Please Select</option>
              {(lookups.data?.currencies ?? []).map((c: Option) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {/* ⚠️ Changing the currency later REINTERPRETS every figure — the
                numbers do not convert. Same as the old app. */}
          </Question>
        )}

        {section && sectionKey && (
          <SectionScreen
            section={section}
            value={f.sections[sectionKey]}
            suppliers={lookups.data?.suppliers ?? []}
            onChange={(next) => patch({ sections: { ...f.sections, [sectionKey]: next } })}
          />
        )}

        {key === 'song' && (
          <Question title="Track Name(s)">
            <input
              className="qw-input"
              autoFocus
              value={f.songName}
              onChange={(e) => patch({ songName: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
            <p className="qw-note">
              Free text, and it may hold more than one — a library job often licences several at
              once.
            </p>
          </Question>
        )}

        {key === 'artist' && (
          <Question title="Artist Name(s)">
            <input
              className="qw-input"
              autoFocus
              value={f.artistName}
              onChange={(e) => patch({ artistName: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
          </Question>
        )}

        {key === 'territories' && (
          <Question title="What territories does the usage cover?">
            <input
              className="qw-input"
              autoFocus
              value={f.usageTerritories}
              onChange={(e) => patch({ usageTerritories: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
          </Question>
        )}

        {key === 'region' && (
          <Question title="Which region?">
            {/* ⚠️ Ten values, and Xano rejects anything outside them — taking
                the whole submit with it rather than just the field. They are a
                fixed list, not the five business regions used elsewhere. */}
            <select
              className="qw-input"
              value={f.usageRegion}
              onChange={(e) => {
                patch({ usageRegion: e.target.value })
                if (e.target.value !== '') next()
              }}
            >
              <option value="">Please Select</option>
              {USAGE_REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Question>
        )}

        {key === 'summary' && (
          <div className="qw-question is-wide">
            <h2 className="qw-title">Summary</h2>

            <div className="qw-summary-row is-heading">
              <span>Cost Avoidance</span>
              <span className="qw-summary-amount">{amount.format(totals.costAvoidance)}</span>
            </div>
            {/* The old app's summary groups the two rights sections into one
                "Rights" row while the form keeps them apart. Kept. */}
            {[
              ['Demos', ['demos']],
              ['Searches', ['searches']],
              ['Rights', ['master', 'publishing']],
              ['Other', ['other']],
            ].map(([label, keys]) => (
              <div key={label as string} className="qw-summary-row">
                <span>{label as string}</span>
                <span className="qw-summary-amount">
                  {amount.format(
                    (keys as SectionKey[]).reduce(
                      (n, k) => n + toAmount(f.sections[k].costAvoidance),
                      0,
                    ),
                  )}
                </span>
              </div>
            ))}

            <div className="qw-summary-row">
              <span>Sequel Fees</span>
              <span className="qw-summary-amount">{amount.format(totals.fees)}</span>
            </div>
            <div className="qw-summary-row">
              <span>Profit</span>
              <span className="qw-summary-amount">{amount.format(totals.profit)}</span>
            </div>
            <div className="qw-summary-row">
              <span>Total Spend</span>
              <span className="qw-summary-amount">{amount.format(totals.totalSpend)}</span>
            </div>
            <div className="qw-summary-row is-total">
              <span>TOTAL TO INVOICE</span>
              <span className="qw-summary-amount">{totalText}</span>
            </div>

            {totals.totalSpend === totals.totalToInvoice && totals.thirdParty > 0 && (
              /* Expected, and it looks like a bug the first time. */
              <p className="qw-note">
                Spend matches the invoice total because every supplier cost is a paythrough — the
                client is paying for all of it through Sequel.
              </p>
            )}
            {error && <p className="form-error">{error}</p>}
          </div>
        )}
      </div>

      <div className="qw-foot">
        {step > 0 ? (
          <button type="button" className="qw-step-button" onClick={back}>
            BACK
          </button>
        ) : (
          <span />
        )}

        {/* Hidden on the first step and on the summary, as the old app's is. */}
        {step > 0 && key !== 'summary' ? (
          <span className="qw-total">
            TOTAL <strong>{totalText}</strong>
          </span>
        ) : (
          <span />
        )}

        {key === 'summary' ? (
          <button
            type="button"
            className="qw-step-button"
            disabled={!canCreate || create.isPending}
            onClick={() => void submit()}
          >
            {create.isPending ? 'SUBMITTING…' : 'SUBMIT INVOICE'}
          </button>
        ) : showNext ? (
          <button type="button" className="qw-step-button" onClick={next}>
            NEXT
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
