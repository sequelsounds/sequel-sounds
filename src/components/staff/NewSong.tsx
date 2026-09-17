import { useMemo, useState } from 'react'
import { useRoster, type RosterMember } from '../../lib/xanoMirror'
import {
  OWNERSHIP_OPTIONS,
  resendSongLink,
  useCreateSong,
  type CreatedSong,
  type Ownership,
} from '../../lib/songSchedule'
import { Modal } from './RowActions'

/**
 * + NEW SONG on a project: the old app's `create_song_menu`, read off the
 * /project page and its Wized bindings 16 Sep — header, subheader, the rights
 * combo, the composition team search, SEND SCHEDULE A and CANCEL.
 *
 * Changed from the old app, Andy 16 Sep:
 *  - rights start blank ("Select rights...") and must be picked — Andy,
 *    16 Sep, after first trying a Master & Publishing default;
 *  - SEND SCHEDULE A asks to confirm, naming who the link goes to (the team's
 *    Contract Email), before anything is created or sent;
 *  - a song that is made but whose email fails says so, with a way to retry,
 *    instead of failing silently as the Xano trigger did.
 */
type Stage = 'pick' | 'confirm' | 'sent'

export function NewSongModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const roster = useRoster()
  const create = useCreateSong(projectId)

  const [ownership, setOwnership] = useState<Ownership | ''>('')
  const [rightsOpen, setRightsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [teamsOpen, setTeamsOpen] = useState(false)
  const [team, setTeam] = useState<RosterMember | null>(null)
  const [stage, setStage] = useState<Stage>('pick')
  const [created, setCreated] = useState<CreatedSong | null>(null)
  const [resending, setResending] = useState(false)

  // Composer_search: typing filters on the name; focus with nothing typed
  // shows the whole roster.
  const results = useMemo(() => {
    const list = roster.data ?? []
    const q = query.trim().toLowerCase()
    if (!q || (team && query === team.title)) return list
    return list.filter((m) => (m.title ?? '').toLowerCase().includes(q))
  }, [roster.data, query, team])

  const email = team?.contract_email?.trim() || null
  const ready = !!team && !!ownership

  // mutateAsync, not mutate's own onSuccess: that callback is dropped if the
  // modal remounts mid-request (a dev hot reload did exactly that, 16 Sep),
  // leaving the modal open after the song was made and emailed. The promise
  // still resolves, and onClose is the page's setter, so it still closes.
  const send = async () => {
    if (!team || !ownership || create.isPending) return
    let r: CreatedSong
    try {
      r = await create.mutateAsync({ supplierId: team.id, ownership })
    } catch {
      return // create.error shows on the confirm step
    }
    if (r.emailed) return onClose()
    setCreated(r)
    setStage('sent')
  }

  const retry = async () => {
    if (!created) return
    setResending(true)
    try {
      const r = await resendSongLink(created.song_id)
      if (r.emailed) onClose()
      else setCreated({ ...created, email_error: r.email_error })
    } catch (e) {
      setCreated({ ...created, email_error: (e as Error).message })
    } finally {
      setResending(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <button type="button" className="wizard-close rm-close" aria-label="Close" onClick={onClose} />

      {stage === 'pick' && (
        <>
          <div className="rm-header">Start New Song Registration</div>
          <div className="rm-subheader">
            Choose the rights Sequel is acquiring, then select the composition team to send a
            Schedule A.
          </div>

          <div className="ns-combo ns-rights">
            <div className="ns-field">
              <input
                className="ns-input"
                placeholder="Select rights..."
                autoComplete="off"
                readOnly
                value={ownership}
                onFocus={() => setRightsOpen(true)}
                onClick={() => setRightsOpen(true)}
                onBlur={() => window.setTimeout(() => setRightsOpen(false), 200)}
              />
            </div>
            {rightsOpen && (
              <div className="ns-results" role="listbox">
                {OWNERSHIP_OPTIONS.map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="option"
                    aria-selected={o === ownership}
                    className="ns-result"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOwnership(o)
                      setRightsOpen(false)
                    }}
                  >
                    <span className="ns-result-text">{o}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ns-combo">
            <div className="ns-field">
              <input
                className="ns-input"
                placeholder="Search composition team..."
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (team && e.target.value !== team.title) setTeam(null)
                  setTeamsOpen(true)
                }}
                onFocus={() => setTeamsOpen(true)}
                onBlur={() => window.setTimeout(() => setTeamsOpen(false), 200)}
              />
            </div>
            {teamsOpen && (
              <div className="ns-results" role="listbox">
                {results.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={team?.id === m.id}
                    className="ns-result"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setTeam(m)
                      setQuery(m.title ?? '')
                      setTeamsOpen(false)
                    }}
                  >
                    <span className="ns-result-text">{m.title}</span>
                    <span className="ns-result-text is-sub">{m.country_text}</span>
                  </button>
                ))}
                {roster.isSuccess && results.length === 0 && (
                  <div className="ns-result is-empty">
                    <span className="ns-result-text">No Composers Found</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {roster.error && <p className="form-error">{roster.error.message}</p>}

          <div className="rm-buttons">
            <button
              type="button"
              className="wizard-btn rm-button ns-button"
              disabled={!ready}
              onClick={() => setStage('confirm')}
            >
              SEND SCHEDULE A
            </button>
            <button type="button" className="wizard-btn rm-button ns-button" onClick={onClose}>
              CANCEL
            </button>
          </div>
        </>
      )}

      {stage === 'confirm' && team && (
        <>
          <div className="rm-header">Send the Schedule A to {team.title}?</div>
          {email ? (
            <div className="rm-subheader">
              We'll email {email} a link to confirm the song's details and sign the Schedule A (
              {ownership}).
            </div>
          ) : (
            <div className="rm-subheader">
              {team.title} has no Contract Email. Add one on their roster page, then try again.
            </div>
          )}
          {create.error && <p className="form-error">{create.error.message}</p>}
          <div className="rm-buttons">
            <button
              type="button"
              className="wizard-btn rm-button ns-button"
              disabled={!email || create.isPending}
              onClick={() => void send()}
            >
              {create.isPending ? 'SENDING…' : 'YES, SEND'}
            </button>
            <button
              type="button"
              className="wizard-btn rm-button ns-button"
              disabled={create.isPending}
              onClick={() => {
                create.reset()
                setStage('pick')
              }}
            >
              BACK
            </button>
          </div>
        </>
      )}

      {stage === 'sent' && created && (
        <>
          <div className="rm-header">The song was created, but the email didn't send</div>
          <div className="rm-subheader">{created.email_error}</div>
          <div className="rm-buttons">
            <button
              type="button"
              className="wizard-btn rm-button ns-button"
              disabled={resending}
              onClick={() => void retry()}
            >
              {resending ? 'SENDING…' : 'TRY AGAIN'}
            </button>
            <button type="button" className="wizard-btn rm-button ns-button" onClick={onClose}>
              CLOSE
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
