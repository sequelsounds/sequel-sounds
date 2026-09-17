import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useSong } from '../lib/xanoMirror'
import { openSignedScheduleA, resendSongLink, useSongSigning } from '../lib/songSchedule'

/**
 * One song — Sequel Track's `/song`, rebuilt.
 *
 * Six tabs, of which Track has five built. Two things diverge on purpose and
 * both are called out on the page itself:
 *
 *  1. **The Earnings tile is hardcoded.** Track renders "£1234.56" whatever
 *     song is loaded — it renders it on a page with no song loaded at all,
 *     which is how it was caught. It is static text in Webflow, not a binding.
 *     Reproducing the number would put a plausible, specific and entirely
 *     invented figure next to real money, so the tile is here and empty. Brand
 *     and Ownership beside it are real.
 *  2. **The Writers tab is empty markup on Track** — no fields, no rows. It
 *     now lists the writers the composer confirmed (sequel_song_writer), for
 *     songs confirmed through the form; older songs still show nothing here.
 *
 * New, Andy 16 Sep: a song made from + NEW SONG shows where its Schedule A
 * has got to on Overview — the link emailed, confirmed, signed (and from
 * where) — with the signed copy, and says plainly if an email or the signing
 * went wrong.
 *
 * The Creative tab lists the song's creative links on Track. Those come from a
 * different table and are not in this view, so it is empty here for now and
 * says so rather than pretending the song has none.
 *
 * Read-only, so Track's save-on-blur is not here.
 */

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const stamp = (v: string | null) => (v ? when.format(new Date(v)) : '')

