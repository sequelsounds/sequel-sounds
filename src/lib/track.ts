/**
 * Sequel Track lives on the Webflow site. Its project page is keyed by the
 * project's UUID — the Project Master List's UUID column in Xano, mirrored as
 * `xano_uuid` — not by the numeric id. No UUID, no link.
 */
const TRACK_PROJECT_PAGE = 'https://www.sequelsounds.app/project'

export function trackProjectUrl(xanoUuid: string | null): string | null {
  return xanoUuid ? `${TRACK_PROJECT_PAGE}?uuid=${encodeURIComponent(xanoUuid)}` : null
}
