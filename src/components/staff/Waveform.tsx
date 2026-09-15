import { useEffect, useRef } from 'react'

type Props = {
  /** Flat [min, max, min, max, …] from the Lambda's peaks.json. */
  peaks: number[] | null
  /** 0–1 played. */
  progress: number
  onSeek: (fraction: number) => void
  className?: string
  /** The two tones, for a page whose colours are not the bar's brown and silver. */
  played?: string
  unplayed?: string
  /** Bar and gap in CSS pixels. The staff bar keeps 3 and 1. */
  bar?: number
  gap?: number
}

const BAR = 3
const GAP = 1
const PLAYED = '#f1f0ee'
// A solid tone rather than silver at low alpha — played and unplayed still
// have to be told apart, and this is that distinction drawn as a real colour
// instead of transparency.
const UNPLAYED = '#7d7370'

/**
 * Bars from peaks, drawn on a canvas because the bar count follows the width
 * and two thousand DOM nodes per track would be felt. Redrawn on resize and on
 * every progress tick — cheap at a few hundred rectangles.
 */
export default function Waveform({
  peaks,
  progress,
  onSeek,
  className = '',
  played = PLAYED,
  unplayed = UNPLAYED,
  bar = BAR,
  gap = GAP,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      // Bar and gap snapped to whole device pixels, so a fractional width
      // (1.5px) stays crisp: 3 and 2 on a Retina screen, 2 and 1 on a plain one.
      const barPx = Math.max(1, Math.round(bar * dpr)) / dpr
      const gapPx = Math.max(1, Math.round(gap * dpr)) / dpr
      const bars = Math.max(1, Math.floor((width + gapPx) / (barPx + gapPx)))
      const pairs = peaks ? Math.floor(peaks.length / 2) : 0
      const playedBars = Math.round(progress * bars)

      for (let i = 0; i < bars; i++) {
        let amp = 0
        if (pairs > 0) {
          const from = Math.floor((i / bars) * pairs)
          const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * pairs))
          for (let p = from; p < to; p++) {
            const lo = Math.abs(peaks![p * 2] ?? 0)
            const hi = Math.abs(peaks![p * 2 + 1] ?? 0)
            amp = Math.max(amp, lo, hi)
          }
        }
        const h = pairs > 0 ? Math.max(2, amp * height) : 3
        ctx.fillStyle = i < playedBars ? played : unplayed
        ctx.fillRect(i * (barPx + gapPx), (height - h) / 2, barPx, h)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks, progress, played, unplayed, bar, gap])

  return (
    <canvas
      ref={ref}
      className={`block h-9 w-full cursor-pointer ${className}`}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        if (rect.width > 0) onSeek((e.clientX - rect.left) / rect.width)
      }}
    />
  )
}
