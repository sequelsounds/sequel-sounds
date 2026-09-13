import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SequelLogo from '../components/SequelLogo'
import { PauseIcon, PlayIcon } from '../components/staff/icons'
import Waveform from '../components/staff/Waveform'
import { formatDuration } from '../lib/format'
import { mediaUrls } from '../lib/media'
import { tokenClient } from '../lib/tokenClient'
import LoadingModal from '../components/Loader'

/**
 * One track on its own, behind its own share token.
 *
 * Deliberately narrow: the token resolves exactly one `tracks` row and nothing
 * around it — not the project, not the inbox, not the other tracks in either —
 * so a link forwarded on tells the recipient about one piece of music and
 * nothing about the job it was sent for. Internal fields stay off it too.
 */
export default function SharedTrackRoute() {
  const { token = '' } = useParams()
  return <SharedTrack key={token} token={token} />
}

function SharedTrack({ token }: { token: string }) {
  const supabase = useMemo(() => tokenClient(token), [token])
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)

  const track = useQuery({
    queryKey: ['shared-track', token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tracks')
        .select(
          'id, title, artist, album, duration_seconds, preview_key, artwork_s3_key, waveform_peaks',
        )
        .single()
      if (error) throw error
      return data
    },
  })

  const previewKey = track.data?.preview_key ?? null
  const artworkKey = track.data?.artwork_s3_key ?? null

  const media = useQuery({
    queryKey: ['shared-track-media', token, previewKey, artworkKey],
    enabled: !!track.data,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const keys = [previewKey, artworkKey].filter((k): k is string => !!k)
      return keys.length ? await mediaUrls(keys, token) : {}
    },
  })

  const previewUrl = previewKey ? (media.data?.[previewKey] ?? null) : null
  const artworkUrl = artworkKey ? (media.data?.[artworkKey] ?? null) : null
  const peaks = Array.isArray(track.data?.waveform_peaks)
    ? (track.data.waveform_peaks as number[])
    : null

  useEffect(() => {
    document.title = track.data ? `Sequel | ${track.data.title}` : 'Sequel'
  }, [track.data])

  useEffect(() => {
    const el = audio.current
    if (!el) return
    const onTime = () => setPosition(el.currentTime)
    const onMeta = () => setDuration(el.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
    }
  }, [previewUrl])

  const total = duration || track.data?.duration_seconds || 0

  return (
    <div className="surface-light flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-16 pt-10">
        <SequelLogo className="mb-12" />

        {track.isPending && <LoadingModal />}
        {track.error && (
          <div>
            <h1 className="font-title text-[2rem] font-normal">
              Link not found
            </h1>
            <p className="mt-2 text-sm text-sequel-mid">
              This link has been withdrawn, or it was never right. Ask whoever
              sent it for another.
            </p>
          </div>
        )}

        {track.data && (
          <>
            <div className="flex items-start gap-5">
              {artworkUrl ? (
                <img
                  src={artworkUrl}
                  alt=""
                  className="h-28 w-28 object-cover"
                />
              ) : (
                <span className="art h-28! w-28!" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="font-sans text-[2rem] font-normal leading-tight">
                  {track.data.title}
                </h1>
                <p className="mt-1 text-sequel-mid">
                  {[track.data.artist, track.data.album]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>

            <div className="mt-10 bg-sequel-brown p-5 text-sequel-silver">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  disabled={!previewUrl}
                  aria-label={playing ? 'Pause' : 'Play'}
                  onClick={() => {
                    const el = audio.current
                    if (!el) return
                    if (el.paused) void el.play()
                    else el.pause()
                  }}
                  className="grid h-[34px] w-[34px] shrink-0 place-items-center bg-sequel-silver text-sequel-brown disabled:opacity-40"
                >
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <div className="min-w-0 flex-1">
                  <Waveform
                    peaks={peaks}
                    progress={total > 0 ? Math.min(1, position / total) : 0}
                    onSeek={(fraction) => {
                      const el = audio.current
                      if (el && total > 0) el.currentTime = fraction * total
                    }}
                  />
                </div>
                <div className="shrink-0 tabular-nums text-[#a9a7a2]">
                  {formatDuration(position)} / {formatDuration(total)}
                </div>
              </div>
              {!previewUrl && !media.isPending && (
                <p className="mt-3 text-xs text-[#a9a7a2]">
                  This track is still being processed. Try again shortly.
                </p>
              )}
            </div>

            {previewUrl && (
              <audio ref={audio} src={previewUrl} preload="metadata" />
            )}
          </>
        )}
      </div>
    </div>
  )
}
