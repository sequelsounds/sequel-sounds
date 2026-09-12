import { useEffect, useRef } from 'react'

type Props = {
  /** Flat [min, max, min, max, …] from the Lambda's peaks.json. */
  peaks: number[] | null
  /** 0–1 played. */
  progress: number
  onSeek: (fraction: number) => void
  className?: string
}

const BAR = 3
const GAP = 1
const PLAYED = '#f1f0ee'
// Sequel Silver at low alpha, so the unplayed bars sit on Sequel Brown
// rather than introducing a third grey.
const UNPLAYED = 'rgba(241, 240, 238, 0.35)'

/**
 * Bars from peaks, drawn on a canvas because the bar count follows the width
 * and two thousand DOM nodes per track would be felt. Redrawn on resize and on
 * every progress tick — cheap at a few hundred rectangles.
 */
export default function Waveform({ peaks, progress, onSeek, className = '' }: Props) {
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

      const bars = Math.max(1, Math.floor((width + GAP) / (BAR + GAP)))
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
        ctx.fillStyle = i < playedBars ? PLAYED : UNPLAYED
        ctx.fillRect(i * (BAR + GAP), (height - h) / 2, BAR, h)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks, progress])

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
