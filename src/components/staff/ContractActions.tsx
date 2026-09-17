import { useEffect, useRef, useState } from 'react'
import {
  contractUrl,
  discardContract,
  extractContract,
  shareContract,
  TERM_UNITS,
  uploadContract,
  useArchiveContract,
  useContractTypes,
  useSaveContract,
  useSuppliersForPicker,
  type ContractRow,
  type Suggested,
} from '../../lib/contracts'
import { pickedSize } from '../../lib/assets'
import { ArchiveIcon, Modal, ShareIcon } from './RowActions'

/**
 * The Contracting tab's moving parts: one modal for upload and edit (the old
 * app has one too — the fields are identical, and two copies of them drifted
 * apart twice), the row's open/share/archive cells, and the share modal.
 * Spec: `sequel-track-contracts.md`.
 *
 * ⚠️ WHAT THE AI DOES HERE: it fills the form in and stops. Nothing it says is
 * saved until a person presses SAVE, and the supplier it names was matched in
 * SQL off the names printed on the page, never chosen by the model.
 */

export type ContractModalMode = { kind: 'upload' } | { kind: 'edit'; contract: ContractRow }

function UploadIcon() {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <rect width="100" height="100" fill="var(--color-sequel-brown)" />
      <g
        fill="none"
        stroke="var(--color-sequel-silver)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M30 70 L70 70" />
        <path d="M50 60 L50 30" />
        <path d="M38 42 L50 30 L62 42" />
      </g>
    </svg>
  )
}

function SpinIcon() {
  return (
    <svg viewBox="0 0 20 20" width="85%" height="85%" aria-hidden="true" className="am-spin">
      <rect width="20" height="20" fill="var(--color-sequel-brown)" />
    </svg>
  )
}

function DoneIcon() {
  return (
    <svg viewBox="0 0 455 455" width="100%" height="100%" aria-hidden="true">
      <path fill="var(--color-sequel-brown)" d="M0,0v455h455V0H0z" />
      <path
        fill="var(--color-sequel-silver)"
        d="M194.93,319.897l-87.837-87.837l21.213-21.213l66.625,66.624l131.764-131.763l21.213,21.213 L194.93,319.897z"
      />
    </svg>
  )
}

const asText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
/** A number box that is really a text box: `type="number"` shows what you type
 *  and reports nothing when the content is invalid, so "1 year" in Term length
 *  submitted as no term at all, and no expiry with it. */
const digits = (v: string) => v.replace(/[^\d]/g, '')
const decimals = (v: string) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')

