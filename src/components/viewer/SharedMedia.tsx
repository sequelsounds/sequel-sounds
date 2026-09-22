import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../../lib/format'
import { peaksFromUrl } from '../../lib/peaks'
import { PauseIcon, PlayIcon, VolumeIcon, VolumeMuteIcon } from '../staff/icons'
import VolumeSlider from '../staff/VolumeSlider'
import Waveform from '../staff/Waveform'

/**
 * The player on `/link`, for audio and video alike — the app's own bar (play
 * square, scrubber, times, volume) in place of the browser's control, which
 * Andy rejected on sight, 16 Sep. One media element, no queue.
 *
 * The scrubber is the app's Waveform. Peaks come with the link when the file
 * has them (worked out at upload); otherwise the page works them out once,
 * in the background, and saves them for the next visitor — the bar draws
 * flat until then. A video's waveform is its soundtrack's.
 *
 * Video (Andy, 16 Sep): the same bar sits UNDER the picture, nothing is drawn
 * over it except a play/pause square in the middle — shown while paused, and
 * flashed then faded when a click starts it. Click the picture to play or
 * pause; double-click, or the bar's last button, for full screen, which takes
 * the bar with it.
 */
/** The volume mark: the shared speaker — one wave when quiet, two when louder, a cross when muted. */
function Speaker({ muted, level }: { muted: boolean; level: number }) {
  if (muted || level <= 0) return <VolumeMuteIcon size="1.1rem" />
  return <VolumeIcon size="1.1rem" waves={level < 0.5 ? 1 : 2} />
}

function FullscreenIcon({ on }: { on: boolean }) {
  return (
    <svg
      width="0.95rem"
      height="0.95rem"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {on ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      )}
    </svg>
  )
}

export default function SharedMedia({
  src,
  video = false,
  onReady,
  peaks: stored,
  size,
  onPeaks,
}: {
  src: string
  /** Draw the picture above the bar. */
  video?: boolean
  onReady: () => void
  peaks: number[] | null
  /** Bytes, to decide whether the file is small enough to decode here. */
  size: number
  onPeaks: (peaks: number[]) => void
}) {
  const media = useRef<HTMLMediaElement | null>(null)
  const shell = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  // Bumped on each click of the picture so the centre square's fade restarts.
  const [flash, setFlash] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(stored)

  useEffect(() => {
    if (stored) return
    let live = true
    void peaksFromUrl(src, size).then((p) => {
      if (!live || !p) return
      setPeaks(p)
      onPeaks(p)
    })
    return () => {
      live = false
    }
    // Once per file. The signed URL changes on refresh; the file does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, size])

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === shell.current && !!shell.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const a = media.current
    if (!a) return
    a.volume = volume
    a.muted = muted
  }, [volume, muted])

  const fullscreen = () => {
    const el = shell.current
    const v = media.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined)
    // iPhone Safari cannot put a div full screen, only the video itself.
    else v?.webkitEnterFullscreen?.()
  }

  const toggle = () => {
    const a = media.current
    if (!a) return
    if (a.paused) void a.play().catch(() => setError('This file will not play here. Download it instead.'))
    else a.pause()
  }

  const common = {
    ref: (el: HTMLMediaElement | null) => {
      media.current = el
    },
    src,
    preload: 'metadata' as const,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      setDuration(e.currentTarget.duration || 0)
      onReady()
    },
    onError: () => {
      setError('This file will not play here. Download it instead.')
      onReady()
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => setPosition(e.currentTarget.currentTime),
  }

  const bar = (
    <div
      className={`sa-bar${video ? ' is-video' : ''}`}
      // The time column is as wide as this file's longest reading and no
      // wider, so the gaps either side of it match the rest of the bar; and
      // fixed for the file, so the waveform never changes width as it plays.
      style={
        {
          '--sa-time': duration >= 3600 ? '6.5rem' : duration >= 600 ? '4.75rem' : '3.8rem',
        } as React.CSSProperties
      }
    >
      {!video && <audio {...common} />}
      <button
        type="button"
        className="sa-play"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      {error ? (
        <div className="sa-error">{error}</div>
      ) : (
        <Waveform
          progress={duration > 0 ? Math.min(1, position / duration) : 0}
          peaks={peaks}
          // Flipped for the silver bar: played in brown, the rest a pale brown.
          played="#372b29"
          unplayed="#b5aeab"
          // Fine lines, 1.5px with a 1px gap — Andy went to hairlines, then a touch thicker.
          bar={1.5}
          gap={1}
          onSeek={(fraction) => {
            const a = media.current
            if (a && duration > 0) a.currentTime = fraction * duration
          }}
        />
      )}
      <div className="sa-time">
        {formatDuration(position)} / {formatDuration(duration || null)}
      </div>
      <div className="sa-volume">
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? 'Unmute' : 'Mute'}
          title={muted ? 'Unmute' : 'Mute'}
        >
          <Speaker muted={muted || volume === 0} level={volume} />
        </button>
        <VolumeSlider
          value={muted ? 0 : volume}
          onChange={(v) => {
            setMuted(false)
            setVolume(Math.max(0, Math.min(1, v)))
          }}
        />
      </div>
      {video && (
        <button
          type="button"
          className="sa-full"
          onClick={fullscreen}
          aria-label={full ? 'Exit full screen' : 'Full screen'}
          title={full ? 'Exit full screen' : 'Full screen'}
        >
          <FullscreenIcon on={full} />
        </button>
      )}
    </div>
  )

  if (!video) return bar

  return (
    <div className={`sv${full ? ' is-full' : ''}`} ref={shell}>
      <div className="sv-frame">
        <video
          {...common}
          className="sv-video"
          playsInline
          onClick={() => {
            toggle()
            setFlash((n) => n + 1)
          }}
          onDoubleClick={fullscreen}
        />
        {!error && (
          <button
            key={flash}
            type="button"
            className={`sv-centre${playing ? ' is-playing' : ''}`}
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseIcon size="1.5rem" /> : <PlayIcon size="1.5rem" />}
          </button>
        )}
      </div>
      {bar}
    </div>
  )
}
