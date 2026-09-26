import { useState } from 'react'
import { ArchiveIcon, ArchiveModal, Modal, ShareIcon } from './RowActions'
import {
  BLANK_LICENCE,
  fetchLicencePrefill,
  licenceUrl,
  shareLicence,
  useArchiveLicence,
  useCreateLicence,
  useLicenceActivity,
  useLicenceDetail,
  useLicenceInvoices,
  useLicenceSongs,
  useSendLicence,
  useUpdateLicence,
  type LicenceActivity,
  type LicenceFeeParts,
  type LicenceFields,
  type LicenceKind,
  type LicenceRow,
} from '../../lib/compositionLicences'

/** First transmission is picked from a calendar but STORED AS THE PRINTED
 *  TEXT ("1 October 2026"): the certificate draws the column as-is and the
 *  prefill already writes that form. These convert for the date input only. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']

function toIsoDate(s: string): string {
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/.exec(t)
  if (!m) return ''
  const mi = MONTHS.findIndex((x) => x.slice(0, 3).toLowerCase() === m[2].slice(0, 3).toLowerCase())
  if (mi < 0) return ''
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

function fromIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}

/**
 * COMPOSITION CONTRACT on the Contracting tab, and the row it leaves behind.
 *
 * ⚠️ INVOICE FIRST — Andy, 25 Sep 2026: "a client doesn't get a licence
 * without the invoice being raised first." The first thing this modal asks for
 * is which RAISED invoice the licence is for. Its number prints on the
 * certificate, and it comes from the database: nothing here can type one.
 *
 * ⚠️ WRITERS, NOT ARTIST — Andy, 25 Sep. Andy does not want composer team
 * names on client paperwork; the schedule names the individual writers, which
 * the song picker fills from the song's own writer list.
 *
 * ⚠️ PREFILLED, NEVER FIXED. Everything the project and the invoice know is
 * put in the boxes, and every box stays editable.
 *
 * One modal, two modes, like the release form: clicking a row reopens it.
 */

/**
 * ⚠️ LIBRARY (Andy, 26 Sep 2026) — the same modal, with three differences:
 * only invoices with a PAYTHROUGH library line are offered (when the client
 * pays the library direct, the library issues the licence); the fee is those
 * library lines alone, never Sequel's fee; the licensor's share is always 100%,
 * so it is not asked. No song picker: the track is not a Sequel song.
 */
export type LicenceMode = { kind: 'new'; type: LicenceKind } | { kind: 'edit'; licence: LicenceRow }

export const LICENCE_NAME: Record<LicenceKind, string> = {
  composition: 'Composition Licence',
  library: 'Library Licence',
}

const RIGHTS = ['Master & Publishing', 'Master Only', 'Publishing Only']

const LABELS: Record<keyof LicenceFields, string> = {
  licensee_name: 'Licensee',
  licensee_address: 'Licensee address',
  rights_granted: 'Rights granted',
  licensor_share: "Licensor's share",
  composition_title: 'Title',
  writer_names: 'Writer(s)',
  production_name: 'Production',
  client_name: 'Client',
  brand: 'Brand',
  campaign: 'Campaign',
  scripts: 'Scripts',
  cutdowns: 'Cutdowns included',
  media: 'Media',
  territory: 'Territory',
  term: 'Term',
  first_transmission: 'First transmission',
  licence_fee: 'Licence fee',
}

/** Everything prints; the address is the only box that may be empty. */
const REQUIRED = (Object.keys(LABELS) as (keyof LicenceFields)[]).filter(
  (k) => k !== 'licensee_address',
)

