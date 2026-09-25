import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

/**
 * The app's one loading state (Andy, 25 Sep 2026): while anything on the page
 * is loading, nothing shows but the brown flipping square, centred on a plain
 * sheet over the whole screen — no nav, no headers, no half-drawn page.
 *
 * <Loader /> draws nothing where it is mounted. It only registers that
 * something is loading; <LoaderHost />, mounted once at the root, draws the
 * single sheet while at least one is registered. So two loaders on a page
 * are still one square, and a page loading in stages (session, then staff
 * check, then its data) never flashes its half-drawn state in between: the
 * sheet stays up until nothing has been loading for HIDE_DELAY_MS.
 *
 * Once up, the sheet stays for at least MIN_SHOWN_MS (Andy, 25 Sep 2026):
 * loads from Supabase take 0.05-0.15s, which showed the square as a twitch.
 *
 * Registration happens in a layout effect, before the browser paints, so the
 * frame that mounts a loader is already covered.
 */

const HIDE_DELAY_MS = 150
const MIN_SHOWN_MS = 1100

let pending = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getPending = () => pending

export function Loader(_props: { className?: string }) {
  useLayoutEffect(() => {
    pending++
    emit()
    return () => {
      pending--
      emit()
    }
  }, [])
  return null
}

/** Kept for existing callers: the same thing as <Loader />. */
export default function LoadingModal() {
  return <Loader />
}

/** Mount once, at the root. Draws the sheet and the square. */
export function LoaderHost() {
  const count = useSyncExternalStore(subscribe, getPending)
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  useLayoutEffect(() => {
    if (count > 0) {
      if (!shown) shownAt.current = performance.now()
      setShown(true)
      return
    }
    if (!shown) return
    const left = MIN_SHOWN_MS - (performance.now() - shownAt.current)
    const t = window.setTimeout(() => setShown(false), Math.max(HIDE_DELAY_MS, left))
    return () => window.clearTimeout(t)
  }, [count, shown])

  if (!(shown || count > 0)) return null
  return createPortal(
    <div className="loading-modal" role="status" aria-label="Loading">
      <div className="loader">
        <svg viewBox="0 0 20 20" width="100%" height="100%" aria-hidden="true">
          <rect width="20" height="20" className="loader-square" />
        </svg>
      </div>
    </div>,
    document.body,
  )
}
