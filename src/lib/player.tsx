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
}

const PlayerContext = createContext<PlayerApi | null>(null)

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
      setState((s) => ({ ...s, playing: false, error: 'This preview could not be played.' }))
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
  useEffect(() => {
    const el = media()
    if (!el) return
    if (!currentId) {
      el.pause()
      el.removeAttribute('src')
      return
    }
    if (!currentKey) {
      setState((s) => ({ ...s, playing: false, error: 'Still processing — no preview yet.' }))
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
          setState((s) => ({ ...s, playing: false, error: 'This preview could not be played.' }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [currentId, currentKey, media])

  const play = useCallback((queue: PlayerTrack[], index: number) => {
    setState((s) => {
      const target = queue[index]
      if (target && s.queue[s.index]?.id === target.id) {
        // Same track: treat as toggle rather than restart — and if it is a
        // film whose picture was dismissed, bring the picture back.
        const el = media()
        if (el?.paused) void el.play()
        else el?.pause()
        return {
          ...s,
          queue,
          index,
          filmOpen: target.kind === 'video' ? true : s.filmOpen,
        }
      }
      return { ...s, queue, index, position: 0, error: null }
    })
  }, [media])

  const toggle = useCallback(() => {
    const el = media()
    if (!el?.src) return
    if (el.paused) void el.play()
    else el.pause()
  }, [media])

  const next = useCallback(() => {
    setState((s) =>
      s.index + 1 < s.queue.length ? { ...s, index: s.index + 1, position: 0 } : s,
    )
  }, [])

  const prev = useCallback(() => {
    const el = media()
    // Convention: more than three seconds in, "previous" restarts the track.
    if (el && el.currentTime > 3) {
      el.currentTime = 0
      return
    }
    setState((s) => (s.index > 0 ? { ...s, index: s.index - 1, position: 0 } : s))
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

  const openFilm = useCallback(() => setState((s) => ({ ...s, filmOpen: true })), [])
  const closeFilm = useCallback(() => setState((s) => ({ ...s, filmOpen: false })), [])

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
    }),
    [state, current, play, toggle, next, prev, seek, isCurrent, openFilm, closeFilm],
  )

  return (
    <PlayerContext value={api}>
      {children}
      <FilmStage
        ref={video}
        open={state.filmOpen && current?.kind === 'video'}
        title={current?.title ?? ''}
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
