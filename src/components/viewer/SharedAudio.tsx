import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../../lib/format'
import { peaksFromUrl } from '../../lib/peaks'
import { PauseIcon, PlayIcon, VolumeIcon, VolumeMuteIcon } from '../staff/icons'
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
    <div className="sa-bar">
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
          {muted || volume === 0 ? <VolumeMuteIcon size="1.1rem" /> : <VolumeIcon size="1.1rem" />}
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
