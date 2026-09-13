import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '../../lib/format'
import { mediaUrls } from '../../lib/media'
import {
  useAddComment,
  useLogEvent,
  useRegister,
  useViewer,
  useViewerPeaks,
  type Identity,
  type Theme,
  type ViewerComment,
  type ViewerPlaylist,
  type ViewerRow,
  type ViewerTrack,
} from '../../lib/viewer'
import { PauseIcon, PlayIcon, VolumeIcon, VolumeMuteIcon } from '../staff/icons'
import VolumeSlider from '../staff/VolumeSlider'
import Waveform from '../staff/Waveform'
import { Shell, Stage, themeColours, withAlpha } from './Shell'
import TrackRows, { groupRows } from './TrackRows'

type Props = {
  playlist: ViewerPlaylist
  theme: Theme | null
  comments: ViewerComment[]
  identity: Identity | null
  onIdentity: (identity: Identity) => void
}

/**
 * Where the music sits against the picture. `offset` is the film time at
 * which the music starts sounding; `inPoint` is where in the track it
 * starts from. So film time f plays track time f − offset + inPoint, and
 * a negative offset is music that starts before the picture does.
 */
type Cue = { inPoint: number; offset: number }

/** "−0:02" for a start before the picture, "0:03" for one after. */
function signed(seconds: number): string {
  return seconds < 0 ? `−${formatDuration(-seconds)}` : formatDuration(seconds)
}

/**
 * Tracks tried against a film.
 *
 * Two media elements, and the picture is the clock. The music follows it:
 * on every tick of the film the track is put where the cue says it should
 * be, started when the film runs into it and stopped when the film runs
 * out of it. That is the reverse of the staff player, where one element
 * is the whole point — but here the person is scrubbing the picture, and
 * an audio element chasing a video one is the arrangement that never
 * lets the music drift from the shot it is being judged against.
 *
 * The cue is set by clicking in the track's waveform: that moment of the
 * music, at this moment of the picture. Nudges move it by tenths.
 */
