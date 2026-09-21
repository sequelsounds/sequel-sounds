import { useMemo, useState } from 'react'
import { ArchiveIcon, ArchiveModal, Modal, ShareIcon } from './RowActions'
import {
  releaseFormUrl,
  shareReleaseForm,
  useArchiveReleaseForm,
  useClientsForPicker,
  useCreateReleaseForm,
  useProjectReleaseRecipient,
  useReleaseFormActivity,
  useReleaseFormDetail,
  useSendReleaseForm,
  useUpdateReleaseForm,
  type ReleaseFormActivity,
  type ReleaseFormFields,
  type ReleaseFormRow,
} from '../../lib/releaseForms'

/**
 * + RELEASE FORM on the Contracting tab, and the row it leaves behind.
 *
 * ⚠️ A release form is not a contract. It grants nothing — it tells a
 * broadcaster that a track has been cleared and on what terms, deliberately
 * without the money, and it commonly goes out BEFORE the contract is written.
 * So it is typed, not derived from a contract or a quote (Andy, 18-19 Sep).
 *
 * ⚠️ ONE TRACK PER FORM — Andy, 19 Sep. There is no track list here on purpose.
 * Two tracks is two forms, which also stops two songs' different terms being
 * flattened into one set.
 *
 * ⚠️ NO SIGNER FIELD. The name is whoever is logged in, stamped by the database,
 * and the title under it is fixed text in the document: "Music Supervisor –
 * Sequel", for everyone including Andy.
 *
 * ⚠️ ONE MODAL, TWO MODES, as the contract modal has. Clicking a row opens it
 * on what is already there; the fields are identical either way, because two
 * copies of a form are how the old app's two upload modals drifted apart.
 */

export type ReleaseFormMode = { kind: 'new' } | { kind: 'edit'; form: ReleaseFormRow }

const BLANK: ReleaseFormFields = {
  recipient_name: '',
  recipient_address: '',
  recipient_email: '',
  brand: '',
  campaign: '',
  track_name: '',
  term: '',
  territory: '',
  media: '',
  scripts: '',
}

/** A null column on the project is not a value; it should leave the box empty
 *  and showing its example, not fill it with "null". */
