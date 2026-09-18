import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  discardContract,
  extractContract,
  TERM_UNITS,
  uploadContract,
  shareContract,
  useArchiveContract,
  useContractTypes,
  useSaveContract,
  useSuppliersForPicker,
  type ContractFields,
  type ContractRow,
  type Suggested,
} from '../../lib/contracts'
import { pickedSize } from '../../lib/assets'
import { ArchiveIcon, ArchiveModal, Modal, ShareIcon, ShareModal } from './RowActions'

/**
 * The Contracting tab's modal and row actions, rebuilt from the old app's
 * `upload_contract_modal` and its Wized config rather than designed afresh.
 * Spec: `sequel-track-contracts.md`.
 *
 * ⚠️ ONE MODAL, TWO MODES, as over there. The fields are identical in both;
 * duplicating them is what let the old app's two copies drift apart and caused
 * two live bugs.
 *
 * Upload mode ends in SUBMIT. Edit mode has NO submit button: it auto-saves on
 * every change, and the status line is the only thing telling the user an edit
 * landed — which is the job the button would otherwise do.
 *
 * Differences from the old app, both deliberate:
 *  - Disabled fields are solid, not faded to 0.35 opacity (CLAUDE.md).
 *  - VIEW CONTRACT opens the PDF itself; the old app's `/contract` page has no
 *    equivalent here yet.
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

const asText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
/** A number box that is really a text box: `type="number"` shows what you type
 *  and reports nothing when the content is invalid, so "1 year" in Term length
 *  looked filled and submitted as no term at all — and no expiry with it. */
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
  const navigate = useNavigate()
  const types = useContractTypes()
  const suppliers = useSuppliersForPicker()
  const save = useSaveContract(projectId)

  const [meta, setMeta] = useState<{ name: string; size: number } | null>(
    editing ? { name: editing.file_name ?? '', size: Number(editing.file_size ?? 0) } : null,
  )
  const [uuid, setUuid] = useState<string | null>(editing?.uuid ?? null)
  const [uploading, setUploading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [readNote, setReadNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const [typeId, setTypeId] = useState<number | null>(editing?.contract_type_id ?? null)
  const [supplierId, setSupplierId] = useState<number | null>(editing?.supplier_list_id ?? null)
  const [supplierQuery, setSupplierQuery] = useState(editing?.supplier ?? '')
  const [suppliersOpen, setSuppliersOpen] = useState(false)
  const [artist, setArtist] = useState(editing?.artist ?? '')
  const [song, setSong] = useState(editing?.song_name ?? '')
  const [masterPct, setMasterPct] = useState(asText(editing?.master_pct))
  const [pubPct, setPubPct] = useState(asText(editing?.publishing_pct))
  const [mcps, setMcps] = useState(editing?.mcps_yn === true)
  const [start, setStart] = useState(editing?.start_date ?? '')
  const [end, setEnd] = useState(editing?.end_date ?? '')
  const [termValue, setTermValue] = useState(asText(editing?.term_value))
  const [termUnit, setTermUnit] = useState(editing?.term_unit ?? '')
  const [perpetual, setPerpetual] = useState(editing?.perpetual === true)
  const [address, setAddress] = useState(editing?.supplier_address ?? '')

  /** An upload never submitted, discarded if the modal closes. */
  const pending = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (pending.current) void Promise.resolve(discardContract(pending.current)).catch(() => undefined)
    },
    [],
  )

  // Typing filters on the name; focus with nothing typed shows the list.
  const supplierResults = useMemo(() => {
    const list = suppliers.data ?? []
    const q = supplierQuery.trim().toLowerCase()
    if (!q) return list.slice(0, 200)
    return list.filter((x) => (x.title ?? '').toLowerCase().includes(q)).slice(0, 200)
  }, [suppliers.data, supplierQuery])

  // Coda sets the supplier id; an empty search box next to a chosen supplier
  // reads as nothing chosen, so the box is made to say the name.
  useEffect(() => {
    if (supplierId === null) return
    const match = suppliers.data?.find((x) => x.id === supplierId)
    if (match?.title && match.title !== supplierQuery) setSupplierQuery(match.title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, suppliers.data])

  const typeName = types.data?.find((t) => t.id === typeId)?.type ?? null
  const isBuyOut = typeName === 'Buy Out'
  // A Buy Out is perpetual whatever the boxes say — the save forces it — so the
  // form says so rather than showing a No it is about to overrule.
  const perpetualShown = perpetual || isBuyOut
  const termNeedsUnit = Number(digits(termValue)) > 0 && !termUnit && !perpetualShown
  /** Nothing is fillable until a contract is there and the read has finished. */
  const ready = !!uuid && !uploading && !scanning
  const canSubmit = ready && typeId !== null && supplierId !== null && !termNeedsUnit

  const fields = (): ContractFields => ({
    uuid: uuid!,
    contract_type: typeId,
    supplier_id: supplierId,
    description: editing?.description ?? '',
    artist,
    song_name: song,
    notes: editing?.notes ?? '',
    master_pct: masterPct,
    publishing_pct: pubPct,
    mcps_yn: mcps,
    start_date: start || null,
    end_date: end || null,
    term_value: Number(digits(termValue)) || null,
    term_unit: termUnit || null,
    perpetual: perpetualShown,
    supplier_address: address,
  })

  /* ---------------------------------------------------------- auto-save */

  /**
   * Edit mode saves on every change, as the old app does.
   *
   * ⚠️ The signature is seeded from the values the form OPENED with, so the
   * prefill does not read as twelve edits and fire a save the moment the modal
   * opens — that exact bug cost a session over there.
   * ⚠️ It refuses to fire while type or supplier is blank: there is no undo,
   * and clearing the supplier by accident would otherwise persist instantly.
   */
  const signature = useMemo(
    () =>
      JSON.stringify([
        typeId,
        supplierId,
        artist,
        song,
        masterPct,
        pubPct,
        mcps,
        start,
        end,
        termValue,
        termUnit,
        perpetualShown,
        address,
      ]),
    [
      typeId,
      supplierId,
      artist,
      song,
      masterPct,
      pubPct,
      mcps,
      start,
      end,
      termValue,
      termUnit,
      perpetualShown,
      address,
    ],
  )
  const saved = useRef(signature)
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved' | 'error'>('')

  useEffect(() => {
    if (!editing || !uuid) return
    if (signature === saved.current) return
    if (typeId === null || supplierId === null || termNeedsUnit) return
    // Claimed before the request goes out, so a keystroke mid-flight cannot
    // fire a second save of the same values; released on failure so a dropped
    // save is retried rather than silently lost.
    const attempt = signature
    saved.current = attempt
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      save.mutate(fields(), {
        onSuccess: () => setSaveState('saved'),
        onError: (e: Error) => {
          saved.current = ''
          setSaveState('error')
          setError(null)
          console.error('contract auto-save failed', e)
        },
      })
    }, 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  /* ------------------------------------------------------------ upload */

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

  /** Coda's read. Never blocks saving: a failure leaves an empty form, which is
   *  a form somebody can still fill in. */
  const read = async (id: string) => {
    setScanning(true)
    setReadNote(null)
    try {
      const s: Suggested = await extractContract(id)
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
      setScanning(false)
    }
  }

  const reset = () => {
    if (pending.current) void Promise.resolve(discardContract(pending.current)).catch(() => undefined)
    pending.current = null
    setUuid(null)
    setMeta(null)
    setError(null)
    setReadNote(null)
    setUploading(false)
    setScanning(false)
    if (input.current) input.current.value = ''
  }

  const submit = () => {
    if (!canSubmit || save.isPending || !uuid) return
    save.mutate(fields(), {
      onSuccess: () => {
        pending.current = null
        onSaved?.(uuid)
        onClose()
      },
      onError: (e: Error) => setError(e.message || "That didn't save. Please try again."),
    })
  }

  // VIEW CONTRACT goes to the contract's own page - the document beside Coda's
  // read of it - rather than straight to the raw PDF, as on Track.
  const view = () => {
    if (!uuid) return
    navigate(`/contracts/${uuid}`)
  }

  // Track's own wording, step for step.
  const title = error ? 'Upload Failed' : editing ? 'Edit Contract' : 'Upload Contract'
  const subtitle = editing
    ? 'Changes save automatically.'
    : scanning
      ? 'Reading the contract...'
      : uuid
        ? 'Check what Coda found and add anything it missed.'
        : 'Upload a contract for Coda to analyse.'

  return (
    <Modal onClose={onClose} className="am-box cm-box">
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">{title}</div>
      {!error && <div className="rm-subheader">{subtitle}</div>}

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
              <div className="am-zone-text">Drag &amp; drop the contract here, or click to browse</div>
            </div>
          )}
          {!editing && (uploading || scanning) && (
            <div className="am-zone">
              <div className="am-zone-icon">
                <SpinIcon />
              </div>
              <div className="am-zone-text">{uploading ? 'Uploading...' : 'Reading the contract...'}</div>
            </div>
          )}
          {meta && (meta.name || meta.size > 0) && (
            <div className="am-picked">
              <div className="am-picked-text">
                {[meta.name, meta.size ? pickedSize(meta.size) : ''].filter(Boolean).join('  ·  ')}
              </div>
              {/* NEVER in edit mode: on a pending upload this discards the file,
                  but on a saved contract it would throw the contract away. */}
              {!editing && uuid && ready && (
                <button type="button" className="am-picked-x" aria-label="Remove this file" onClick={reset} />
              )}
            </div>
          )}

          {readNote && <div className="cm-note">{readNote}</div>}

          {ready && (
            <div className="cm-grid">
              {/* Two columns in Track's own order — the left column is what the
                  contract IS, the right is how long it runs. Column-major, so a
                  narrow window stacks the columns rather than interleaving. */}
              <div className="cm-col">
                <div className="am-group">
                  <label className="am-label" htmlFor="cm-type">
                    Contract Type*
                  </label>
                  <select
                    id="cm-type"
                    className={`am-input${typeId === null ? ' needs-input' : ''}`}
                    value={typeId ?? ''}
                    onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Select type</option>
                    {(types.data ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.type}
                      </option>
                    ))}
                  </select>
                </div>

                {/* A search, not a dropdown — there are ~150 suppliers.
                    ⚠️ The id is what counts, never the text in the box: typing a
                    name without picking it leaves nothing selected, and a check
                    on the text would let that through to the save. */}
                <div className="am-group">
                  <label className="am-label" htmlFor="cm-supplier">
                    Select who the contract is from*
                  </label>
                  <div className="ns-combo">
                    <div className={`ns-field${supplierId === null ? ' needs-input' : ''}`}>
                      <input
                        id="cm-supplier"
                        className="ns-input"
                        placeholder="Search Suppliers"
                        autoComplete="off"
                        value={supplierQuery}
                        onChange={(e) => {
                          setSupplierQuery(e.target.value)
                          if (supplierId !== null) setSupplierId(null)
                          setSuppliersOpen(true)
                        }}
                        onFocus={() => setSuppliersOpen(true)}
                        onBlur={() => window.setTimeout(() => setSuppliersOpen(false), 200)}
                      />
                    </div>
                    {suppliersOpen && (
                      <div className="ns-results" role="listbox">
                        {supplierResults.map((sup) => (
                          <button
                            key={sup.id}
                            type="button"
                            role="option"
                            aria-selected={supplierId === sup.id}
                            className="ns-result"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSupplierId(sup.id)
                              setSupplierQuery(sup.title ?? '')
                              setSuppliersOpen(false)
                            }}
                          >
                            <span className="ns-result-text">{sup.title}</span>
                          </button>
                        ))}
                        {supplierResults.length === 0 && (
                          <span className="ns-result-text">No supplier of that name</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="am-group">
                  <label className="am-label" htmlFor="cm-artist">
                    Artist name
                  </label>
                  <input
                    id="cm-artist"
                    type="text"
                    autoComplete="off"
                    className="am-input"
                    placeholder="e.g. James Brown"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                  />
                </div>

                <div className="am-group">
                  <label className="am-label" htmlFor="cm-song">
                    Song name
                  </label>
                  <input
                    id="cm-song"
                    type="text"
                    autoComplete="off"
                    className="am-input"
                    placeholder="e.g. The Big Pay Back"
                    value={song}
                    onChange={(e) => setSong(e.target.value)}
                  />
                </div>

                <div className="am-group">
                  <label className="am-label" htmlFor="cm-master">
                    Master share %
                  </label>
                  <input
                    id="cm-master"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="am-input"
                    value={masterPct}
                    onChange={(e) => setMasterPct(decimals(e.target.value))}
                  />
                </div>

                <div className="am-group">
                  <label className="am-label" htmlFor="cm-pub">
                    Publishing share %
                  </label>
                  <input
                    id="cm-pub"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="am-input"
                    value={pubPct}
                    onChange={(e) => setPubPct(decimals(e.target.value))}
                  />
                </div>
              </div>

              <div className="cm-col">
                <div className="am-group">
                  <label className="am-label" htmlFor="cm-start">
                    Licence start date
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
                    disabled={perpetualShown}
                    value={termValue}
                    onChange={(e) => setTermValue(digits(e.target.value))}
                  />
                </div>

                <div className="am-group">
                  <label className="am-label" htmlFor="cm-unit">
                    Term unit
                  </label>
                  <select
                    id="cm-unit"
                    className={`am-input${termNeedsUnit ? ' needs-input' : ''}`}
                    disabled={perpetualShown}
                    value={termUnit}
                    onChange={(e) => setTermUnit(e.target.value)}
                  >
                    <option value="">Select unit</option>
                    {TERM_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="am-group">
                  <label className="am-label" htmlFor="cm-end">
                    End date (only if printed on the document)
                  </label>
                  <input
                    id="cm-end"
                    type="date"
                    className="am-input"
                    disabled={perpetualShown}
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </div>

                <div className="am-group">
                  <div className="am-label">In perpetuity / buy out?</div>
                  <div className="am-tags cm-tags">
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
                  <div className="am-label">MCPS Contract?</div>
                  <div className="am-tags cm-tags">
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
              </div>
            </div>
          )}

          {/* Upload mode ends in SUBMIT; edit mode has the status line and
              VIEW CONTRACT instead, as over there. */}
          {editing ? (
            <div className="cm-foot">
              <span className="cm-status">
                {saveState === 'saving'
                  ? 'Saving...'
                  : saveState === 'saved'
                    ? 'All changes saved'
                    : saveState === 'error'
                      ? 'Could not save that change. Check your connection and try again.'
                      : ''}
              </span>
              {/* The app's own button, not the asset modal's SUBMIT: this one
                  leaves the modal rather than committing anything. */}
              <button
                type="button"
                className="btn btn-mono btn-outline"
                onClick={() => void view()}
              >
                VIEW CONTRACT
              </button>
            </div>
          ) : (
            ready && (
              <button
                type="button"
                className={`am-submit is-full${canSubmit && !save.isPending ? '' : ' is-off'}`}
                onClick={submit}
              >
                {save.isPending ? 'SAVING…' : 'SUBMIT'}
              </button>
            )
          )}
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------ the row cell */

/** The row's share and archive cells — the same pair, in the same order and
 *  the same modals, as an asset, an invoice and a quote row. The contract's
 *  link is minted on the click (`track_share_contract`), so the modal opens on
 *  "Generating link..." and fills in. */
export function ContractRowActions({
  contract,
  projectId,
}: {
  contract: ContractRow
  projectId: number | undefined
}) {
  const archive = useArchiveContract(projectId)
  const [sharing, setSharing] = useState<{ link: string | null; status?: string } | null>(null)
  const [open, setOpen] = useState(false)

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Share this contract"
          onClick={(e) => {
            stop(e)
            setSharing({ link: null })
            shareContract(contract.uuid).then(
              (s) => setSharing({ link: s.link }),
              (err: Error) => setSharing({ link: null, status: err.message }),
            )
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
            setOpen(true)
          }}
        >
          <ArchiveIcon />
        </button>
      </span>

      {sharing && (
        <ShareModal
          link={sharing.link}
          status={sharing.status}
          header="Shareable Link Generated"
          subheader="This link will remain active for 7 days and will then expire."
          onClose={() => setSharing(null)}
        />
      )}
      {open && (
        <ArchiveModal
          header="Are you sure you want to archive this contract?"
          /* Said plainly: the document is kept, because it is the evidence of
             the right to use the music. */
          subheader="It leaves the list. The document itself is kept."
          archive={archive}
          onConfirm={() => archive.mutate(contract.uuid, { onSuccess: () => setOpen(false) })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