const money = (n: number | null, cur: string | null) =>
  n === null ? '' : `${cur ?? ''} ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()

/**
 * ⚠️ THE FEE FOLLOWS THE RIGHTS GRANTED (Andy, 26 Sep): a pay-through
 * re-record licenses the master only — the publishing money is on our invoice
 * but the publisher issues their own licence — so the fee is the master part
 * alone. Both sides are read off the invoice's lines (track_invoice_licence_parts),
 * never the total, which can include demos. Empty when that side is nothing.
 */
function feeFor(rights: string, parts: LicenceFeeParts | null): string {
  if (!parts) return ''
  const n =
    rights === 'Master Only'
      ? Number(parts.master)
      : rights === 'Publishing Only'
        ? Number(parts.publishing)
        : Number(parts.master) + Number(parts.publishing)
  return n > 0 ? money(n, parts.currency) : ''
}

export function LicenceModal({
  mode,
  projectId,
  onClose,
}: {
  mode: LicenceMode
  projectId: number
  onClose: () => void
}) {
  const editing = mode.kind === 'edit' ? mode.licence : null
  const type: LicenceKind = mode.kind === 'edit' ? (mode.licence.kind ?? 'composition') : mode.type
  const detail = useLicenceDetail(editing?.uuid)

  // ⚠️ Not rendered until its values exist — empty boxes that fill a moment
  // later read as "this is blank", not "this is loading".
  if (editing && !detail.data) {
    return (
      <Modal onClose={onClose} className="am-box cm-box">
        <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
        <div className="rm-header">{`${LICENCE_NAME[type]} ${editing.ref}`}</div>
        <div className="rm-subheader">{detail.error ? detail.error.message : 'Opening…'}</div>
      </Modal>
    )
  }

  const d = detail.data
  return (
    <LicenceEditor
      key={editing?.uuid ?? `new-${type}`}
      type={type}
      editing={editing}
      fixedInvoice={d ? { id: d.invoice_id, number: d.invoice_number } : null}
      initial={d ? pickFields(d) : BLANK_LICENCE}
      projectId={projectId}
      onClose={onClose}
    />
  )
}

function pickFields(src: Partial<LicenceFields>): LicenceFields {
  const out = { ...BLANK_LICENCE }
  for (const k of Object.keys(BLANK_LICENCE) as (keyof LicenceFields)[]) {
    out[k] = String(src[k] ?? '')
  }
  return out
}

function LicenceEditor({
  type,
  editing,
  fixedInvoice,
  initial,
  projectId,
  onClose,
}: {
  type: LicenceKind
  editing: LicenceRow | null
  fixedInvoice: { id: number; number: string } | null
  initial: LicenceFields
  projectId: number
  onClose: () => void
}) {
  const [f, setF] = useState<LicenceFields>(initial)
  const [invoiceId, setInvoiceId] = useState<number | null>(fixedInvoice?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  /** The chosen invoice's total — a hint in the fee box, never its value. */
  const [invoiceTotal, setInvoiceTotal] = useState('')
  /** The chosen invoice's master and publishing parts. Null when editing. */
  const [feeParts, setFeeParts] = useState<LicenceFeeParts | null>(null)

  const library = type === 'library'
  const invoices = useLicenceInvoices(projectId, !editing)
  // Library tracks are not Sequel songs: no picker, nothing filled from one.
  const songs = useLicenceSongs(projectId, !library)
  const create = useCreateLicence(projectId)
  const update = useUpdateLicence(projectId)

  const set = (k: keyof LicenceFields) => (v: string) =>
    setF((p) => {
      if (k !== 'rights_granted') return { ...p, [k]: v }
      // A fee still as filled in follows the new rights; one typed over is left.
      const auto = feeFor(p.rights_granted, feeParts)
      const typed = p.licence_fee.trim() !== '' && p.licence_fee !== auto
      return { ...p, rights_granted: v, licence_fee: typed ? p.licence_fee : feeFor(v, feeParts) }
    })

  /** Picking the invoice fills the boxes from the invoice and the project. */
  const chooseInvoice = (id: number | null) => {
    setInvoiceId(id)
    setError(null)
    if (id === null) return
    setFilling(true)
    fetchLicencePrefill(projectId, id)
      .then((pre) => {
        const next = pickFields(pre)
        /* ⚠️ THE FEE IS FILLED FROM THE INVOICE'S LINES, NOT ITS TOTAL (Andy,
         * 26 Sep). 1167 on Bisma bills "Demo & Licence Fees" at SGD 15,200, of
         * which 3,600 is demos: the fee is the master and/or publishing part,
         * whichever the rights granted cover (feeFor). Still editable. */
        // Library: the paythrough library lines only — never Sequel's fee.
        const parts = (library ? pre.library_parts : pre.fee_parts) ?? null
        setFeeParts(parts)
        setInvoiceTotal(next.licence_fee)
        setF((p) => ({
          ...next,
          licence_fee: feeFor(next.rights_granted, parts),
          // A song already picked is kept: the invoice does not know the writers.
          composition_title: p.composition_title || next.composition_title,
          writer_names: p.writer_names || next.writer_names,
        }))
        // One song on the project is the one: fill it straight in.
        const only = !library && songs.data?.length === 1 ? songs.data[0] : null
        if (only) setF((p) => ({ ...p, composition_title: only.title, writer_names: only.writers }))
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setFilling(false))
  }

  // A library licence is always 100% (the database sets it too).
  const fields = library ? { ...f, licensor_share: '100%' } : f
  const ready = invoiceId !== null && REQUIRED.every((k) => fields[k].trim() !== '')
  const busy = create.isPending || update.isPending || filling

  const submit = () => {
    if (!ready || busy) return
    setError(null)
    const done = { onSuccess: () => onClose(), onError: (e: Error) => setError(e.message) }
    if (editing) update.mutate({ uuid: editing.uuid, fields }, done)
    else create.mutate({ invoice_id: invoiceId!, kind: type, fields }, done)
  }

  const input = (k: keyof LicenceFields, placeholder?: string) => (
    <div className="am-group" key={k}>
      <label className="am-label" htmlFor={`cl-${k}`}>
        {LABELS[k]}
      </label>
      {k === 'licensee_address' ? (
        <textarea
          id={`cl-${k}`}
          className="am-input rf-address"
          rows={3}
          autoComplete="off"
          placeholder={placeholder}
          value={f[k]}
          onChange={(e) => set(k)(e.target.value)}
        />
      ) : k === 'first_transmission' ? (
        <input
          id={`cl-${k}`}
          type="date"
          className={`am-input${f[k].trim() === '' ? ' needs-input' : ''}`}
          value={toIsoDate(f[k])}
          onChange={(e) => set(k)(fromIsoDate(e.target.value))}
        />
      ) : (
        <input
          id={`cl-${k}`}
          className={`am-input${f[k].trim() === '' ? ' needs-input' : ''}`}
          autoComplete="off"
          placeholder={placeholder}
          value={f[k]}
          onChange={(e) => set(k)(e.target.value)}
        />
      )}
    </div>
  )

  const select = (k: keyof LicenceFields, options: string[]) => (
    <div className="am-group" key={k}>
      <label className="am-label" htmlFor={`cl-${k}`}>
        {LABELS[k]}
      </label>
      <select
        id={`cl-${k}`}
        className={`am-input${f[k].trim() === '' ? ' needs-input' : ''}`}
        value={f[k]}
        onChange={(e) => set(k)(e.target.value)}
      >
        <option value="">Select</option>
        {/* A stored value that is not one of the options still shows. */}
        {[...new Set([...options, ...(f[k] ? [f[k]] : [])])].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )

  const invoiceList = (invoices.data ?? []).filter((i) => !library || i.library_fee)
  const noInvoices = !editing && invoices.isSuccess && invoiceList.length === 0

  return (
    <Modal onClose={onClose} className="am-box cm-box">
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">
        {editing ? `${LICENCE_NAME[type]} ${editing.ref}` : `New ${LICENCE_NAME[type]}`}
      </div>
      {error && <div className="rm-subheader">{error}</div>}
      {noInvoices && (
        // ⚠️ INVOICE FIRST. Said plainly rather than a greyed-out button with
        // no reason — Andy, 25 Sep.
        <div className="rm-subheader">
          {library
            ? 'There is no raised invoice with a paythrough library fee on this project. Raise the licence invoice first. If the client pays the library direct, the library issues the licence.'
            : 'There is no raised invoice on this project yet. Raise the licence invoice first — its number prints on the licence.'}
        </div>
      )}

      <div className="am-form">
        <div className="cm-grid">
          <div className="cm-col">
            <div className="am-group">
              <label className="am-label" htmlFor="cl-invoice">
                Licence invoice
              </label>
              {editing ? (
                // The invoice never changes on an edit: its number is what the
                // client was told.
                <input id="cl-invoice" className="am-input" disabled value={`Invoice ${fixedInvoice?.number ?? ''}`} />
              ) : (
                <select
                  id="cl-invoice"
                  className={`am-input${invoiceId === null ? ' needs-input' : ''}`}
                  value={invoiceId ?? ''}
                  disabled={noInvoices}
                  onChange={(e) => chooseInvoice(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{invoices.isPending ? 'Loading…' : 'Select the raised invoice'}</option>
                  {invoiceList.map((i) => (
                    <option key={i.id} value={i.id}>
                      {`${i.invoice_number} · ${money(i.total, i.currency)} · ${i.client ?? ''}${
                        i.licences ? ' · has a licence' : ''
                      }`}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {input('licensee_name', 'Who the invoice is addressed to')}
            {input('licensee_address', 'Prints on one line, commas between')}
            {input('client_name', 'e.g. Unilever')}
            {input('brand', 'e.g. Dove')}
            {input('campaign')}
            {input('production_name')}
            {input(
              'licence_fee',
              feeParts
                ? `Nothing billed for ${f.rights_granted.toLowerCase()} on this invoice`
                : invoiceTotal
                  ? `Invoice total ${invoiceTotal} — enter the licence part`
                  : 'e.g. GBP 5,000.00',
            )}
          </div>

          <div className="cm-col">
            {(songs.data?.length ?? 0) > 0 && (
              <div className="am-group">
                <label className="am-label" htmlFor="cl-song">
                  Song
                </label>
                <select
                  id="cl-song"
                  className="am-input"
                  value=""
                  onChange={(e) => {
                    const s = songs.data?.find((x) => x.id === Number(e.target.value))
                    if (s) setF((p) => ({ ...p, composition_title: s.title, writer_names: s.writers }))
                  }}
                >
                  <option value="">Fill title and writers from a song…</option>
                  {songs.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {input('composition_title')}
            {input('writer_names', 'Individual writers, comma separated')}
            {select('rights_granted', RIGHTS)}
            {!library && input('licensor_share', 'e.g. 100%')}
            {input('scripts', 'e.g. 1 x 30"')}
            {select('cutdowns', ['Yes', 'No'])}
            {input('media')}
            {input('territory')}
            {input('term')}
            {input('first_transmission')}
          </div>
        </div>

        <button
          type="button"
          className={`am-submit is-full is-brief${ready && !busy ? '' : ' is-off'}`}
          onClick={submit}
        >
          {editing
            ? update.isPending
              ? 'SAVING…'
              : 'SAVE'
            : create.isPending
              ? 'CREATING…'
              : filling
                ? 'FILLING IN…'
                : 'CREATE LICENCE'}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------- the row */

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** One line per address it went to: "dane@agency.com · sent 26 Sep · opened
 *  twice · downloaded 27 Sep". ⚠️ "Opened", never "read by": the link can be
 *  forwarded. Nothing until it has been sent. */
function activityLines(a: LicenceActivity): string[] {
  if (!a.sent_at) return []
  return (a.recipients ?? []).map((r) => {
    const parts = [r.to, `sent ${shortDate(r.sent_at)}`]
    if (r.views === 0) parts.push('not opened yet')
    else parts.push(r.views === 1 ? 'opened once' : `opened ${r.views} times`)
    if (r.downloads > 0)
      parts.push(`downloaded ${r.last_download ? shortDate(r.last_download) : ''}`.trim())
    return parts.join(' · ')
  })
}

export function LicenceRowActions({
  licence,
  projectId,
}: {
  licence: LicenceRow
  projectId: number | undefined
}) {
  const archive = useArchiveLicence(projectId)
  const [menu, setMenu] = useState(false)
  const activity = useLicenceActivity(licence.uuid, menu && Boolean(licence.sent_at))
  const lines = activity.data ? activityLines(activity.data) : []
  const [archiving, setArchiving] = useState(false)
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const close = () => {
    setMenu(false)
    setCopied(false)
    setNote(null)
  }

  const copyLink = () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    shareLicence(licence.uuid)
      .then(async (s) => {
        try {
          await navigator.clipboard.writeText(s.link)
          setCopied(true)
          window.setTimeout(close, 1200)
        } catch {
          setNote(s.link)
        }
      })
      .catch((e: Error) => setNote(e.message))
      .finally(() => setBusy(false))
  }

  /** ⚠️ The tab is opened ON THE CLICK and pointed at the file when the signed
   *  url arrives; one opened after the await is a blocked popup. */
  const fetchInto = (download: boolean) => () => {
    const tab = window.open('about:blank', '_blank')
    void licenceUrl(licence.uuid, { download })
      .then((url) => {
        if (tab && !tab.closed) tab.location.href = url
        close()
      })
      .catch((e: Error) => {
        if (tab && !tab.closed) tab.close()
        setNote(e.message)
      })
  }

  return (
    <>
      <span className="row-action rf-menu-wrap">
        <button
          type="button"
          className="row-action-button"
          aria-label="Share this licence"
          aria-expanded={menu}
          onClick={(e) => {
            stop(e)
            setMenu((m) => !m)
          }}
        >
          <ShareIcon />
        </button>
        {menu && (
          <>
            <div
              className="rf-menu-catch"
              onClick={(e) => {
                stop(e)
                close()
              }}
            />
            <div className="rf-menu" role="menu" onClick={stop}>
              {lines.map((l) => (
                <span key={l} className="rf-menu-head">
                  {l}
                </span>
              ))}
              <button type="button" className="rf-menu-item" onClick={fetchInto(false)}>
                Open
              </button>
              <button type="button" className="rf-menu-item" disabled={busy} onClick={copyLink}>
                {copied ? 'Link copied' : busy ? 'Copying…' : 'Copy link'}
              </button>
              <button
                type="button"
                className="rf-menu-item"
                onClick={() => {
                  setMenu(false)
                  setSending(true)
                }}
              >
                Send…
              </button>
              <button type="button" className="rf-menu-item" onClick={fetchInto(true)}>
                Download
              </button>
              {note && <span className="rf-menu-note">{note}</span>}
            </div>
          </>
        )}
      </span>

      <span className="row-action">
        <button
          type="button"
          className="row-action-button"
          aria-label="Archive this licence"
          onClick={(e) => {
            stop(e)
            archive.reset()
            setArchiving(true)
          }}
        >
          <ArchiveIcon />
        </button>
      </span>

      {sending && (
        <SendLicenceModal licence={licence} projectId={projectId} onClose={() => setSending(false)} />
      )}

      {archiving && (
        <ArchiveModal
          header="Are you sure you want to archive this licence?"
          subheader="It leaves the list and its share link stops working. The document itself is kept."
          archive={archive}
          onConfirm={() => archive.mutate(licence.uuid, { onSuccess: () => setArchiving(false) })}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------- the send */

/**
 * Who the licence goes to. The release form's send, for a licence.
 *
 * ⚠️ TO STARTS EMPTY AND IS TYPED EVERY TIME. Nothing is prefilled from the
 * project or the invoice: on 21 Sep a test release form reached a real client
 * because an address was seeded for the sender. ⚠️ It does not close on
 * success — it says where it went, because this is the one action here that
 * leaves the company and cannot be taken back.
 */
function SendLicenceModal({
  licence,
  projectId,
  onClose,
}: {
  licence: LicenceRow
  projectId: number | undefined
  onClose: () => void
}) {
  const send = useSendLicence(projectId)
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ to: string; cc: string[] } | null>(null)
  const ready = to.trim() !== ''

  const submit = () => {
    if (!ready || send.isPending) return
    setError(null)
    send.mutate(
      { uuid: licence.uuid, to: to.trim() },
      {
        onSuccess: (r) => setSent({ to: r.sent_to, cc: r.cc }),
        onError: (e: Error) => setError(e.message),
      },
    )
  }

  if (sent) {
    return (
      <Modal onClose={onClose} className="am-box cm-box rf-send-box">
        <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
        <div className="rm-header">Sent</div>
        <div className="rm-subheader">
          Licence {licence.ref} has gone to {sent.to}
          {sent.cc.length ? ', copied to you' : ''}.
        </div>
        <div className="am-form">
          <button type="button" className="am-submit is-brief" onClick={onClose}>
            CLOSE
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} className="am-box cm-box rf-send-box">
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">Send Licence {licence.ref}</div>
      <div className="rm-subheader">
        {error ?? 'They get an email with a button to open the licence. You’re copied in, replies come to you, and you’ll get a notification when they open it.'}
      </div>
      <div className="am-form">
        <div className="am-group">
          <label className="am-label" htmlFor="cl-send-to">
            To
          </label>
          <input
            id="cl-send-to"
            type="email"
            className="am-input"
            autoComplete="off"
            placeholder="name@agency.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`am-submit is-full is-brief${ready && !send.isPending ? '' : ' is-off'}`}
          onClick={submit}
        >
          {send.isPending ? 'SENDING…' : 'SEND'}
        </button>
      </div>
    </Modal>
  )
}