export default function SyncSession({
  playlist,
  theme,
  comments,
  identity,
  onIdentity,
}: Props) {
  const { token } = useViewer()
  const film = playlist.video
  const filmEl = useRef<HTMLVideoElement>(null)
  const musicEl = useRef<HTMLAudioElement>(null)

  const [music, setMusic] = useState<ViewerTrack | null>(null)
  const [cue, setCueState] = useState<Cue>({ inPoint: 0, offset: 0 })
  const cueRef = useRef(cue)
  const [filmTime, setFilmTime] = useState(0)
  const [filmDuration, setFilmDuration] = useState(0)
  const [musicTime, setMusicTime] = useState(0)
  const [musicDuration, setMusicDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [asking, setAsking] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const peaks = useViewerPeaks(music?.id ?? null)
  const add = useAddComment()
  const register = useRegister()
  const log = useLogEvent()
  const { fg } = themeColours(theme)
  const groups = useMemo(() => groupRows(playlist), [playlist])

  // The picture's source.
  useEffect(() => {
    const f = filmEl.current
    const key = film?.preview_key
    if (!f || !key) return
    let cancelled = false
    mediaUrls([key], token)
      .then((urls) => {
        if (!cancelled && urls[key]) f.src = urls[key]
      })
      .catch(() => {
        if (!cancelled) setError('The picture could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [film?.preview_key, token])

  // The music's, whenever a different track is picked.
  useEffect(() => {
    const m = musicEl.current
    if (!m) return
    const key = music?.preview_key
    if (!key) {
      m.pause()
      m.removeAttribute('src')
      return
    }
    let cancelled = false
    mediaUrls([key], token)
      .then((urls) => {
        if (cancelled) return
        const url = urls[key]
        if (!url) throw new Error('no url')
        m.src = url
        m.load()
      })
      .catch(() => {
        if (!cancelled) setError('This track could not be played.')
      })
    return () => {
      cancelled = true
    }
  }, [music?.preview_key, token])

  // Put the music where the picture says. Forced after a seek or a new
  // cue; otherwise only when it has drifted further than a frame or so.
  const align = useCallback((force = false) => {
    const f = filmEl.current
    const m = musicEl.current
    if (!f || !m || !m.src) return
    const { inPoint, offset } = cueRef.current
    const target = f.currentTime - offset + inPoint
    const past = m.duration > 0 && target > m.duration
    if (target < 0 || past) {
      if (!m.paused) m.pause()
      return
    }
    if (force || Math.abs(m.currentTime - target) > 0.12) m.currentTime = target
    if (!f.paused && m.paused) void m.play().catch(() => undefined)
    if (f.paused && !m.paused) m.pause()
  }, [])

  useEffect(() => {
    const f = filmEl.current
    if (!f) return
    const onTime = () => {
      setFilmTime(f.currentTime)
      align()
      setMusicTime(musicEl.current?.currentTime ?? 0)
    }
    const onMeta = () => setFilmDuration(f.duration || 0)
    const onPlay = () => {
      setPlaying(true)
      align(true)
    }
    const onPause = () => {
      setPlaying(false)
      musicEl.current?.pause()
    }
    const onSeeked = () => align(true)
    f.addEventListener('timeupdate', onTime)
    f.addEventListener('loadedmetadata', onMeta)
    f.addEventListener('play', onPlay)
    f.addEventListener('pause', onPause)
    f.addEventListener('seeked', onSeeked)
    f.addEventListener('ended', onPause)
    return () => {
      f.removeEventListener('timeupdate', onTime)
      f.removeEventListener('loadedmetadata', onMeta)
      f.removeEventListener('play', onPlay)
      f.removeEventListener('pause', onPause)
      f.removeEventListener('seeked', onSeeked)
      f.removeEventListener('ended', onPause)
    }
  }, [align])

  useEffect(() => {
    const m = musicEl.current
    if (!m) return
    const onMeta = () => {
      setMusicDuration(m.duration || 0)
      align(true)
    }
    m.addEventListener('loadedmetadata', onMeta)
    return () => m.removeEventListener('loadedmetadata', onMeta)
  }, [align])

  useEffect(() => {
    const m = musicEl.current
    if (!m) return
    m.volume = volume
    m.muted = muted
  }, [volume, muted])

  const setCue = (next: Cue) => {
    cueRef.current = next
    setCueState(next)
    setSaved(false)
    align(true)
  }

  const playFilm = () => void filmEl.current?.play().catch(() => undefined)

  /** A row picked: its track, from the staff preset if there is one, run in with two seconds of picture. */
  const pick = (row: ViewerRow) => {
    const t = row.tracks!
    const offset =
      row.sync_offset_seconds != null ? Number(row.sync_offset_seconds) : 0
    setError(null)
    setMusic(t)
    setMusicTime(0)
    cueRef.current = { inPoint: 0, offset }
    setCueState(cueRef.current)
    setSaved(false)
    const f = filmEl.current
    if (f) {
      f.currentTime = Math.max(0, offset - 2)
      playFilm()
    }
  }

  const toggle = () => {
    const f = filmEl.current
    if (!f) return
    if (f.paused) playFilm()
    else f.pause()
  }

  const seekFilm = (fraction: number) => {
    const f = filmEl.current
    if (f && filmDuration > 0) f.currentTime = fraction * filmDuration
  }

  /** This moment of the music, at this moment of the picture. */
  const cueHere = (fraction: number) => {
    const f = filmEl.current
    if (!f || !musicDuration) return
    setCue({ inPoint: fraction * musicDuration, offset: f.currentTime })
    playFilm()
  }

  const nudge = (by: number) =>
    setCue({
      ...cueRef.current,
      offset: Math.round((cueRef.current.offset + by) * 1000) / 1000,
    })

  const runUp = () => {
    const f = filmEl.current
    if (!f) return
    f.currentTime = Math.max(0, cueRef.current.offset - 2)
    playFilm()
  }

  const fromTop = () => {
    setCue({ inPoint: 0, offset: 0 })
    const f = filmEl.current
    if (f) {
      f.currentTime = 0
      playFilm()
    }
  }

  const save = async () => {
    if (!music) return
    let who = identity
    if (!who) {
      if (!name.trim() || !email.trim()) {
        setAsking(true)
        return
      }
      try {
        who = await register.mutateAsync({ name, email })
        onIdentity(who)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save.')
        return
      }
    }
    const { inPoint, offset } = cueRef.current
    try {
      await add.mutateAsync({
        playlistId: playlist.id,
        identity: who,
        targetType: 'track',
        targetId: music.id,
        body: `Sync — music from ${formatDuration(inPoint)}, starting at ${signed(offset)} of the picture.`,
        timestamp: Math.round(offset * 1000) / 1000,
      })
      log({
        playlistId: playlist.id,
        kind: 'sync_save',
        trackId: music.id,
        viewerId: who.viewerId,
        position: offset,
        meta: { in_point: inPoint, offset },
      })
      setSaved(true)
      setAsking(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    }
  }

  const cueOnFilm =
    music && filmDuration > 0 && cue.offset >= 0 && cue.offset <= filmDuration
      ? (cue.offset / filmDuration) * 100
      : null

  // No picture: the session behaves as a plain playlist until one is added.
  if (!film) {
    return (
      <Shell theme={theme} playlist={playlist}>
        <div className="mt-8">
          <Stage away />
          <p className="viewer-meta">
            No picture on this session yet. The tracks play on their own until
            there is one.
          </p>
          <TrackRows
            playlist={playlist}
            comments={comments}
            identity={identity}
            onIdentity={onIdentity}
          />
        </div>
      </Shell>
    )
  }

  return (
    <Shell theme={theme} playlist={playlist} bar={false}>
      <div className="mt-8">
        <div className="viewer-stage">
          <video ref={filmEl} playsInline muted onClick={toggle} />
        </div>
        <audio ref={musicEl} preload="auto" />

        <div className="viewer-sync">
          <button
            type="button"
            className="grid h-[34px] w-[34px] place-items-center"
            style={{ backgroundColor: 'var(--v-fg)', color: 'var(--v-bg)' }}
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div
            className="viewer-scrub"
            role="slider"
            aria-label="Picture"
            aria-valuemin={0}
            aria-valuemax={Math.round(filmDuration)}
            aria-valuenow={Math.round(filmTime)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              if (rect.width > 0) seekFilm((e.clientX - rect.left) / rect.width)
            }}
          >
            <div
              className="played"
              style={{
                width: `${filmDuration > 0 ? (filmTime / filmDuration) * 100 : 0}%`,
              }}
            />
            {cueOnFilm != null && (
              <div
                className="cue"
                style={{ left: `${cueOnFilm}%` }}
                title="Music starts here"
              />
            )}
          </div>
          <span
            className="dur tabular-nums text-[0.75rem]"
            style={{ color: 'var(--v-mid)' }}
          >
            {formatDuration(filmTime)} / {formatDuration(filmDuration)}
          </span>
        </div>

        <div className="py-3">
          {music ? (
            <>
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.9rem]">{music.title}</div>
                  {music.artist && (
                    <div
                      className="truncate text-xs font-light"
                      style={{ color: 'var(--v-mid)' }}
                    >
                      {music.artist}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMuted((v) => !v)}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                >
                  {muted || volume === 0 ? (
                    <VolumeMuteIcon size="1.1rem" />
                  ) : (
                    <VolumeIcon size="1.1rem" />
                  )}
                </button>
                <div className="viewer-bar-volume">
                  <VolumeSlider
                    value={muted ? 0 : volume}
                    onChange={(v) => {
                      setVolume(v)
                      if (v > 0) setMuted(false)
                    }}
                  />
                </div>
              </div>
              <div className="mt-2">
                <Waveform
                  peaks={peaks.data ?? null}
                  progress={
                    musicDuration > 0
                      ? Math.min(1, musicTime / musicDuration)
                      : 0
                  }
                  onSeek={cueHere}
                  played={fg}
                  unplayed={withAlpha(fg, 0.35)}
                />
              </div>
              <div className="viewer-sync-cue">
                <span>
                  Music from <strong>{formatDuration(cue.inPoint)}</strong>,
                  starting at <strong>{signed(cue.offset)}</strong> of the
                  picture
                </span>
                <span className="viewer-nudge" aria-label="Nudge the start">
                  {[-1, -0.1, 0.1, 1].map((by) => (
                    <button key={by} type="button" onClick={() => nudge(by)}>
                      {by > 0 ? '+' : '−'}
                      {Math.abs(by)}s
                    </button>
                  ))}
                </span>
                <button
                  type="button"
                  className="btn-v is-outline"
                  onClick={runUp}
                >
                  Run up
                </button>
                <button
                  type="button"
                  className="btn-v is-outline"
                  onClick={fromTop}
                >
                  From the top
                </button>
                <button
                  type="button"
                  className="btn-v"
                  onClick={() => void save()}
                  disabled={add.isPending || register.isPending}
                >
                  {saved ? 'Saved' : 'Save this sync'}
                </button>
              </div>
              {asking && !identity && (
                <div className="mt-3 grid max-w-md grid-cols-[1fr_1fr_auto] gap-2">
                  <input
                    className="field-boxed"
                    placeholder="Your name"
                    aria-label="Your name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <input
                    className="field-boxed"
                    placeholder="Email"
                    aria-label="Your email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-v"
                    onClick={() => void save()}
                  >
                    Save
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="viewer-meta">
              Pick a track below to hear it against the picture. Then click in
              its waveform to start the music from that moment, wherever the
              picture is.
            </p>
          )}
          {error && <p className="form-error mt-2">{error}</p>}
        </div>

        <TrackRows
          playlist={playlist}
          comments={comments}
          identity={identity}
          onIdentity={onIdentity}
          groups={groups}
          onPick={pick}
          activeId={music?.id ?? null}
        />
      </div>
    </Shell>
  )
}
