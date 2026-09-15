import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../../lib/format'
import { peaksFromUrl } from '../../lib/peaks'
import { PauseIcon, PlayIcon } from '../staff/icons'
import VolumeSlider from '../staff/VolumeSlider'
import Waveform from '../staff/Waveform'

/**
 * The audio player on `/link` — the app's own bottom bar (play square,
 * scrubber, times, volume) in place of the browser's control, which Andy
 * rejected on sight, 16 Sep. One <audio>, no queue.
 *
 * The scrubber is the app's Waveform. Peaks come with the link when the file
 * has them (worked out at upload); otherwise the page works them out once,
 * in the background, and saves them for the next visitor — the bar draws
 * flat until then.
 */
/**
 * The volume mark: three rising bars rather than a speaker — Andy, 16 Sep
 * (second design). The bars fill up to the level; muted, all three go pale.
 * Local to this page, so the staff player keeps its own.
 */
function Speaker({ muted, level }: { muted: boolean; level: number }) {
  // A solid speaker, square-cut like the play button, with sound waves that
  // follow the level: one arc when quiet, two when louder, a cross when muted.
  const waves = muted || level <= 0 ? 0 : level < 0.5 ? 1 : 2
  return (
    <svg
      width="1rem"
      height="1rem"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M4 9h3.5L12 5v14l-4.5-4H4z" fill="currentColor" stroke="none" />
      {waves === 0 && <path d="m16 10 4 4m0-4-4 4" />}
      {waves >= 1 && <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />}
      {waves >= 2 && <path d="M18 7a7 7 0 0 1 0 10" />}
    </svg>
  )
}

export default function SharedAudio({
  src,
  onReady,
  peaks: stored,
  size,
  onPeaks,
}: {
  src: string
  onReady: () => void
  peaks: number[] | null
  /** Bytes, to decide whether the file is small enough to decode here. */
  size: number
  onPeaks: (peaks: number[]) => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
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
    const a = audio.current
    if (!a) return
    a.volume = volume
    a.muted = muted
  }, [volume, muted])

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play().catch(() => setError('This file will not play here. Download it instead.'))
    else a.pause()
  }

  return (
    <div
      className="sa-bar"
      // The time column is as wide as this file's longest reading and no
      // wider, so the gaps either side of it match the rest of the bar; and
      // fixed for the file, so the waveform never changes width as it plays.
      style={
        {
          '--sa-time': duration >= 3600 ? '6.5rem' : duration >= 600 ? '4.75rem' : '3.8rem',
        } as React.CSSProperties
      }
    >
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0)
          onReady()
        }}
        onError={() => {
          setError('This file will not play here. Download it instead.')
          onReady()
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
      />
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
          // Hairlines, 1px with a 1px gap — Andy wanted it much finer than the staff bar.
          bar={1}
          gap={1}
          onSeek={(fraction) => {
            const a = audio.current
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
    </div>
  )
}
