import { formatDuration } from '../../lib/format'
import { usePeaks, usePlayer } from '../../lib/player'
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from './icons'
import Waveform from './Waveform'

/** The bottom bar. Mounted once in the layout, so it outlives every route. */
export default function Player() {
  const player = usePlayer()
  const { data: peaks } = usePeaks(player.current?.id ?? null)
  const duration = player.duration || player.current?.duration_seconds || 0
  const subtitle = [player.current?.artist, player.current?.company].filter(Boolean).join(' · ')

  return (
    <footer
      className="col-start-1 col-span-3 row-start-2 grid items-center gap-[18px] bg-sequel-brown px-[22px] text-sequel-silver"
      style={{ gridTemplateColumns: '44px minmax(120px, 300px) 1fr 100px 60px' }}
    >
      <button
        type="button"
        onClick={player.toggle}
        disabled={!player.current}
        aria-label={player.playing ? 'Pause' : 'Play'}
        className="grid h-[34px] w-[34px] place-items-center bg-sequel-silver text-sequel-brown disabled:opacity-40"
      >
        {player.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="min-w-0">
        <div className="truncate">{player.current?.title ?? 'Nothing playing'}</div>
        <div className="truncate text-xs font-light text-sequel-silver">
          {player.error ? <span className="text-sequel-error">{player.error}</span> : subtitle}
        </div>
      </div>
      <Waveform
        peaks={peaks ?? null}
        progress={duration > 0 ? Math.min(1, player.position / duration) : 0}
        onSeek={(fraction) => player.seek(fraction * duration)}
      />
      <div className="text-right font-light text-sequel-silver tabular-nums">
        {formatDuration(player.position)} / {formatDuration(duration)}
      </div>
      <div className="flex items-center justify-end gap-4">
        <button
          type="button"
          onClick={player.prev}
          disabled={!player.current}
          aria-label="Previous"
          className="disabled:opacity-40"
        >
          <PrevIcon size="1.1rem" />
        </button>
        <button
          type="button"
          onClick={player.next}
          disabled={!player.current}
          aria-label="Next"
          className="disabled:opacity-40"
        >
          <NextIcon size="1.1rem" />
        </button>
      </div>
    </footer>
  )
}
