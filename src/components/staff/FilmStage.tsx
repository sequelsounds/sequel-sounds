import { useEffect, type Ref } from 'react'

type Props = {
  ref: Ref<HTMLVideoElement>
  open: boolean
  title: string
  onClose: () => void
}

/**
 * Where a film is watched: over the page, above everything except the player.
 *
 * The element itself is the app's one media element — the same one an mp3
 * plays through — so it is rendered unconditionally and never re-parented.
 * Opening and closing changes only where it sits on screen. Re-parenting a
 * media element reloads its source and loses the position, which on a panel
 * opened and dismissed twenty times a day would be the whole feature.
 *
 * Closing leaves it playing. A film's soundtrack is still a take somebody is
 * listening to, and the transport in the bar below goes on driving it.
 */
export default function FilmStage({ ref, open, title, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {open && (
        <div
          className="film-backdrop"
          onClick={onClose}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* Always in the tree. Off-screen rather than display:none, because a
          hidden media element is a browser's business and an off-screen one
          is not — this one has to keep playing whatever else is true. */}
      <video
        ref={ref}
        playsInline
        aria-label={open ? `${title} — film` : undefined}
        className={open ? 'film-video' : 'film-video is-away'}
      />

      {open && (
        <button
          type="button"
          className="film-close"
          aria-label="Close the film"
          title="Close the film — the sound keeps playing"
          onClick={onClose}
        >
          ×
        </button>
      )}
    </>
  )
}
