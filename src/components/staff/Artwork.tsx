import { useMediaUrl } from '../../lib/media'

type Props = {
  artworkKey: string | null
  kind: 'audio' | 'video'
  className?: string
}

/** Cover art, or the mockup's placeholder block — darker for video. */
export default function Artwork({ artworkKey, kind, className = '' }: Props) {
  const { data: url } = useMediaUrl(artworkKey)
  const cls = `art ${kind === 'video' ? 'is-video' : ''} ${className}`
  return url ? (
    <img src={url} alt="" className={cls} loading="lazy" draggable={false} />
  ) : (
    <span className={cls} aria-hidden="true" />
  )
}
