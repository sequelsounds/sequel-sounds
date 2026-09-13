import { useMediaUrl } from '../../lib/media'
import { FilmIcon, ImageIcon, PageIcon, WaveformIcon } from './icons'

/**
 * What a file is, as far as its square is concerned. `tracks.kind` is only
 * audio or video, but project assets are briefs and artwork and contracts,
 * so the other three are here already rather than waiting to be retrofitted
 * the day that list gets a page.
 */
export type ArtKind = 'audio' | 'video' | 'image' | 'pdf' | 'document'

const MARKS = {
  audio: WaveformIcon,
  video: FilmIcon,
  image: ImageIcon,
  pdf: PageIcon,
  document: PageIcon,
} as const

/** A film is the only kind that gets a dark block; the rest are the grey one. */
const DARK: ArtKind[] = ['video']

/**
 * Whatever a mime type is, in the five terms above. Anything unrecognised is
 * a document rather than nothing — an unknown file still has to draw as
 * something, and a page is the honest guess.
 */
export function artKindFromMime(mime: string | null | undefined): ArtKind {
  if (!mime) return 'document'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  return 'document'
}

type Props = {
  artworkKey: string | null
  kind: ArtKind
  className?: string
}

/**
 * Cover art, or a square that says what the file is.
 *
 * Most of what partners send has no embedded cover, so the placeholder is
 * what is actually on screen most of the time. A blank block said only
 * "nothing here"; the mark says which of the things it is, which is the one
 * fact a row cannot otherwise show at a glance.
 */
export default function Artwork({ artworkKey, kind, className = '' }: Props) {
  const { data: url } = useMediaUrl(artworkKey)
  const dark = DARK.includes(kind)
  const cls = `art ${dark ? 'is-video' : ''} ${className}`

  if (url) {
    return (
      <img src={url} alt="" className={cls} loading="lazy" draggable={false} />
    )
  }

  const Mark = MARKS[kind]
  return (
    <span className={`${cls} is-empty`} aria-hidden="true">
      <Mark className="art-mark" />
    </span>
  )
}
