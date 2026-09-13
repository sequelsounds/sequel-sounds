import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

type Props = {
  /** 0 to 1. */
  value: number
  onChange: (next: number) => void
}

const STEP = 0.05

/**
 * The volume slider, built from plain elements rather than `input[type=range]`.
 *
 * A range input is three parts with a different name in every engine, and each
 * one has defaults that have to be turned off rather than overridden — the
 * radius alone renders square in Chromium and round in Firefox unless both
 * vendor pseudo-elements say otherwise. That is a control whose appearance can
 * only be confirmed by opening every browser, and this one is looked at all
 * day.
 *
 * Two divs and a span have no engine-specific parts, so checking it once
 * checks it everywhere. What the input was giving us free — a role, a value,
 * arrow keys — is written out below instead.
 */
export default function VolumeSlider({ value, onChange }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)

  const setFromX = (clientX: number) => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    onChange((clientX - box.left) / box.width)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Capture, so a drag that leaves the 80px track keeps setting the level
    // instead of stopping at the edge.
    e.currentTarget.setPointerCapture(e.pointerId)
    setFromX(e.clientX)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 0) setFromX(e.clientX)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = (d: number) => {
      e.preventDefault()
      onChange(value + d)
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') by(STEP)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') by(-STEP)
    else if (e.key === 'Home') by(-1)
    else if (e.key === 'End') by(1)
  }

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%`}
      className="volume"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <span className="volume-line" />
      <span className="volume-fill" style={{ width: `${pct}%` }} />
      <span className="volume-thumb" style={{ left: `${pct}%` }} />
    </div>
  )
}