function clean(p?: Partial<ReleaseFormFields>): Partial<ReleaseFormFields> {
  return Object.fromEntries(
    Object.entries(p ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
  )
}

const REQUIRED = [
  'recipient_name',
  'brand',
  'campaign',
  'track_name',
  'term',
  'territory',
  'media',
  'scripts',
] as const

/**
 * ⚠️ THE FORM IS NOT RENDERED UNTIL ITS VALUES EXIST. On a row that already
 * exists they arrive from the database a moment later, and seeding them into
 * state afterwards would show a set of empty boxes first — which on a document
 * someone is checking reads as "this is blank", not "this is loading".
 */
export function ReleaseFormModal({
  mode,
  projectId,
  prefill,
  onClose,
  onIssued,
}: {
  mode: ReleaseFormMode
  projectId: number
  /**
   * Everything the project already holds — brand and title, and the four terms
   * off its Terms tab. ⚠️ PREFILLED, NEVER FIXED: a release form often goes out
   * before the deal is final, and what a broadcaster is told may be narrower
   * than what the project records. Every one of these is typed over freely.
   * Ignored in edit mode, where the form's own values win.
   */
  prefill?: Partial<ReleaseFormFields>
  onClose: () => void
  onIssued?: (uuid: string) => void
}) {
  const editing = mode.kind === 'edit' ? mode.form : null
  const detail = useReleaseFormDetail(editing?.uuid)
  /* ⚠️ FETCHED HERE, NOT PASSED IN. Project.tsx supplies what the project row
   * already holds; the agency's name and address need their own query, and
   * waiting for it is the same rule edit mode follows below — a form that
   * paints empty and fills in a moment later reads as broken. */
  const recipient = useProjectReleaseRecipient(mode.kind === 'edit' ? undefined : projectId)

  if ((editing && !detail.data) || (!editing && recipient.isPending)) {
    return (
      <Modal onClose={onClose} className="am-box cm-box">
        <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
        <div className="rm-header">
          {editing ? `Release Form ${editing.ref}` : 'New Release Form'}
        </div>
        <div className="rm-subheader">
          {detail.error ? detail.error.message : 'Opening…'}
        </div>
      </Modal>
    )
  }

  const d = detail.data
  return (
    <ReleaseFormEditor
      key={editing?.uuid ?? 'new'}
      editing={editing}
      initial={
        d
          ? {
              recipient_name: d.recipient_name,
              recipient_address: d.recipient_address,
              recipient_email: d.recipient_email,
              brand: d.brand,
              campaign: d.campaign,
              track_name: d.track_name,
              term: d.term,
              territory: d.territory,
              media: d.media,
              scripts: d.scripts,
            }
          : {
              ...BLANK,
              ...clean(prefill),
              /* ⚠️ AFTER `prefill`, so the agency wins over anything the
               * project row happens to carry under the same key. The email
               * still comes from prefill — it is the project's producer, a
               * person, not the agency's switchboard. */
              ...clean({
                recipient_name: recipient.data?.name,
                recipient_address: recipient.data?.address,
              }),
            }
      }
      projectId={projectId}
      onClose={onClose}
      onIssued={onIssued}
    />
  )
}

function ReleaseFormEditor({
  editing,
  initial,
  projectId,
  onClose,
  onIssued,
}: {
  editing: ReleaseFormRow | null
  initial: ReleaseFormFields
  projectId: number
  onClose: () => void
  onIssued?: (uuid: string) => void
}) {
  const [f, setF] = useState<ReleaseFormFields>(initial)
  const [error, setError] = useState<string | null>(null)
  const [clientsOpen, setClientsOpen] = useState(false)

  const create = useCreateReleaseForm(projectId)
  const update = useUpdateReleaseForm(projectId)
  const clients = useClientsForPicker()

  const set = (k: keyof ReleaseFormFields) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  /** Same shape as the contract modal's supplier search: type to narrow, and
   *  what is typed is what prints whether or not it matches anybody. */
  const clientResults = useMemo(() => {
    const q = f.recipient_name.trim().toLowerCase()
    const all = clients.data ?? []
    return (q ? all.filter((c) => c.company.toLowerCase().includes(q)) : all).slice(0, 8)
  }, [clients.data, f.recipient_name])

  /** Every one of these prints, and a release form with a blank Territory is
   *  worse than none: it reads as cleared everywhere. The database refuses them
   *  too — this only saves the round trip. The email is not among them; it is
   *  needed to SEND one, not to issue one. */
  const ready = REQUIRED.every((k) => f[k].trim() !== '')
  const busy = create.isPending || update.isPending

  /**
   * ⚠️ NOTHING OPENS ON SAVE, and there is no download or send button here any
   * more — Andy, 19 Sep. The document is written either way; getting at it is a
   * separate job and not this modal's. The PDF is reachable through the row's
   * share link.
   */
  const submit = () => {
    if (!ready || busy) return
    setError(null)
    const done = {
      onSuccess: (r: { uuid: string }) => {
        onIssued?.(r.uuid)
        onClose()
      },
      onError: (e: Error) => setError(e.message),
    }
    if (editing) update.mutate({ uuid: editing.uuid, ...f }, done)
    else create.mutate(f, done)
  }

  const Field = ({
    id,
    label,
    value,
    onChange,
    placeholder,
    textarea,
    type,
  }: {
    id: string
    label: string
    value: string
    onChange: (v: string) => void
    placeholder?: string
    textarea?: boolean
    type?: string
  }) => (
    <div className="am-group">
      <label className="am-label" htmlFor={id}>
        {label}
      </label>
      {textarea ? (
        <textarea
          id={id}
          className="am-input rf-address"
          rows={3}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type={type ?? 'text'}
          className="am-input"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )

  return (
    <Modal onClose={onClose} className="am-box cm-box">
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">{editing ? `Release Form ${editing.ref}` : 'New Release Form'}</div>
      {error && <div className="rm-subheader">{error}</div>}

      <div className="am-form">
        <div className="cm-grid">
          <div className="cm-col">
            <div className="am-group">
              <label className="am-label" htmlFor="rf-recipient">
                Address to
              </label>
              <div className="ns-combo rf-combo">
                <div className="ns-field">
                  <input
                    id="rf-recipient"
                    className="ns-input"
                    placeholder="Search clients, or type a name"
                    autoComplete="off"
                    value={f.recipient_name}
                    onChange={(e) => {
                      set('recipient_name')(e.target.value)
                      setClientsOpen(true)
                    }}
                    onFocus={() => setClientsOpen(true)}
                    onBlur={() => window.setTimeout(() => setClientsOpen(false), 200)}
                  />
                </div>
                {clientsOpen && (
                  <div className="ns-results" role="listbox">
                    {clientResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={f.recipient_name === c.company}
                        className="ns-result"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          // The address fills in, and stays editable: over half
                          // the client list has no street address on file, and
                          // a broadcaster's is often not the client's anyway.
                          setF((p) => ({
                            ...p,
                            recipient_name: c.company,
                            recipient_address: c.address ?? p.recipient_address,
                          }))
                          setClientsOpen(false)
                        }}
                      >
                        <span className="ns-result-text">{c.company}</span>
                      </button>
                    ))}
                    {clientResults.length === 0 && (
                      <span className="ns-result-text">
                        No client of that name — it will print as typed
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ⚠️ EXACTLY TWO FIELDS TALL — see .rf-address. That is what keeps
                the two columns level: the address sits across Term and
                Territory, and everything below it pairs off line for line. */}
            {Field({
              id: 'rf-address',
              label: 'Address',
              value: f.recipient_address,
              onChange: set('recipient_address'),
              placeholder: 'One line per line, as it should print',
              textarea: true,
            })}
            {/* ⚠️ NO EMAIL FIELD HERE — Andy, 21 Sep. It printed nowhere and did
                one thing: prefill To in the send modal. Prefilled from the
                project's client contact, it put a real Ogilvy address on a form
                called "Delete me", and on 21 Sep that form reached him. The
                recipient is now typed at send time, every time, on purpose.
                `recipient_email` survives on the row and in the payload so a
                form created before this keeps the address it already had. */}
            {Field({
              id: 'rf-brand',
              label: 'Brand',
              value: f.brand,
              onChange: set('brand'),
              placeholder: "e.g. Hellmann's",
            })}
            {Field({
              id: 'rf-campaign',
              label: 'Campaign',
              value: f.campaign,
              onChange: set('campaign'),
              placeholder: 'e.g. Soccer Campaign',
            })}
          </div>

          <div className="cm-col">
            {Field({
              id: 'rf-track',
              label: 'Track',
              value: f.track_name,
              onChange: set('track_name'),
              placeholder: 'e.g. Do the Right Thing',
            })}
            {Field({
              id: 'rf-term',
              label: 'Term',
              value: f.term,
              onChange: set('term'),
              placeholder: 'e.g. Perpetuity',
            })}
            {Field({
              id: 'rf-territory',
              label: 'Territory',
              value: f.territory,
              onChange: set('territory'),
              placeholder: 'e.g. Worldwide',
            })}
            {Field({
              id: 'rf-media',
              label: 'Media',
              value: f.media,
              onChange: set('media'),
              placeholder: 'e.g. Online incl. Social (Excluding VOD)',
            })}
            {Field({
              id: 'rf-scripts',
              label: 'Scripts',
              value: f.scripts,
              onChange: set('scripts'),
              placeholder: 'e.g. 1 script including cutdowns',
            })}
          </div>
        </div>

        <button
          type="button"
          className={`am-submit is-full is-brief${ready && !busy ? '' : ' is-off'}`}
          onClick={submit}
        >
          {/* ⚠️ "CREATE", NOT "ISSUE" — Andy, 20 Sep: *"it makes it seem like it
              is actually issuing it rather than just creating it."* Pressing
              this writes a row and draws a PDF. Nobody outside Sequel learns
              anything until Send… is used, and a button that says ISSUE on the
              screen where that distinction matters is how someone ends up
              believing a broadcaster has been told. */}
          {editing
            ? update.isPending
              ? 'SAVING…'
              : 'SAVE'
            : create.isPending
              ? 'CREATING…'
              : 'CREATE RELEASE FORM'}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------- what happened */

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * One line on what became of a sent form.
 *
 * ⚠️ "OPENED", NOT "READ BY". The link can be forwarded and often is — a
 * broadcaster passes it to whoever handles clearances — so these are opens of a
 * link, not proof that the addressee looked at it. The wording is careful on
 * purpose; do not tighten it into "<name> read this".
 *
 * ⚠️ NOT OPENED IS NOT NOT DELIVERED. A quiet line means nobody followed the
 * link, which is a different thing from the email bouncing. Resend knows about
 * bounces; this does not.
 */
function activityLine(a: ReleaseFormActivity): string | null {
  if (!a.sent_at) return null
  const parts = [`Sent ${shortDate(a.sent_at)}`]
  if (a.views === 0) parts.push('not opened yet')
  else parts.push(a.views === 1 ? 'opened once' : `opened ${a.views} times`)
  if (a.downloads > 0) parts.push(`downloaded ${a.last_download ? shortDate(a.last_download) : ''}`.trim())
  return parts.join(' · ')
}

/* -------------------------------------------------------------- the compose */

/**
 * Write the email that carries the release form.
 *
 * ⚠️ THIS IS NOT A CONFIRMATION STEP — Andy, 19 Sep. Send used to fire on the
 * click, from a template, to whatever address sat on the form: a letter landed
 * in a broadcaster's inbox under words nobody here had read, sent from the
 * registrations address with no way to reply to a person. Adding "are you
 * sure?" would have fixed the misclick and none of the rest. So the words are
 * written here, the address can be corrected here, and the reply comes back to
 * whoever pressed send.
 *
 * The body opens with a line to save typing the obvious. It is a draft in a box
 * the sender is looking at, which is a different thing from boilerplate sent on
 * their behalf.
 */
function SendReleaseFormModal({
  form,
  projectId,
  onClose,
}: {
  form: ReleaseFormRow
  projectId: number | undefined
  onClose: () => void
}) {
  const send = useSendReleaseForm(projectId)
  /* ⚠️ THE ADDRESS COMES FROM THE FORM'S OWN RECORD, not from the list row.
   * Andy, 21 Sep: To opened empty on a form that had an email on it. The row
   * in the list can be a moment behind — it is whatever was fetched last — and
   * on a just-created form that is exactly when Send is pressed. */
  const detail = useReleaseFormDetail(form.uuid)

  /* ⚠️ DERIVED, NOT SEEDED. `detail` lands after the modal opens, so state
   * seeded on first render would keep the stale value for ever. null until
   * something is typed, and then the typed value wins permanently. */
  const [edited, setEdited] = useState<string | null>(null)
  const to = edited ?? detail.data?.recipient_email ?? form.recipient_email ?? ''
  /* Still sent, just not editable: the function falls back to this exact line
   * when the payload carries none, so the two cannot drift apart. */
  const subject = `Music release | ${form.brand} — ${form.campaign}`
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ to: string; cc: string[] } | null>(null)

  const ready = to.trim() !== ''

  const submit = () => {
    if (!ready || send.isPending) return
    setError(null)
    send.mutate(
      { uuid: form.uuid, to: to.trim(), subject: subject.trim() },
      {
        /* ⚠️ IT DOES NOT CLOSE ON SUCCESS. Nothing in the row shows that a form
         * has been emailed, so closing silently leaves the sender with no way
         * to tell a send from a no-op — on the one action here that reaches
         * outside the company and cannot be taken back. */
        onSuccess: (r) => setSent({ to: r.sent_to, cc: r.cc }),
        onError: (e: Error) => setError(e.message),
      },
    )
  }

  if (sent) {
    return (
      <Modal onClose={onClose} className="am-box cm-box rf-send-box">
        <button
          type="button"
          className="wizard-close rm-close"
          aria-label="Close"
          onClick={onClose}
        />
        <div className="rm-header">Sent</div>
        <div className="rm-subheader">
          Release form {form.ref} has gone to {sent.to}
          {sent.cc.length ? ', copied to you' : ''}. The share menu shows when it is opened.
        </div>
        <div className="am-form">
          {/* ⚠️ NOT FULL WIDTH — Andy, 21 Sep. Full width is for the one button
              that completes a form: CREATE and SEND. This panel is an
              acknowledgement, the sending is already done, and a bar across
              the whole modal reads as another commitment to make. Auto width,
              left, the way .rm-buttons sits in every other dialog here. */}
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
      <div className="rm-header">Send Release Form {form.ref}</div>
      {/* ⚠️ PLAIN TEXT, NEVER A BORDERED BOX — Andy, 21 Sep: *"WHY IS THIS
          PRETENDING TO BE AN ATTACHMENT"*. This said the right thing in the
          wrong shape: a bordered panel with an icon, directly under Subject, is
          an attachment row in every mail client, and no wording survives that.
          Nothing is attached, so nothing here may look like a file. */}
      <div className="rm-subheader">
        {error ??
          'A link to the release form, not an attachment. A copy comes to you, and so do any replies.'}
      </div>

      <div className="am-form">
        <div className="am-group">
          <label className="am-label" htmlFor="rf-send-to">
            To
          </label>
          <input
            id="rf-send-to"
            type="email"
            className="am-input"
            autoComplete="off"
            placeholder="name@broadcaster.com"
            value={to}
            onChange={(e) => setEdited(e.target.value)}
          />
        </div>

        {/* ⚠️ NO SUBJECT FIELD — Andy, 21 Sep. It was prefilled from the brand
            and campaign already on the form, and nobody was ever going to
            improve on that by hand. The function composes the identical line
            when none is sent, so this costs nothing and leaves ONE input in
            the modal: who it goes to. After a test letter reached a real
            client, that is the field worth having alone on the screen. */}

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

/* ------------------------------------------------------------ the row cell */

/**
 * Share and archive.
 *
 * ⚠️ SHARE IS A MENU, NOT A MODAL, and that is a correctness point rather than
 * a taste one. The modal it replaced minted a public seven-day link the moment
 * it opened — so someone who only wanted to download the thing published it as
 * a side effect. Here the link is created only if COPY LINK is chosen.
 *
 * A modal is for something you have to stop and read. Archive keeps one because
 * it is destructive; these three are just verbs and happen where you clicked.
 */
export function ReleaseFormRowActions({
  form,
  projectId,
}: {
  form: ReleaseFormRow
  projectId: number | undefined
}) {
  const archive = useArchiveReleaseForm(projectId)
  const [menu, setMenu] = useState(false)
  const activity = useReleaseFormActivity(form.uuid, menu && Boolean(form.sent_at))
  const line = activity.data ? activityLine(activity.data) : null
  const [sending, setSending] = useState(false)
  const [archiving, setArchiving] = useState(false)
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
    shareReleaseForm(form.uuid)
      .then(async (s) => {
        try {
          await navigator.clipboard.writeText(s.link)
          setCopied(true)
          window.setTimeout(close, 1200)
        } catch {
          // The browser refuses the clipboard in some contexts. The link exists
          // either way, so show it rather than lose it.
          setNote(s.link)
        }
      })
      .catch((e: Error) => setNote(e.message))
      .finally(() => setBusy(false))
  }

  /**
   * Open reads it in the browser; download puts it on the disk. Same signed
   * url, and the only difference is the disposition the function sets on it.
   *
   * ⚠️ THE TAB IS OPENED ON THE CLICK, blank, and pointed at the file when the
   * signed url arrives. One opened after the await is a popup and is blocked.
   */
  const fetchInto = (download: boolean) => () => {
    const tab = window.open('about:blank', '_blank')
    void releaseFormUrl(form.uuid, { download })
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
          aria-label="Share this release form"
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
            {/* Catches the click that dismisses it, so no document listener has
                to be added and removed. */}
            <div className="rf-menu-catch" onClick={(e) => { stop(e); close() }} />
            <div className="rf-menu" role="menu" onClick={stop}>
              {/* Only once it has been sent — before that there is nothing to
                  report and an empty line is noise. Fetched when the menu
                  opens, not with the list: it is one query per row otherwise,
                  for a line almost nobody is looking at. */}
              {line && <span className="rf-menu-head">{line}</span>}
              <button type="button" className="rf-menu-item" onClick={fetchInto(false)}>
                Open
              </button>
              <button type="button" className="rf-menu-item" disabled={busy} onClick={copyLink}>
                {copied ? 'Link copied' : busy ? 'Copying…' : 'Copy link'}
              </button>
              {/* ⚠️ ENABLED WITH OR WITHOUT AN ADDRESS ON THE FORM. It used to
                  grey out and point at a box on the form; now the compose has
                  its own To field, so a missing address is typed rather than
                  gone back for. The ellipsis is the convention for "this opens
                  something" as against "this fires". */}
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
          aria-label="Archive this release form"
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
        <SendReleaseFormModal
          form={form}
          projectId={projectId}
          onClose={() => setSending(false)}
        />
      )}

      {archiving && (
        <ArchiveModal
          header="Are you sure you want to archive this release form?"
          /* Said plainly: the letter was sent, and archiving does not unsend
             it. What goes is the link and the row. */
          subheader="It leaves the list and its share link stops working. The document itself is kept."
          archive={archive}
          onConfirm={() => archive.mutate(form.uuid, { onSuccess: () => setArchiving(false) })}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  )
}
