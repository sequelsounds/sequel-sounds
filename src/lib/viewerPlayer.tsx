import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
} from 'react'
import { mediaUrls } from './media'

/**
 * The viewer page's player: the staff player's shape, without its shell.
 *
 * Two things are different on a client's page and both are structural. The
 * media element is rendered by the page, not the provider, because where it
 * sits is the page's whole design — a film on a sync session is the top of
 * the page, on a composition review it is the work itself — so the provider
 * hands out a ref and the page puts the element where it wants. And every
 * signed URL carries the share token, since there is no staff session.
 *
 * It is still one `<video>` for audio and film alike, for the reasons in
 * docs/decisions.md: one set of listeners, one position, one thing that can
 * be playing.
 */
export type ViewerPlayable = {
  id: string
  title: string
  artist: string | null
  kind: 'audio' | 'video'
  preview_key: string | null
  duration_seconds: number | null
}

type State = {
  queue: ViewerPlayable[]
  index: number
  playing: boolean
  position: number
  duration: number
  error: string | null
  volume: number
  muted: boolean
}

type Api = State & {
  current: ViewerPlayable | null
  play: (queue: ViewerPlayable[], index: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  isCurrent: (id: string) => boolean
  /** Put this on the page's <video>. */
  attach: RefCallback<HTMLVideoElement>
  /** The element itself, for anything that has to follow it frame by frame. */
  element: () => HTMLVideoElement | null
}

const Ctx = createContext<Api | null>(null)

const VOLUME_KEY = 'sequel.viewer.volume'

function storedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw === null) return 1
    const level = Number(raw)
    return Number.isFinite(level) && level >= 0 && level <= 1 ? level : 1
  } catch {
    return 1
  }
}

