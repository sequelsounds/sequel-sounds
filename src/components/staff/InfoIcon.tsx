/**
 * The details mark on a track row.
 *
 * Taken from the supplied SVG, with two changes: the opaque white backing
 * rect is dropped, since the row it sits on inverts to Sequel Brown on hover
 * and a white square would punch through it; and the strokes are
 * `currentColor` rather than black, so the mark follows the row's text the
 * way the share mark does.
 */
export default function InfoIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1rem"
      height="1rem"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11V17" />
      <path d="M11.75 8V7H12.25V8H11.75Z" />
    </svg>
  )
}
