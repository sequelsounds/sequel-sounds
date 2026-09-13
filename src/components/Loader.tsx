/**
 * Webflow's "Loading Modal", verbatim: a cassette with its two reels
 * turning at different speeds — the left one slower, as on a real deck
 * where the full spool turns slower than the empty one. The SVG carries
 * its own styles and animation, so it is served as a file rather than
 * inlined; a browser runs an SVG's CSS animation inside an <img>, and the
 * reduced-motion rule the embed carries keeps working there too.
 */
export function Loader({ className = '' }: { className?: string }) {
  return (
    <div className={`loader ${className}`}>
      <img src="/cassette-loader.svg" alt="Loading" width={400} height={260} />
    </div>
  )
}

/** The full sheet: what a page shows while it has nothing to show yet. */
export default function LoadingModal() {
  return (
    <div className="loading-modal" role="status">
      <Loader />
    </div>
  )
}