export function ViewerPlayerProvider({
  token,
  onPlayed,
  children,
}: {
  token: string
  /** Called with how long a track was actually heard, when it stops. */
  onPlayed?: (track: ViewerPlayable, seconds: number, position: number) => void
  children: ReactNode
}) {
  const el = useRef<HTMLVideoElement | null>(null)
  // The element arrives from the page, possibly after the first render and
  // possibly more than once (the stage remounts between kinds), so the
  // listeners are wired per element rather than once.
  const [node, setNode] = useState<HTMLVideoElement | null>(null)
  const attach = useCallback<RefCallback<HTMLVideoElement>>((n) => {
    el.current = n
    setNode(n)
  }, [])
  const element = useCallback(() => el.current, [])

  const [state, setState] = useState<State>({
    queue: [],
    index: -1,
    playing: false,
    position: 0,
    duration: 0,
    error: null,
    volume: storedVolume(),
    muted: false,
  })
  const current = state.index >= 0 ? (state.queue[state.index] ?? null) : null

  // Listening time, for the activity record: accumulated while playing and
  // reported when the track stops or changes.
  const heard = useRef<{
    track: ViewerPlayable
    since: number | null
    total: number
  } | null>(null)
  const onPlayedRef = useRef(onPlayed)
  useEffect(() => {
    onPlayedRef.current = onPlayed
  })
  const settle = useCallback(() => {
    const h = heard.current
    if (!h) return
    if (h.since != null) {
      h.total += (performance.now() - h.since) / 1000
      h.since = null
    }
  }, [])
  const report = useCallback(() => {
    const h = heard.current
    settle()
    if (h && h.total >= 1) {
      onPlayedRef.current?.(
        h.track,
        Math.round(h.total),
        el.current?.currentTime ?? 0,
      )
    }
    heard.current = null
  }, [settle])

  useEffect(() => {
    if (!node) return
    const onTime = () => setState((s) => ({ ...s, position: node.currentTime }))
    const onMeta = () =>
      setState((s) => ({ ...s, duration: node.duration || 0 }))
    const onPlay = () => {
      if (heard.current && heard.current.since == null)
        heard.current.since = performance.now()
      setState((s) => ({ ...s, playing: true }))
    }
    const onPause = () => {
      settle()
      setState((s) => ({ ...s, playing: false }))
    }
    const onEnded = () => {
      report()
      setState((s) =>
        s.index + 1 < s.queue.length
          ? { ...s, index: s.index + 1, position: 0 }
          : { ...s, playing: false, position: 0 },
      )
    }
    const onError = () =>
      setState((s) => ({
        ...s,
        playing: false,
        error: 'This preview could not be played.',
      }))
    node.addEventListener('timeupdate', onTime)
    node.addEventListener('loadedmetadata', onMeta)
    node.addEventListener('play', onPlay)
    node.addEventListener('pause', onPause)
    node.addEventListener('ended', onEnded)
    node.addEventListener('error', onError)
    return () => {
      node.removeEventListener('timeupdate', onTime)
      node.removeEventListener('loadedmetadata', onMeta)
      node.removeEventListener('play', onPlay)
      node.removeEventListener('pause', onPause)
      node.removeEventListener('ended', onEnded)
      node.removeEventListener('error', onError)
    }
  }, [node, settle, report])

  useEffect(() => {
    if (!node) return
    node.volume = state.volume
    node.muted = state.muted
  }, [node, state.volume, state.muted])

  const currentId = current?.id ?? null
  const currentKey = current?.preview_key ?? null

  useEffect(() => {
    const v = el.current
    if (!v) return
    if (!currentId || !current) {
      v.pause()
      v.removeAttribute('src')
      return
    }
    report()
    heard.current = { track: current, since: null, total: 0 }
    if (!currentKey) {
      setState((s) => ({
        ...s,
        playing: false,
        error: 'Still processing — no preview yet.',
      }))
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, error: null, position: 0, duration: 0 }))
    mediaUrls([currentKey], token)
      .then((urls) => {
        if (cancelled) return
        const url = urls[currentKey]
        if (!url) throw new Error('no url')
        v.src = url
        return v.play()
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
    // `current` is derived from the two ids; listing it would restart the
    // track every time the queue array was rebuilt around it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, currentKey, node, token, report])

  // Whatever was heard is recorded when the page goes away too.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') report()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [report])

  const play = useCallback((queue: ViewerPlayable[], index: number) => {
    setState((s) => {
      const target = queue[index]
      if (target && s.queue[s.index]?.id === target.id) {
        const v = el.current
        if (v?.paused) void v.play()
        else v?.pause()
        return { ...s, queue, index }
      }
      return { ...s, queue, index, position: 0, error: null }
    })
  }, [])

  const toggle = useCallback(() => {
    const v = el.current
    if (!v?.src) return
    if (v.paused) void v.play()
    else v.pause()
  }, [])

  const next = useCallback(() => {
    setState((s) =>
      s.index + 1 < s.queue.length
        ? { ...s, index: s.index + 1, position: 0 }
        : s,
    )
  }, [])

  const prev = useCallback(() => {
    const v = el.current
    if (v && v.currentTime > 3) {
      v.currentTime = 0
      return
    }
    setState((s) =>
      s.index > 0 ? { ...s, index: s.index - 1, position: 0 } : s,
    )
  }, [])

  const seek = useCallback((seconds: number) => {
    const v = el.current
    if (!v || !Number.isFinite(seconds)) return
    v.currentTime = Math.max(0, Math.min(seconds, v.duration || seconds))
  }, [])

  const setVolume = useCallback((level: number) => {
    const next = Math.max(0, Math.min(1, level))
    try {
      localStorage.setItem(VOLUME_KEY, String(next))
    } catch {
      // Not remembering is fine.
    }
    setState((s) => ({
      ...s,
      volume: next,
      muted: next === 0 ? s.muted : false,
    }))
  }, [])

  const toggleMute = useCallback(
    () => setState((s) => ({ ...s, muted: !s.muted })),
    [],
  )
  const isCurrent = useCallback((id: string) => currentId === id, [currentId])

  const api = useMemo<Api>(
    () => ({
      ...state,
      current,
      play,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      isCurrent,
      attach,
      element,
    }),
    [
      state,
      current,
      play,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      isCurrent,
      attach,
      element,
    ],
  )

  return <Ctx value={api}>{children}</Ctx>
}

export function useViewerPlayer(): Api {
  const ctx = use(Ctx)
  if (!ctx) throw new Error('useViewerPlayer outside ViewerPlayerProvider')
  return ctx
}
