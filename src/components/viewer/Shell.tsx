import type { CSSProperties, ReactNode } from 'react'
import { formatDuration } from '../../lib/format'
import {
  useViewerPeaks,
  type Theme,
  type ViewerPlaylist,
} from '../../lib/viewer'
import { useViewerPlayer } from '../../lib/viewerPlayer'
import {
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from '../staff/icons'
import VolumeSlider from '../staff/VolumeSlider'
import Waveform from '../staff/Waveform'

export const SEQUEL_BG = '#f1f0ee'
export const SEQUEL_FG = '#372b29'

/** The page's colours: the theme's where it has them, Sequel's where not. */
export function themeColours(theme: Theme | null | undefined) {
  const bg = theme?.background_color?.trim() || SEQUEL_BG
  const fg = theme?.text_color?.trim() || SEQUEL_FG
  const accent = theme?.accent_color?.trim() || fg
  return { bg, fg, accent }
}

function hexToRgb(colour: string): [number, number, number] | null {
  const m = colour.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/**
 * Whether a ground is dark enough to want the light mark on it. Only hex is
 * understood; a colour written any other way is treated as light, which
 * puts the brown wordmark on it — the wrong guess that is still readable
 * more often than the other one.
 */
export function isDark(colour: string): boolean {
  const rgb = hexToRgb(colour)
  if (!rgb) return false
  const [r, g, b] = rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140
}

/** A colour at some opacity, for the canvas, which cannot read CSS variables. */
export function withAlpha(colour: string, alpha: number): string {
  const rgb = hexToRgb(colour)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : colour
}

type ShellProps = {
  theme: Theme | null | undefined
  playlist: ViewerPlaylist
  /** The line above the title. Defaults to the client and the project. */
  eyebrow?: string | null
  /** Whether the transport bar sits along the bottom. A sync session has its own. */
  bar?: boolean
  children: ReactNode
}

/**
 * The frame every kind of viewer page sits in: the theme applied as CSS
 * variables, a logo, the heading, and the transport along the bottom.
 */
export function Shell({
  theme,
  playlist,
  eyebrow,
  bar = true,
  children,
}: ShellProps) {
  const { bg, fg, accent } = themeColours(theme)
  const style = {
    '--v-bg': bg,
    '--v-fg': fg,
    '--v-accent': accent,
    backgroundImage: theme?.background_url
      ? `url("${theme.background_url}")`
      : undefined,
  } as CSSProperties

  const project = playlist.projects_mirror
  const line =
    eyebrow !== undefined
      ? eyebrow
      : theme?.heading?.trim() ||
        [project?.client_name, project?.name].filter(Boolean).join(' · ') ||
        'Sequel'

  return (
    <div className="viewer" style={style}>
      <div className="viewer-page">
        <header className="viewer-top">
          {theme?.logo_url ? (
            <img src={theme.logo_url} alt="" className="viewer-logo" />
          ) : isDark(bg) ? (
            <img
              src="/sequel-mark-light.svg"
              alt="Sequel"
              className="viewer-logo"
            />
          ) : (
            /* .qw-logo, not .viewer-logo: that rule sizes by height, which is
               right for a client's own logo of unknown shape and wrong for our
               wordmark, which is 80px wide everywhere else. */
            <img src="/sequel-wordmark.png" alt="Sequel" className="qw-logo" />
          )}
        </header>
        <div>
          {line && <div className="viewer-eyebrow">{line}</div>}
          <h1 className="viewer-title">{playlist.name}</h1>
          {playlist.description && (
            <p className="viewer-desc">{playlist.description}</p>
          )}
        </div>
        {children}
      </div>
      {bar && <Bar bg={bg} />}
    </div>
  )
}

/** The bottom bar — the tool's player, in the page's two colours. */
function Bar({ bg }: { bg: string }) {
  const player = useViewerPlayer()
  const { data: peaks } = useViewerPeaks(player.current?.id ?? null)
  const duration = player.duration || player.current?.duration_seconds || 0

  return (
    <footer className="viewer-bar">
      <button
        type="button"
        className="play"
        onClick={player.toggle}
        disabled={!player.current}
        aria-label={player.playing ? 'Pause' : 'Play'}
      >
        {player.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="min-w-0">
        <div className="truncate">
          {player.current?.title ?? 'Nothing playing'}
        </div>
        <div className="truncate text-xs font-light opacity-80">
          {player.error ?? player.current?.artist ?? ''}
        </div>
      </div>
      <Waveform
        peaks={peaks ?? null}
        progress={duration > 0 ? Math.min(1, player.position / duration) : 0}
        onSeek={(fraction) => player.seek(fraction * duration)}
        played={bg}
        unplayed={withAlpha(bg, 0.45)}
      />
      <div className="text-right font-light tabular-nums">
        {formatDuration(player.position)} / {formatDuration(duration)}
      </div>
      <div className="flex items-center justify-end gap-4">
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

/**
 * Where the player's element lives on the page. Shown as a picture when
 * the page wants one, parked off-screen when it does not — never unmounted
 * between the two, so the sound is not interrupted by the picture arriving.
 */
export function Stage({
  away,
  poster,
  onStart,
}: {
  away: boolean
  /** A still to show before anything has been started. */
  poster?: string | null
  /** Starts the picture from a standing start; drawn as a big play mark. */
  onStart?: () => void
}) {
  const player = useViewerPlayer()
  const idle = !player.current && !!onStart
  return (
    <div className={`viewer-stage ${away ? 'is-away' : ''}`}>
      <video ref={player.attach} playsInline onClick={player.toggle} />
      {!away && idle && (
        <button
          type="button"
          onClick={onStart}
          aria-label="Play"
          className="absolute inset-0 grid place-items-center bg-black/40 text-white"
          style={
            poster
              ? { backgroundImage: `url("${poster}")`, backgroundSize: 'cover' }
              : undefined
          }
        >
          <span className="grid h-16 w-16 place-items-center bg-black/60">
            <PlayIcon size="2rem" />
          </span>
        </button>
      )}
    </div>
  )
}
