import { formatDuration } from '../../lib/format'
import { usePeaks, usePlayer } from '../../lib/player'
import {
  FilmIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from './icons'
import VolumeSlider from './VolumeSlider'
import Waveform from './Waveform'

/** The bottom bar. Mounted once in the layout, so it outlives every route. */
export default function Player() {
  const player = usePlayer()
  const { data: peaks } = usePeaks(player.current?.id ?? null)
  const duration = player.duration || player.current?.duration_seconds || 0
  const subtitle = [player.current?.artist, player.current?.company].filter(Boolean).join(' · ')

  return (
    <footer
      className="col-start-1 col-span-3 row-start-3 grid items-center gap-[18px] bg-sequel-white px-[22px] text-sequel-brown"
      style={{
        gridTemplateColumns: '44px minmax(120px, 300px) 1fr 100px auto',
      }}
    >
      <button
        type="button"
        onClick={player.toggle}
        disabled={!player.current}
        aria-label={player.playing ? 'Pause' : 'Play'}
        className="grid h-[34px] w-[34px] place-items-center bg-sequel-brown text-sequel-silver disabled:opacity-40"
      >
        {player.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate">
            {player.current?.title ?? 'Nothing playing'}
          </div>
          <div className="truncate text-xs font-light text-sequel-brown">
            {player.error ? (
              <span className="text-sequel-error">{player.error}</span>
            ) : (
              subtitle
            )}
          </div>
        </div>
        {/* The way back to a film whose picture was dismissed. Only there
            when there is a picture to return to. */}
        {player.current?.kind === 'video' && !player.filmOpen && (
          <button
            type="button"
            className="icon-btn shrink-0 text-sequel-brown"
            aria-label="Show the film"
            title="Show the film"
            onClick={player.openFilm}
          >
            <FilmIcon />
          </button>
        )}
      </div>
      <Waveform
        peaks={peaks ?? null}
        progress={duration > 0 ? Math.min(1, player.position / duration) : 0}
        onSeek={(fraction) => player.seek(fraction * duration)}
        played="#372b29"
        unplayed="#8b8a86"
      />
      <div className="text-right font-light text-sequel-brown tabular-nums">
        {formatDuration(player.position)} / {formatDuration(duration)}
      </div>
      <div className="flex items-center justify-end gap-4">
        {/* Click the mark to mute, drag the slider to set the level. Muting
            keeps the level, so unmuting comes back where it was. */}
        <button
          type="button"
          onClick={player.toggleMute}
          aria-label={player.muted ? 'Unmute' : 'Mute'}
          title={player.muted ? 'Unmute' : 'Mute'}
        >
          {player.muted || player.volume === 0 ? (
            <VolumeMuteIcon size="1.1rem" />
          ) : (
            <VolumeIcon size="1.1rem" />
          )}
        </button>
        <VolumeSlider
          value={player.muted ? 0 : player.volume}
          onChange={player.setVolume}
        />
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
