/**
 * Webflow's "Loading Modal", copied rather than approximated: a Sequel Brown
 * square, 3.8rem in a 6rem box, turning over on both axes across six
 * seconds on the site's own easing. `loading modal wrapper` is the sheet it
 * sits on — Sequel Silver, edge to edge, everything centred.
 */
export function Loader({ className = '' }: { className?: string }) {
  return (
    <div className={`loader ${className}`} aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <rect width="20" height="20" className="loader-square" />
      </svg>
    </div>
  )
}

/** The full sheet: what a page shows while it has nothing to show yet. */
export default function LoadingModal({
  label = 'Loading',
}: {
  label?: string
}) {
  return (
    <div className="loading-modal" role="status" aria-label={label}>
      <Loader />
    </div>
  )
}
