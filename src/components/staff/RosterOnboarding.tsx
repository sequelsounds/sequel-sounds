import { useEffect, useState } from 'react'
import PdfView from '../PdfView'
import { Modal } from './RowActions'
import type { RosterMember } from '../../lib/xanoMirror'
import {
  openSignedAgreement,
  pdfUrl,
  previewAgreement,
  useCompanySign,
  useInviteTeam,
  useRequestAgreement,
  useResendAgreement,
  useResendInvite,
  type AgreementPreview,
} from '../../lib/rosterOnboarding'

/**
 * Adding a composition team by email, and the composer agreement's buttons on
 * a team's page (Andy, 24 Sep 2026). The flow is in `lib/rosterOnboarding.ts`.
 */

/** + Add team: one field. The team fills in the rest itself. */
export function InviteTeamModal({ onClose }: { onClose: () => void }) {
  const invite = useInviteTeam()
  const [email, setEmail] = useState('')
  const [missing, setMissing] = useState(false)
  const done = invite.data

  // Sent: say so, and the only thing left to do is close.
  if (done) {
    return (
      <Modal onClose={onClose}>
        <div className="rm-header">{done.emailed ? 'Invite sent' : 'Team added, but the email did not send'}</div>
        <div className="rm-subheader">
          {done.emailed
            ? `We've emailed ${email.trim()} a link to add their details. They'll show on the Roster as Invited until they do.`
            : done.email_error}
        </div>
        <div className="rm-buttons">
          <button type="button" className="wizard-btn rm-button" autoFocus onClick={onClose}>
            CLOSE
          </button>
        </div>
      </Modal>
    )
  }

  // Never dimmed: pressed with nothing typed, it says what is missing.
  const send = () => {
    if (invite.isPending) return
    if (!email.trim()) return setMissing(true)
    invite.mutate(email.trim())
  }

  return (
    <Modal onClose={onClose}>
      <div className="rm-header">New composition team</div>
      <div className="rm-subheader">
        {invite.error?.message ??
          (missing
            ? 'Please enter their email address.'
            : "We'll email them a link to add their details. Once they have, you can send the composer agreement.")}
      </div>
      <label className="modal-field">
        <span className="am-label">Email</span>
        <input
          type="email"
          className="am-input"
          autoComplete="off"
          autoFocus
          placeholder="hello@composer.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setMissing(false)
            if (invite.error) invite.reset()
          }}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
      </label>
      <div className="rm-buttons">
        <button
          type="button"
          className="wizard-btn rm-button"
          disabled={invite.isPending}
          onClick={send}
        >
          {invite.isPending ? 'SENDING…' : 'SEND INVITE'}
        </button>
        <button type="button" className="wizard-btn rm-button" onClick={onClose}>
          CANCEL
        </button>
      </div>
    </Modal>
  )
}

/**
 * The header button on a team's page, by where the agreement is:
 *   none yet        → REQUEST AGREEMENT
 *   awaiting Sequel → REVIEW AGREEMENT (Andy signs there; others can look)
 *   sent            → RESEND AGREEMENT
 *   signed          → VIEW AGREEMENT
 * An invited team that has not filled in its details gets RESEND INVITE.
 */
