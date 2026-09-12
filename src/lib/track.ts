/**
 * Sequel Track lives on the Webflow site. The project page there is keyed by
 * Xano's own id, which the mirror keeps as `xano_id`.
 */
const TRACK_ORIGIN = 'https://sequelsounds.app'

export function trackProjectUrl(xanoId: string): string {
  return `${TRACK_ORIGIN}/projects/${encodeURIComponent(xanoId)}`
}
