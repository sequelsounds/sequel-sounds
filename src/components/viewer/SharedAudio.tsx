import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../../lib/format'
import { PauseIcon, PlayIcon, VolumeIcon, VolumeMuteIcon } from '../staff/icons'
import VolumeSlider from '../staff/VolumeSlider'
import Waveform from '../staff/Waveform'

/**
 * The audio player on `/link` — the app's own bottom bar (play square,
 * scrubber, times, volume) in place of the browser's control, which Andy
 * rejected on sight, 16 Sep. One <audio>, no queue.
 *
 * The scrubber is the app's Waveform with no peaks: a shared file has not
 * been through the Lambda, so there is no peaks.json, and decoding the whole
 * file in the browser just to draw it would download all of it up front.
 */
export default function SharedAudio({ src, onReady }: { src: string; onReady: () => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          peaks={null}
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