export function AgreementActions({ member, openReview }: { member: RosterMember; openReview?: boolean }) {
  const request = useRequestAgreement()
  const resend = useResendAgreement()
  const resendInvite = useResendInvite()
  const [reviewing, setReviewing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    if (openReview && member.agreement_stage === 'awaiting_sequel') setReviewing(true)
  }, [openReview, member.agreement_stage])

  const emailed = (r: { emailed: boolean; email_error?: string }, ok: string) =>
    setNote(r.emailed ? ok : (r.email_error ?? 'The email could not be sent.'))

  let button: React.ReactNode = null
  if (member.onboarding_status === 'Invited') {
    button = (
      <button
        type="button"
        className="btn btn-mono btn-outline"
        disabled={resendInvite.isPending}
        onClick={() =>
          resendInvite.mutate(member.id, {
            onSuccess: (r) => emailed(r, 'Invite sent again.'),
            onError: (e) => setNote(e.message),
          })
        }
      >
        {resendInvite.isPending ? 'SENDING…' : 'RESEND INVITE'}
      </button>
    )
  } else if (member.has_agreement) {
    button = (
      <button
        type="button"
        className="btn btn-mono btn-outline"
        disabled={opening}
        onClick={() => {
          // Opened on the click, pointed at the file when the link arrives:
          // a tab opened after an await is a pop-up and gets blocked.
          const tab = window.open('about:blank', '_blank')
          setOpening(true)
          openSignedAgreement(member.id)
            .then((url) => {
              if (tab && !tab.closed) tab.location.href = url
            })
            .catch((e: Error) => {
              if (tab && !tab.closed) tab.close()
              setNote(e.message)
            })
            .finally(() => setOpening(false))
        }}
      >
        VIEW AGREEMENT
      </button>
    )
  } else if (member.agreement_stage === 'awaiting_sequel') {
    button = (
      <button type="button" className="btn btn-mono btn-outline" onClick={() => setReviewing(true)}>
        REVIEW AGREEMENT
      </button>
    )
  } else if (member.agreement_stage === 'awaiting_composer') {
    button = (
      <button
        type="button"
        className="btn btn-mono btn-outline"
        disabled={resend.isPending}
        onClick={() =>
          resend.mutate(member.id, {
            onSuccess: (r) => emailed(r, 'Agreement sent again.'),
            onError: (e) => setNote(e.message),
          })
        }
      >
        {resend.isPending ? 'SENDING…' : 'RESEND AGREEMENT'}
      </button>
    )
  } else if (member.ca_status !== 'Complete') {
    button = (
      <button
        type="button"
        className="btn btn-mono btn-outline"
        disabled={request.isPending}
        onClick={() =>
          request.mutate(member.id, {
            onSuccess: () => setRequested(true),
            onError: (e) => setNote(e.message),
          })
        }
      >
        {request.isPending ? 'REQUESTING…' : 'REQUEST AGREEMENT'}
      </button>
    )
  }

  const status =
    member.onboarding_status === 'Invited'
      ? 'Waiting for their details'
      : member.agreement_stage === 'awaiting_sequel'
        ? 'Agreement waiting for Andy to sign'
        : member.agreement_stage === 'awaiting_composer'
          ? `Agreement sent to ${member.title ?? 'the composition team'}`
          : member.has_agreement && member.ca_signed_at
            ? `Agreement signed ${new Date(member.ca_signed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : null

  return (
    <>
      <div className="agreement-actions">
        {(note ?? status) && <span className="agreement-note">{note ?? status}</span>}
        {button}
      </div>
      {reviewing && <ReviewAgreement member={member} onClose={() => setReviewing(false)} />}
      {/* Requested: say so in a modal, naming the team (Andy, 24 Sep). */}
      {requested && (
        <Modal onClose={() => setRequested(false)}>
          <div className="rm-header">Agreement requested</div>
          <div className="rm-subheader">
            Andy will check and sign the composer agreement, then it goes to{' '}
            {member.title ?? 'the composition team'} to sign.
          </div>
          <div className="rm-buttons">
            <button type="button" className="wizard-btn rm-button" autoFocus onClick={() => setRequested(false)}>
              CLOSE
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

/** The agreement as it will be sent, and — for Andy — the signature. */
function ReviewAgreement({ member, onClose }: { member: RosterMember; onClose: () => void }) {
  const sign = useCompanySign()
  const [preview, setPreview] = useState<AgreementPreview | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let made: string | null = null
    previewAgreement(member.id)
      .then((p) => {
        if (!live) return
        made = pdfUrl(p.pdf)
        setPreview(p)
        setUrl(made)
      })
      .catch((e: Error) => live && setLoadError(e.message))
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [member.id])

  const submit = () => {
    if (sign.isPending) return
    if (name.trim().length < 2) return setError('Type your full name to sign.')
    if (!consent) return setError('Tick the box to agree to sign electronically.')
    setError(null)
    sign.mutate(
      { supplierId: member.id, name: name.trim(), consent },
      { onError: (e) => setError(e.message) },
    )
  }

  if (sign.data) {
    return (
      <Modal onClose={onClose}>
        <div className="rm-header">{sign.data.emailed ? 'Signed and sent' : 'Signed, email not sent'}</div>
        <div className="rm-subheader">
          {sign.data.emailed
            ? `The agreement has gone to ${preview?.team ?? member.title ?? 'the composition team'} to sign. You'll get a notification when they have.`
            : sign.data.email_error}
        </div>
        <div className="rm-buttons">
          <button type="button" className="wizard-btn rm-button" onClick={onClose}>
            CLOSE
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} className="ag-box">
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />
      <div className="rm-header">Composer agreement</div>
      <div className="rm-subheader">
        {loadError ??
          (preview
            ? `${preview.legal_name || preview.team}. Once you sign, it goes to ${preview.team}${preview.email ? ` (${preview.email})` : ''} to sign.`
            : 'Filling in the agreement…')}
      </div>
      <div className="ag-doc">{url && <PdfView url={url} />}</div>
      {preview?.can_sign ? (
        <div className="ag-sign">
          <div className="ag-signature" aria-hidden="true">
            {name.trim() || ' '}
          </div>
          <input
            className="am-input"
            placeholder="Your full name"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
          />
          <label className="ag-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{preview.consent}</span>
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="rm-buttons">
            <button type="button" className="wizard-btn rm-button" disabled={sign.isPending} onClick={submit}>
              {sign.isPending ? 'SIGNING…' : 'SIGN AND SEND'}
            </button>
            <button type="button" className="wizard-btn rm-button" onClick={onClose}>
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        preview && (
          <div className="rm-subheader ag-wait">
            Andy signs for Sequel. It goes to {member.title ?? 'the composition team'} once he has.
          </div>
        )
      )}
    </Modal>
  )
}
