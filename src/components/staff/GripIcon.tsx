/**
 * The drag handle on a track row.
 *
 * Drawn rather than typed. It used to be two ⋮ characters (U+22EE), which
 * Creato Display has no glyph for — so the browser substituted from whatever
 * fallback it had and rendered them as a ragged cluster of dots that changed
 * shape between machines. An SVG is the same everywhere.
 */
export default function GripIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="16"
      viewBox="0 0 10 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <circle cx="2" cy="3" r="1.15" />
      <circle cx="8" cy="3" r="1.15" />
      <circle cx="2" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="2" cy="13" r="1.15" />
      <circle cx="8" cy="13" r="1.15" />
    </svg>
  )
}
