import { useQuery } from '@tanstack/react-query'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import FilmStage from '../components/staff/FilmStage'
import { mediaUrls } from './media'
import { supabase } from './supabase'
import type { Track } from './queries'

/**
 * One media element for the whole staff app, living above the router so a
 * track keeps playing while the person navigates. The queue is whatever list
 * the track was started from — an inbox submission, the library, a playlist —
 * so prev/next mean "in the list I was looking at".
 *
 * It is a <video>, for audio as well. A video element plays an mp3 perfectly
 * well, and one element means one set of listeners, one source of truth for
 * position and one thing that can be playing — where two would have to be
 * kept in step and would eventually drift. It is rendered once and never
 * moved in the DOM: showing a film changes where the element is on screen,
 * not where it is in the tree, because re-parenting a media element reloads
 * it and loses the play state.
 */
export type PlayerTrack = {
  id: string
  title: string
  artist: string | null
  company: string | null
  kind: 'audio' | 'video'
  preview_key: string | null
  duration_seconds: number | null
}

export function toPlayerTrack(t: Track): PlayerTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    company: t.submitter_company,
    kind: t.kind,
    preview_key: t.preview_key,
    duration_seconds: t.duration_seconds,
  }
}

type PlayerState = {
  queue: PlayerTrack[]
  index: number
  playing: boolean
  position: number
  duration: number
  error: string | null
  /** Whether the film is showing over the page. Sound plays either way. */
  filmOpen: boolean
  volume: number
  muted: boolean
}