/** Where a new-app song's Schedule A has got to, in one line. */
function ScheduleAPanel({ songId }: { songId: number }) {
  const q = useSongSigning(songId)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const sig = q.data?.signing

  // 'sequel' songs, and the two signed through Firma while it was tried.
  if (!sig || (sig.schedule_a_via !== 'sequel' && sig.schedule_a_via !== 'firma')) return null

  const progress = sig.schedule_a_signed_at
    ? `Signed ${stamp(sig.schedule_a_signed_at)}${sig.schedule_a_signer_name ? ` by ${sig.schedule_a_signer_name}` : ''}`
    : sig.composer_reg_form_status === 'Confirmed'
      ? `Details confirmed ${stamp(sig.confirmed_at)} — waiting for the signature`
      : sig.link_emailed_at
        ? `Link emailed ${stamp(sig.link_emailed_at)} — waiting for the composer`
        : 'Link not sent'
  const problem = sig.link_email_error || sig.firma_error || sig.signed_copy_email_error

  return (
    <>
      <Field label="Schedule A" value={progress} />
      <Field label="Sent To (Contract Email)" value={sig.contract_email} />
      {sig.schedule_a_signer_ip && <Field label="Signed From (IP Address)" value={sig.schedule_a_signer_ip} />}
      {problem && <p className="form-error">{problem}</p>}
      {note && <p className="form-error">{note}</p>}
      <div className="flex gap-4">
        {sig.schedule_a_pdf_path && (
          <button
            type="button"
            className="btn btn-mono btn-outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setNote(null)
              // Opened before the await, so the browser does not block it.
              const tab = window.open('about:blank', '_blank')
              try {
                const url = await openSignedScheduleA(songId)
                if (tab) tab.location.href = url
              } catch (e) {
                tab?.close()
                setNote((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            SIGNED COPY
          </button>
        )}
        {/* Until it is signed: the same link covers the form and the signing. */}
        {!sig.schedule_a_signed_at && (
          <button
            type="button"
            className="btn btn-mono btn-outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setNote(null)
              try {
                const r = await resendSongLink(songId)
                setNote(r.emailed ? null : (r.email_error ?? 'The email did not send.'))
                await q.refetch()
              } catch (e) {
                setNote((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            RESEND LINK
          </button>
        )}
      </div>
    </>
  )
}

function WritersPane({ songId }: { songId: number }) {
  const q = useSongSigning(songId)
  const writers = q.data?.writers ?? []
  if (q.isPending) return null
  if (writers.length === 0) return <p className="empty-note py-6">No writers confirmed for this song yet.</p>
  return (
    <div className="edit-form">
      {writers.map((w, i) => (
        <Field
          key={w.id}
          label={`Writer ${i + 1}`}
          value={[w.full_name, w.cae_number || 'No CAE', w.share_split !== null ? `${Number(w.share_split)}%` : '']
            .filter(Boolean)
            .join('  ·  ')}
        />
      ))}
    </div>
  )
}

const TABS = ['Overview', 'Registration', 'Campaign', 'Writers', 'Creative', 'Notes'] as const
type Tab = (typeof TABS)[number]

function Stat({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value ?? ''}</span>
    </div>
  )
}

function Field({
  label,
  value,
  textarea,
}: {
  label: string
  value: string | number | null | undefined
  textarea?: boolean
}) {
  const v = value === null || value === undefined ? '' : String(value)
  return (
    <div className="edit-field">
      <label className="edit-field-label">{label}</label>
      {textarea ? (
        <textarea className="edit-field-input edit-field-input-text" value={v} readOnly />
      ) : (
        <input className="edit-field-input" value={v} readOnly />
      )}
    </div>
  )
}

export default function Song() {
  const { uuid } = useParams()
  const song = useSong(uuid)
  const [tab, setTab] = useState<Tab>('Overview')

  if (song.isPending) {
    return (
      <div className="flex flex-1 justify-center py-16">
        <Loader />
      </div>
    )
  }
  if (song.error) return <p className="form-error px-8 py-8">{song.error.message}</p>
  if (!song.data) return <p className="empty-note py-8">No song with that link.</p>

  const s = song.data

  return (
    <>
      <div className="header-band">
        {/* The composer is the eyebrow here, where every other page puts a
            section name there. */}
        <div className="page-eyebrow">{s.composer ?? ''}</div>
        <div className="title-row">
          <h1 className="page-title">{s.track_title ?? `Untitled (#${s.id})`}</h1>
        </div>
        <div className="page-subtitle">&nbsp;</div>
      </div>

      <div className="tab-band">
        {/* Empty on purpose — see the note at the top. Track's £1234.56 is
            static text, not this song's earnings or any other song's. */}
        <Stat label="Earnings" value="" />
        <div className="tab-band-divider" />
        <Stat label="Brand" value={s.brand} />
        <div className="tab-band-divider" />
        <Stat label="Ownership" value={s.ownership} />
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
            <Field label="Title" value={s.track_title} />
            <Field label="Schedule A Status" value={s.schedule_a_status} />
            <Field label="Duration" value={s.duration} />
            <Field label="Alternative Titles" value={s.alternative_titles} textarea />
            <Field label="Composer" value={s.composer} />
            <ScheduleAPanel songId={s.id} />
          </div>
        )}

        {tab === 'Registration' && (
          <div className="edit-form">
            <Field label="Registration Status" value={s.registration_status} />
            <Field label="Tunecode" value={s.tunecode} />
            <Field label="Agreement Number" value={s.agreement_number} />
            <Field label="PRS Registration Date" value={s.prs_registration_date} />
            <Field label="Commencement Date" value={s.commencement_date} />
            <Field label="Clock Numbers" value={s.clock_numbers} textarea />
          </div>
        )}

        {tab === 'Campaign' && (
          <div className="edit-form">
            <Field label="Project Name" value={s.project} />
            <Field label="Campaign Description" value={s.campaign_description} />
            <Field label="Script title" value={s.script_title} />
            {/* The project's client company, not the song's own
                Advertising_Agency column — which holds something different on
                at least one row. Two Wized elements share this name, one bound
                to each source; the project's client is the one that renders. */}
            <Field label="Ad Agency" value={s.ad_agency} />
          </div>
        )}

        {/* Empty markup on Track. The eight composer slots, their CAE numbers
            and their shares are all on the table and none of them is shown. */}
        {tab === 'Writers' && <WritersPane songId={s.id} />}

        {tab === 'Creative' && (
          <p className="empty-note py-6">
            Creative links are not on this side yet.
          </p>
        )}

        {tab === 'Notes' && (
          <div className="edit-form">
            <Field label="Notes" value={s.notes} textarea />
          </div>
        )}
      </div>
    </>
  )
}
