import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * The two line charts on `/management`: Revenue and Projects.
 *
 * Track draws these with Chart.js. This is SVG instead — the shapes are a
 * twelve-point line and a legend, and pinning a charting library to match one
 * page's defaults is more to keep in step than the drawing itself. Everything
 * that shows on screen is matched deliberately: the curve is Chart.js's own
 * cardinal spline at tension 0.25, the dashes are 4/4, the grid is Sequel
 * Brown at 8% and the axis figures at 50%.
 *
 * ⚠️ A gap is a gap. `spanGaps` is false on Track, so a month with no
 * invoices breaks the line rather than drawing a straight run across it —
 * which is what stops an empty October reading as a slow decline.
 */

export type ChartSeries = {
  label: string
  /** Twelve values. Null where the month has nothing, never zero. */
  data: (number | null)[]
  colour: string
  /** Solid at 1.5px is this year, dashed at 1px is the second measure. */
  solid: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Measured off Track's canvas at 1440: the top gridline sits 16px down, the
// December point 19px in from the right, and the month labels 23px under the
// baseline. Absolute, because Chart.js's paddings are absolute too.
const PAD = { top: 16, right: 19, bottom: 26 }
const TENSION = 0.25

/**
 * Chart.js's tick hunt, near enough: at most five lines, on a round step, and
 * the top one at or above the highest value — an axis that stopped below its
 * own data would clip the line it is there to measure.
 */
function ticks(max: number): number[] {
  if (max <= 0) return [0]
  const rough = max / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? power * 10
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let i = 0; i * step <= top + step * 0.001; i++) out.push(i * step)
  return out
}

type Point = { x: number; y: number }

/**
 * Chart.js's splineCurve, which weights each control point by the distance to
 * its neighbour — so a spike between two flat months does not overshoot.
 */
function path(points: (Point | null)[]): string {
  let d = ''
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p) continue
    const prev = points[i - 1] ?? null
    if (!prev) {
      d += `M${p.x} ${p.y}`
      continue
    }
    const before = points[i - 2] ?? prev
    const after = points[i + 1] ?? p
    const cp1 = control(before, prev, p, true)
    const cp2 = control(prev, p, after, false)
    d += `C${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${p.x} ${p.y}`
  }
  return d
}

function control(p0: Point, p1: Point, p2: Point, next: boolean): Point {
  const d01 = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const total = d01 + d12
  if (total === 0) return { x: p1.x, y: p1.y }
  const f = TENSION * (next ? d12 / total : d01 / total)
  const dir = next ? 1 : -1
  return {
    x: p1.x + dir * f * (p2.x - p0.x),
    y: p1.y + dir * f * (p2.y - p0.y),
  }
}

export default function LineChart({
  series,
  format,
}: {
  series: ChartSeries[]
  /** How a value reads in the axis and the tooltip — money, or a whole count. */
  format: (value: number) => string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<number | null>(null)

  // The pane is a flex child of a tab that starts hidden, so the first
  // measurement is zero and has to be taken again when it appears.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w, h } = size

  const scale = useMemo(() => {
    const highest = Math.max(
      0,
      ...series.flatMap((s) => s.data.filter((v): v is number => v != null)),
    )
    const lines = ticks(highest)
    const top = lines[lines.length - 1] || 1
    // The gutter is as wide as the widest figure in it, so a count of
    // projects does not get the same 64px a six-figure sum needs.
    const longest = Math.max(...lines.map((v) => format(v).length), 1)
    return { lines, top, padLeft: Math.max(28, longest * 7 + 24) }
  }, [series, format])

  const innerW = Math.max(0, w - scale.padLeft - PAD.right)
  const innerH = Math.max(0, h - PAD.top - PAD.bottom)

  const x = (i: number) => scale.padLeft + (innerW * i) / 11
  const y = (v: number) => PAD.top + innerH - (innerH * v) / scale.top

  if (w === 0 || h === 0)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div ref={wrap} className="chart-wrap" />
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={wrap}
        className="chart-wrap"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const at = e.clientX - box.left - scale.padLeft
          if (innerW <= 0) return
          const i = Math.round((at / innerW) * 11)
          setHover(i < 0 || i > 11 ? null : i)
        }}
      >
        <svg width={w} height={h} role="img" aria-label="Monthly totals">
          {scale.lines.map((v) => (
            <g key={v}>
              <line
                x1={scale.padLeft}
                x2={w - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="rgba(55, 43, 41, 0.08)"
              />
              <text
                x={scale.padLeft - 10}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="rgba(55, 43, 41, 0.5)"
                fontSize="11"
              >
                {format(v)}
              </text>
            </g>
          ))}

          {MONTHS.map((m, i) => (
            <text
              key={m}
              x={x(i)}
              y={h - 6}
              textAnchor="middle"
              fill="var(--color-sequel-brown)"
              fontSize="11"
            >
              {m}
            </text>
          ))}

          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="rgba(55, 43, 41, 0.25)"
            />
          )}

          {series.map((s) => (
            <path
              key={s.label}
              d={path(s.data.map((v, i) => (v == null ? null : { x: x(i), y: y(v) })))}
              fill="none"
              stroke={s.colour}
              strokeWidth={s.solid ? 1.5 : 1}
              strokeDasharray={s.solid ? undefined : '4 4'}
              strokeLinecap="round"
            />
          ))}

          {hover != null &&
            series.map((s) =>
              s.data[hover] == null ? null : (
                <circle
                  key={s.label}
                  cx={x(hover)}
                  cy={y(s.data[hover] as number)}
                  r={4}
                  fill={s.colour}
                />
              ),
            )}
        </svg>

        {hover != null && series.some((s) => s.data[hover] != null) && (
          <div
            className="chart-tip"
            style={{
              // Flips to the left of the pointer near the right edge, so the
              // card never runs off the pane.
              left: x(hover) > w * 0.7 ? undefined : x(hover) + 14,
              right: x(hover) > w * 0.7 ? w - x(hover) + 14 : undefined,
              top: PAD.top,
            }}
          >
            <div>{MONTHS[hover]}</div>
            {series.map((s) =>
              s.data[hover] == null ? null : (
                <div key={s.label}>
                  {s.label}
                  {'  '}
                  {format(s.data[hover] as number)}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label} className="chart-legend-item">
            <span
              className="chart-legend-key"
              style={{
                borderTopColor: s.colour,
                borderTopStyle: s.solid ? 'solid' : 'dashed',
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