type PlayerApi = PlayerState & {
  current: PlayerTrack | null
  play: (queue: PlayerTrack[], index: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  isCurrent: (id: string) => boolean
  openFilm: () => void
  closeFilm: () => void
  setVolume: (v: number) => void
  toggleMute: () => void
}

const PlayerContext = createContext<PlayerApi | null>(null)

/**
 * Volume is per person, not per session: someone who works quietly should not
 * have to turn it down again every morning. Stored as a number so a muted
 * player still remembers what to come back to.
 */
const VOLUME_KEY = 'sequel.player.volume'

function storedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    // Nothing stored means full, not silent. `Number(null)` is 0, and 0 is a
    // legitimate volume, so the absence has to be checked before the parse —
    // otherwise a first visit is a player that plays nothing.
    if (raw === null) return 1
    const level = Number(raw)
    return Number.isFinite(level) && level >= 0 && level <= 1 ? level : 1
  } catch {
    return 1
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  // Rendered below, once, and only ever touched from effects and handlers —
  // it is an external system, not a render input.
  const video = useRef<HTMLVideoElement | null>(null)
  const media = useCallback(() => video.current, [])

  const [state, setState] = useState<PlayerState>({
    queue: [],
    index: -1,
    playing: false,
    position: 0,
    duration: 0,
    error: null,
    filmOpen: false,
    volume: storedVolume(),
    muted: false,
  })
  const current = state.index >= 0 ? (state.queue[state.index] ?? null) : null

  // Wire the element once. Position updates are frequent, so they are the
  // only thing that goes through setState on a timer.
  useEffect(() => {
    const el = media()
    if (!el) return
    const onTime = () => setState((s) => ({ ...s, position: el.currentTime }))
    const onMeta = () => setState((s) => ({ ...s, duration: el.duration || 0 }))
    const onPlay = () => setState((s) => ({ ...s, playing: true }))
    const onPause = () => setState((s) => ({ ...s, playing: false }))
    const onEnded = () =>
      setState((s) =>
        s.index + 1 < s.queue.length
          ? { ...s, index: s.index + 1, position: 0 }
          : { ...s, playing: false, position: 0 },
      )
    const onError = () =>
      setState((s) => ({
        ...s,
        playing: false,
        error: 'This preview could not be played.',
      }))
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
    }
  }, [media])

  // A new current track: sign its preview and start it. The id is checked
  // after the await so a fast second click cannot start the earlier track.
  const currentId = current?.id ?? null
  const currentKey = current?.preview_key ?? null

  // The element takes its level from state rather than the other way round,
  // so a track starting mid-session comes in at the level already set.
  useEffect(() => {
    const el = media()
    if (!el) return
    el.volume = state.volume
    el.muted = state.muted
  }, [media, state.volume, state.muted, currentId])

  useEffect(() => {
    const el = media()
    if (!el) return
    if (!currentId) {
      el.pause()
      el.removeAttribute('src')
      return
    }
    if (!currentKey) {
      // Stop whatever was playing before. Leaving it running meant the bar
      // named this track while play/pause drove the previous one.
      el.pause()
      el.removeAttribute('src')
      setState((s) => ({
        ...s,
        playing: false,
        error: 'Still processing — no preview yet.',
      }))
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, error: null, position: 0, duration: 0 }))
    mediaUrls([currentKey])
      .then((urls) => {
        if (cancelled) return
        const url = urls[currentKey]
        if (!url) throw new Error('no url')
        el.src = url
        return el.play()
      })
      .catch(() => {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            playing: false,
            error: 'This preview could not be played.',
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [currentId, currentKey, media])

  // What is current, readable from a handler without going through state.
  // The play/pause below must not live inside a setState updater: React
  // runs updaters twice in development to flush out exactly this kind of
  // side effect, and a toggle run twice is a pause followed by a resume —
  // which is what made every square and row on the page unable to pause.
  const currentRef = useRef<PlayerTrack | null>(null)
  useEffect(() => {
    currentRef.current = current
  }, [current])

  const play = useCallback(
    (queue: PlayerTrack[], index: number) => {
      const target = queue[index]
      // Same track, same preview: a toggle. A track that has finished
      // processing since it was queued arrives with a preview it did not
      // have, so it is started fresh rather than toggled.
      if (
        target &&
        currentRef.current?.id === target.id &&
        currentRef.current?.preview_key === target.preview_key
      ) {
        // Same track: treat as toggle rather than restart — and if it is a
        // film whose picture was dismissed, bring the picture back.
        const el = media()
        if (el?.paused) void el.play()
        else el?.pause()
        setState((s) => ({
          ...s,
          queue,
          index,
          filmOpen: target.kind === 'video' ? true : s.filmOpen,
        }))
        return
      }
      setState((s) => ({ ...s, queue, index, position: 0, error: null }))
    },
    [media],
  )

  const toggle = useCallback(() => {
    const el = media()
    if (!el?.src) return
    if (el.paused) void el.play()
    else el.pause()
  }, [media])

  const next = useCallback(() => {
    setState((s) =>
      s.index + 1 < s.queue.length
        ? { ...s, index: s.index + 1, position: 0 }
        : s,
    )
  }, [])

  const prev = useCallback(() => {
    const el = media()
    // Convention: more than three seconds in, "previous" restarts the track.
    if (el && el.currentTime > 3) {
      el.currentTime = 0
      return
    }
    setState((s) =>
      s.index > 0 ? { ...s, index: s.index - 1, position: 0 } : s,
    )
  }, [media])

  const seek = useCallback(
    (seconds: number) => {
      const el = media()
      if (!el || !Number.isFinite(seconds)) return
      el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds))
    },
    [media],
  )

  // What is playing decides whether there is a picture: starting a film
  // opens it, and stepping to an audio track closes it, so video is never a
  // mode you have to leave.
  const currentKind = current?.kind ?? null
  useEffect(() => {
    if (!currentId) return
    setState((s) =>
      s.filmOpen === (currentKind === 'video')
        ? s
        : { ...s, filmOpen: currentKind === 'video' },
    )
  }, [currentId, currentKind])

  const setVolume = useCallback((v: number) => {
    const next = Math.max(0, Math.min(1, v))
    try {
      localStorage.setItem(VOLUME_KEY, String(next))
    } catch {
      // Not remembering is fine.
    }
    // Moving the slider at all is a way of unmuting: the alternative is a
    // silent player and a slider that looks like it should have fixed it.
    setState((s) => ({
      ...s,
      volume: next,
      muted: next === 0 ? s.muted : false,
    }))
  }, [])

  const toggleMute = useCallback(() => {
    setState((s) => ({ ...s, muted: !s.muted }))
  }, [])

  const openFilm = useCallback(
    () => setState((s) => ({ ...s, filmOpen: true })),
    [],
  )
  const closeFilm = useCallback(
    () => setState((s) => ({ ...s, filmOpen: false })),
    [],
  )

  const isCurrent = useCallback((id: string) => currentId === id, [currentId])

  const api = useMemo<PlayerApi>(
    () => ({
      ...state,
      current,
      play,
      toggle,
      next,
      prev,
      seek,
      isCurrent,
      openFilm,
      closeFilm,
      setVolume,
      toggleMute,
    }),
    [
      state,
      current,
      play,
      toggle,
      next,
      prev,
      seek,
      isCurrent,
      openFilm,
      closeFilm,
      setVolume,
      toggleMute,
    ],
  )

  return (
    <PlayerContext value={api}>
      {children}
      <FilmStage
        ref={video}
        open={state.filmOpen && current?.kind === 'video'}
        playing={state.playing}
        title={current?.title ?? ''}
        onToggle={toggle}
        onClose={closeFilm}
      />
    </PlayerContext>
  )
}

export function usePlayer(): PlayerApi {
  const ctx = use(PlayerContext)
  if (!ctx) throw new Error('usePlayer outside PlayerProvider')
  return ctx
}

/** Peaks are fetched only for the track on the player, never with the lists. */
export function usePeaks(trackId: string | null) {
  return useQuery({
    queryKey: ['peaks', trackId],
    enabled: !!trackId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tracks')
        .select('waveform_peaks')
        .eq('id', trackId!)
        .single()
      if (error) throw error
      const peaks = data.waveform_peaks
      return Array.isArray(peaks) ? (peaks as number[]) : null
    },
  })
}
