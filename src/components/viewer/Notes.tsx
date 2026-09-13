import { useState } from 'react'
import { formatDate, formatDuration } from '../../lib/format'
import {
  useAddComment,
  useLogEvent,
  useRegister,
  type Identity,
  type ViewerComment,
} from '../../lib/viewer'

type Props = {
  playlistId: string
  targetType: 'track' | 'video'
  targetId: string
  comments: ViewerComment[]
  identity: Identity | null
  onIdentity: (identity: Identity) => void
  /** Where the player is in this target right now, offered as the note's timestamp. */
  stampAt?: number | null
  /** Takes the player to a timestamp on this target. */
  onStamp?: (seconds: number) => void
  /** Under a row, the notes indent to the row's title; elsewhere they sit flush. */
  flush?: boolean
}

/**
 * The notes on one track or one cut, and the box for another.
 *
 * A note needs a name on it. A signed-in viewer's comes from their profile;
 * an anonymous one is asked for name and email the first time, once, and
 * the pair is kept for the link so the second note asks nothing. Either way
 * `register_viewer` mints the row the comment policy checks for.
 */
export default function Notes({
  playlistId,
  targetType,
  targetId,
  comments,
  identity,
  onIdentity,
  stampAt = null,
  onStamp,
  flush = false,
}: Props) {
  const [body, setBody] = useState('')
  const [withStamp, setWithStamp] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const register = useRegister()
  const add = useAddComment()
  const log = useLogEvent()
  const busy = register.isPending || add.isPending

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const text = body.trim()
    if (!text) return
    try {
      let who = identity
      if (!who) {
        if (!name.trim() || !email.trim()) {
          setError('Your name and email go on the note.')
          return
        }
        who = await register.mutateAsync({ name, email })
        onIdentity(who)
      }
      const timestamp =
        withStamp && stampAt != null ? Math.round(stampAt * 1000) / 1000 : null
      await add.mutateAsync({
        playlistId,
        identity: who,
        targetType,
        targetId,
        body: text,
        timestamp,
      })
      log({
        playlistId,
        kind: 'comment',
        trackId: targetId,
        viewerId: who.viewerId,
        position: timestamp,
      })
      setBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The note was not saved.')
    }
  }

  return (
    <div className={`viewer-notes ${flush ? 'is-flush' : ''}`}>
      {comments.length > 0 && (
        <div>
          {comments.map((c) => (
            <div key={c.id} className="viewer-note">
              <div>
                {c.timestamp_seconds != null ? (
                  <button
                    type="button"
                    className="viewer-stamp"
                    onClick={() => onStamp?.(Number(c.timestamp_seconds))}
                    title="Play from here"
                  >
                    {formatDuration(Number(c.timestamp_seconds))}
                  </button>
                ) : (
                  <span className="viewer-stamp opacity-0" aria-hidden="true">
                    0:00
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <span className="who">{c.author_name}</span>
                <span className="when">{formatDate(c.created_at)}</span>
                <div className="body">{c.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="viewer-compose" onSubmit={submit}>
        {!identity && (
          <div className="grid grid-cols-2 gap-2">
            <input
              className="field-boxed"
              placeholder="Your name"
              aria-label="Your name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="field-boxed"
              placeholder="Email"
              aria-label="Your email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        )}
        <textarea
          className="field-boxed"
          placeholder="Leave a note…"
          aria-label="Note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="viewer-compose-row">
          <label className="flex items-center gap-2">
            {stampAt != null ? (
              <>
                <input
                  type="checkbox"
                  checked={withStamp}
                  onChange={(e) => setWithStamp(e.target.checked)}
                />
                <span>at {formatDuration(stampAt)}</span>
              </>
            ) : (
              <span>Play the track to note a moment in it.</span>
            )}
          </label>
          <button
            type="submit"
            className="btn-v"
            disabled={busy || !body.trim()}
          >
            {busy ? 'Saving…' : identity ? `Post as ${identity.name}` : 'Post'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  )
}