export function ContractModal({
  mode,
  projectId,
  onClose,
  onSaved,
}: {
  mode: ContractModalMode
  projectId: number
  onClose: () => void
  onSaved?: (uuid: string) => void
}) {
  const editing = mode.kind === 'edit' ? mode.contract : null
  const types = useContractTypes()
  const suppliers = useSuppliersForPicker()
  const save = useSaveContract(projectId)

  const [meta, setMeta] = useState<{ name: string; size: number } | null>(
    editing ? { name: editing.file_name ?? '', size: Number(editing.file_size ?? 0) } : null,
  )
  const [uuid, setUuid] = useState<string | null>(editing?.uuid ?? null)
  const [uploading, setUploading] = useState(false)
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<string | null>(null)
  const [suggested, setSuggested] = useState<Suggested | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const [typeId, setTypeId] = useState<number | null>(editing?.contract_type_id ?? null)
  const [supplierId, setSupplierId] = useState<number | null>(editing?.supplier_list_id ?? null)
  const [description, setDescription] = useState(editing?.description ?? '')
  const [artist, setArtist] = useState(editing?.artist ?? '')
  const [song, setSong] = useState(editing?.song_name ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [masterPct, setMasterPct] = useState(asText(editing?.master_pct))
  const [pubPct, setPubPct] = useState(asText(editing?.publishing_pct))
  const [mcps, setMcps] = useState(editing?.mcps_yn === true)
  const [start, setStart] = useState(editing?.start_date ?? '')
  const [end, setEnd] = useState(editing?.end_date ?? '')
  const [termValue, setTermValue] = useState(asText(editing?.term_value))
  const [termUnit, setTermUnit] = useState(editing?.term_unit ?? '')
  const [perpetual, setPerpetual] = useState(editing?.perpetual === true)
  const [address, setAddress] = useState(editing?.supplier_address ?? '')

  // An upload never saved, to be discarded if the modal closes.
  const pending = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (pending.current) void Promise.resolve(discardContract(pending.current)).catch(() => undefined)
    },
    [],
  )

  const typeName = types.data?.find((t) => t.id === typeId)?.type ?? null
  // Library and Sonic Branding grant the lot; Talent grants no share. The save
  // enforces this, so the boxes say so rather than inviting a number that
  // would be overwritten.
  const sharesFixed = typeName === 'Library' || typeName === 'Sonic Branding'
  const noShares = typeName === 'Talent'
  const isBuyOut = typeName === 'Buy Out'
  // A Buy Out is perpetual whatever the boxes say — the save forces it — so
  // the form says so rather than showing a No it is about to overrule.
  const perpetualShown = perpetual || isBuyOut
  const termNeedsUnit = Number(digits(termValue)) > 0 && !termUnit && !perpetualShown
  const ok = !!uuid && !uploading && typeId !== null && supplierId !== null && !termNeedsUnit

  const pick = async (file: File | undefined) => {
    if (!file) return
    setMeta({ name: file.name, size: file.size })
    setUploading(true)
    setError(null)
    try {
      const id = await uploadContract(projectId, file)
      pending.current = id
      setUuid(id)
      void read(id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  /** The AI read. Never blocks saving: a failure leaves an empty form, which
   *  is a form somebody can still fill in. */
  const read = async (id: string) => {
    setReading(true)
    setReadNote(null)
    try {
      const s = await extractContract(id)
      setSuggested(s)
      if (s.contract_type) {
        const t = types.data?.find((x) => x.type === s.contract_type)
        if (t) setTypeId(t.id)
      }
      if (s.supplier_id) setSupplierId(s.supplier_id)
      if (s.supplier_address) setAddress(s.supplier_address)
      if (s.artist) setArtist(s.artist)
      if (s.song_name) setSong(s.song_name)
      if (s.master_pct !== null) setMasterPct(String(s.master_pct))
      if (s.publishing_pct !== null) setPubPct(String(s.publishing_pct))
      if (s.mcps) setMcps(true)
      if (s.start_date) setStart(s.start_date)
      if (s.end_date) setEnd(s.end_date)
      if (s.term_value !== null) setTermValue(String(s.term_value))
      if (s.term_unit) setTermUnit(String(s.term_unit).toLowerCase())
      if (s.perpetual) setPerpetual(true)
      if (!s.supplier_id) {
        setReadNote(
          s.supplier_matched_on.length
            ? `No supplier on our list matches ${s.supplier_matched_on.slice(0, 3).join(', ')} — pick one.`
            : 'No rights holder was printed on the document — pick the supplier.',
        )
      }
    } catch (e) {
      setReadNote((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  const reset = () => {
    if (pending.current) void Promise.resolve(discardContract(pending.current)).catch(() => undefined)
    pending.current = null
    setUuid(null)
    setMeta(null)
    setError(null)
    setSuggested(null)
    setReadNote(null)
    setUploading(false)
    if (input.current) input.current.value = ''
  }

  const submit = () => {
    if (!ok || save.isPending || !uuid) return
    save.mutate(
      {
        uuid,
        contract_type: typeId,
        supplier_id: supplierId,
        description,
        artist,
        song_name: song,
        notes,
        master_pct: sharesFixed || noShares ? '' : masterPct,
        publishing_pct: sharesFixed || noShares ? '' : pubPct,
        mcps_yn: mcps,
        start_date: start || null,
        end_date: end || null,
        term_value: Number(digits(termValue)) || null,
        term_unit: termUnit || null,
        perpetual: perpetualShown,
        supplier_address: address,
      },
      {
        onSuccess: () => {
          pending.current = null
          onSaved?.(uuid)
          onClose()
        },
        onError: (e: Error) => setError(e.message || "That didn't save. Please try again."),
      },
    )
  }

  return (
    <Modal onClose={onClose} className="am-box cm-box">
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">{editing ? 'Edit Contract' : 'Upload Contract'}</div>
      <div className="rm-subheader">
        {editing
          ? 'Change anything that is wrong. The expiry is worked out from the dates.'
          : 'Add the PDF. It is read automatically, and you confirm what it found.'}
      </div>

      {error ? (
        <div className="am-error">
          <div className="am-label">{error}</div>
          <button type="button" className="am-submit" onClick={reset}>
            START AGAIN
          </button>
        </div>
      ) : (
        <div className="am-form">
          {!editing && !uuid && !uploading && (
            <div className="am-zone">
              <input
                ref={input}
                type="file"
                accept="application/pdf"
                className="am-file"
                aria-label="Choose a contract"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
              <div className="am-zone-icon">
                <UploadIcon />
              </div>
              <div className="am-zone-text">Drag &amp; drop the contract here, or click to browse — PDF</div>
            </div>
          )}
          {!editing && uploading && (
            <div className="am-zone">
              <div className="am-zone-icon">
                <SpinIcon />
              </div>
              <div className="am-zone-text">Uploading...</div>
            </div>
          )}
          {!editing && uuid && !uploading && (
            <div className="am-zone">
              <div className="am-zone-icon">{reading ? <SpinIcon /> : <DoneIcon />}</div>
              <div className="am-zone-text">{reading ? 'Reading the contract...' : 'Done!'}</div>
            </div>
          )}

          {meta && (meta.name || meta.size > 0) && (
            <div className="am-picked">
              <div className="am-picked-text">
                {[meta.name, meta.size ? pickedSize(meta.size) : ''].filter(Boolean).join('  ·  ')}
              </div>
              {!editing && uuid && !reading && (
                <button type="button" className="am-picked-x" aria-label="Remove this file" onClick={reset} />
              )}
            </div>
          )}

          {readNote && <div className="cm-note">{readNote}</div>}
          {suggested?.summary && <div className="cm-summary">{suggested.summary}</div>}
          {suggested && !suggested.dates_resolved && !perpetualShown && (
            <div className="cm-note">
              No dates were printed, so this contract has no expiry and will not be chased for renewal.
            </div>
          )}

          {uuid && !uploading && (
            <div className="cm-grid">
              <div className="am-group">
                <label className="am-label" htmlFor="cm-type">
                  Contract type*
                </label>
                <select
                  id="cm-type"
                  className="am-input"
                  value={typeId ?? ''}
                  onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Choose…</option>
                  {(types.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.type}
                    </option>
                  ))}
                </select>
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-supplier">
                  Supplier*
                </label>
                <select
                  id="cm-supplier"
                  className="am-input"
                  value={supplierId ?? ''}
                  onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Choose…</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-artist">
                  Artist / composer
                </label>
                <input
                  id="cm-artist"
                  type="text"
                  autoComplete="off"
                  className="am-input"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                />
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-song">
                  Song
                </label>
                <input
                  id="cm-song"
                  type="text"
                  autoComplete="off"
                  className="am-input"
                  value={song}
                  onChange={(e) => setSong(e.target.value)}
                />
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-start">
                  Commencement
                </label>
                <input
                  id="cm-start"
                  type="date"
                  className="am-input"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-end">
                  Expiry (if printed)
                </label>
                <input
                  id="cm-end"
                  type="date"
                  className="am-input"
                  value={end}
                  disabled={perpetual || isBuyOut}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-term">
                  Term length
                </label>
                <input
                  id="cm-term"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoComplete="off"
                  className="am-input"
                  value={termValue}
                  disabled={perpetual || isBuyOut}
                  onChange={(e) => setTermValue(digits(e.target.value))}
                />
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-unit">
                  Term unit{termNeedsUnit ? ' — needed' : ''}
                </label>
                <select
                  id="cm-unit"
                  className={`am-input${termNeedsUnit ? ' needs-input' : ''}`}
                  value={termUnit}
                  disabled={perpetual || isBuyOut}
                  onChange={(e) => setTermUnit(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {TERM_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div className="am-group">
                <div className="am-label">Perpetual</div>
                <div className="am-tags">
                  {[true, false].map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      className={`am-tag${perpetualShown === v ? ' is-selected' : ''}`}
                      disabled={isBuyOut}
                      onClick={() => setPerpetual(v)}
                    >
                      {v ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="am-group">
                <div className="am-label">MCPS</div>
                <div className="am-tags">
                  {[true, false].map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      className={`am-tag${mcps === v ? ' is-selected' : ''}`}
                      onClick={() => setMcps(v)}
                    >
                      {v ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-master">
                  Master %
                </label>
                <input
                  id="cm-master"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="am-input"
                  value={sharesFixed ? '100' : noShares ? '' : masterPct}
                  disabled={sharesFixed || noShares}
                  onChange={(e) => setMasterPct(decimals(e.target.value))}
                />
              </div>

              <div className="am-group">
                <label className="am-label" htmlFor="cm-pub">
                  Publishing %
                </label>
                <input
                  id="cm-pub"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="am-input"
                  value={sharesFixed ? '100' : noShares ? '' : pubPct}
                  disabled={sharesFixed || noShares}
                  onChange={(e) => setPubPct(decimals(e.target.value))}
                />
              </div>

              <div className="am-group cm-wide">
                <label className="am-label" htmlFor="cm-description">
                  Description
                </label>
                <input
                  id="cm-description"
                  type="text"
                  autoComplete="off"
                  maxLength={256}
                  className="am-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="am-group cm-wide">
                <label className="am-label" htmlFor="cm-notes">
                  Notes
                </label>
                <input
                  id="cm-notes"
                  type="text"
                  autoComplete="off"
                  maxLength={512}
                  className="am-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          )}

          {uuid && !uploading && (
            <button
              type="button"
              className={`am-submit is-full${ok && !save.isPending ? '' : ' is-off'}`}
              onClick={submit}
            >
              {save.isPending ? 'SAVING…' : editing ? 'SAVE CHANGES' : 'SAVE CONTRACT'}
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------- the row cells */

function OpenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1rem"
      height="1rem"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M14 3h7v7" />
      <path d="M21 3l-9 9" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  )
}

/** Open, share and archive, on the contract row. */
export function ContractRowActions({
  contract,
  projectId,
}: {
  contract: ContractRow
  projectId: number | undefined
}) {
  const archive = useArchiveContract(projectId)
  const [sharing, setSharing] = useState<
    { kind: 'pending' } | { kind: 'failed'; message: string } | { kind: 'ready'; link: string } | null
  >(null)
  const [archiving, setArchiving] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const open = async () => {
    setOpening(true)
    setOpenError(null)
    try {
      const url = await contractUrl(contract.uuid)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setOpenError((e as Error).message)
    } finally {
      setOpening(false)
    }
  }

  return (
    <>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Open this contract"
          disabled={opening}
          onClick={(e) => {
            stop(e)
            void open()
          }}
        >
          <OpenIcon />
        </button>
      </span>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Share this contract"
          onClick={(e) => {
            stop(e)
            setSharing({ kind: 'pending' })
            shareContract(contract.uuid)
              .then((r) => setSharing({ kind: 'ready', link: r.link }))
              .catch((err: Error) => setSharing({ kind: 'failed', message: err.message }))
          }}
        >
          <ShareIcon />
        </button>
      </span>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Archive this contract"
          onClick={(e) => {
            stop(e)
            archive.reset()
            setArchiving(true)
          }}
        >
          <ArchiveIcon />
        </button>
      </span>

      {openError && (
        <Modal onClose={() => setOpenError(null)}>
          <div className="rm-header">That file is not here yet</div>
          <div className="rm-subheader">{openError}</div>
        </Modal>
      )}

      {sharing && (
        <Modal onClose={() => setSharing(null)}>
          <button
            type="button"
            className="wizard-close rm-close"
            aria-label="Close"
            onClick={() => setSharing(null)}
          />
          <div className="rm-header">
            {sharing.kind === 'ready'
              ? 'Shareable Link Generated'
              : sharing.kind === 'failed'
                ? 'That did not work'
                : 'One moment…'}
          </div>
          <div className="rm-subheader">
            {sharing.kind === 'ready'
              ? 'This link will remain active for 7 days and will then expire.'
              : sharing.kind === 'failed'
                ? sharing.message
                : 'Making the link.'}
          </div>
          {sharing.kind === 'ready' && (
            <div className="rm-buttons">
              <input className="am-input" readOnly value={sharing.link} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className="am-submit"
                onClick={() => void navigator.clipboard.writeText(sharing.link).catch(() => undefined)}
              >
                COPY LINK
              </button>
            </div>
          )}
        </Modal>
      )}

      {archiving && (
        <Modal onClose={() => setArchiving(false)}>
          <button
            type="button"
            className="wizard-close rm-close"
            aria-label="Close"
            onClick={() => setArchiving(false)}
          />
          <div className="rm-header">Archive this contract?</div>
          {/* Said plainly: it is kept, because it is the evidence of the right
              to use the music. */}
          <div className="rm-subheader">
            It leaves the list and its share link stops working. The file is kept.
          </div>
          {archive.error && <div className="form-error">{archive.error.message}</div>}
          <div className="rm-buttons">
            <button type="button" className="am-submit" onClick={() => setArchiving(false)}>
              CANCEL
            </button>
            <button
              type="button"
              className="am-submit"
              disabled={archive.isPending}
              onClick={() => archive.mutate(contract.uuid, { onSuccess: () => setArchiving(false) })}
            >
              {archive.isPending ? 'ARCHIVING…' : 'ARCHIVE'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
